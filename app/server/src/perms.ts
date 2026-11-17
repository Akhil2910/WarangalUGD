/**
 * Permissions for a signed-in user: the ticks in their role's row of the grid (Admin → Roles and permissions),
 * or the defaults of the role it is based on. Kept in memory; cleared whenever an admin changes the grid.
 * Also the ULB settings (deadlines, names) with the same caching.
 */
import { ACTION_KEYS, defaultGrants, DUE_DAYS, GRIEVANCE_DUE_DAYS, ROLE_LABEL, type Action, type Role, type Severity } from 'shared';
import type { Q } from './works.ts';

interface Entry { grants: Action[]; label: string; base: Role }
const cache = new Map<string, Entry>();
export const invalidatePerms = () => cache.clear();

export async function roleEntry(q: Q, ulbId: number, roleKey: string, base: Role): Promise<Entry> {
  const k = `${ulbId}|${roleKey}`;
  const hit = cache.get(k);
  if (hit) return hit;
  const role = (await q<{ label: string; base_role: string }>('SELECT label, base_role FROM roles WHERE ulb_id = $1 AND key = $2', [ulbId, roleKey]))[0];
  const b = (role?.base_role as Role) ?? base;
  const rows = await q<{ action: string; allowed: boolean }>('SELECT action, allowed FROM role_permissions WHERE ulb_id = $1 AND role_key = $2', [ulbId, roleKey]);
  let grants: Action[];
  if (rows.length) {
    const allowed = new Set(rows.filter((r) => r.allowed).map((r) => r.action));
    const decided = new Set(rows.map((r) => r.action));
    // actions added in a later release (no row yet) follow the default of the base role
    grants = ACTION_KEYS.filter((a) => (decided.has(a) ? allowed.has(a) : defaultGrants(b).includes(a)));
  } else grants = defaultGrants(b);
  const e = { grants, label: role?.label ?? ROLE_LABEL[b] ?? roleKey, base: b };
  cache.set(k, e);
  return e;
}

/** Does this user have this action? (Area limits are checked separately.) */
export const has = (u: { perms: readonly string[] }, a: Action) => u.perms.includes(a);

// ---------------- ULB settings ----------------
export interface UlbSettings {
  short_name: string; app_title: string; grievance_due_days: number; issue_due_days: Record<Severity, number>;
}
const settingsCache = new Map<number, { name: string; name_local: string; code: string; settings: UlbSettings }>();
export const invalidateSettings = () => settingsCache.clear();
export async function ulbOf(q: Q, ulbId = 1) {
  const hit = settingsCache.get(ulbId);
  if (hit) return hit;
  const r = (await q<{ name: string; name_local: string; code: string; settings: Partial<UlbSettings> }>('SELECT name, name_local, code, settings FROM ulbs WHERE id = $1', [ulbId]))[0];
  const s = r?.settings ?? {};
  const out = {
    name: r?.name ?? '', name_local: r?.name_local ?? '', code: r?.code ?? '',
    settings: {
      short_name: s.short_name ?? r?.code ?? '', app_title: s.app_title ?? 'UGD Tracker',
      grievance_due_days: s.grievance_due_days ?? GRIEVANCE_DUE_DAYS,
      issue_due_days: { ...DUE_DAYS, ...(s.issue_due_days ?? {}) },
    },
  };
  settingsCache.set(ulbId, out);
  return out;
}
