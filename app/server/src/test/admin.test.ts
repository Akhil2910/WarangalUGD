/**
 * Admin panel: System Admin role, users, roles and the permission grid, settings (deadlines), audit log.
 * Run:  npm run test:admin -w server
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.STATE_DIR = mkdtempSync(path.join(os.tmpdir(), 'wgl-test9-'));
const { buildApp } = await import('../app.ts');
const { migrate, openDb } = await import('../db.ts');
const { seedAccounts } = await import('../auth.ts');
const { loadComplianceItems } = await import('../seed.ts');
const { DATA_DIR } = await import('../config.ts');

const full = JSON.parse(readFileSync(path.join(DATA_DIR, 'stretches_seed.json'), 'utf8'));
const db = await openDb();
await migrate(db, () => {});
await seedAccounts(db, () => {});
await loadComplianceItems(db, () => {});
const app = await buildApp(db);
await db.query(`INSERT INTO project_records (item_key, period, status, valid_to, note, override) SELECT key, '', 'verified', '2099-12-31', 'test set-up', 'test set-up' FROM project_items WHERE gate = 'block'`);

const pwFile = readFileSync(path.join(process.env.STATE_DIR, 'initial-passwords.txt'), 'utf8');
const otp = (email: string) => pwFile.split('\n').find((l) => l.includes(email))!.split('one-time password: ')[1].trim();
const H = { 'x-wgl-request': '1', 'content-type': 'application/json' };
async function login(email: string, password: string) {
  const r = await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { email, password } });
  if (r.statusCode !== 200) return null;
  return `wgl_session=${r.cookies.find((c) => c.name === 'wgl_session')!.value}`;
}
async function signIn(email: string) {
  let cookie = (await login(email, otp(email)))!;
  const r2 = await app.inject({ method: 'POST', url: '/api/auth/change-password', headers: { ...H, cookie }, payload: { currentPassword: otp(email), newPassword: 'test-password-123' } });
  cookie = `wgl_session=${r2.cookies.find((c) => c.name === 'wgl_session')!.value}`;
  return cookie;
}
const as = (cookie: string) => ({
  get: (url: string) => app.inject({ url, headers: { cookie } }),
  post: (url: string, payload: unknown) => app.inject({ method: 'POST', url, headers: { ...H, cookie }, payload: payload as object }),
});
let passed = 0;
async function check(name: string, fn: () => Promise<void>) {
  await fn();
  passed++;
  console.log(`  ok  ${name}`);
}
const admin = as(await signIn('admin@gwmc.local'));
const contractor = as(await signIn('contractor@gwmc.local'));
const piu = as(await signIn('piu@gwmc.local'));
const commissioner = as(await signIn('commissioner@gwmc.local'));
const S0 = full.stretches[0];

await check('only admins open the Admin panel; the System Admin sees users, roles, settings and the audit log', async () => {
  assert.equal((await contractor.get('/api/admin/overview')).statusCode, 403);
  const o = (await admin.get('/api/admin/overview')).json();
  assert.equal(o.ulb.code, 'GWMC');
  assert.ok(o.can['admin.users'] && o.can['admin.roles'] && o.can['admin.settings'] && o.can['admin.audit']);
  const c = (await commissioner.get('/api/admin/overview')).json();
  assert.ok(c.can['admin.audit'] && !c.can['admin.users']);
  assert.equal((await commissioner.get('/api/admin/users')).statusCode, 403);
  const me = (await admin.get('/api/auth/me')).json().user;
  assert.equal(me.role_label, 'System Admin');
  assert.ok(!me.perms.includes('status.update'), 'the System Admin does not do field work');
});

await check('the grid: taking "create work stretches" from the PIU stops it at once; giving it to the Contractor allows it; reset restores', async () => {
  const pipes = S0.pipes.map((p: unknown[]) => p[0]);
  const roles = (await admin.get('/api/admin/roles')).json();
  const piuRole = roles.roles.find((r: { key: string }) => r.key === 'piu_officer');
  assert.ok(piuRole.grants.includes('stretch.create'));
  const without = piuRole.grants.filter((g: string) => g !== 'stretch.create');
  assert.equal((await admin.post('/api/admin/roles/piu_officer/permissions', { grants: without })).statusCode, 200);
  assert.equal((await piu.post('/api/site/stretches', { name: 'Grid test', dpr_pipes: pipes.slice(0, 1) })).statusCode, 403);
  const k = roles.roles.find((r: { key: string }) => r.key === 'contractor');
  await admin.post('/api/admin/roles/contractor/permissions', { grants: [...k.grants, 'stretch.create'] });
  const made = await contractor.post('/api/site/stretches', { name: 'Made by contractor', dpr_pipes: pipes.slice(0, 1) });
  assert.equal(made.statusCode, 200, made.body);
  await admin.post('/api/admin/roles/piu_officer/reset', {});
  await admin.post('/api/admin/roles/contractor/reset', {});
  assert.equal((await contractor.post('/api/site/stretches', { name: 'Again', dpr_pipes: pipes.slice(1, 2) })).statusCode, 403);
});

await check('the System Admin cannot lock everyone out of administration', async () => {
  const r = await admin.post('/api/admin/roles/system_admin/permissions', { grants: ['admin.audit'] });
  assert.equal(r.statusCode, 400);
});

await check('a new role based on an existing one; renaming a built-in role', async () => {
  const r = (await admin.post('/api/admin/roles', { label: 'Site Engineer', base_role: 'field_inspector' })).json();
  assert.ok(r.key);
  await admin.post('/api/admin/roles', { key: 'pmu_officer', label: 'PMU Engineer' });
  const roles = (await admin.get('/api/admin/roles')).json().roles;
  assert.equal(roles.find((x: { key: string }) => x.key === 'pmu_officer').label, 'PMU Engineer');
  const se = roles.find((x: { key: string }) => x.key === r.key);
  assert.equal(se.base_role, 'field_inspector');
  assert.ok(se.grants.includes('status.update'));
  // a user with the new role
  const u = await admin.post('/api/admin/users', { name: 'New Engineer', email: 'eng1@gwmc.local', role_key: r.key, areas: { wards: [1, 2] }, password: 'engineer-pass-1' });
  assert.equal(u.statusCode, 200, u.body);
  const ck = await login('eng1@gwmc.local', 'engineer-pass-1');
  assert.ok(ck);
  const me = (await as(ck!).get('/api/auth/me')).json().user;
  assert.equal(me.role_label, 'Site Engineer');
  assert.equal(me.role, 'field_inspector');
});

await check('users: add, change, set password, switch off; nobody switches off their own account; duplicates refused', async () => {
  assert.equal((await admin.post('/api/admin/users', { name: 'Some One', email: 'contractor@gwmc.local', role_key: 'viewer', password: 'abcdefgh1' })).statusCode, 409);
  assert.equal((await admin.post('/api/admin/users', { name: 'Field One', email: 'field1@gwmc.local', role_key: 'super_admin', password: 'abcdefgh1' })).statusCode, 403);
  const id = (await admin.post('/api/admin/users', { name: 'Field One', email: 'field1@gwmc.local', role_key: 'field_inspector', password: 'abcdefgh1' })).json().id;
  assert.ok(await login('field1@gwmc.local', 'abcdefgh1'));
  assert.equal((await admin.post(`/api/admin/users/${id}/password`, { password: 'new-pass-22' })).statusCode, 200);
  assert.equal(await login('field1@gwmc.local', 'abcdefgh1'), null);
  assert.ok(await login('field1@gwmc.local', 'new-pass-22'));
  assert.equal((await admin.post(`/api/admin/users/${id}`, { active: false })).statusCode, 200);
  assert.equal(await login('field1@gwmc.local', 'new-pass-22'), null);
  const me = (await admin.get('/api/auth/me')).json().user;
  assert.equal((await admin.post(`/api/admin/users/${me.id}`, { active: false })).statusCode, 400);
  const list = (await admin.get('/api/admin/users')).json();
  assert.ok(list.users.some((x: { email: string; active: boolean }) => x.email === 'field1@gwmc.local' && !x.active));
});

await check('settings: deadlines apply to new issues and grievances', async () => {
  const s = (await admin.get('/api/admin/settings')).json().ulb;
  assert.equal(s.settings.grievance_due_days, 3);
  assert.equal((await admin.post('/api/admin/settings', { name: s.name, name_local: s.name_local, short_name: 'GWMC', app_title: 'Warangal UGD Tracker', grievance_due_days: 5, issue_due_days: { high: 1, medium: 4, low: 9 } })).statusCode, 200);
  const r = (await piu.post('/api/issues', { kind: 'water_leak', count: 1, severity: 'high', remark: 'Settings test', lon: 79.55, lat: 17.98, photos: [] })).json();
  assert.ok(r.code, JSON.stringify(r));
  const issue = (await piu.get(`/api/issues?status=active`)).json().rows.find((x: { code: string }) => x.code === r.code);
  const d = (s2: string) => Math.round((new Date(s2).getTime() - new Date(new Date().toISOString().slice(0, 10)).getTime()) / 86400000);
  assert.equal(d(issue.due_date), 1);
});

await check('audit log shows the admin changes', async () => {
  const rows = (await admin.get('/api/admin/audit')).json().rows;
  for (const a of ['admin_settings_saved', 'admin_user_added', 'admin_permissions_saved', 'admin_role_saved', 'admin_password_set']) assert.ok(rows.some((r: { action: string }) => r.action === a), a);
});

console.log(`\n${passed} checks passed (${db.engine})`);
await app.close();
await db.close();
