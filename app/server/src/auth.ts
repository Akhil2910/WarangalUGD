/**
 * Sign-in, sessions and the guards every route uses.
 *  - httpOnly JWT cookie, SameSite=Lax, 14 days; a per-user session_version signs all devices out
 *    on password reset, role change or disable.
 *  - 8 failed sign-ins per email+IP per 15 minutes, then refused.
 *  - One-time passwords must be changed before anything else (enforced here, on the server).
 *  - State-changing /api calls must carry the CSRF header (checked on the decoded path).
 */
import { randomBytes } from 'node:crypto';
import { appendFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { CSRF_HEADER, PASSWORD_MIN_LENGTH, ROLES, type Role } from 'shared';
import { COOKIE_SECURE, SEED_FILE, SESSION_DAYS, SESSION_SECRET, STATE_DIR } from './config.ts';
import type { Db } from './db.ts';
import { roleEntry, ulbOf } from './perms.ts';
import { cur, prefixFor, withUlb } from './ulbctx.ts';
import type { Action } from 'shared';

export const COOKIE = 'wgl_session';
const MAX_FAILS = 8;
const FAIL_WINDOW_MIN = 15;

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  designation: string;
  role: Role;
  supervisor: boolean;
  areas: Record<string, unknown>;
  must_change_password: boolean;
  ulb_id: number;
  home_ulb_id: number;
  ulb_prefix: string;
  /** The ULB's short code, name and app title, for the header. */
  ulb: { code: string; short_name: string; name: string; app_title: string };
  role_key: string;
  role_label: string;
  perms: Action[];
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: SessionUser;
  }
}

export class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

export function oneTimePassword(): string {
  // 12 characters, no look-alikes (0/O, 1/l/I)
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const bytes = randomBytes(12);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

export async function audit(db: Db, actor: string | null, action: string, detail: Record<string, unknown> = {}, ulb = cur()) {
  await db.query('INSERT INTO audit_log (actor, action, detail, ulb_id) VALUES ($1, $2, $3, $4)', [actor, action, JSON.stringify(detail), ulb]);
}

/** Create starting accounts from the release file, by key, once. */
export async function seedAccounts(db: Db, log: (m: string) => void) {
  const file = JSON.parse(readFileSync(SEED_FILE, 'utf8')) as {
    accounts: { key: string; email: string; name: string; designation?: string; role: Role; areas?: Record<string, unknown> }[];
  };
  for (const a of file.accounts) {
    const done = await db.query('SELECT 1 FROM seeded_accounts WHERE seed_key = $1', [a.key]);
    if (done.length) continue;
    if (!ROLES.includes(a.role)) throw new Error(`Seed account ${a.key}: unknown role ${a.role}`);
    const existing = await db.query<{ id: string }>('SELECT id FROM users WHERE lower(email) = lower($1)', [a.email]);
    let userId: string;
    if (existing.length) {
      userId = existing[0].id; // never re-create; just register the key
    } else {
      // DEFAULT_PASSWORD (set on the server, never in the code): new accounts get it and are not asked to change it
      const common = process.env.DEFAULT_PASSWORD;
      const pw = common || oneTimePassword();
      const rows = await db.query<{ id: string }>(
        `INSERT INTO users (email, name, designation, role, areas, password_hash, must_change_password)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [a.email, a.name, a.designation ?? '', a.role, JSON.stringify(a.areas ?? {}), await bcrypt.hash(pw, 10), !common],
      );
      userId = rows[0].id;
      if (!common) appendFileSync(
        path.join(STATE_DIR, 'initial-passwords.txt'),
        `${new Date().toISOString()}  ${a.email}  one-time password: ${pw}\n`,
        { mode: 0o600 },
      );
      log(`starting account created: ${a.email} (one-time password written to app-state/initial-passwords.txt)`);
    }
    await db.query('INSERT INTO seeded_accounts (seed_key, user_id) VALUES ($1, $2)', [a.key, userId]);
  }
}

function setSession(reply: FastifyReply, userId: string, sv: number) {
  const token = jwt.sign({ sub: userId, sv }, SESSION_SECRET, { expiresIn: `${SESSION_DAYS}d` });
  reply.setCookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: COOKIE_SECURE,
    path: '/',
    maxAge: SESSION_DAYS * 86400,
  });
}

async function loadUser(db: Db, req: FastifyRequest): Promise<SessionUser | undefined> {
  const token = req.cookies?.[COOKIE];
  if (!token) return undefined;
  let claims: { sub: string; sv: number };
  try {
    claims = jwt.verify(token, SESSION_SECRET) as { sub: string; sv: number };
  } catch {
    return undefined;
  }
  if (!/^[0-9a-f-]{36}$/i.test(claims.sub)) return undefined;
  const rows = await db.query<SessionUser & { active: boolean; session_version: number }>(
    `SELECT id, email, name, designation, role, supervisor, areas, must_change_password, active, session_version, ulb_id, role_key, prefs
     FROM users WHERE id = $1`,
    [claims.sub],
  );
  const u = rows[0];
  if (!u || !u.active || u.session_version !== claims.sv) return undefined;
  const { active: _a, session_version: _s, prefs, ...user } = u as typeof u & { prefs?: { active_ulb?: number } };
  const home = Number(user.ulb_id ?? 1);
  // the State Admin works in the ULB they last switched to
  const ulb = user.role === 'super_admin' && prefs?.active_ulb ? Number(prefs.active_ulb) : home;
  const info = await ulbOf(db.query.bind(db), ulb);
  const key = user.role_key || user.role;
  const e = await roleEntry(db.query.bind(db), ulb, key, user.role);
  return { ...user, ulb_id: ulb, home_ulb_id: home, ulb_prefix: prefixFor(ulb, info.code), ulb: { code: info.code, short_name: info.settings.short_name, name: info.name, app_title: info.settings.app_title }, role_key: key, role_label: e.label, perms: e.grants };
}

// /api/auth/me answers {user: undefined} when signed out (no error), so the app can show the sign-in page.
const PUBLIC_API = new Set(['/api/auth/login', '/api/health', '/api/auth/me']);
const ALLOWED_DURING_PW_CHANGE = new Set(['/api/auth/me', '/api/auth/change-password', '/api/auth/logout']);

export function registerAuth(app: FastifyInstance, db: Db) {
  app.addHook('onRequest', async (req) => {
    let p: string;
    try {
      p = decodeURIComponent(req.url.split('?')[0]);
    } catch {
      throw new HttpError(400, 'Malformed address.');
    }
    const isApi = p.startsWith('/api/');
    const isData = p.startsWith('/data/');
    if (isApi && !['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers[CSRF_HEADER] !== '1') {
      throw new HttpError(403, 'Request refused: missing security header.', 'CSRF');
    }
    if (!isApi && !isData) return;
    req.user = await loadUser(db, req);
    if (PUBLIC_API.has(p) || p.startsWith('/api/public/')) return; // /api/public: citizens' grievance form (no account)
    if (!req.user) throw new HttpError(401, 'Please sign in.', 'UNAUTHENTICATED');
    if (req.user.must_change_password && !ALLOWED_DURING_PW_CHANGE.has(p)) {
      throw new HttpError(403, 'Please change your one-time password first.', 'PASSWORD_CHANGE_REQUIRED');
    }
  });
  // everything that answers this request works inside the user's ULB
  app.addHook('preHandler', (req, _reply, done) => {
    if (!req.user) return done();
    withUlb(req.user.ulb_id, req.user.ulb_prefix, done);
  });

  const loginBody = z.object({ email: z.string().trim().min(3).max(200), password: z.string().min(1).max(200) });
  app.post('/api/auth/login', async (req, reply) => {
    const parsed = loginBody.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, 'Enter your email and password.');
    const { email, password } = parsed.data;
    const ip = req.ip;
    const fails = await db.query<{ n: string }>(
      `SELECT count(*) AS n FROM sign_in_attempts
       WHERE lower(email) = lower($1) AND ip = $2 AND NOT ok AND at > now() - interval '${FAIL_WINDOW_MIN} minutes'`,
      [email, ip],
    );
    if (Number(fails[0].n) >= MAX_FAILS) {
      throw new HttpError(429, `Too many failed sign-ins. Try again in ${FAIL_WINDOW_MIN} minutes.`);
    }
    const rows = await db.query<{ id: string; password_hash: string; active: boolean; session_version: number; ulb_id: number }>(
      'SELECT id, password_hash, active, session_version, ulb_id FROM users WHERE lower(email) = lower($1)',
      [email],
    );
    const u = rows[0];
    const ok = !!u && u.active && (await bcrypt.compare(password, u.password_hash));
    await db.query('INSERT INTO sign_in_attempts (email, ip, ok) VALUES ($1, $2, $3)', [email, ip, ok]);
    if (!ok) {
      await audit(db, u?.id ?? null, 'sign_in_failed', { email, ip }, Number(u?.ulb_id ?? 1));
      throw new HttpError(401, 'Email or password is not correct.');
    }
    setSession(reply, u.id, u.session_version);
    await audit(db, u.id, 'sign_in', { ip }, Number(u.ulb_id));
    const user = await db.query('SELECT must_change_password FROM users WHERE id = $1', [u.id]);
    return { ok: true, mustChangePassword: user[0].must_change_password };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    reply.clearCookie(COOKIE, { path: '/' });
    if (req.user) await audit(db, req.user.id, 'sign_out');
    return { ok: true };
  });

  app.get('/api/auth/me', async (req) => ({ user: req.user }));

  const pwBody = z.object({
    currentPassword: z.string().min(1).max(200),
    newPassword: z.string().min(PASSWORD_MIN_LENGTH, `The new password needs at least ${PASSWORD_MIN_LENGTH} characters.`).max(200),
  });
  app.post('/api/auth/change-password', async (req, reply) => {
    const parsed = pwBody.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? 'Invalid input.');
    const u = req.user!;
    const rows = await db.query<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1', [u.id]);
    if (!(await bcrypt.compare(parsed.data.currentPassword, rows[0].password_hash))) {
      throw new HttpError(400, 'The current password is not correct.');
    }
    if (parsed.data.newPassword === parsed.data.currentPassword) throw new HttpError(400, 'Choose a password different from the current one.');
    const upd = await db.query<{ session_version: number }>(
      `UPDATE users SET password_hash = $2, must_change_password = false, session_version = session_version + 1, updated_at = now()
       WHERE id = $1 RETURNING session_version`,
      [u.id, await bcrypt.hash(parsed.data.newPassword, 10)],
    );
    setSession(reply, u.id, upd[0].session_version); // this device stays signed in; others are signed out
    await audit(db, u.id, 'password_changed');
    return { ok: true };
  });
}
