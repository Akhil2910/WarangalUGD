/**
 * Project definition and timeline: who may change what, packages, the Excel work programme (preview, apply, baseline, removal),
 * actual progress and late items, extensions of time, and the S-curve built from work-stretch updates.
 * Run:  npm run test:schedule -w server
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';

process.env.STATE_DIR = mkdtempSync(path.join(os.tmpdir(), 'wgl-test12-'));
const { buildApp } = await import('../app.ts');
const { migrate, openDb } = await import('../db.ts');
const { seedAccounts } = await import('../auth.ts');
const { loadComplianceItems } = await import('../seed.ts');
const { DATA_DIR } = await import('../config.ts');
const { EMPTY_STATUS, indiaDate, addDays } = await import('shared');

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
  return {
    get: (url: string) => app.inject({ url, headers: { cookie } }),
    post: (url: string, payload: unknown) => app.inject({ method: 'POST', url, headers: { ...H, cookie }, payload: payload as object }),
    upload: (url: string, body: Buffer) => app.inject({ method: 'POST', url, headers: { cookie, 'x-wgl-request': '1', 'content-type': 'application/octet-stream' }, payload: body }),
  };
}
let passed = 0;
async function check(name: string, fn: () => Promise<void>) {
  await fn();
  passed++;
  console.log(`  ok  ${name}`);
}
const today = indiaDate();
const comm = await signIn('commissioner@gwmc.local');
const pmu = await signIn('pmu@gwmc.local');
const contractor = await signIn('contractor@gwmc.local');
const aee = await signIn('aee@gwmc.local');
const viewer = await signIn('viewer@gwmc.local');

await check('only the PMU and Commissioner define the project; everyone can see it', async () => {
  const def = { name: 'Warangal UGD Project', work_start: addDays(today, -400), completion: addDays(today, 330), scheme: 'AMRUT 2.0', as_no: 'GO Ms 12', as_date: addDays(today, -500), sanctioned_cost_cr: 412.5, dlp_months: 24, scope: { pipe_km: 120, manholes: 4800, ics: 30000 } };
  assert.equal((await contractor.post('/api/project/definition', def)).statusCode, 403);
  assert.equal((await viewer.post('/api/project/definition', def)).statusCode, 403);
  const r = await pmu.post('/api/project/definition', def);
  assert.equal(r.statusCode, 200, r.body);
  const p = (await viewer.get('/api/project/plan')).json();
  assert.equal(p.settings.scheme, 'AMRUT 2.0');
  assert.equal(p.settings.sanctioned_cost_cr, 412.5);
  assert.equal(p.can.plan, false);
  assert.equal((await pmu.get('/api/project/plan')).json().can.plan, true);
  assert.equal((await contractor.get('/api/project/plan')).json().can.progress, true);
});

await check('packages: add, change, codes must be new', async () => {
  const a = await comm.post('/api/project/packages', { code: 'pkg-1', name: 'Package 1 (East)', contractor: 'ABC Infra', agreement_no: 'AG-1', appointed_date: addDays(today, -400), original_completion: addDays(today, 300), value_cr: 210, wards: [1, 2, 3] });
  assert.equal(a.statusCode, 200, a.body);
  assert.equal((await comm.post('/api/project/packages', { code: 'PKG-1', name: 'Again' })).statusCode, 409);
  assert.equal((await comm.post('/api/project/packages', { code: 'PKG-2', name: 'Package 2 (West)', contractor: 'XYZ Ltd', appointed_date: addDays(today, -300), original_completion: addDays(today, 200), wards: [4, 5] })).statusCode, 200);
  assert.equal((await contractor.post('/api/project/packages', { code: 'PKG-3', name: 'No' })).statusCode, 403);
  const p = (await comm.get('/api/project/plan')).json();
  assert.deepEqual(p.packages.map((x: { code: string }) => x.code), ['PKG-1', 'PKG-2']);
  assert.deepEqual(p.packages[0].wards, [1, 2, 3]);
});

// a work programme made in Excel
const month = (offset: number) => { const d = new Date(`${today.slice(0, 7)}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + offset); return d; };
async function programme(edit?: (ws: { act: ExcelJS.Worksheet; tgt: ExcelJS.Worksheet }) => void) {
  const buf = (await comm.get('/api/project/plan/workbook.xlsx')).rawPayload;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const act = wb.getWorksheet('Activities')!, tgt = wb.getWorksheet('Monthly targets')!;
  if (!edit) {
    act.addRow(['PKG-1', '1', '', 'Survey and design', 'Phase', addDays(today, -380), addDays(today, -200), 1]);
    act.addRow(['PKG-1', '1.1', '1', 'Topographic survey', 'Activity', addDays(today, -380), addDays(today, -300), 1]);
    act.addRow(['PKG-1', '1.2', '1', 'Design approval', 'Milestone', '', addDays(today, -10), 0]);
    act.addRow(['PKG-1', '2', '', 'Sewer laying, wards 1-3', 'Activity', addDays(today, -200), addDays(today, 200), 5]);
    act.addRow(['PKG-2', '1', '', 'Pumping station', 'Activity', '01-06-2026', '31-03-2027', 2]);
    act.addRow(['', 'M1', '', 'Commissioning', 'Milestone', '', addDays(today, 320), 0]);
    for (let i = -6; i <= 6; i++) tgt.addRow(['PKG-1', month(i), 2, 80, 500, 1]);
    for (let i = -3; i <= 3; i++) tgt.addRow(['PKG-2', month(i), 1, 40, '', '']);
  } else edit({ act, tgt });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

await check('Excel work programme: preview changes nothing, apply saves it; mistakes are reported by row', async () => {
  const file = await programme();
  assert.equal((await contractor.upload('/api/project/plan/import', file)).statusCode, 403);
  const preR = await pmu.upload("/api/project/plan/import", file); const pre = preR.json(); assert.equal(preR.statusCode, 200, preR.body);
  assert.equal(pre.ok, true, JSON.stringify(pre.errors));
  assert.equal(pre.changes.activities.added, 6);
  assert.equal((await pmu.get('/api/project/plan')).json().activities.length, 0); // preview only
  const ap = (await pmu.upload('/api/project/plan/import?apply=1', file)).json();
  assert.equal(ap.ok, true);
  const p = (await pmu.get('/api/project/plan')).json();
  assert.equal(p.activities.length, 6);
  const ms = p.activities.find((a: { code: string; package_id: number }) => a.code === '1.2');
  assert.equal(ms.kind, 'milestone'); assert.equal(ms.planned_start, ms.planned_finish); assert.equal(ms.baseline_finish, addDays(today, -10));
  assert.equal(p.activities.find((a: { code: string; package_id: number }) => a.code === '1' && a.package_id === p.packages[1].id).planned_finish, '2027-03-31');
  assert.equal(p.targets.filter((t: { measure: string }) => t.measure === 'pipe_km').length, 13 + 7);
  // bad rows
  const bad = await programme(({ act }) => {
    act.addRow(['PKG-9', 'X1', '', 'Unknown package', 'Activity', addDays(today, 1), addDays(today, 5)]);
    act.addRow(['PKG-1', 'X2', '', 'Bad type', 'Stage', addDays(today, 1), addDays(today, 5)]);
    act.addRow(['PKG-1', 'X3', '', 'Bad date', 'Activity', 'soon', addDays(today, 5)]);
    act.addRow(['PKG-1', 'X4', '', 'Backwards', 'Activity', addDays(today, 9), addDays(today, 5)]);
  });
  const br = (await pmu.upload('/api/project/plan/import?apply=1', bad)).json();
  assert.equal(br.ok, false);
  const txt = br.errors.join(' | ');
  assert.match(txt, /PKG-9/); assert.match(txt, /Stage/); assert.match(txt, /not a date/); assert.match(txt, /before Planned start/);
  assert.equal((await pmu.get('/api/project/plan')).json().activities.length, 6); // nothing saved
  assert.equal((await pmu.upload('/api/project/plan/import', Buffer.from('not excel'))).statusCode, 400);
});

await check('uploading again keeps the baseline (unless asked), keeps actual progress, removes lines no longer in the file', async () => {
  let p = (await pmu.get('/api/project/plan')).json();
  const lay = p.activities.find((a: { code: string; package_id: number }) => a.code === '2');
  assert.equal((await contractor.post(`/api/project/activities/${lay.id}/progress`, { actual_start: addDays(today, -190), pct: 40 })).statusCode, 200);
  const moved = await programme(({ act }) => {
    act.eachRow((row, n) => { if (n > 1 && row.getCell(2).value === '2') row.getCell(7).value = new Date(`${addDays(today, 260)}T00:00:00Z`); });
    let m1 = 0;
    act.eachRow((row, n) => { if (row.getCell(2).value === 'M1') m1 = n; });
    act.spliceRows(m1, 1); // drop "Commissioning"
  });
  const pre = (await pmu.upload('/api/project/plan/import', moved)).json();
  assert.equal(pre.changes.activities.changed, 1); assert.equal(pre.changes.activities.removed, 1);
  await pmu.upload('/api/project/plan/import?apply=1', moved);
  p = (await pmu.get('/api/project/plan')).json();
  const a2 = p.activities.find((a: { id: number }) => a.id === lay.id);
  assert.equal(a2.planned_finish, addDays(today, 260)); assert.equal(a2.baseline_finish, addDays(today, 200));
  assert.equal(a2.pct, 40); assert.equal(a2.actual_start, addDays(today, -190));
  assert.ok(!p.activities.some((a: { code: string }) => a.code === 'M1'));
  await pmu.upload('/api/project/plan/import?apply=1&rebaseline=1', moved);
  p = (await pmu.get('/api/project/plan')).json();
  assert.equal(p.activities.find((a: { id: number }) => a.id === lay.id).baseline_finish, addDays(today, 260));
});

await check('progress: actual dates (not in the future); late milestones show in the summary and in My tasks', async () => {
  const p = (await pmu.get('/api/project/plan')).json();
  const ms = p.activities.find((a: { code: string }) => a.code === '1.2');
  const sum = p.summary.find((s: { package_id: number }) => s.package_id === p.packages[0].id);
  assert.ok(sum.late.some((l: { code: string }) => l.code === '1.2'));
  const tasks = (await pmu.get('/api/my-tasks')).json().tasks as { kind: string; title: string; tone: string }[];
  assert.ok(tasks.some((t) => t.kind === 'project' && /Design approval/.test(t.title) && t.tone === 'bad'));
  assert.equal((await viewer.post(`/api/project/activities/${ms.id}/progress`, { actual_finish: today })).statusCode, 403);
  assert.equal((await contractor.post(`/api/project/activities/${ms.id}/progress`, { actual_finish: addDays(today, 3) })).statusCode, 400);
  assert.equal((await contractor.post(`/api/project/activities/${ms.id}/progress`, { actual_finish: addDays(today, -2), note: 'Approved by CE' })).statusCode, 200);
  const p2 = (await pmu.get('/api/project/plan')).json();
  assert.ok(!p2.summary[1].late.some((l: { code: string }) => l.code === '1.2'));
  assert.equal(p2.activities.find((a: { id: number }) => a.id === ms.id).pct, 100);
});

await check('extensions of time: history kept, revised completion and days of extension', async () => {
  let p = (await pmu.get('/api/project/plan')).json();
  const pk = p.packages[0];
  assert.equal((await contractor.post('/api/project/eots', { package_id: pk.id, to_date: addDays(today, 400), reason: 'Monsoon delay' })).statusCode, 403);
  assert.equal((await pmu.post('/api/project/eots', { package_id: pk.id, to_date: addDays(today, 400), reason: 'x' })).statusCode, 400);
  assert.equal((await pmu.post('/api/project/eots', { package_id: pk.id, eot_no: 'EOT-1', approved_on: today, to_date: addDays(today, 360), reason: 'Monsoon delay and land issues' })).statusCode, 200);
  assert.equal((await pmu.post('/api/project/eots', { package_id: pk.id, eot_no: 'EOT-2', approved_on: today, to_date: addDays(today, 420), reason: 'Railway crossing permission' })).statusCode, 200);
  p = (await pmu.get('/api/project/plan')).json();
  const s = p.summary.find((x: { package_id: number }) => x.package_id === pk.id);
  assert.equal(s.original_completion, addDays(today, 300)); assert.equal(s.revised_completion, addDays(today, 420));
  assert.equal(s.extension_days, 120); assert.equal(s.eots, 2);
  assert.equal(p.eots.length, 2);
});

await check('S-curve: actual pipe laid comes from work-stretch updates in the package\'s wards', async () => {
  // a site work stretch in ward 1 with 3 updates over time, written straight into its history
  const [lon0, lat0] = full.stretches.find((s: { ward: number }) => s.ward === 1)?.geom.coordinates[0][0] ?? full.stretches[0].geom.coordinates[0][0];
  const ids: number[] = [];
  for (let i = 0; i < 2; i++) ids.push((await aee.post('/api/site/manholes', { lon: lon0 + 0.002 * i, lat: lat0 })).json().id);
  const pipe = (await aee.post('/api/site/pipes', { from_mh: ids[0], to_mh: ids[1], dia_mm: 200 })).json().id;
  const st = (await aee.post('/api/site/stretches', { name: 'S-curve lane', pipes: [pipe] })).json();
  assert.ok(st.code, JSON.stringify(st));
  const row = (await db.query<{ ward: number; length_m: number }>('SELECT ward, length_m FROM stretches WHERE code = $1', [st.code]))[0];
  const len = Number(row.length_m);
  const put = async (at: string, s: object) => db.query(`INSERT INTO stretch_history (stretch_code, version, kind, at, snapshot) VALUES ($1, 99, 'status', $2, $3)`, [st.code, `${at}T10:00:00+05:30`, JSON.stringify({ status: { ...EMPTY_STATUS, ...s } })]);
  // the stretch was made 70 days ago (its own history starts then)
  await db.query(`UPDATE stretch_history SET at = $2 WHERE stretch_code = $1`, [st.code, `${addDays(today, -70)}T09:00:00+05:30`]);
  await put(addDays(today, -65), { pipeline: 'partly', pipe_laid_m: Math.round(len / 2) });
  await put(addDays(today, -1), { pipeline: 'laid', manholes_built: 2, ics_built: 5 });
  const p = (await pmu.get('/api/project/plan')).json();
  const i = p.months.indexOf(today.slice(0, 7));
  const wardPkg = p.packages.find((x: { wards: number[] }) => x.wards.includes(Number(row.ward)));
  for (const sc of [0, ...(wardPkg ? [wardPkg.id] : [])]) {
    assert.ok(Math.abs(p.actual[sc].pipe_km[i] - len / 1000) < 0.01, `scope ${sc}: ${p.actual[sc].pipe_km[i]} vs ${len / 1000}`);
    assert.equal(p.actual[sc].ics[i], 5);
    assert.ok(p.actual[sc].pipe_km[i - 2] > 0 && p.actual[sc].pipe_km[i - 2] < len / 1000); // half laid two months ago
    assert.equal(p.actual[sc].pipe_km[i + 1], null); // future months have no actual
  }
  const other = p.packages.find((x: { wards: number[] }) => !x.wards.includes(Number(row.ward)));
  assert.equal(p.actual[other.id].pipe_km[i], 0);
  // planned: PKG-1 has 2 km a month from 6 months ago; whole project = sum of packages
  assert.equal(p.planned[p.packages[0].id].pipe_km[i], 14);
  assert.equal(p.planned[0].pipe_km[i], 14 + 4);
  const s0 = p.summary.find((x: { package_id: number }) => x.package_id === 0);
  assert.ok(s0.slip_days > 0, 'far behind plan');
  assert.ok(s0.time_pct > 0 && s0.time_pct < 100);
});

await check('history of plan changes; the workbook downloads with the saved plan', async () => {
  const h = (await viewer.get('/api/project/plan/history')).json().events as { kind: string }[];
  for (const k of ['definition_saved', 'package_added', 'plan_imported', 'progress', 'eot_added']) assert.ok(h.some((e) => e.kind === k), k);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await viewer.get('/api/project/plan/workbook.xlsx')).rawPayload as unknown as ArrayBuffer);
  assert.equal(wb.getWorksheet('Packages')!.rowCount, 3);
  assert.equal(wb.getWorksheet('Activities')!.rowCount, 6); // header + 5 (Commissioning removed)
});

console.log(`\n${passed} checks passed (${process.env.DATABASE_URL ? 'postgres' : 'pglite'})`);
await app.close();
process.exit(0);
