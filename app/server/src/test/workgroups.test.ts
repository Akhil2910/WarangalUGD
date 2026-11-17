/**
 * Work stretches end-to-end API test: create (AEE and above only), one road in one work stretch, totals,
 * compliance recorded once for all roads (one batch, each road its own record), batch verification,
 * status for all roads at once (all or nothing), edit (add / remove roads), history, map and list.
 * Run:  npm run test:groups -w server
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.STATE_DIR = mkdtempSync(path.join(os.tmpdir(), 'wgl-test4-'));
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
// these tests start work on roads: the project's blocking pre-work items (insurance, safety plan) are taken as verified
await db.query(`INSERT INTO project_records (item_key, period, status, valid_to, note, override) SELECT key, '', 'verified', '2099-12-31', 'test set-up', 'test set-up' FROM project_items WHERE gate = 'block'`);

const pwFile = readFileSync(path.join(process.env.STATE_DIR, 'initial-passwords.txt'), 'utf8');
const otp = (email: string) => pwFile.split('\n').find((l) => l.includes(email))!.split('one-time password: ')[1].trim();
const H = { 'x-wgl-request': '1', 'content-type': 'application/json' };
async function signIn(email: string) {
  const r = await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { email, password: otp(email) } });
  let cookie = `wgl_session=${r.cookies.find((c) => c.name === 'wgl_session')!.value}`;
  const r2 = await app.inject({ method: 'POST', url: '/api/auth/change-password', headers: { ...H, cookie }, payload: { currentPassword: otp(email), newPassword: 'test-password-123' } });
  cookie = `wgl_session=${r2.cookies.find((c) => c.name === 'wgl_session')!.value}`;
  return cookie;
}
const as = (cookie: string) => ({
  get: (url: string) => app.inject({ url, headers: { cookie } }),
  post: (url: string, payload: unknown) => app.inject({ method: 'POST', url, headers: { ...H, cookie }, payload: payload as object }),
});
const insp = as(await signIn('inspector@gwmc.local'));
const aee = as(await signIn('aee@gwmc.local'));
const viewer = as(await signIn('viewer@gwmc.local'));

let passed = 0;
async function check(name: string, fn: () => Promise<void>) {
  await fn();
  passed++;
  console.log(`  ok  ${name}`);
}
const PDF = Buffer.from('%PDF-1.4\n% test\n').toString('base64');
const doc = async () => (await insp.post('/api/files', { kind: 'document', name: 'permit.pdf', mime: 'application/pdf', data: PDF })).json().id as string;

/** A work stretch made (by an AEE) from the DPR pipes of seed stretch i: how work is set up now. */
async function makeWork(who: { post: (u: string, p: unknown) => Promise<{ statusCode: number; body: string; json: () => any }> }, i: number, name = `Test work ${i}`) {
  const r = await who.post('/api/site/stretches', { name, dpr_pipes: full.stretches[i].pipes.map((p: unknown[]) => p[0]) });
  if (r.statusCode !== 200) throw new Error(r.body);
  return r.json().code as string;
}
const [A, B, C, D] = [await makeWork(aee, 0), await makeWork(aee, 1), await makeWork(aee, 2), await makeWork(aee, 3)];
const LEN: Record<string, number> = {};
for (const c of [A, B, C, D]) LEN[c] = (await aee.get(`/api/stretches/${c}`)).json().stretch.length_m;
const len = (c: string) => LEN[c];
let WS = '';
const cardOf = async () => (await insp.get(`/api/work-groups/${WS}`)).json();

await check('preview totals; only AEE and above create; created as WS-0001', async () => {
  const p = (await aee.post('/api/work-groups/preview', { roads: [A, B, C] })).json();
  assert.equal(p.roads, 3);
  assert.equal(p.length_m, Math.round(len(A) + len(B) + len(C)));
  assert.equal(p.can_create, true);
  assert.equal((await insp.post('/api/work-groups/preview', { roads: [A] })).json().can_create, false);
  assert.equal((await insp.post('/api/work-groups', { name: 'Main road', roads: [A, B, C] })).statusCode, 403);
  assert.equal((await aee.post('/api/work-groups', { name: 'x', roads: [A] })).statusCode, 400); // name too short
  const r = await aee.post('/api/work-groups', { name: 'Trial main road with two lanes', contractor: 'ABC Infra', package: 'PKG-3', start_date: '2026-11-16', roads: [A, B, C] });
  assert.equal(r.statusCode, 200, r.body);
  WS = r.json().code;
  assert.equal(WS, 'WS-0001');
});
await check('a road belongs to only one work stretch', async () => {
  const r = await aee.post('/api/work-groups', { name: 'Another group', roads: [C, D] });
  assert.equal(r.statusCode, 400);
  assert.match(r.json().error, new RegExp(`${C} \\(WS-0001\\)`));
  const p = (await aee.post('/api/work-groups/preview', { roads: [C, D] })).json();
  assert.deepEqual(p.taken, [{ code: C, group: WS }]);
});
await check('card: roads, totals, compliance by item, permissions by role', async () => {
  const c = await cardOf();
  assert.equal(c.roads.length, 3);
  assert.equal(c.totals.pipe_laid_pct, 0);
  assert.equal(c.group.contractor, 'ABC Infra');
  assert.equal(c.can.update, true);
  assert.equal(c.can.edit, false); // inspector
  assert.equal((await viewer.get(`/api/work-groups/${WS}`)).json().can.update, false);
  const perm = c.compliance.flatMap((s: { items: { item: { key: string } }[] }) => s.items).find((i: { item: { key: string } }) => i.item.key === 'permissions_valid');
  assert.equal(perm.applies_to, 3);
  assert.equal(perm.group_recordable, true);
});
let bulk = '';
await check('compliance once for all roads: one batch, a record on each road; per-reach items refused', async () => {
  const r = await insp.post(`/api/work-groups/${WS}/compliance`, { roads: [A, B, C], item_key: 'permissions_valid', result: 'complied', reference: 'RC-77', documents: [await doc()] });
  assert.equal(r.statusCode, 200, r.body);
  bulk = r.json().bulk;
  assert.equal(r.json().results.length, 3);
  const n = await db.query<{ n: string }>('SELECT count(*) AS n FROM compliance_records WHERE bulk_id = $1', [bulk]);
  assert.equal(Number(n[0].n), 3);
  assert.equal((await insp.post(`/api/work-groups/${WS}/compliance`, { roads: [A], item_key: 'leak_test', result: 'complied', value_date: '2026-11-16', documents: [await doc()] })).statusCode, 400);
  assert.equal((await insp.post(`/api/work-groups/${WS}/compliance`, { roads: [A, D], item_key: 'work_board', result: 'not_applicable', reason: 'n/a' })).statusCode, 400); // D not in group
});
await check('status for all roads at once: each road its own history; stale version refuses all', async () => {
  const c = await cardOf();
  const versions = Object.fromEntries(c.roads.map((r: { code: string; version: number }) => [r.code, r.version]));
  const stale = await insp.post(`/api/work-groups/${WS}/status`, { roads: [A, B, C], set: { cutting: 'road_cut' }, versions: { ...versions, [B]: versions[B] - 1 } });
  assert.equal(stale.statusCode, 400);
  assert.equal(stale.json().code, 'BULK_REFUSED');
  assert.equal((await cardOf()).roads.every((r: { stage: string }) => r.stage === 'not_started'), true); // nothing saved
  assert.equal((await insp.post(`/api/work-groups/${WS}/status`, { roads: [A], set: {} })).statusCode, 400);
  const r = await insp.post(`/api/work-groups/${WS}/status`, { roads: [A, B, C], set: { cutting: 'road_cut' }, versions, note: 'Cutting started on all three' });
  assert.equal(r.statusCode, 200, r.body);
  const after = await cardOf();
  assert.ok(after.roads.every((x: { stage: string }) => x.stage === 'in_progress'));
  const h = (await insp.get(`/api/stretches/${B}/history`)).json().history[0];
  assert.equal(h.kind, 'status');
  assert.match(h.note, /WS-0001: Cutting started/);
});
await check('totals follow the roads (pipe laid on one road)', async () => {
  const r = await insp.post(`/api/work-groups/${WS}/status`, { roads: [A], set: { pipeline: 'laid' } });
  assert.equal(r.statusCode, 200, r.body);
  const t = (await cardOf()).totals;
  const total = len(A) + len(B) + len(C);
  assert.equal(t.pipe_laid_m, Math.round(len(A)));
  assert.equal(t.pipe_laid_pct, Math.round((len(A) / total) * 100));
});
await check('batch verification: field staff refused; AEE verifies all records of the batch at once', async () => {
  assert.equal((await insp.post(`/api/compliance/bulk/${bulk}/verify`, { decision: 'accept' })).statusCode, 403);
  const c = (await aee.get(`/api/work-groups/${WS}`)).json();
  assert.ok(c.bulks.some((b: { bulk_id: string; can_verify: boolean; waiting: number }) => b.bulk_id === bulk && b.can_verify && b.waiting === 3));
  const r = await aee.post(`/api/compliance/bulk/${bulk}/verify`, { decision: 'accept' });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().verified, 3);
  const perm = (await cardOf()).compliance.flatMap((s: { items: unknown[] }) => s.items).find((i: { item: { key: string } }) => i.item.key === 'permissions_valid');
  assert.equal(perm.state, 'verified');
});
await check('edit: AEE adds and removes roads, renames; group events in the history', async () => {
  assert.equal((await insp.post(`/api/work-groups/${WS}/edit`, { name: 'New name' })).statusCode, 403);
  const r = await aee.post(`/api/work-groups/${WS}/edit`, { name: 'Trial main road (3 roads)', add: [D], remove: [C] });
  assert.equal(r.statusCode, 200, r.body);
  const c = await cardOf();
  assert.deepEqual(c.roads.map((x: { code: string }) => x.code).sort(), [A, B, D].sort());
  assert.equal(c.group.name, 'Trial main road (3 roads)');
  assert.equal((await aee.post(`/api/work-groups/${WS}/edit`, { remove: [A, B, D] })).statusCode, 400); // needs one road
  const h = (await insp.get(`/api/work-groups/${WS}/history`)).json().history;
  for (const a of ['created', 'edited', 'roads_added', 'roads_removed', 'status_all', 'compliance_all']) assert.ok(h.some((x: { action?: string }) => x.action === a), a);
  assert.ok(h.some((x: { type: string; stretch_code?: string }) => x.type === 'road' && x.stretch_code === A));
});
await check('map and list', async () => {
  const m = (await viewer.get('/api/work-groups/map')).json().groups;
  assert.equal(m.length, 1);
  assert.deepEqual(m[0].roads.sort(), [A, B, D].sort());
  assert.equal(m[0].label.length, 2);
  const l = (await viewer.get('/api/work-groups?q=trial')).json().groups;
  assert.equal(l.length, 1);
  assert.equal(l[0].roads, 3);
  assert.equal((await viewer.get('/api/work-groups?q=zzz')).json().groups.length, 0);
  assert.equal((await viewer.get('/api/work-groups/WS-9999')).statusCode, 404);
});

console.log(`\n${passed} checks passed (${db.engine})`);
await app.close();
await db.close();
