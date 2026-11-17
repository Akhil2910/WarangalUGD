/**
 * Project-level compliance (Pre-work, During work, Post-work), the road-cutting block and My tasks.
 * Run:  npm run test:project -w server
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.STATE_DIR = mkdtempSync(path.join(os.tmpdir(), 'wgl-test8-'));
const { buildApp } = await import('../app.ts');
const { migrate, openDb } = await import('../db.ts');
const { seedAccounts } = await import('../auth.ts');
const { loadComplianceItems } = await import('../seed.ts');
const { DATA_DIR } = await import('../config.ts');
const { periodsFor, projectStatus } = await import('shared');

const full = JSON.parse(readFileSync(path.join(DATA_DIR, 'stretches_seed.json'), 'utf8'));
const db = await openDb();
await migrate(db, () => {});
await seedAccounts(db, () => {});
await loadComplianceItems(db, () => {});
const app = await buildApp(db);

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
let passed = 0;
async function check(name: string, fn: () => Promise<void>) {
  await fn();
  passed++;
  console.log(`  ok  ${name}`);
}
const contractor = as(await signIn('contractor@gwmc.local'));
const piu = as(await signIn('piu@gwmc.local'));
const pmu = as(await signIn('pmu@gwmc.local'));
const finance = as(await signIn('finance@gwmc.local'));
const commissioner = as(await signIn('commissioner@gwmc.local'));
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]).toString('base64');
const upload = async () => (await piu.post('/api/files', { kind: 'document', name: 'proof.jpg', mime: 'image/jpeg', data: JPEG })).json().id as string;
const state = async (x = piu) => (await x.get('/api/project')).json();
const item = async (key: string, x = piu) => (await state(x)).items.find((i: { key: string }) => i.key === key);
const STATUS = { work_start: '2026-08-15', completion: null };
let GATE_CODE = '';

await check('rules: monthly periods from the work start, due on the given day of the next month; statuses', async () => {
  const p = periodsFor({ phase: 'during', frequency: 'monthly', due_day: 10 }, STATUS, '2026-11-17');
  assert.deepEqual(p.map((x) => [x.key, x.due]), [['2026-08', '2026-09-10'], ['2026-09', '2026-10-10'], ['2026-10', '2026-11-10'], ['2026-11', '2026-12-10']]);
  const q = periodsFor({ phase: 'during', frequency: 'quarterly', due_day: 15 }, STATUS, '2026-11-17');
  assert.deepEqual(q.map((x) => x.key), ['2026-Q3', '2026-Q4']);
  assert.equal(q[0].due, '2026-10-15');
  assert.equal(periodsFor({ phase: 'post', frequency: 'once', due_day: 30 }, STATUS, '2026-11-17')[0].due, null);
  const it = { phase: 'pre' as const, frequency: 'once' as const, has_validity: true };
  assert.equal(projectStatus(it, '2026-08-15', null, '2026-11-17', true), 'overdue');
  assert.equal(projectStatus(it, '2026-08-15', { status: 'verified', valid_to: '2026-12-01' }, '2026-11-17', true), 'expiring');
  assert.equal(projectStatus(it, '2026-08-15', { status: 'verified', valid_to: '2026-11-01' }, '2026-11-17', true), 'expired');
  assert.equal(projectStatus(it, '2026-08-15', { status: 'verified', valid_to: '2027-12-01' }, '2026-11-17', true), 'verified');
  assert.equal(projectStatus({ ...it, phase: 'post' }, null, null, '2026-11-17', false), 'not_due');
});

await check('three phases with the starting list; everyone signed in can see it, the financial institution included', async () => {
  const s = await state(finance);
  assert.deepEqual(s.summary.map((x: { phase: string }) => x.phase), ['pre', 'during', 'post']);
  assert.ok(s.items.length >= 25);
  assert.ok(s.items.every((i: { periods: { can_submit: boolean }[] }) => i.periods.every((p) => !p.can_submit)), 'finance cannot submit');
  assert.equal(s.items.find((i: { key: string }) => i.key === 'completion_certificate').status, 'not_due');
});

await check('work cannot start on a road while insurance and the safety plan are not verified; the card says why', async () => {
  const S0 = full.stretches[0];
  const code = (await piu.post('/api/site/stretches', { name: 'Project gate road', dpr_pipes: S0.pipes.map((p: unknown[]) => p[0]) })).json().code as string;
  GATE_CODE = code;
  const card = (await piu.get(`/api/stretches/${code}`)).json();
  assert.equal(card.project_blocks.length, 3);
  const r = await contractor.post(`/api/stretches/${code}/status`, { status: { ...card.stretch.status, cutting: 'road_cut' }, version: card.stretch.version, photos: [], gps: null });
  assert.equal(r.statusCode, 409, r.body);
  assert.match(r.json().error, /Contractor's all-risk insurance/);
});

await check('contractor submits proof; PMU verifies; nobody verifies their own; rejecting needs a reason', async () => {
  const f = await upload();
  const bad = await contractor.post('/api/project/items/car_insurance/submit', { period: '', files: [{ id: f, kind: 'document' }] });
  assert.equal(bad.statusCode, 400, 'reference and valid-until are asked for');
  const ok = await contractor.post('/api/project/items/car_insurance/submit', { period: '', reference: 'POL-123', valid_from: '2026-08-01', valid_to: '2027-07-31', files: [{ id: f, kind: 'document', name: 'policy.pdf' }] });
  assert.equal(ok.statusCode, 200, ok.body);
  assert.equal((await item('car_insurance')).status, 'waiting');
  assert.equal((await contractor.post('/api/project/items/car_insurance/submit', { period: '', reference: 'x', valid_to: '2027-01-01', files: [{ id: f, kind: 'document' }] })).statusCode, 409);
  const id = ok.json().id;
  assert.equal((await piu.post(`/api/project/records/${id}/decide`, { decision: 'verify' })).statusCode, 403, 'PIU does not verify');
  assert.equal((await pmu.post(`/api/project/records/${id}/decide`, { decision: 'reject' })).statusCode, 400, 'reason needed');
  assert.equal((await pmu.post(`/api/project/records/${id}/decide`, { decision: 'verify', note: 'Policy checked' })).statusCode, 200);
  assert.equal((await item('car_insurance')).status, 'verified');
  const h = (await piu.get('/api/project/items/car_insurance/history')).json().history;
  assert.deepEqual(h.map((e: { kind: string }) => e.kind), ['verified', 'submitted']);
});

await check('reject, then submit again; the Commissioner can override with a reason; then work can start', async () => {
  const f = await upload();
  const s1 = (await piu.post('/api/project/items/wc_insurance/submit', { period: '', reference: 'WC-9', valid_to: '2027-03-31', files: [{ id: f, kind: 'document' }] })).json();
  assert.equal((await pmu.post(`/api/project/records/${s1.id}/decide`, { decision: 'reject', note: 'Expired copy attached' })).statusCode, 200);
  assert.equal((await item('wc_insurance')).status, 'rejected', 'rejected: to be submitted again');
  const s2 = (await piu.post('/api/project/items/wc_insurance/submit', { period: '', reference: 'WC-10', valid_to: '2027-03-31', files: [{ id: f, kind: 'document' }] })).json();
  await pmu.post(`/api/project/records/${s2.id}/decide`, { decision: 'verify' });
  assert.equal((await contractor.post('/api/project/items/safety_plan/override', { reason: 'Approved in the review meeting' })).statusCode, 403);
  assert.equal((await commissioner.post('/api/project/items/safety_plan/override', { reason: 'Approved in the review meeting on 12 Nov' })).statusCode, 200);
  assert.equal((await item('safety_plan')).status, 'verified');
  const card = (await piu.get(`/api/stretches/${GATE_CODE}`)).json();
  assert.equal(card.project_blocks.length, 0);
  const r = await contractor.post(`/api/stretches/${GATE_CODE}/status`, { status: { ...card.stretch.status, cutting: 'road_cut' }, version: card.stretch.version, photos: [], gps: null });
  assert.ok(!/Project:/.test(r.json().error ?? ''), r.body); // only the road's own items (e.g. its permission) may still block
});

await check('monthly items: one per month from the work start; the Commissioner sets the dates; expiring shows 30 days ahead', async () => {
  assert.equal((await piu.post('/api/project/settings', { work_start: '2026-08-15' })).statusCode, 403);
  assert.equal((await commissioner.post('/api/project/settings', { work_start: '2026-08-15' })).statusCode, 200);
  const m = await item('monthly_progress');
  assert.ok(m.periods.length >= 3);
  assert.equal(m.periods.at(-1).key, '2026-08');
  const f = await upload();
  const r = (await piu.post('/api/project/items/performance_guarantee/submit', { period: '', reference: 'BG-1', valid_to: new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10), files: [{ id: f, kind: 'document' }] })).json();
  await pmu.post(`/api/project/records/${r.id}/decide`, { decision: 'verify' });
  assert.equal((await item('performance_guarantee')).status, 'expiring');
});

await check('My tasks: the PMU sees what to verify, the contractor what to submit or renew', async () => {
  const f = await upload();
  await contractor.post('/api/project/items/quality_plan/submit', { period: '', files: [{ id: f, kind: 'document' }] });
  const pt = (await pmu.get('/api/my-tasks')).json().tasks;
  assert.ok(pt.some((t: { title: string }) => t.title.startsWith('Verify: Approved quality assurance plan')));
  const ct = (await contractor.get('/api/my-tasks')).json().tasks;
  assert.ok(ct.some((t: { title: string }) => /Submit: Monthly progress report/.test(t.title)));
  assert.ok(ct.some((t: { title: string }) => /Renew: Performance bank guarantee/.test(t.title)));
  assert.ok(!ct.some((t: { title: string }) => t.title.startsWith('Verify')));
});

await check('the Commissioner edits the list: adds an item, retires one', async () => {
  const body = { phase: 'during', category: 'Safety', name: 'Weekly toolbox talk record', description: '', frequency: 'monthly', due_day: 7, has_validity: false, evidence: ['document'], gate: 'none', mandatory: false };
  assert.equal((await piu.post('/api/project/items', body)).statusCode, 403);
  const r = (await commissioner.post('/api/project/items', body)).json();
  assert.ok((await item(r.key)).periods.length > 0);
  await commissioner.post('/api/project/items', { ...body, key: r.key, active: false });
  assert.equal(await item(r.key), undefined);
});

await check('dashboard carries project compliance by phase', async () => {
  const d = (await pmu.get('/api/dashboard')).json();
  assert.deepEqual(d.project.summary.map((x: { phase: string }) => x.phase), ['pre', 'during', 'post']);
  assert.ok(Array.isArray(d.project.attention));
});

console.log(`\n${passed} checks passed (${db.engine})`);
await app.close();
await db.close();
