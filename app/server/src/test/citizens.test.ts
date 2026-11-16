/**
 * Grievances (QR code, public form, status check, staff handling), utilities (mark, import) and the dashboard.
 * Run:  npm run test:citizens -w server
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.STATE_DIR = mkdtempSync(path.join(os.tmpdir(), 'wgl-test6-'));
const { buildApp } = await import('../app.ts');
const { migrate, openDb } = await import('../db.ts');
const { seedAccounts } = await import('../auth.ts');
const { loadComplianceItems } = await import('../seed.ts');
const { DATA_DIR } = await import('../config.ts');
const { resetPublicLimits } = await import('../grievances.ts');
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
const pub = {
  get: (url: string) => app.inject({ url }),
  post: (url: string, payload: unknown) => app.inject({ method: 'POST', url, headers: H, payload: payload as object }),
};
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
const S0 = full.stretches[0];
const CODE = (await aee.post('/api/site/stretches', { name: 'Citizen test road', dpr_pipes: S0.pipes.map((p: unknown[]) => p[0]) })).json().code as string;
let TOKEN = '';
let G = '';
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]).toString('base64');

await check('QR code: staff get an image and a link with a random token; the token is stable', async () => {
  assert.equal((await pub.get(`/api/stretches/${CODE}/qr`)).statusCode, 401);
  const r = (await viewer.get(`/api/stretches/${CODE}/qr`)).json();
  assert.match(r.svg, /^<svg/);
  TOKEN = r.url.split('/g/')[1];
  assert.match(TOKEN, /^[A-Za-z0-9_-]{12}$/);
  assert.ok(!TOKEN.includes(CODE));
  assert.equal((await viewer.get(`/api/stretches/${CODE}/qr`)).json().url.split('/g/')[1], TOKEN);
});
await check('public page: work stretch summary without signing in; bad token refused', async () => {
  const r = await pub.get(`/api/public/w/${TOKEN}`);
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().code, CODE);
  assert.equal(r.json().categories.length, 10);
  assert.ok(r.json().categories.every((c: { te: string }) => c.te.length > 0));
  assert.equal((await pub.get('/api/public/w/notarealtoken12')).statusCode, 404);
  // nothing else is public
  assert.equal((await pub.get('/api/grievances')).statusCode, 401);
  assert.equal((await pub.get(`/api/stretches/${CODE}`)).statusCode, 401);
});
await check('citizen submits: checks on mobile, consent, description; gets a number; goes to the AEE with a 3-day deadline', async () => {
  const photo = (await pub.post('/api/public/photos', { token: TOKEN, name: 'p.jpg', mime: 'image/jpeg', data: JPEG })).json().id;
  const base = { token: TOKEN, category: 'open_trench', description: 'Trench open near the school with no barricade', name: 'Ravi Kumar', mobile: '+91 98765 43210', consent: true, language: 'te', photos: [photo] };
  assert.equal((await pub.post('/api/public/grievances', { ...base, mobile: '12345' })).statusCode, 400);
  assert.equal((await pub.post('/api/public/grievances', { ...base, consent: false })).statusCode, 400);
  assert.equal((await pub.post('/api/public/grievances', { ...base, description: 'short' })).statusCode, 400);
  const r = await pub.post('/api/public/grievances', base);
  assert.equal(r.statusCode, 200, r.body);
  G = r.json().number;
  assert.equal(G, 'G-000001');
  const d = (await aee.get(`/api/grievances/${G}`)).json();
  assert.equal(d.grievance.status, 'assigned');
  assert.equal(d.grievance.assignee_name, 'Trial AEE');
  assert.equal(d.grievance.mobile, '9876543210');
  assert.equal(d.grievance.stretch_code, CODE);
  const days = (new Date(d.grievance.due_date).getTime() - new Date(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })).getTime()) / 86400000;
  assert.equal(days, 3);
  assert.equal((await insp.get(`/api/grievances/${G}`)).json().grievance.mobile, '98xxxxxx10'); // masked below AEE
});
await check('citizen checks the status with number + mobile only', async () => {
  assert.equal((await pub.get(`/api/public/grievances/${G}?mobile=9000000000`)).statusCode, 404);
  const r = (await pub.get(`/api/public/grievances/${G}?mobile=9876543210`)).json();
  assert.equal(r.status.key, 'assigned');
  assert.ok(r.status.te.length > 0);
});
await check('staff: field staff cannot act; AEE turns it into an issue, then resolves; citizen sees the answer; reopen', async () => {
  assert.equal((await insp.post(`/api/grievances/${G}/resolve`, { note: 'done' })).statusCode, 403);
  const ti = await aee.post(`/api/grievances/${G}/to-issue`, {});
  assert.equal(ti.statusCode, 200, ti.body);
  const issue = (await aee.get(`/api/issues/${ti.json().issue}`)).json().issue;
  assert.equal(issue.stretch_code, CODE);
  assert.match(issue.remark, new RegExp(G));
  assert.equal((await aee.post(`/api/grievances/${G}/resolve`, { note: '' })).statusCode, 400);
  assert.equal((await aee.post(`/api/grievances/${G}/resolve`, { note: 'Barricades put up on both sides', public_note: 'Barricading done. Thank you.' })).statusCode, 200);
  const s = (await pub.get(`/api/public/grievances/${G}?mobile=9876543210`)).json();
  assert.equal(s.status.key, 'resolved');
  assert.ok(s.updates.some((u: { note: string }) => u.note === 'Barricading done. Thank you.'));
  assert.equal((await aee.post(`/api/grievances/${G}/reopen`, { note: 'Barricade removed again' })).statusCode, 200);
  assert.equal((await dee.post(`/api/grievances/${G}/assign`, { assignee: (await dee.get('/api/users/assignable')).json().users.find((x: { role: string }) => x.role === 'aee').id })).statusCode, 200);
  assert.equal((await aee.post(`/api/grievances/${G}/assign`, { assignee: '00000000-0000-0000-0000-000000000000' })).statusCode, 403);
});
await check('misuse limit: at most 5 complaints an hour from one address', async () => {
  resetPublicLimits();
  const base = { token: TOKEN, category: 'dust_noise', description: 'Dust all day from the work site', name: 'Test', mobile: '9876500000', consent: true };
  for (let i = 0; i < 5; i++) assert.equal((await pub.post('/api/public/grievances', base)).statusCode, 200);
  assert.equal((await pub.post('/api/public/grievances', base)).statusCode, 429);
  resetPublicLimits();
});
await check('utilities: mark a pole and a water main; wrong shape refused; viewer refused; import a GeoJSON file', async () => {
  const [lon, lat] = S0.geom.coordinates[0][0];
  assert.equal((await insp.post('/api/utilities', { layer: 'electric_poles', geom: { type: 'Point', coordinates: [lon, lat] }, props: { owner: 'TSNPDCL', condition: 'Good' } })).statusCode, 200);
  assert.equal((await insp.post('/api/utilities', { layer: 'electric_poles', geom: { type: 'LineString', coordinates: [[lon, lat], [lon + 0.001, lat]] } })).statusCode, 400);
  assert.equal((await viewer.post('/api/utilities', { layer: 'trees', geom: { type: 'Point', coordinates: [lon, lat] } })).statusCode, 403);
  assert.equal((await insp.post('/api/utilities', { layer: 'water_mains', geom: { type: 'LineString', coordinates: [[lon, lat], [lon + 0.001, lat + 0.001]] }, props: { size: '150 mm', depth_m: 1.2 } })).statusCode, 200);
  const fc = { type: 'FeatureCollection', features: [
    { type: 'Feature', properties: { ID: 'T-1' }, geometry: { type: 'Point', coordinates: [lon + 0.0002, lat] } },
    { type: 'Feature', properties: { ID: 'T-2' }, geometry: { type: 'Point', coordinates: [lon + 0.0004, lat] } },
    { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[lon, lat], [lon + 1, lat]] } },
    { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [80.9, 16.5] } },
  ] };
  assert.equal((await insp.post('/api/utilities/import', { layer: 'transformers', geojson: fc })).statusCode, 403);
  const r = (await aee.post('/api/utilities/import', { layer: 'transformers', geojson: fc, source_name: 'TSNPDCL list' })).json();
  assert.deepEqual([r.added, r.skipped], [2, 2]);
  const sum = (await viewer.get('/api/utilities/summary')).json().layers;
  assert.equal(sum.find((l: { key: string }) => l.key === 'transformers').count, 2);
  assert.equal((await viewer.get('/api/utilities/map')).json().features.length, 4);
});
await check('dashboard: overall against the DPR plan, by zone / ward / sewerage zone, trend, activity; filters', async () => {
  await insp.post(`/api/stretches/${CODE}/compliance`, { item_key: 'permissions_valid', result: 'complied', reference: 'P', documents: [(await insp.post('/api/files', { kind: 'document', name: 'p.pdf', mime: 'application/pdf', data: Buffer.from('%PDF-1.4\n').toString('base64') })).json().id] });
  const st = await insp.post(`/api/stretches/${CODE}/status`, { status: { ...EMPTY_STATUS, cutting: 'road_cut', pipeline: 'laid' }, version: 1, photos: [] });
  assert.equal(st.statusCode, 200, st.body);
  const d = (await viewer.get('/api/dashboard')).json();
  assert.ok(d.overall.plan.km > 2700 && d.overall.plan.km < 2750);
  assert.equal(d.overall.works.count, 1);
  assert.equal(d.overall.works.pipe_laid_m, Math.round((await viewer.get(`/api/stretches/${CODE}`)).json().stretch.length_m));
  assert.ok(d.overall.grievances.total >= 6);
  assert.ok(d.overall.issues.open >= 1);
  assert.equal(d.areas.length, 8); // GWMC zones
  const today = d.trend[d.trend.length - 1];
  assert.ok(today.updates >= 1 && today.laid_m > 0 && today.grievances >= 6);
  assert.ok(d.activity.some((a: { name: string; updates: number }) => a.name === 'Trial Field Inspector' && a.updates >= 1));
  const w = (await viewer.get(`/api/dashboard?level=ward&ward=${S0.ward}`)).json();
  assert.equal(w.overall.works.count, 1);
  assert.ok(w.overall.plan.km > 0 && w.overall.plan.km < d.overall.plan.km);
  const other = (await viewer.get(`/api/dashboard?ward=${S0.ward === 1 ? 2 : 1}`)).json();
  assert.equal(other.overall.works.count, 0);
  const sz = (await viewer.get('/api/dashboard?level=sewer')).json();
  assert.equal(sz.areas.length, 6);
  assert.equal((await viewer.get('/api/dashboard?level=bogus')).statusCode, 400);
});

console.log(`\n${passed} checks passed (${db.engine})`);
await app.close();
await db.close();
