/**
 * Administration for one ULB: users, roles and the permission grid, organisation settings and deadlines, audit log.
 * Each admin works only inside their own ULB (the State Admin manages ULBs — next step).
 * Every change is written to the audit log.
 */
import bcrypt from 'bcryptjs';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ACTION_KEYS, ACTIONS, defaultGrants, PASSWORD_MIN_LENGTH, ROLE_DUTY, ROLE_LABEL, ROLES, type Action, type Role } from 'shared';
import { audit, HttpError, type SessionUser } from './auth.ts';
import type { Db } from './db.ts';
import { has, invalidatePerms, invalidateSettings, roleEntry, ulbOf } from './perms.ts';
import { iso, parse, type Q } from './works.ts';

const ADMIN_ACTIONS: Action[] = ['admin.users', 'admin.roles', 'admin.settings', 'admin.audit'];
const need = (u: SessionUser, a: Action) => { if (!has(u, a)) throw new HttpError(403, 'Your role cannot do this in the Admin panel.'); };
/** Roles a ULB's System Admin may give (the State Admin role is given only by a State Admin). */
const grantable = (u: SessionUser) => ROLES.filter((r) => r !== 'super_admin' || u.role === 'super_admin');

const areasSchema = z.object({
  all: z.boolean().optional(),
  admin_zones: z.array(z.string().max(20)).max(50).optional(),
  wards: z.array(z.number().int().min(1).max(500)).max(500).optional(),
}).strict();

export function registerAdmin(app: FastifyInstance, db: Db) {
  const q: Q = db.query.bind(db);

  /** All roles of this ULB with their labels and effective permissions. */
  async function rolesOf(ulb: number, u: SessionUser) {
    const rows = await q<{ key: string; label: string; base_role: string; builtin: boolean; active: boolean; sort: number }>('SELECT * FROM roles WHERE ulb_id = $1 ORDER BY sort, key', [ulb]);
    const counts = await q<{ k: string; n: string }>(`SELECT COALESCE(role_key, role) AS k, count(*) AS n FROM users WHERE ulb_id = $1 AND active GROUP BY 1`, [ulb]);
    const custom = new Set((await q<{ role_key: string }>('SELECT DISTINCT role_key FROM role_permissions WHERE ulb_id = $1', [ulb])).map((r) => r.role_key));
    const out = [];
    for (const r of grantable(u)) {
      const row = rows.find((x) => x.key === r);
      const e = await roleEntry(q, ulb, r, r);
      out.push({ key: r, label: row?.label ?? ROLE_LABEL[r], base_role: r, builtin: true, active: row?.active ?? true, duty: ROLE_DUTY[r], grants: e.grants, changed: custom.has(r), users: Number(counts.find((c) => c.k === r)?.n ?? 0) });
    }
    for (const row of rows.filter((x) => !x.builtin)) {
      const e = await roleEntry(q, ulb, row.key, row.base_role as Role);
      out.push({ key: row.key, label: row.label, base_role: row.base_role, builtin: false, active: row.active, duty: `Based on ${ROLE_LABEL[row.base_role as Role] ?? row.base_role}`, grants: e.grants, changed: custom.has(row.key), users: Number(counts.find((c) => c.k === row.key)?.n ?? 0) });
    }
    return out;
  }

  app.get('/api/admin/overview', async (req) => {
    const u = req.user!;
    if (!ADMIN_ACTIONS.some((a) => has(u, a))) throw new HttpError(403, 'The Admin panel is for System Admins.');
    const ulb = await ulbOf(q, u.ulb_id);
    const [c] = await q<{ users: string; active: string; roles: string }>(
      `SELECT count(*) AS users, count(*) FILTER (WHERE active) AS active, count(DISTINCT COALESCE(role_key, role)) AS roles FROM users WHERE ulb_id = $1`, [u.ulb_id]);
    return { ulb: { id: u.ulb_id, ...ulb }, users: Number(c.users), active_users: Number(c.active), roles_in_use: Number(c.roles), can: Object.fromEntries(ADMIN_ACTIONS.map((a) => [a, has(u, a)])) };
  });

  // ---------------- users ----------------
  app.get('/api/admin/users', async (req) => {
    const u = req.user!;
    need(u, 'admin.users');
    const rows = await q<Record<string, unknown>>(
      `SELECT u.id, u.email, u.name, u.designation, u.phone, u.role, u.role_key, u.areas, u.active, u.created_at,
              (SELECT max(at) FROM sign_in_attempts s WHERE lower(s.email) = lower(u.email) AND s.ok) AS last_sign_in
       FROM users u WHERE u.ulb_id = $1 ORDER BY u.active DESC, u.name`, [u.ulb_id]);
    const roles = await rolesOf(u.ulb_id, u);
    const label = (k: string) => roles.find((r) => r.key === k)?.label ?? k;
    return {
      users: rows.map((r) => ({ ...r, role_key: (r.role_key as string) || r.role, role_label: label(((r.role_key as string) || r.role) as string), created_at: iso(r.created_at), last_sign_in: iso(r.last_sign_in) })),
      roles: roles.filter((r) => r.active).map((r) => ({ key: r.key, label: r.label, base_role: r.base_role })),
    };
  });

  const userBody = z.object({
    name: z.string().trim().min(2).max(120),
    email: z.string().trim().toLowerCase().email().max(200),
    designation: z.string().trim().max(120).default(''),
    phone: z.string().trim().max(20).default(''),
    role_key: z.string().max(60),
    areas: areasSchema.default({ all: true }),
    password: z.string().min(PASSWORD_MIN_LENGTH, `The password needs at least ${PASSWORD_MIN_LENGTH} characters.`).max(200).optional(),
    active: z.boolean().default(true),
  });
  const resolveRole = async (u: SessionUser, key: string): Promise<{ role: Role; role_key: string | null }> => {
    if ((ROLES as readonly string[]).includes(key)) {
      if (!grantable(u).includes(key as Role)) throw new HttpError(403, 'Only a State Admin can give that role.');
      return { role: key as Role, role_key: null };
    }
    const r = (await q<{ base_role: string; active: boolean }>('SELECT base_role, active FROM roles WHERE ulb_id = $1 AND key = $2', [u.ulb_id, key]))[0];
    if (!r || !r.active) throw new HttpError(400, 'That role does not exist or is switched off.');
    return { role: r.base_role as Role, role_key: key };
  };

  app.post('/api/admin/users', async (req) => {
    const u = req.user!;
    need(u, 'admin.users');
    const b = parse(userBody, req.body);
    if (!b.password) throw new HttpError(400, 'Give the user a password.');
    if ((await q('SELECT 1 FROM users WHERE lower(email) = lower($1)', [b.email])).length) throw new HttpError(409, 'A user with this e-mail already exists.');
    const r = await resolveRole(u, b.role_key);
    const [row] = await q<{ id: string }>(
      `INSERT INTO users (email, name, designation, phone, role, role_key, areas, password_hash, must_change_password, active, ulb_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,false,$9,$10) RETURNING id`,
      [b.email, b.name, b.designation, b.phone, r.role, r.role_key, JSON.stringify(b.areas), await bcrypt.hash(b.password, 10), b.active, u.ulb_id]);
    await audit(db, u.id, 'admin_user_added', { user: row.id, email: b.email, role: b.role_key });
    return { ok: true, id: row.id };
  });

  app.post<{ Params: { id: string } }>('/api/admin/users/:id', async (req) => {
    const u = req.user!;
    need(u, 'admin.users');
    if (!/^[0-9a-f-]{36}$/.test(req.params.id)) throw new HttpError(404, 'User not found.');
    const b = parse(userBody.partial().omit({ password: true }), req.body);
    const cur = (await q<{ id: string; role: string; email: string }>('SELECT id, role, email FROM users WHERE id = $1 AND ulb_id = $2', [req.params.id, u.ulb_id]))[0];
    if (!cur) throw new HttpError(404, 'User not found.');
    if (cur.role === 'super_admin' && u.role !== 'super_admin') throw new HttpError(403, 'Only a State Admin can change a State Admin.');
    if (cur.id === u.id && (b.active === false || (b.role_key && b.role_key !== (u.role_key)))) throw new HttpError(400, 'You cannot switch off or change the role of your own account.');
    if (b.email && b.email !== cur.email && (await q('SELECT 1 FROM users WHERE lower(email) = lower($1) AND id <> $2', [b.email, cur.id])).length) throw new HttpError(409, 'A user with this e-mail already exists.');
    const sets: string[] = []; const vals: unknown[] = [cur.id];
    const put = (col: string, v: unknown) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
    if (b.name !== undefined) put('name', b.name);
    if (b.email !== undefined) put('email', b.email);
    if (b.designation !== undefined) put('designation', b.designation);
    if (b.phone !== undefined) put('phone', b.phone);
    if (b.areas !== undefined) put('areas', JSON.stringify(b.areas));
    if (b.role_key !== undefined) { const r = await resolveRole(u, b.role_key); put('role', r.role); put('role_key', r.role_key); }
    if (b.active !== undefined) put('active', b.active);
    if (!sets.length) return { ok: true };
    // any change to role, areas or access signs the person out, so it takes effect at once
    const signOut = b.role_key !== undefined || b.areas !== undefined || b.active === false;
    await q(`UPDATE users SET ${sets.join(', ')}, updated_at = now()${signOut ? ', session_version = session_version + 1' : ''} WHERE id = $1`, vals);
    await audit(db, u.id, 'admin_user_changed', { user: cur.id, fields: Object.keys(b) });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/admin/users/:id/password', async (req) => {
    const u = req.user!;
    need(u, 'admin.users');
    const b = parse(z.object({ password: z.string().min(PASSWORD_MIN_LENGTH, `The password needs at least ${PASSWORD_MIN_LENGTH} characters.`).max(200) }), req.body);
    const cur = (await q<{ id: string; role: string }>('SELECT id, role FROM users WHERE id = $1 AND ulb_id = $2', [req.params.id, u.ulb_id]))[0];
    if (!cur) throw new HttpError(404, 'User not found.');
    if (cur.role === 'super_admin' && u.role !== 'super_admin') throw new HttpError(403, 'Only a State Admin can change a State Admin.');
    await q('UPDATE users SET password_hash = $2, must_change_password = false, session_version = session_version + 1, updated_at = now() WHERE id = $1', [cur.id, await bcrypt.hash(b.password, 10)]);
    await audit(db, u.id, 'admin_password_set', { user: cur.id });
    return { ok: true };
  });

  // ---------------- roles and the permission grid ----------------
  app.get('/api/admin/roles', async (req) => {
    const u = req.user!;
    need(u, 'admin.roles');
    return { roles: await rolesOf(u.ulb_id, u), actions: ACTIONS };
  });

  const roleBody = z.object({
    key: z.string().regex(/^[a-z][a-z0-9_]{2,40}$/, 'Use small letters, numbers and _ for the key.').optional(),
    label: z.string().trim().min(2).max(80),
    base_role: z.enum(ROLES).optional(),
    active: z.boolean().default(true),
  });
  app.post('/api/admin/roles', async (req) => {
    const u = req.user!;
    need(u, 'admin.roles');
    const b = parse(roleBody, req.body);
    const builtin = b.key && (ROLES as readonly string[]).includes(b.key);
    if (builtin) {
      if (b.key === 'super_admin' || (b.key === 'system_admin' && !b.active)) throw new HttpError(400, 'This role cannot be changed here.');
      await q(`INSERT INTO roles (ulb_id, key, label, base_role, builtin, active) VALUES ($1,$2,$3,$2,true,$4)
               ON CONFLICT (ulb_id, key) DO UPDATE SET label = EXCLUDED.label, active = EXCLUDED.active`, [u.ulb_id, b.key, b.label, b.active]);
    } else {
      const key = b.key ?? `r_${b.label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30)}`;
      const ex = (await q<{ base_role: string }>('SELECT base_role FROM roles WHERE ulb_id = $1 AND key = $2', [u.ulb_id, key]))[0];
      const base = ex?.base_role ?? b.base_role;
      if (!base) throw new HttpError(400, 'Choose the role the new one starts from.');
      if (!grantable(u).includes(base as Role) || base === 'super_admin') throw new HttpError(403, 'A new role cannot be based on that role.');
      await q(`INSERT INTO roles (ulb_id, key, label, base_role, builtin, active, sort) VALUES ($1,$2,$3,$4,false,$5,100)
               ON CONFLICT (ulb_id, key) DO UPDATE SET label = EXCLUDED.label, active = EXCLUDED.active`, [u.ulb_id, key, b.label, base, b.active]);
      b.key = key;
    }
    invalidatePerms();
    await audit(db, u.id, 'admin_role_saved', { key: b.key, label: b.label, active: b.active });
    return { ok: true, key: b.key };
  });

  app.post<{ Params: { key: string } }>('/api/admin/roles/:key/permissions', async (req) => {
    const u = req.user!;
    need(u, 'admin.roles');
    const key = req.params.key;
    const b = parse(z.object({ grants: z.array(z.enum(ACTION_KEYS as [Action, ...Action[]])).max(100) }), req.body);
    const known = (ROLES as readonly string[]).includes(key) || (await q('SELECT 1 FROM roles WHERE ulb_id = $1 AND key = $2', [u.ulb_id, key])).length;
    if (!known || key === 'super_admin') throw new HttpError(404, 'Role not found.');
    // never lock everyone out of administration
    if (key === 'system_admin' && !(['admin.users', 'admin.roles', 'admin.settings'] as Action[]).every((a) => b.grants.includes(a)))
      throw new HttpError(400, 'The System Admin must keep users, roles and settings — otherwise nobody could manage the system.');
    await db.tx(async (t) => {
      await t('DELETE FROM role_permissions WHERE ulb_id = $1 AND role_key = $2', [u.ulb_id, key]);
      for (const a of ACTION_KEYS) await t('INSERT INTO role_permissions (ulb_id, role_key, action, allowed) VALUES ($1,$2,$3,$4)', [u.ulb_id, key, a, b.grants.includes(a)]);
    });
    invalidatePerms();
    await audit(db, u.id, 'admin_permissions_saved', { role: key, grants: b.grants });
    return { ok: true };
  });

  app.post<{ Params: { key: string } }>('/api/admin/roles/:key/reset', async (req) => {
    const u = req.user!;
    need(u, 'admin.roles');
    await q('DELETE FROM role_permissions WHERE ulb_id = $1 AND role_key = $2', [u.ulb_id, req.params.key]);
    invalidatePerms();
    await audit(db, u.id, 'admin_permissions_reset', { role: req.params.key });
    const base = (ROLES as readonly string[]).includes(req.params.key) ? (req.params.key as Role) : ((await q<{ base_role: Role }>('SELECT base_role FROM roles WHERE ulb_id = $1 AND key = $2', [u.ulb_id, req.params.key]))[0]?.base_role ?? 'viewer');
    return { ok: true, grants: defaultGrants(base) };
  });

  // ---------------- organisation settings ----------------
  app.get('/api/admin/settings', async (req) => {
    const u = req.user!;
    need(u, 'admin.settings');
    return { ulb: await ulbOf(q, u.ulb_id) };
  });
  const settingsBody = z.object({
    name: z.string().trim().min(3).max(160),
    name_local: z.string().trim().max(160).default(''),
    short_name: z.string().trim().min(2).max(20),
    app_title: z.string().trim().min(3).max(60),
    grievance_due_days: z.number().int().min(1).max(60),
    issue_due_days: z.object({ high: z.number().int().min(1).max(90), medium: z.number().int().min(1).max(90), low: z.number().int().min(1).max(180) }),
  });
  app.post('/api/admin/settings', async (req) => {
    const u = req.user!;
    need(u, 'admin.settings');
    const b = parse(settingsBody, req.body);
    const { name, name_local, ...settings } = b;
    await q(`UPDATE ulbs SET name = $2, name_local = $3, settings = settings || $4::jsonb, updated_at = now() WHERE id = $1`, [u.ulb_id, name, name_local, JSON.stringify(settings)]);
    invalidateSettings();
    await audit(db, u.id, 'admin_settings_saved', b);
    return { ok: true };
  });

  // ---------------- audit log ----------------
  app.get<{ Querystring: { before?: string; who?: string; what?: string } }>('/api/admin/audit', async (req) => {
    const u = req.user!;
    need(u, 'admin.audit');
    const where = ['(a.actor IS NULL OR au.ulb_id = $1)'];
    const vals: unknown[] = [u.ulb_id];
    if (req.query.before && /^\d+$/.test(req.query.before)) { vals.push(Number(req.query.before)); where.push(`a.id < $${vals.length}`); }
    if (req.query.what) { vals.push(`%${req.query.what.slice(0, 40)}%`); where.push(`a.action ILIKE $${vals.length}`); }
    if (req.query.who) { vals.push(`%${req.query.who.slice(0, 60)}%`); where.push(`(au.name ILIKE $${vals.length} OR au.email ILIKE $${vals.length})`); }
    const rows = await q<{ id: string; action: string; detail: unknown; at: unknown; name: string | null; email: string | null }>(
      `SELECT a.id, a.action, a.detail, a.at, au.name, au.email FROM audit_log a LEFT JOIN users au ON au.id = a.actor
       WHERE ${where.join(' AND ')} ORDER BY a.id DESC LIMIT 100`, vals);
    return { rows: rows.map((r) => ({ ...r, id: Number(r.id), at: iso(r.at) })) };
  });
}
