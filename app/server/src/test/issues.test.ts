/**
 * Issues end-to-end API test (brief §6.9): raised from status with counts, auto-close, resolve clears the
 * damage on the stretch, re-open brings it back, manual reports, assign + due date + overdue, compliance-
 * raised issues, CSV export, permanent delete (Commissioner, reason, audit, orphan photos removed).
 * Run:  npm run test:issues -w server
 */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.STATE_DIR = mkdtempSync(path.join(os.tmpdir(), 'wgl-test3-'));
const { buildApp } = await import('../app.ts');
const { migrate, openDb } = await import('../db.ts');
const { seedAccounts } = await import('../auth.ts');
const { loadComplianceItems } = await import('../seed.ts');
const { DATA_DIR } = await import('../config.ts');
const { FILES_DIR } = await import('../files.ts');
const { EMPTY_STATUS } = await import('shared');

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
const insp = as(await signIn('inspector@gwmc.local'));
const aee = as(await signIn('aee@gwmc.local'));
const dee = as(await signIn('dee@gwmc.local'));
const com = as(await signIn('commissioner@gwmc.local'));
const viewer = as(await signIn('viewer@gwmc.local'));
const inspId = (await insp.get('/api/auth/me')).json().user.id;

let passed = 0;
async function check(name: string, fn: () => Promise<void>) {
  await fn();
  passed++;
  console.log(`  ok  ${name}`);
}
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]).toString('base64');
const PDF = Buffer.from('%PDF-1.4\n% test\n').toString('base64');
const upload = async (kind: 'photo' | 'document') =>
  (await insp.post('/api/files', { kind, name: 'x', mime: kind === 'photo' ? 'image/jpeg' : 'application/pdf', data: kind === 'photo' ? JPEG : PDF })).json().id as string;


/** A work stretch made (by an AEE) from the DPR pipes of seed stretch i: how work is set up now. */
async function makeWork(who: { post: (u: string, p: unknown) => Promise<{ statusCode: number; body: string; json: () => any }> }, i: number, name = `Test work ${i}`) {
  const r = await who.post('/api/site/stretches', { name, dpr_pipes: full.stretches[i].pipes.map((p: unknown[]) => p[0]) });
  if (r.statusCode !== 200) throw new Error(r.body);
  return r.json().code as string;
}
const CODE = await makeWork(aee, 0);
let cur = { ...EMPTY_STATUS };
let ver = 1;
async function save(over: Partial<typeof EMPTY_STATUS>, extra: Record<string, unknown> = {}) {
  const r = await insp.post(`/api/stretches/${CODE}/status`, { status: { ...cur, ...over }, version: ver, photos: [], ...extra });
  assert.equal(r.statusCode, 200, r.body);
  cur = r.json().card.stretch.status;
  ver = r.json().card.stretch.version;
  return r.json().card;
}
async function refreshVersion() {
  const c = (await insp.get(`/api/stretches/${CODE}`)).json();
  cur = c.stretch.status;
  ver = c.stretch.version;
  return c;
}
const issuesOf = async (q = '') => (await aee.get(`/api/issues?stretch=${CODE}${q}`)).json().rows as Record<string, any>[];
const find = (rows: Record<string, any>[], kind: string, status?: string) => rows.find((r) => r.kind === kind && (!status || r.status === status));

// the stretch must be opened first: permission recorded (blocking gate)
await insp.post(`/api/stretches/${CODE}/compliance`, { item_key: 'permissions_valid', result: 'complied', reference: 'P-1', documents: [await upload('document')] });

await check('status raises one issue per kind with a count, due date by severity, open-issue count on the stretch', async () => {
  const c = await save({ cutting: 'road_cut', taps_broken: 3 });
  const rows = await issuesOf();
  const t = find(rows, 'taps_broken')!;
  assert.equal(t.count, 3);
  assert.equal(t.status, 'open');
  assert.equal(t.severity, 'high');
  assert.match(t.code, /^I-\d{4}$/);
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  assert.ok(t.due_date > today);
  assert.ok(c.issues.some((i: { kind: string }) => i.kind === 'taps_broken'));
  const w = (await viewer.get('/api/works?q=' + CODE)).json().rows[0];
  assert.equal(w.open_issues, 1);
});
await check('count follows the status; one issue, not two', async () => {
  await save({ taps_restored: 1 });
  const rows = (await issuesOf()).filter((r) => r.kind === 'taps_broken');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].count, 2);
});
await check('resolve: field staff refused, note required; AEE resolves and the damage is cleared on the stretch', async () => {
  const code = find(await issuesOf(), 'taps_broken')!.code;
  assert.equal((await insp.post(`/api/issues/${code}/resolve`, { note: 'done' })).statusCode, 403);
  assert.equal((await aee.post(`/api/issues/${code}/resolve`, { note: '' })).statusCode, 400);
  const r = await aee.post(`/api/issues/${code}/resolve`, { note: 'All 3 connections restored by contractor', photos: [await upload('photo')] });
  assert.equal(r.statusCode, 200, r.body);
  const c = await refreshVersion();
  assert.equal(c.stretch.status.taps_restored, 3);
  assert.equal(find(await issuesOf(), 'taps_broken')!.status, 'resolved');
  assert.equal((await issuesOf('&status=active')).filter((r) => r.kind === 'taps_broken').length, 0);
  const h = (await aee.get(`/api/stretches/${CODE}/history`)).json().history[0];
  assert.equal(h.kind, 'issue');
  assert.match(h.note, /resolved/);
});
await check('re-open brings the damage back on the stretch; the next save keeps it open', async () => {
  const code = find(await issuesOf(), 'taps_broken')!.code;
  assert.equal((await aee.post(`/api/issues/${code}/reopen`, { note: '' })).statusCode, 400);
  const r = await aee.post(`/api/issues/${code}/reopen`, { note: 'One connection still dry on site' });
  assert.equal(r.statusCode, 200, r.body);
  await refreshVersion();
  assert.equal(cur.taps_broken - cur.taps_restored, 2);
  await save({ motorability: 'difficulty' });
  const t = find(await issuesOf(), 'taps_broken')!;
  assert.equal(t.status, 'open');
  assert.equal(t.code, code);
  const d = (await aee.get(`/api/issues/${code}`)).json();
  assert.deepEqual(d.events.map((e: { action: string }) => e.action), ['opened', 'count', 'resolved', 'reopened']);
});
await check('saving the damage as fixed closes the issue automatically', async () => {
  await save({ taps_restored: cur.taps_broken });
  const t = find(await issuesOf(), 'taps_broken')!;
  assert.equal(t.status, 'resolved');
  assert.equal(t.resolution_note, 'Cleared on the stretch status');
});
let manual = '';
await check('manual report: remark required, viewer refused, photo optional', async () => {
  assert.equal((await insp.post('/api/issues', { stretch_code: CODE, kind: 'culvert_damaged', remark: '' })).statusCode, 400);
  assert.equal((await viewer.post('/api/issues', { stretch_code: CODE, kind: 'culvert_damaged', remark: 'Broken slab' })).statusCode, 403);
  // any kind can be reported by hand; it does not change the work stretch's status counts
  const before = (await insp.get(`/api/stretches/${CODE}`)).json().stretch.status;
  const tb = await insp.post('/api/issues', { stretch_code: CODE, kind: 'taps_broken', count: 2, remark: 'Two taps broken by the excavator' });
  assert.equal(tb.statusCode, 200, tb.body);
  assert.deepEqual((await insp.get(`/api/stretches/${CODE}`)).json().stretch.status, before);
  assert.equal((await insp.post('/api/issues', { stretch_code: CODE, kind: 'compliance', remark: 'not allowed' })).statusCode, 400);
  const r = await insp.post('/api/issues', { stretch_code: CODE, kind: 'culvert_damaged', remark: 'Culvert slab cracked by excavator', photos: [await upload('photo')] });
  assert.equal(r.statusCode, 200, r.body);
  manual = r.json().code;
  const d = (await viewer.get(`/api/issues/${manual}`)).json();
  assert.equal(d.issue.severity, 'high');
  assert.equal(d.issue.created_by_name, 'Trial Field Inspector');
});
await check('assign: AEE refused; DEE assigns with a due date; overdue from the day after', async () => {
  assert.equal((await aee.post(`/api/issues/${manual}/assign`, { assignee: inspId })).statusCode, 403);
  const r = await dee.post(`/api/issues/${manual}/assign`, { assignee: inspId, due_date: '2026-01-10', note: 'Fix before monsoon' });
  assert.equal(r.statusCode, 200, r.body);
  const d = (await dee.get(`/api/issues/${manual}`)).json().issue;
  assert.equal(d.status, 'assigned');
  assert.equal(d.assignee_name, 'Trial Field Inspector');
  assert.equal(d.overdue, true);
  const od = (await dee.get('/api/issues?overdue=1')).json();
  assert.ok(od.rows.some((x: { code: string }) => x.code === manual));
  const users = (await dee.get('/api/users/assignable')).json().users;
  assert.ok(!users.some((x: { role: string }) => x.role === 'viewer'));
});
await check('compliance issue: a failed test raises it; it cannot be resolved by hand; complied + verified closes it', async () => {
  await save({ pipeline: 'laid', cutting: 'backfilled' });
  await insp.post(`/api/stretches/${CODE}/compliance`, { item_key: 'compaction', result: 'complied', value: 88, documents: [await upload('document')] });
  const ci = find(await issuesOf('&status=active'), 'compliance')!;
  assert.ok(ci, 'compliance issue raised');
  assert.match(ci.title, /Compaction/);
  assert.equal((await aee.post(`/api/issues/${ci.code}/resolve`, { note: 'ok now' })).statusCode, 400);
  const rec = await insp.post(`/api/stretches/${CODE}/compliance`, { item_key: 'compaction', result: 'complied', value: 97, documents: [await upload('document')] });
  assert.equal((await issuesOf()).find((r) => r.code === ci.code)!.status, 'open'); // complied, not yet verified
  // the failed record must be verified too (accepting the failure) or it keeps the item "not complied"
  const recs = (await aee.get(`/api/compliance/records?item=compaction&verification=waiting`)).json().rows;
  for (const x of recs) if (x.id !== rec.json().id) await aee.post(`/api/compliance/records/${x.id}/verify`, { decision: 'reject', note: 'Superseded by the re-test' });
  await aee.post(`/api/compliance/records/${rec.json().id}/verify`, { decision: 'accept' });
  const closed = (await issuesOf()).find((r) => r.code === ci.code)!;
  assert.equal(closed.status, 'resolved');
  assert.equal(closed.resolution_note, 'Complied and verified');
});
await check('list: filters, sort by severity, bad sort refused, CSV of exactly the filtered list', async () => {
  const all = (await viewer.get('/api/issues?sort=severity&dir=desc&limit=500')).json();
  const sev = all.rows.map((r: { severity: string }) => r.severity);
  const rank = { high: 3, medium: 2, low: 1 } as Record<string, number>;
  assert.deepEqual(sev, [...sev].sort((a: string, b: string) => rank[b] - rank[a]));
  assert.equal((await viewer.get('/api/issues?sort=bogus')).statusCode, 400);
  const csv = await viewer.get('/api/issues?kind=culvert_damaged&format=csv');
  assert.match(csv.headers['content-type'] as string, /text\/csv/);
  const lines = csv.body.trim().split('\r\n');
  assert.equal(lines.length, 2);
  assert.match(lines[1], new RegExp(manual));
});
await check('permanent delete: Commissioner only, reason required; audit kept; photos used only by it removed; road damage cleared', async () => {
  await save({ potholes: true });
  const pot = find(await issuesOf('&status=active'), 'potholes')!;
  const d = (await com.get(`/api/issues/${manual}`)).json().issue;
  const photo = d.photos[0];
  assert.ok(existsSync(path.join(FILES_DIR, photo)));
  assert.equal((await dee.post('/api/issues/delete', { codes: [manual], reason: 'Duplicate report' })).statusCode, 403);
  assert.equal((await com.post('/api/issues/delete', { codes: [manual], reason: '' })).statusCode, 400);
  const r = await com.post('/api/issues/delete', { codes: [manual, pot.code], reason: 'Reported on the wrong road' });
  assert.equal(r.statusCode, 200, r.body);
  assert.deepEqual(r.json().deleted, [manual, pot.code]);
  assert.equal((await com.get(`/api/issues/${manual}`)).statusCode, 404);
  assert.ok(!existsSync(path.join(FILES_DIR, photo)));
  const a = await db.query<{ n: string }>("SELECT count(*) AS n FROM audit_log WHERE action = 'issue_deleted'");
  assert.equal(Number(a[0].n), 2);
  const c = await refreshVersion();
  assert.equal(c.stretch.status.potholes, false);
  assert.ok(!(await issuesOf('&status=active')).some((x) => x.kind === 'potholes'));
});

await check('report anywhere on the map: ward and zone from the place; a place or GPS is needed; outside the city refused', async () => {
  const [lon, lat] = full.stretches[5].geom.coordinates[0][0];
  const r = await insp.post('/api/issues', { lon, lat, kind: 'drain_damaged', severity: 'low', remark: 'Side drain wall fallen' });
  assert.equal(r.statusCode, 200, r.body);
  const d = (await insp.get(`/api/issues/${r.json().code}`)).json().issue;
  assert.equal(d.stretch_code, null);
  assert.equal(d.ward, full.stretches[5].ward);
  assert.equal(d.severity, 'low');
  assert.equal((await insp.post('/api/issues', { kind: 'other', remark: 'somewhere' })).statusCode, 400);
  const g = await insp.post('/api/issues', { kind: 'other', remark: 'at my position', gps: { lon, lat, accuracy_m: 5 } });
  assert.equal(g.statusCode, 200, g.body);
  assert.equal((await insp.post('/api/issues', { lon: 80.5, lat: 17, kind: 'other', remark: 'far away' })).statusCode, 400);
  assert.equal((await viewer.post('/api/issues', { lon, lat, kind: 'other', remark: 'viewer' })).statusCode, 403);
  assert.ok((await viewer.get('/api/issues?status=active&limit=500')).json().rows.some((x: { code: string }) => x.code === r.json().code));
});

console.log(`\n${passed} checks passed (${db.engine})`);
await app.close();
await db.close();
