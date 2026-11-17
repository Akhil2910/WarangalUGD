/**
 * Site network end-to-end API test: manholes and pipelines drawn on the imagery (AEE and above), lengths,
 * wards, guards, Work/Road stretches made from site pipelines (with status, compliance, history like any
 * stretch), redrawing a site stretch, protection of pipelines in a stretch, map / search / list.
 * Run:  npm run test:site -w server
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.STATE_DIR = mkdtempSync(path.join(os.tmpdir(), 'wgl-test5-'));
const { buildApp } = await import('../app.ts');
const { migrate, openDb } = await import('../db.ts');
const { seedAccounts } = await import('../auth.ts');
const { loadComplianceItems } = await import('../seed.ts');
const { DATA_DIR } = await import('../config.ts');
const { metres, wardAt } = await import('../geo.ts');
const { EMPTY_STATUS } = await import('shared');

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
const dee = as(await signIn('dee@gwmc.local'));
const viewer = as(await signIn('viewer@gwmc.local'));

let passed = 0;
async function check(name: string, fn: () => Promise<void>) {
  await fn();
  passed++;
  console.log(`  ok  ${name}`);
}
const [lon0, lat0] = full.stretches[0].geom.coordinates[0][0] as [number, number];
const P = (dx: number, dy: number) => ({ lon: lon0 + dx, lat: lat0 + dy });
const ids: number[] = [];
const pipes: number[] = [];
let SC = '';

await check('manholes: AEE/DEE only; auto number; duplicate number and points outside the city refused; ward found', async () => {
  assert.equal((await insp.post('/api/site/manholes', P(0, 0))).statusCode, 403);
  assert.equal((await viewer.post('/api/site/manholes', P(0, 0))).statusCode, 403);
  const r = await aee.post('/api/site/manholes', { ...P(0, 0), depth_m: 1.8 });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().code, 'SMH-0001');
  assert.equal(r.json().ward, wardAt(lon0, lat0).ward);
  ids.push(r.json().id);
  for (const [i, pt] of [P(0.0006, 0), P(0.0012, 0.0002), P(0.0012, 0.0012)].entries()) {
    const x = await dee.post('/api/site/manholes', { ...pt, code: `MH-T${i + 2}`, invert_m: 240 + i });
    assert.equal(x.statusCode, 200, x.body);
    ids.push(x.json().id);
  }
  assert.equal((await aee.post('/api/site/manholes', { ...P(0.003, 0), code: 'mh-t2' })).statusCode, 400); // same number, any case
  assert.equal((await aee.post('/api/site/manholes', { lon: 80.5, lat: 17.0 })).statusCode, 400);
});
await check('pipelines: length measured, different manholes, no duplicates, at most 1,000 m', async () => {
  const r = await aee.post('/api/site/pipes', { from_mh: ids[0], to_mh: ids[1], dia_mm: 200, material: 'DWC' });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().length_m, Math.round(metres(lon0, lat0, lon0 + 0.0006, lat0) * 10) / 10);
  pipes.push(r.json().id);
  const r2 = await aee.post('/api/site/pipes', { from_mh: ids[1], to_mh: ids[2], dia_mm: 300, material: 'RCC NP3' });
  pipes.push(r2.json().id);
  const r3 = await aee.post('/api/site/pipes', { from_mh: ids[2], to_mh: ids[3], dia_mm: 300 });
  pipes.push(r3.json().id);
  assert.equal((await aee.post('/api/site/pipes', { from_mh: ids[0], to_mh: ids[0], dia_mm: 200 })).statusCode, 400);
  assert.equal((await aee.post('/api/site/pipes', { from_mh: ids[1], to_mh: ids[0], dia_mm: 200 })).statusCode, 400); // already joined
  assert.equal((await aee.post('/api/site/pipes', { from_mh: ids[0], to_mh: ids[3], dia_mm: 123 })).statusCode, 400); // bad diameter
  const far = (await aee.post('/api/site/manholes', P(0.012, 0))).json().id;
  assert.equal((await aee.post('/api/site/pipes', { from_mh: ids[0], to_mh: far, dia_mm: 200 })).statusCode, 400);
  assert.equal((await insp.post('/api/site/pipes', { from_mh: ids[0], to_mh: ids[3], dia_mm: 200 })).statusCode, 403);
});
await check('work/road stretch from site pipelines: code W<ward>-S001, totals, card like any stretch', async () => {
  assert.equal((await insp.post('/api/site/stretches', { name: 'Test lane', pipes: pipes.slice(0, 2) })).statusCode, 403);
  const r = await aee.post('/api/site/stretches', { name: 'Trial lane behind school', pipes: pipes.slice(0, 2) });
  assert.equal(r.statusCode, 200, r.body);
  SC = r.json().code;
  assert.match(SC, /^W\d+-S001$/);
  const c = (await insp.get(`/api/stretches/${SC}`)).json();
  assert.equal(c.stretch.source, 'site');
  assert.equal(c.stretch.planned_manholes, 3);
  assert.equal(c.stretch.max_dia_mm, 300);
  assert.equal(c.stretch.road_name, 'Trial lane behind school');
  assert.equal(c.stretch.pipes_count, 2);
  assert.equal(c.can.update, true);
  assert.equal((await aee.post('/api/site/stretches', { name: 'Again', pipes: [pipes[1]] })).statusCode, 400); // pipe already in a stretch
});
await check('status and compliance work on a site stretch (blocking permission, then road cut)', async () => {
  const blocked = await insp.post(`/api/stretches/${SC}/status`, { status: { ...EMPTY_STATUS, cutting: 'road_cut' }, version: 1, photos: [] });
  assert.equal(blocked.statusCode, 409);
  const doc = (await insp.post('/api/files', { kind: 'document', name: 'p.pdf', mime: 'application/pdf', data: Buffer.from('%PDF-1.4\n').toString('base64') })).json().id;
  assert.equal((await insp.post(`/api/stretches/${SC}/compliance`, { item_key: 'permissions_valid', result: 'complied', reference: 'X-1', documents: [doc] })).statusCode, 200);
  const ok = await insp.post(`/api/stretches/${SC}/status`, { status: { ...EMPTY_STATUS, cutting: 'road_cut' }, version: 1, photos: [] });
  assert.equal(ok.statusCode, 200, ok.body);
  assert.equal(ok.json().card.stretch.stage, 'in_progress');
  // per-reach item: the 300 mm pipe is one unit, the 200 mm pipe goes with "smaller ones together"
  const leak = ok.json().card.compliance.stages.flatMap((s: { items: unknown[] }) => s.items).find((i: { item: { key: string } }) => i.item.key === 'leak_test');
  assert.equal(leak.units.length, 2);
});
await check('pipelines and manholes in a stretch are protected; free ones can be deleted', async () => {
  assert.equal((await aee.post(`/api/site/pipes/${pipes[0]}/delete`, {})).statusCode, 400);
  assert.equal((await aee.post(`/api/site/manholes/${ids[1]}/edit`, P(0.0007, 0.0001))).statusCode, 400); // move refused
  assert.equal((await aee.post(`/api/site/manholes/${ids[3]}/edit`, { depth_m: 2.2, note: 'checked' })).statusCode, 200); // details fine
  assert.equal((await aee.post(`/api/site/manholes/${ids[3]}/delete`, {})).statusCode, 400); // has a pipe
});
await check('redraw: add a pipeline to the site stretch; history records it; DPR stretches cannot be redrawn', async () => {
  const before = (await insp.get(`/api/stretches/${SC}`)).json().stretch;
  const r = await aee.post(`/api/site/stretches/${SC}/pipes`, { add: [pipes[2]] });
  assert.equal(r.statusCode, 200, r.body);
  const after = (await insp.get(`/api/stretches/${SC}`)).json().stretch;
  assert.ok(after.length_m > before.length_m);
  assert.equal(after.version, before.version + 1);
  assert.equal(after.planned_manholes, 4);
  assert.equal(after.status.cutting, 'road_cut'); // status kept
  const h = (await insp.get(`/api/stretches/${SC}/history`)).json().history[0];
  assert.equal(h.kind, 'network');
  assert.equal((await aee.post(`/api/site/stretches/${full.stretches[0].code}/pipes`, { add: [] })).statusCode, 404); // DPR road stretches are not used
});
let MIX = '';
await check('work stretch from DPR pipes plus a drawn pipeline from a DPR manhole; separate pieces reported; a DPR pipe in only one work stretch', async () => {
  const dpr = full.stretches[1].pipes.map((p: unknown[]) => p[0] as string);
  const firstMh = full.stretches[1].pipes[0][2] as string;
  const a = await aee.post('/api/site/manholes', { dpr_mh: firstMh });
  assert.equal(a.statusCode, 200, a.body);
  assert.equal(a.json().code, firstMh);
  assert.equal((await aee.post('/api/site/manholes', { dpr_mh: firstMh })).json().id, a.json().id); // same DPR manhole: same site manhole
  const fresh = (await aee.post('/api/site/manholes', P(0.0003, -0.0004))).json().id;
  // the new manhole is far from that DPR manhole: allowed only if under 1,000 m
  const pipe = await aee.post('/api/site/pipes', { from_mh: a.json().id, to_mh: fresh, dia_mm: 250 });
  const drawn = pipe.statusCode === 200 ? [pipe.json().id] : [];
  const pv = (await aee.post('/api/site/stretches/preview', { dpr_pipes: dpr, pipes: drawn })).json();
  assert.equal(pv.pipes, dpr.length + drawn.length);
  assert.equal(pv.pieces, 1);
  const pv2 = (await aee.post('/api/site/stretches/preview', { dpr_pipes: [dpr[0], ...full.stretches[3].pipes.map((p: unknown[]) => p[0])] })).json();
  assert.ok(pv2.pieces >= 2, 'separate pieces reported');
  const r = await aee.post('/api/site/stretches', { name: 'Trial road on DPR pipes', dpr_pipes: dpr, pipes: drawn });
  assert.equal(r.statusCode, 200, r.body);
  MIX = r.json().code;
  const again = await aee.post('/api/site/stretches', { name: 'Same pipes again', dpr_pipes: [dpr[0]] });
  assert.equal(again.statusCode, 400);
  assert.match(again.json().error, new RegExp(MIX));
  const c = (await insp.get(`/api/stretches/${MIX}`)).json().stretch;
  assert.equal(c.catchment, full.stretches[1].catchment);
  const m = (await viewer.get('/api/site/map')).json();
  assert.equal(m.dpr_taken[dpr[0]], MIX);
  // work stretches (of any pipes) can still be grouped through the API
  assert.equal((await aee.post('/api/work-groups', { name: 'Mixed', roads: [SC, MIX] })).statusCode, 200);
});
await check('map, search and the works list show the site network', async () => {
  const m = (await viewer.get('/api/site/map')).json();
  assert.equal(m.manholes.features.length, 7);
  assert.equal(m.pipes.features.length, 3);
  assert.equal(m.stretches.features.length, 2);
  assert.equal(m.stretches.features.find((f: { properties: { code: string } }) => f.properties.code === SC).properties.stage, 'in_progress');
  assert.ok(m.pipes.features.filter((f: { properties: { stretch: string } }) => f.properties.stretch).length >= 3);
  const s = (await viewer.get('/api/search/db?q=trial lane')).json().results;
  assert.ok(s.some((x: { label: string }) => x.label === SC));
  assert.ok((await viewer.get('/api/search/db?q=MH-T3')).json().results.some((x: { kind: string }) => x.kind === 'Drawn manhole'));
  const l = (await viewer.get('/api/works?source=site')).json();
  assert.equal(l.total, 2);
  assert.equal((await viewer.get('/api/works?source=dpr')).json().total, 0);
});

await check('start and end points: from the two loose ends of a run of pipes; shown in the preview; correctable by typing', async () => {
  const pipes = full.stretches[2].pipes as [string, number, string, string, number][];
  const pv = (await aee.post('/api/site/stretches/preview', { dpr_pipes: pipes.map((p) => p[0]) })).json();
  assert.ok(pv.start_point && pv.end_point);
  assert.notEqual(pv.start_point.code, pv.end_point.code);
  const r = await aee.post('/api/site/stretches', { name: 'Ends test road', dpr_pipes: pipes.map((p) => p[0]) });
  const code = r.json().code;
  const s = (await insp.get(`/api/stretches/${code}`)).json().stretch;
  assert.deepEqual([s.start_point.code, s.end_point.code], [pv.start_point.code, pv.end_point.code]);
  assert.ok(Math.abs(s.start_point.lat - 18) < 0.5 && Math.abs(s.start_point.lon - 79.5) < 0.5);
  const fix = { start_point: { lat: 18.001, lon: 79.551 }, end_point: { lat: 18.002, lon: 79.552 } };
  assert.equal((await insp.post(`/api/site/stretches/${code}/ends`, fix)).statusCode, 403);
  assert.equal((await aee.post(`/api/site/stretches/${code}/ends`, { ...fix, end_point: { lat: 17, lon: 80.5 } })).statusCode, 400);
  assert.equal((await aee.post(`/api/site/stretches/${code}/ends`, fix)).statusCode, 200);
  const s2 = (await insp.get(`/api/stretches/${code}`)).json().stretch;
  assert.equal(s2.start_point.lat, 18.001);
  assert.equal(s2.start_point.typed, true);
  const h = (await insp.get(`/api/stretches/${code}/history`)).json().history[0];
  assert.equal(h.changes[0].label, 'Start point');
  const l = (await viewer.get('/api/works?q=Ends test')).json().rows[0];
  assert.equal(l.end_point.lon, 79.552);
});
await check('each person keeps their own map layer styles (colour, width, line type)', async () => {
  assert.deepEqual((await insp.get('/api/me/prefs')).json().prefs, {});
  const bad = await insp.post('/api/me/prefs', { map_styles: { dpr_pipes: { color: 'purple' } } });
  assert.equal(bad.statusCode, 400);
  assert.equal((await insp.post('/api/me/prefs', { map_styles: { dpr_pipes: { color: '#7c3aed', width: 1.5, dash: 'dashed' }, wards: { dash: 'dotted' } } })).statusCode, 200);
  assert.equal((await insp.get('/api/me/prefs')).json().prefs.map_styles.dpr_pipes.color, '#7c3aed');
  assert.deepEqual((await aee.get('/api/me/prefs')).json().prefs, {}); // others unaffected
});

console.log(`\n${passed} checks passed (${db.engine})`);
await app.close();
await db.close();
