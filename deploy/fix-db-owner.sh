#!/usr/bin/env bash
# One-time fix: make the app's database user the OWNER of all the app's tables, so that the database
# changes that come with updates are allowed. Changes no data. Safe to run again.
#
#   bash deploy/fix-db-owner.sh
#
# Reads DATABASE_URL from the settings file (<project>/.env). Finds PostgreSQL in Docker, or on this server.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${WGL_ENV_FILE:-$ROOT/.env}"

say() { printf '%s\n' "$*"; }
die() { printf 'STOPPED: %s\n' "$*" >&2; exit 1; }

[ -f "$ENV_FILE" ] || die "settings file $ENV_FILE not found. Run  bash deploy/update.sh  once (it creates it), or create it with a DATABASE_URL=... line."
URL="$(sed -n -E 's/^[[:space:]]*(export[[:space:]]+)?DATABASE_URL=//p' "$ENV_FILE" | tail -1 | sed -E "s/^[\"']//; s/[\"']$//")"
[ -n "$URL" ] || die "no DATABASE_URL line in $ENV_FILE."
APPUSER="$(printf '%s' "$URL" | sed -E 's#^[a-z]+://([^:/@]+).*#\1#')"
DB="$(printf '%s' "$URL" | sed -E 's#^.*/([^/?]+)(\?.*)?$#\1#')"
[ -n "$APPUSER" ] && [ -n "$DB" ] || die "could not read the user and database name from DATABASE_URL."
say "App database: $DB · app user: $APPUSER"

SQL=$(cat <<EOF
DO \$\$ DECLARE r record; BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tableowner <> '$APPUSER' LOOP
    EXECUTE format('ALTER TABLE public.%I OWNER TO %I', r.tablename, '$APPUSER');
  END LOOP;
  FOR r IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relkind = 'S' AND pg_get_userbyid(c.relowner) <> '$APPUSER'
             AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype IN ('a', 'i')) LOOP
    EXECUTE format('ALTER SEQUENCE public.%I OWNER TO %I', r.relname, '$APPUSER');
  END LOOP;
END \$\$;
GRANT ALL ON SCHEMA public TO "$APPUSER";
SELECT count(*) AS tables_owned_by_app FROM pg_tables WHERE schemaname = 'public' AND tableowner = '$APPUSER';
SELECT count(*) AS tables_owned_by_others FROM pg_tables WHERE schemaname = 'public' AND tableowner <> '$APPUSER';
EOF
)

# ---- find a way in as the database administrator
DOCKER=""
if command -v docker >/dev/null 2>&1; then
  if docker ps >/dev/null 2>&1; then DOCKER="docker"; elif sudo -n docker ps >/dev/null 2>&1 || sudo docker ps >/dev/null 2>&1; then DOCKER="sudo docker"; fi
fi
RUN=""
if [ -n "$DOCKER" ]; then
  for C in $($DOCKER ps --format '{{.Names}} {{.Image}}' | awk 'tolower($2) ~ /postgres|postgis|timescale/ {print $1}'); do
    SUPER="$($DOCKER exec "$C" printenv POSTGRES_USER 2>/dev/null || true)"; SUPER="${SUPER:-postgres}"
    if $DOCKER exec "$C" psql -U "$SUPER" -d "$DB" -tAc 'select 1' >/dev/null 2>&1; then
      RUN="$DOCKER exec -i $C psql -v ON_ERROR_STOP=1 -U $SUPER -d $DB"; say "Found PostgreSQL in Docker container \"$C\" (administrator: $SUPER)."; break
    fi
  done
fi
if [ -z "$RUN" ] && command -v psql >/dev/null 2>&1 && id postgres >/dev/null 2>&1; then
  if sudo -u postgres psql -d "$DB" -tAc 'select 1' >/dev/null 2>&1; then RUN="sudo -u postgres psql -v ON_ERROR_STOP=1 -d $DB"; say "Found PostgreSQL on this server."; fi
fi
if [ -z "$RUN" ]; then
  say "Could not reach PostgreSQL as its administrator automatically."
  say "Ask the person who manages the database to run this SQL in database \"$DB\" as an administrator:"
  say "-----"; say "$SQL"; say "-----"
  exit 1
fi

say "This makes \"$APPUSER\" the owner of every table and sequence in \"$DB\" (no data is changed)."
if [ "${1:-}" != "--yes" ]; then
  read -r -p "Go ahead? [y/N] " ok
  case "$ok" in y|Y|yes|YES) ;; *) say "Nothing changed."; exit 1 ;; esac
fi
printf '%s\n' "$SQL" | $RUN
say "Done. Check:  cd $ROOT/app && npm run db-check -w server"
