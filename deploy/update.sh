#!/usr/bin/env bash
# Safe update of the server:  bash deploy/update.sh
#
#  1. settings file (.env) — created the first time from the running app (or by asking for the database address)
#  2. get the new code from GitHub
#  3. install and build
#  4. check the database (connection, pending changes, table ownership)
#  5. back up the database (.sql in app-state/backups, newest 10 kept)
#  6. apply the database changes — all or nothing — BEFORE restarting
#  7. restart and check the app answers
# If anything fails, it goes back to the previous version and restarts that, so the app stays up.
#
# Options: PM2_NAME=warangal-ugd (default)   BRANCH=main (default)   --yes (no questions)
set -uo pipefail

# run from a copy, so that pulling a new version of this script does not disturb the running one
if [ -z "${WGL_UPDATE_COPY:-}" ]; then
  tmp="$(mktemp /tmp/wgl-update.XXXXXX.sh)"; cp "$0" "$tmp"
  WGL_UPDATE_COPY=1 WGL_ROOT="$(cd "$(dirname "$0")/.." && pwd)" exec bash "$tmp" "$@"
fi
ROOT="${WGL_ROOT}"
APP="$ROOT/app"
NAME="${PM2_NAME:-warangal-ugd}"
BRANCH="${BRANCH:-main}"
ENV_FILE="${WGL_ENV_FILE:-$ROOT/.env}"
YES=""; [ "${1:-}" = "--yes" ] && YES=1
KEYS="DATABASE_URL PORT HOST DATA_DIR STATE_DIR PUBLIC_BASE_URL COOKIE_SECURE SESSION_SECRET DEFAULT_PASSWORD"

step() { printf '\n== %s\n' "$*"; }
say() { printf '%s\n' "$*"; }
ask() { [ -n "$YES" ] && return 0; read -r -p "$1 [y/N] " a; case "$a" in y|Y|yes|YES) return 0 ;; *) return 1 ;; esac; }
envval() { sed -n -E "s/^[[:space:]]*(export[[:space:]]+)?$1=//p" "$ENV_FILE" 2>/dev/null | tail -1 | sed -E "s/^[\"']//; s/[\"']$//"; }
cd "$ROOT" || exit 1

# ---------------- 1. settings file
step "1/7 Settings file ($ENV_FILE)"
if [ ! -s "$ENV_FILE" ] || [ -z "$(envval DATABASE_URL)" ]; then
  pid="$(pgrep -f 'server/src/index.ts' | tail -1 || true)"
  if [ -n "$pid" ] && sudo test -r "/proc/$pid/environ"; then
    say "Taking the settings from the running app (process $pid)."
    { echo "# Warangal UGD Tracker settings — read by the app and its commands. Keep private (chmod 600)."
      sudo cat "/proc/$pid/environ" | tr '\0' '\n' | grep -E "^($(echo $KEYS | tr ' ' '|'))=" ; } > "$ENV_FILE.new"
  fi
  # the address given to this shell, or to pm2's own background process
  if [ ! -s "$ENV_FILE.new" ] || ! grep -q '^DATABASE_URL=' "$ENV_FILE.new" 2>/dev/null; then
    if [ -n "${DATABASE_URL:-}" ]; then say "Using the database address from this shell."; echo "DATABASE_URL=$DATABASE_URL" > "$ENV_FILE.new"; fi
  fi
  if [ ! -s "$ENV_FILE.new" ] || ! grep -q '^DATABASE_URL=' "$ENV_FILE.new" 2>/dev/null; then
    gpid="$(pgrep -f 'PM2 v.*God Daemon' | head -1 || true)"
    if [ -n "$gpid" ] && sudo cat "/proc/$gpid/environ" 2>/dev/null | tr '\0' '\n' | grep -q '^DATABASE_URL='; then
      say "Taking the settings from pm2's background process."
      { echo "# Warangal UGD Tracker settings — read by the app and its commands. Keep private (chmod 600)."
        sudo cat "/proc/$gpid/environ" | tr '\0' '\n' | grep -E "^($(echo $KEYS | tr ' ' '|'))=" ; } > "$ENV_FILE.new"
    fi
  fi
  if [ ! -s "$ENV_FILE.new" ] || ! grep -q '^DATABASE_URL=' "$ENV_FILE.new" 2>/dev/null; then
    for f in "$APP/.env" "$APP/server/.env" "$HOME/.env" "$HOME/.bashrc" "$HOME/.profile" "$HOME/.bash_profile" /etc/environment $(ls "$ROOT"/*.sh "$HOME"/*.sh "$ROOT"/ecosystem* "$HOME"/ecosystem* 2>/dev/null); do
      [ -f "$f" ] || continue
      line="$(grep -Eo "DATABASE_URL[=:][[:space:]]*['\"]?postgres[a-z]*://[^'\" ]+" "$f" 2>/dev/null | head -1 || true)"
      if [ -n "$line" ]; then say "Found the database address in $f."; echo "DATABASE_URL=$(echo "$line" | sed -E "s/^DATABASE_URL[=:][[:space:]]*['\"]?//")" > "$ENV_FILE.new"; break; fi
    done
  fi
  if [ ! -s "$ENV_FILE.new" ] || ! grep -q '^DATABASE_URL=' "$ENV_FILE.new" 2>/dev/null; then
    [ -n "$YES" ] && { say "STOPPED: no database address found. Run without --yes to type it."; exit 1; }
    say "The app is not running and no settings were found."
    read -r -s -p "Paste the database address (postgresql://user:password@host:5432/database): " url; echo
    case "$url" in postgres*://*) echo "DATABASE_URL=$url" > "$ENV_FILE.new" ;; *) say "STOPPED: that is not a postgresql:// address."; exit 1 ;; esac
  fi
  [ -s "$ENV_FILE" ] && cat "$ENV_FILE" >> "$ENV_FILE.new"
  mv "$ENV_FILE.new" "$ENV_FILE"; chmod 600 "$ENV_FILE"
  say "Saved $ENV_FILE (private). The app and all commands now read it."
else
  say "OK: $(envval DATABASE_URL | sed -E 's#//([^:]+):[^@]*@#//\1:****@#')"
fi
PORT="$(envval PORT)"; PORT="${PORT:-8787}"
STATE_DIR="$(envval STATE_DIR)"; STATE_DIR="${STATE_DIR:-$ROOT/app-state}"

# ---------------- 2. new code
step "2/7 New code from GitHub ($BRANCH)"
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  say "STOPPED: files in the project were changed on this server:"; git status --short --untracked-files=no
  say "Nothing was updated. Undo those changes (git checkout -- <file>) or tell the developer."; exit 1
fi
PREV="$(git rev-parse HEAD)"
git fetch -q origin "$BRANCH" || { say "STOPPED: cannot reach GitHub."; exit 1; }
git checkout -q "$BRANCH" 2>/dev/null || git checkout -q -b "$BRANCH" "origin/$BRANCH"
git merge -q --ff-only "origin/$BRANCH" || { say "STOPPED: the server's copy has its own commits; tell the developer."; git checkout -q "$PREV"; exit 1; }
NEW="$(git rev-parse HEAD)"
if [ "$PREV" = "$NEW" ]; then say "Already the latest version ($(git log -1 --format='%h %s'))."; else git log --oneline "$PREV..$NEW" | sed 's/^/  new: /'; fi

rollback_code() {
  say "Going back to the previous version ($PREV)…"
  git checkout -q "$PREV" && (cd "$APP" && npm ci --silent && npm run build --silent >/dev/null 2>&1)
}
restart_and_check() {
  pm2 restart "$NAME" >/dev/null 2>&1 || pm2 start npm --name "$NAME" --cwd "$APP" -- start >/dev/null 2>&1
  for i in $(seq 1 40); do
    if curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  return 1
}

# ---------------- 3. install and build
step "3/7 Install and build"
if ! (cd "$APP" && npm ci --silent && npm run build --silent >/dev/null); then
  say "STOPPED: the build failed. The app was not restarted."; rollback_code; exit 1
fi
say "OK"

# ---------------- 4. database check
step "4/7 Database check"
(cd "$APP" && npm run --silent db-check -w server); rc=$?
if [ $rc -eq 2 ]; then
  say "The app's database user does not own the tables, so the database changes would be refused."
  if ask "Fix that now (one-time, no data changed)?" && bash "$ROOT/deploy/fix-db-owner.sh" ${YES:+--yes}; then
    (cd "$APP" && npm run --silent db-check -w server) || { say "STOPPED: still not ready."; rollback_code; exit 1; }
  else
    say "STOPPED: nothing was changed; the app keeps running the previous version."; rollback_code; exit 1
  fi
elif [ $rc -ne 0 ]; then
  say "STOPPED: cannot use the database. The app was not restarted."; rollback_code; exit 1
fi

# ---------------- 5. backup
step "5/7 Database backup"
mkdir -p "$STATE_DIR/backups"
BK="$STATE_DIR/backups/before-update-$(date +%Y-%m-%d-%H%M).sql"
if (cd "$APP" && npm run --silent export-sql -w server -- "$BK" >/dev/null); then
  say "OK: $BK ($(du -h "$BK" | cut -f1))"
  ls -1t "$STATE_DIR"/backups/before-update-*.sql 2>/dev/null | tail -n +11 | xargs -r rm -f
else
  say "STOPPED: the backup failed, so nothing else was done."; rollback_code; exit 1
fi

# ---------------- 6. database changes
step "6/7 Database changes"
if ! (cd "$APP" && npm run --silent migrate -w server); then
  say "STOPPED: a database change failed and was undone (nothing changed). The app keeps running the previous version."
  rollback_code; exit 1
fi

# ---------------- 7. restart
step "7/7 Restart and check"
if restart_and_check; then
  pm2 save >/dev/null 2>&1 || true
  say "DONE: $(git log -1 --format='%h %s') is running. $(curl -s "http://127.0.0.1:$PORT/api/health")"
else
  say "The new version did not start. Logs:"; pm2 logs "$NAME" --lines 20 --nostream --err 2>/dev/null | tail -20
  rollback_code
  if restart_and_check; then say "The previous version is running again. Send the logs above to the developer."; else say "The previous version also did not start — send the logs above to the developer."; fi
  exit 1
fi
