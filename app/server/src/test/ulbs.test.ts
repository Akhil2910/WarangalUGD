/**
 * One shared system, many ULBs: the State Admin adds a ULB; each ULB sees only its own works, issues,
 * grievances, compliance lists, users and audit log; codes of a new ULB carry its short code.
 * Run:  npm run test:ulbs -w server
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import bcrypt from 'bcryptjs';

process.env.STATE_DIR = mkdtempSync(path.join(os.tmpdir(), 'wgl-test10-'));
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
await db.query(`INSERT INTO project_records (item_key, period, status, valid_to, note, override) SELECT key, '', 'verified', '2099-12-31', 'test set-up', 'test set-up' FROM project_items WHERE gate = 'block' AND ulb_id = 1`);
// a State Admin (made directly: no seeded account has this role)
await db.query(`INSERT INTO users (email, name, role, role_key, areas, password_hash, must_change_password, ulb_id) VALUES ('state@test.local', 'State Admin', 'super_admin', 'super_admin', '{"all":true}', $1, false, 1)`,
  [await bcrypt.hash('state-pass-123', 10)]);

const pwFile = readFileSync(path.join(process.env.STATE_DIR, 'initial-passwords.txt'), 'utf8');
const otp = (email: string) => pwFile.split('\n').find((l) => l.includes(email))!.split('one-time password: ')[1].trim();
const H = { 'x-wgl-request': '1', 'content-type': 'application/json' };
const cookieOf = (r: { cookies: { name: string; value: string }[] }) => `wgl_session=${r.cookies.find((c) => c.name === 'wgl_session')!.value}`;
/** Sign in; change a one-time password if asked. */
async function signIn(email: string, password: string) {
  const r = await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { email, password } });
  assert.equal(r.statusCode, 200, r.body);
  let cookie = cookieOf(r);
  if (r.json().mustChangePassword) {
    const r2 = await app.inject({ method: 'POST', url: '/api/auth/change-password', headers: { ...H, cookie }, payload: { currentPassword: password, newPassword: 'test-password-123' } });
    assert.equal(r2.statusCode, 200, r2.body);
    cookie = cookieOf(r2);
  }
  return as(cookie);
}
function as(cookie: string) {
  return {
    get: (url: string) => app.inject({ url, headers: { cookie } }),
    post: (url: string, payload: unknown) => app.inject({ method: 'POST', url, headers: { ...H, cookie }, payload: payload as object }),
  };
}
const pub = { get: (url: string) => app.inject({ url }), post: (url: string, payload: unknown) => app.inject({ method: 'POST', url, headers: H, payload: payload as object }) };
let passed = 0;
async function check(name: string, fn: () => Promise<void>) {
  await fn();
  passed++;
  console.log(`  ok  ${name}`);
}

const state = await signIn('state@test.local', 'state-pass-123');
const gAdmin = await signIn('admin@gwmc.local', otp('admin@gwmc.local'));
const gAee = await signIn('aee@gwmc.local', otp('aee@gwmc.local'));
let kAdmin: Awaited<ReturnType<typeof signIn>>;
let kAee: Awaited<ReturnType<typeof signIn>>;
let KID = 0;

await check('only the State Admin lists and adds ULBs; codes and e-mails must be new', async () => {
  assert.equal((await gAdmin.get('/api/admin/ulbs')).statusCode, 403);
  assert.equal((await gAdmin.post('/api/admin/ulbs', {})).statusCode, 403);
  const l = (await state.get('/api/admin/ulbs')).json();
  assert.deepEqual(l.ulbs.map((x: { code: string }) => x.code), ['GWMC']);
  const body = { code: 'kmc', name: 'Khammam Municipal Corporation', admin: { name: 'KMC Admin', email: 'admin@kmc.test', password: 'kmc-admin-pass1' } };
  assert.equal((await state.post('/api/admin/ulbs', { ...body, code: 'GWMC' })).statusCode, 409);
  assert.equal((await state.post('/api/admin/ulbs', { ...body, admin: { ...body.admin, email: 'admin@gwmc.local' } })).statusCode, 409);
  assert.equal((await state.post('/api/admin/ulbs', { ...body, code: '1X' })).statusCode, 400);
  const r = await state.post('/api/admin/ulbs', body);
  assert.equal(r.statusCode, 200, r.body);
  KID = r.json().id;
  assert.equal(KID, 2);
  const l2 = (await state.get('/api/admin/ulbs')).json();
  const k = l2.ulbs.find((x: { code: string }) => x.code === 'KMC');
  assert.equal(k.users, 1);
});

await check("the new ULB's System Admin works only in KMC and adds an AEE there", async () => {
  kAdmin = await signIn('admin@kmc.test', 'kmc-admin-pass1');
  const ov = await kAdmin.get('/api/admin/overview');
  assert.equal(ov.statusCode, 200, ov.body);
  const o = ov.json();
  assert.equal(o.ulb.code, 'KMC');
  const users = (await kAdmin.get('/api/admin/users')).json().users as { email: string }[];
  assert.deepEqual(users.map((u) => u.email), ['admin@kmc.test']);
  const r = await kAdmin.post('/api/admin/users', { name: 'KMC AEE', email: 'aee@kmc.test', role_key: 'aee', password: 'kmc-aee-pass-1' });
  assert.equal(r.statusCode, 200, r.body);
  // GWMC's admin does not see KMC users, and cannot change them
  const g = (await gAdmin.get('/api/admin/users')).json().users as { email: string; id: string }[];
  assert.ok(!g.some((u) => u.email.endsWith('@kmc.test')));
  const kid = (await kAdmin.get('/api/admin/users')).json().users.find((u: { email: string }) => u.email === 'aee@kmc.test').id;
  assert.equal((await gAdmin.post(`/api/admin/users/${kid}`, { name: 'Taken over', email: 'aee@kmc.test', role_key: 'viewer' })).statusCode, 404);
  kAee = await signIn('aee@kmc.test', 'kmc-aee-pass-1');
});

await check('each ULB has its own compliance lists (KMC keys carry its code)', async () => {
  const g = (await gAee.get('/api/compliance/items')).json().items as { key: string }[];
  const k = (await kAee.get('/api/compliance/items')).json().items as { key: string }[];
  assert.ok(g.length > 0 && g.length === k.length);
  assert.ok(k.every((i) => i.key.startsWith('KMC:')) && g.every((i) => !i.key.includes(':')));
  const gp = (await gAee.get('/api/project/items')).json().items as { key: string }[];
  const kp = (await kAee.get('/api/project/items')).json().items as { key: string }[];
  assert.ok(kp.length === gp.length && kp.every((i) => i.key.startsWith('KMC:')));
});

const [lon0, lat0] = full.stretches[0].geom.coordinates[0][0] as [number, number];
const P = (dx: number, dy: number) => ({ lon: lon0 + dx, lat: lat0 + dy });
async function makeStretch(who: typeof kAee, name: string) {
  const ids: number[] = [];
  for (let i = 0; i < 3; i++) {
    const r = await who.post('/api/site/manholes', { ...P(0.0004 * i, 0.0002), code: `MH-U${i + 1}` });
    assert.equal(r.statusCode, 200, r.body);
    ids.push(r.json().id);
  }
  const pipes: number[] = [];
  for (let i = 0; i < 2; i++) {
    const r = await who.post('/api/site/pipes', { from_mh: ids[i], to_mh: ids[i + 1], dia_mm: 200 });
    assert.equal(r.statusCode, 200, r.body);
    pipes.push(r.json().id);
  }
  const s = await who.post('/api/site/stretches', { name, pipes });
  assert.equal(s.statusCode, 200, s.body);
  return s.json().code as string;
}
let KCODE = '';
let GCODE = '';

await check('both ULBs add site work at the same place with the same manhole numbers; KMC codes carry its code', async () => {
  KCODE = await makeStretch(kAee, 'KMC trial lane');
  GCODE = await makeStretch(gAee, 'GWMC trial lane');
  assert.match(KCODE, /^KMC-W\d+-S001$/);
  assert.match(GCODE, /^W\d+-S001$/);
});

await check('works, cards and the map show only your own ULB', async () => {
  const kw = (await kAee.get('/api/works')).json();
  const gw = (await gAee.get('/api/works')).json();
  const codes = (x: { rows?: { code: string }[]; works?: { code: string }[] }) => (x.rows ?? x.works ?? []).map((w) => w.code);
  assert.deepEqual(codes(kw), [KCODE]);
  assert.ok(codes(gw).includes(GCODE) && !codes(gw).includes(KCODE));
  assert.equal((await gAee.get(`/api/stretches/${KCODE}`)).statusCode, 404);
  assert.equal((await kAee.get(`/api/stretches/${GCODE}`)).statusCode, 404);
  assert.equal((await kAee.get(`/api/stretches/${KCODE}`)).statusCode, 200);
  const km = JSON.stringify((await kAee.get('/api/site/map')).json());
  assert.ok(km.includes('KMC-SMH') || km.includes('MH-U1'));
  assert.ok(!km.includes(`"${GCODE}"`));
});

await check('issues: KMC numbers its own; nobody sees or changes the other ULB\'s', async () => {
  const r = await kAee.post('/api/issues', { stretch_code: KCODE, kind: 'taps_broken', count: 1, remark: 'Tap broken by the excavator' });
  assert.equal(r.statusCode, 200, r.body);
  const code = r.json().code as string;
  assert.equal(code, 'KMC-I-0001');
  assert.equal((await gAee.post('/api/issues', { stretch_code: KCODE, kind: 'taps_broken', count: 1, remark: 'Not mine' })).statusCode, 404);
  assert.equal((await gAee.get(`/api/issues/${code}`)).statusCode, 404);
  const gl = (await gAee.get('/api/issues')).json();
  assert.ok(!JSON.stringify(gl).includes('KMC-I-'));
  const kl = (await kAee.get('/api/issues')).json();
  assert.ok(JSON.stringify(kl).includes(code));
  // only KMC people can be assigned
  const assignable = (await kAee.get('/api/users/assignable')).json();
  assert.ok(!JSON.stringify(assignable).includes('@gwmc.local') && !JSON.stringify(assignable).includes('GWMC'));
});

await check("citizens' grievances go to the ULB of the road behind the QR code", async () => {
  const qr = (await kAee.get(`/api/stretches/${KCODE}/qr`)).json();
  const token = qr.url.split('/g/')[1];
  assert.equal((await gAee.get(`/api/stretches/${KCODE}/qr`)).statusCode, 404);
  const r = await pub.post('/api/public/grievances', { token, category: 'open_trench', description: 'Road left open near the school', name: 'Citizen', mobile: '9876543210', consent: true });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().number, 'KMC-G-000001');
  const st = await pub.get(`/api/public/grievances/KMC-G-000001?mobile=9876543210`);
  assert.equal(st.statusCode, 200, st.body);
  // the KMC AEE gets it; GWMC does not see it
  const g = (await db.query<{ ulb_id: number; assignee: string | null }>(`SELECT ulb_id, assignee FROM grievances WHERE number = 'KMC-G-000001'`))[0];
  assert.equal(Number(g.ulb_id), KID);
  const kaee = (await db.query<{ id: string }>(`SELECT id FROM users WHERE email = 'aee@kmc.test'`))[0].id;
  assert.equal(g.assignee, kaee);
  const kAdminList = (await kAee.get('/api/grievances?status=all')).json();
  assert.equal(kAdminList.rows.length, 1);
  const gList = (await gAee.get('/api/grievances?status=all')).json();
  assert.ok(!JSON.stringify(gList).includes('KMC-G-'));
  assert.equal((await gAee.get('/api/grievances/KMC-G-000001')).statusCode, 404);
});

await check('dashboard and audit log count only your own ULB', async () => {
  const kd = (await kAdmin.get('/api/dashboard')).json();
  assert.ok(!JSON.stringify(kd).includes(`"${GCODE}"`));
  const ka = (await kAdmin.get('/api/admin/audit')).json().rows as { action: string; detail: Record<string, unknown> }[];
  assert.ok(ka.some((a) => a.action === 'ulb_created'));
  const ga = (await gAdmin.get('/api/admin/audit')).json().rows as { action: string; detail: Record<string, unknown> }[];
  assert.ok(!JSON.stringify(ga).includes('aee@kmc.test'));
});

await check('the State Admin switches to KMC and back', async () => {
  assert.equal((await state.get(`/api/stretches/${KCODE}`)).statusCode, 404);
  assert.equal((await state.post('/api/admin/ulbs/99/switch', {})).statusCode, 404);
  assert.equal((await gAdmin.post(`/api/admin/ulbs/${KID}/switch`, {})).statusCode, 403);
  assert.equal((await state.post(`/api/admin/ulbs/${KID}/switch`, {})).statusCode, 200);
  assert.equal((await state.get('/api/auth/me')).json().user.ulb_id, KID);
  assert.equal((await state.get(`/api/stretches/${KCODE}`)).statusCode, 200);
  assert.equal((await state.get(`/api/stretches/${GCODE}`)).statusCode, 404);
  assert.equal((await state.post('/api/admin/ulbs/1/switch', {})).statusCode, 200);
  assert.equal((await state.get(`/api/stretches/${GCODE}`)).statusCode, 200);
});

console.log(`\n${passed} checks passed (${process.env.DATABASE_URL ? 'postgres' : 'pglite'})`);
await app.close();
process.exit(0);
