/**
 * Phase 2/3 end-to-end API test: work status updates, validation, history, edit conflicts, compliance
 * recording with evidence, pass rules, gates (warn / block / Commissioner override), verification rules,
 * restoration approval, overdue items, monitoring lists, compliance list versions. Fresh temporary database,
 * on work stretches made from real DPR pipes (app-data/dpr_network_seed.json).
 * Run:  npm run test:works -w server
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.STATE_DIR = mkdtempSync(path.join(os.tmpdir(), 'wgl-test2-'));
const { buildApp } = await import('../app.ts');
const { migrate, openDb } = await import('../db.ts');
const { seedAccounts } = await import('../auth.ts');
const { loadComplianceItems } = await import('../seed.ts');
const { DATA_DIR } = await import('../config.ts');
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
  assert.equal(r2.statusCode, 200);
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

let passed = 0;
async function check(name: string, fn: () => Promise<void>) {
  await fn();
  passed++;
  console.log(`  ok  ${name}`);
}
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]).toString('base64');
const PDF = Buffer.from('%PDF-1.4\n% test report\n').toString('base64');
async function upload(kind: 'photo' | 'document') {
  const r = await insp.post('/api/files', { kind, name: kind === 'photo' ? 'site.jpg' : 'report.pdf', mime: kind === 'photo' ? 'image/jpeg' : 'application/pdf', data: kind === 'photo' ? JPEG : PDF });
  assert.equal(r.statusCode, 200, r.body);
  return r.json().id as string;
}


/** A work stretch made (by an AEE) from the DPR pipes of seed stretch i: how work is set up now. */
async function makeWork(who: { post: (u: string, p: unknown) => Promise<{ statusCode: number; body: string; json: () => any }> }, i: number, name = `Test work ${i}`) {
  const r = await who.post('/api/site/stretches', { name, dpr_pipes: full.stretches[i].pipes.map((p: unknown[]) => p[0]) });
  if (r.statusCode !== 200) throw new Error(r.body);
  return r.json().code as string;
}
const CODE = await makeWork(aee, 0);
const CODE2 = await makeWork(aee, 1);
let cardV = 1;
const status = (over: Partial<typeof EMPTY_STATUS>, base = EMPTY_STATUS) => ({ ...base, ...over });
let cur = { ...EMPTY_STATUS };
async function save(who: ReturnType<typeof as>, over: Partial<typeof EMPTY_STATUS>, extra: Record<string, unknown> = {}) {
  const next = status(over, cur);
  const r = await who.post(`/api/stretches/${CODE}/status`, { status: next, version: cardV, note: 'test', photos: [], ...extra });
  if (r.statusCode === 200) {
    cardV = r.json().card.stretch.version;
    cur = r.json().card.stretch.status;
  }
  return r;
}
const itemState = (cardJson: { compliance: { stages: { items: { item: { key: string }; state: string }[] }[] } }, key: string) =>
  cardJson.compliance.stages.flatMap((s) => s.items).find((i) => i.item.key === key)!.state;

await check('2 work stretches made from DPR pipes; 22 compliance items; every pipe in one work stretch', async () => {
  const n = await db.query<{ n: string }>("SELECT count(*) AS n FROM stretches WHERE source = 'site'");
  assert.equal(Number(n[0].n), 2);
  const h = await db.query<{ n: string }>("SELECT count(*) AS n FROM stretch_history WHERE kind = 'created'");
  assert.equal(Number(h[0].n), 2);
  const items = await db.query<{ n: string }>('SELECT count(*) AS n FROM compliance_items');
  assert.equal(Number(items[0].n), 22);
  const pipes = full.stretches.slice(0, 2).reduce((a: number, s: { pipes: unknown[] }) => a + s.pipes.length, 0);
  const sp = await db.query<{ n: string }>('SELECT count(*) AS n FROM stretch_pipes');
  assert.equal(Number(sp[0].n), pipes);
});
await check('stretch card: not started, nothing due, permissions by role', async () => {
  const c = (await insp.get(`/api/stretches/${CODE}`)).json();
  assert.equal(c.stretch.stage, 'not_started');
  assert.equal(c.compliance.summary.theme, 'nothing_due');
  assert.equal(c.can.update, true);
  assert.equal(c.can.verify, false);
  assert.equal((await viewer.get(`/api/stretches/${CODE}`)).json().can.update, false);
  assert.equal((await insp.get('/api/stretches/W999-999')).statusCode, 404);
});
await check('viewer cannot update; bad input is a clear 400', async () => {
  assert.equal((await save(viewer, { cutting: 'road_cut' })).statusCode, 403);
  const r = await insp.post(`/api/stretches/${CODE}/status`, { status: { ...EMPTY_STATUS, pipeline: 'flying' }, version: 1 });
  assert.equal(r.statusCode, 400);
});
await check('blocking gate: road cutting refused until the permission is recorded', async () => {
  const r = await save(insp, { cutting: 'road_cut', cut_length_m: 40 });
  assert.equal(r.statusCode, 409);
  assert.equal(r.json().code, 'GATE_BLOCK');
  assert.match(r.json().error, /Every required permission valid/);
});
await check('compliance needs its evidence; permission recorded with reference + document', async () => {
  const r = await insp.post(`/api/stretches/${CODE}/compliance`, { item_key: 'permissions_valid', result: 'complied', reference: 'RC-1' });
  assert.equal(r.statusCode, 400);
  assert.match(r.json().error, /document/);
  const doc = await upload('document');
  const r2 = await insp.post(`/api/stretches/${CODE}/compliance`, { item_key: 'permissions_valid', result: 'complied', reference: 'RC-2026-114', documents: [doc] });
  assert.equal(r2.statusCode, 200, r2.body);
  assert.equal(itemState(r2.json().card, 'permissions_valid'), 'complied');
});
await check('road cut saved with warnings for the other before-cutting items; stage Work in progress', async () => {
  const r = await save(insp, { cutting: 'road_cut', cut_length_m: 40 }, { gps: await (async () => { const g = (await insp.get(`/api/stretches/${CODE}`)).json().stretch.geom.coordinates[0][0]; return { lat: g[1], lon: g[0], accuracy_m: 8 }; })() });
  assert.equal(r.statusCode, 200, r.body);
  const w = r.json().warnings.join(' ');
  assert.match(w, /Existing utilities located and marked/);
  assert.match(w, /Work board displayed/);
  assert.equal(r.json().distance, 0);
  assert.equal(r.json().card.stretch.stage, 'in_progress');
  assert.equal(itemState(r.json().card, 'barricading'), 'due');
});
await check('history: who, from -> to, snapshot, GPS distance, warnings', async () => {
  const h = (await aee.get(`/api/stretches/${CODE}/history`)).json().history;
  const last = h.find((x: { kind: string }) => x.kind === 'status');
  assert.equal(last.by_name, 'Trial Field Inspector');
  assert.deepEqual(last.changes.find((c: { field: string }) => c.field === 'cutting'), { field: 'cutting', label: 'Road cutting', from: 'Road not cut', to: 'Road cut' });
  assert.equal(last.snapshot.status.cutting, 'road_cut');
  assert.equal(last.distance_m, 0);
  assert.ok(last.warnings.length >= 2);
});
await check('edit conflict: an update based on an old version is refused', async () => {
  const r = await insp.post(`/api/stretches/${CODE}/status`, { status: status({ motorability: 'difficulty' }, cur), version: cardV - 1, photos: [] });
  assert.equal(r.statusCode, 409);
  assert.equal(r.json().code, 'CONFLICT');
});
await check('validation errors: restored > broken, partial pipe without metres', async () => {
  const r = await save(insp, { taps_broken: 1, taps_restored: 2 });
  assert.equal(r.statusCode, 400);
  assert.match(r.json().error, /restored cannot be more than broken/);
  const r2 = await save(insp, { pipeline: 'partly', pipe_laid_m: null });
  assert.equal(r2.statusCode, 400);
});
await check('record + verify: inspector cannot verify, AEE cannot verify own, AEE verifies inspector record', async () => {
  const photo = await upload('photo');
  const r = await insp.post(`/api/stretches/${CODE}/compliance`, { item_key: 'barricading', result: 'complied', photos: [photo] });
  assert.equal(r.statusCode, 200, r.body);
  const id = r.json().id;
  assert.equal((await insp.post(`/api/compliance/records/${id}/verify`, { decision: 'accept' })).statusCode, 403);
  const own = await aee.post(`/api/stretches/${CODE}/compliance`, { item_key: 'night_lighting', result: 'complied', photos: [photo] });
  assert.equal((await aee.post(`/api/compliance/records/${own.json().id}/verify`, { decision: 'accept' })).statusCode, 403);
  const waiting = (await aee.get('/api/compliance/records?verification=waiting')).json();
  assert.ok(waiting.rows.some((x: { id: number; can_verify: boolean }) => x.id === id && x.can_verify));
  const v = await aee.post(`/api/compliance/records/${id}/verify`, { decision: 'accept' });
  assert.equal(v.statusCode, 200, v.body);
  assert.equal(itemState(v.json().card, 'barricading'), 'verified');
});
await check('rejected verification makes the item due again (reason required)', async () => {
  const photo = await upload('photo');
  const r = await insp.post(`/api/stretches/${CODE}/compliance`, { item_key: 'ppe', result: 'complied', photos: [photo] });
  assert.equal((await aee.post(`/api/compliance/records/${r.json().id}/verify`, { decision: 'reject' })).statusCode, 400);
  const v = await aee.post(`/api/compliance/records/${r.json().id}/verify`, { decision: 'reject', note: 'Photo does not show helmets' });
  assert.equal(itemState(v.json().card, 'ppe'), 'due');
});
await check('overdue: a mandatory item past its grace days turns the stretch red with a C badge', async () => {
  await db.query(`UPDATE stretches SET milestones = jsonb_set(milestones, '{trench_open}', to_jsonb($2::text)) WHERE code = $1`,
    [CODE, new Date(Date.now() - 5 * 86400000).toISOString()]);
  const c = (await com.post(`/api/stretches/${CODE}/compliance`, { item_key: 'work_board', result: 'complied', photos: [await upload('photo')] })).json().card;
  assert.equal(itemState(c, 'spoil_stacked'), 'overdue');
  assert.equal(c.compliance.summary.theme, 'non_compliance');
  assert.ok(c.badges.includes('C'));
  assert.ok(c.tags.some((t: string) => t.startsWith('Overdue: ')));
});
await check('measured value below the pass rule is recorded as not complied', async () => {
  await save(insp, { pipeline: 'laid', manholes_built: 3, cutting: 'backfilled' });
  assert.equal(cur.restoration, 'pending'); // back-filling makes restoration due
  const r = await insp.post(`/api/stretches/${CODE}/compliance`, { item_key: 'compaction', result: 'complied', value: 91, documents: [await upload('document')] });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().result, 'not_complied');
  assert.equal(itemState(r.json().card, 'compaction'), 'not_complied');
  const r2 = await insp.post(`/api/stretches/${CODE}/compliance`, { item_key: 'compaction', result: 'complied', value: 96.5, documents: [await upload('document')] });
  assert.equal(r2.json().result, 'complied');
});
await check('restoration: road type needed, photo required; final step waits for approval', async () => {
  const r = await save(insp, { restoration: 'done' });
  assert.equal(r.statusCode, 400);
  assert.match(r.json().error, /road type/);
  const r2 = await save(insp, { restoration: 'done', road_type: 'cc' });
  assert.equal(r2.statusCode, 400);
  assert.match(r2.json().error, /photo is required/);
  const r3 = await save(insp, { restoration: 'done', road_type: 'cc' }, { photos: [await upload('photo')] });
  assert.equal(r3.statusCode, 200, r3.body);
  assert.equal(r3.json().card.stretch.approval, 'pending');
  assert.equal(r3.json().card.stretch.stage, 'restored_awaiting');
  assert.equal(itemState(r3.json().card, 'cube_test'), 'due'); // CC roads only
});
await check('approval: AEE cannot approve; DEE rejection needs a reason; DEE approves', async () => {
  assert.equal((await aee.post(`/api/stretches/${CODE}/approval`, { decision: 'approve' })).statusCode, 403);
  assert.equal((await dee.post(`/api/stretches/${CODE}/approval`, { decision: 'reject' })).statusCode, 400);
  const r = await dee.post(`/api/stretches/${CODE}/approval`, { decision: 'approve', note: 'Seen on site' });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().card.stretch.stage, 'restored_approved');
  assert.ok(r.json().warnings.some((w: string) => /cube test/i.test(w)));
});
await check('monitoring list and map states reflect the stretch', async () => {
  const l = (await viewer.get('/api/works?stage=restored_approved')).json();
  assert.equal(l.total, 1);
  assert.equal(l.rows[0].code, CODE);
  assert.equal(l.by_stage.reduce((a: number, s: { n: number }) => a + s.n, 0), 2);
  const st = (await viewer.get('/api/stretches/states')).json().states;
  assert.deepEqual(st.find((x: string[]) => x[0] === CODE).slice(0, 2), [CODE, 'restored_approved']);
  assert.equal((await viewer.get('/api/works?sort=bogus')).statusCode, 400);
});
await check('Commissioner override of a blocking gate is recorded with the reason', async () => {
  const code2 = CODE2;
  const body = { status: { ...EMPTY_STATUS, cutting: 'trench_open' }, version: 1, photos: [] };
  assert.equal((await com.post(`/api/stretches/${code2}/status`, body)).statusCode, 409);
  const r = await com.post(`/api/stretches/${code2}/status`, { ...body, override_reason: 'Emergency repair of a burst line' });
  assert.equal(r.statusCode, 200, r.body);
  const h = (await com.get(`/api/stretches/${code2}/history`)).json().history[0];
  assert.equal(h.override, 'Emergency repair of a burst line');
});
await check('compliance list: only the Commissioner edits; edits make a new version, old records keep theirs; retire hides', async () => {
  const items = (await com.get('/api/compliance/items')).json().items;
  const it = items.find((i: { key: string }) => i.key === 'compaction');
  const { id: _i, version: _v, retired_at: _r, is_current: _c, created_at: _ca, ...edit } = it;
  assert.equal((await aee.post('/api/compliance/items', { ...edit, pass_rule: { op: '>=', value: 97 } })).statusCode, 403);
  const r = await com.post('/api/compliance/items', { ...edit, pass_rule: { op: '>=', value: 97 } });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().version, 2);
  const recs = await db.query<{ item_version: number }>("SELECT item_version FROM compliance_records WHERE item_key = 'compaction'");
  assert.ok(recs.every((x) => x.item_version === 1));
  assert.equal((await com.get('/api/compliance/items/compaction/versions')).json().versions.length, 2);
  await com.post('/api/compliance/items/dewatering/retire', { retire: true });
  const c = (await insp.get(`/api/stretches/${CODE}`)).json();
  assert.equal(c.compliance.stages.flatMap((s: { items: { item: { key: string } }[] }) => s.items).some((i: { item: { key: string } }) => i.item.key === 'dewatering'), false);
});
await check('files: wrong content type refused; download only when signed in', async () => {
  const bad = await insp.post('/api/files', { kind: 'photo', name: 'x.jpg', mime: 'image/jpeg', data: PDF });
  assert.equal(bad.statusCode, 400);
  const id = await upload('photo');
  assert.equal((await app.inject({ url: `/api/files/${id}` })).statusCode, 401);
  const r = await viewer.get(`/api/files/${id}`);
  assert.equal(r.statusCode, 200);
  assert.equal(r.headers['content-type'], 'image/jpeg');
  assert.equal((await viewer.post('/api/files', { kind: 'photo', name: 'x.jpg', mime: 'image/jpeg', data: JPEG })).statusCode, 403);
});
await check('seed file is not downloadable', async () => {
  assert.equal((await viewer.get('/data/stretches_seed.json')).statusCode, 404);
});

console.log(`\n${passed} checks passed (${db.engine})`);
await app.close();
await db.close();
