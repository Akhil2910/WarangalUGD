/**
 * Daily log: submit, checks, verify (accept / return), roll-up into the work stretch's status, My tasks, reports and Excel.
 * Run:  npm run test:daily -w server
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';

process.env.STATE_DIR = mkdtempSync(path.join(os.tmpdir(), 'wgl-test13-'));
const { buildApp } = await import('../app.ts');
const { migrate, openDb } = await import('../db.ts');
const { seedAccounts } = await import('../auth.ts');
const { loadComplianceItems } = await import('../seed.ts');
const { DATA_DIR } = await import('../config.ts');
const { indiaDate, addDays } = await import('shared');

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
async function signIn(email: string) {
  const r = await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { email, password: otp(email) } });
  let cookie = `wgl_session=${r.cookies.find((c) => c.name === 'wgl_session')!.value}`;
  const r2 = await app.inject({ method: 'POST', url: '/api/auth/change-password', headers: { ...H, cookie }, payload: { currentPassword: otp(email), newPassword: 'test-password-123' } });
  cookie = `wgl_session=${r2.cookies.find((c) => c.name === 'wgl_session')!.value}`;
  return { get: (url: string) => app.inject({ url, headers: { cookie } }), post: (url: string, payload: unknown) => app.inject({ method: 'POST', url, headers: { ...H, cookie }, payload: payload as object }) };
}
let passed = 0;
async function check(name: string, fn: () => Promise<void>) { await fn(); passed++; console.log(`  ok  ${name}`); }
const today = indiaDate();
const aee = await signIn('aee@gwmc.local');
const contractor = await signIn('contractor@gwmc.local');
const comm = await signIn('commissioner@gwmc.local');
const viewer = await signIn('viewer@gwmc.local');

// a drawn work stretch of 3 pipes
const [lon0, lat0] = full.stretches[0].geom.coordinates[0][0] as [number, number];
const ids: number[] = [];
for (let i = 0; i < 4; i++) ids.push((await aee.post('/api/site/manholes', { lon: lon0 + 0.0006 * i, lat: lat0 + 0.0002 })).json().id);
const pipes: number[] = [];
for (let i = 0; i < 3; i++) pipes.push((await aee.post('/api/site/pipes', { from_mh: ids[i], to_mh: ids[i + 1], dia_mm: 200 })).json().id);
const CODE = (await aee.post('/api/site/stretches', { name: 'Daily log lane', pipes })).json().code as string;
const LEN = Number((await db.query<{ length_m: number }>('SELECT length_m FROM stretches WHERE code = $1', [CODE]))[0].length_m);
const D = (n: number) => addDays(today, n);
const entry = (date: string, pipe: number, extra: Record<string, unknown> = {}) => {
  const { quantities: qx, ...rest } = extra as { quantities?: object };
  return {
    log_date: date, quantities: { excavation_m: pipe + 5, pipe: { 200: pipe }, bedding_m: pipe, manholes: 1, ics: 2, backfill_m: 0, road_m: 0, ...(qx ?? {}) },
    labour: { skilled: 3, unskilled: 8 }, machines: { excavator: 1, pump: 1 }, hindrances: [{ reason: 'rain', hours: 2, note: 'Afternoon rain' }], remark: 'Work as planned', ...rest,
  };
};

await check('submitting: field roles only, in their area; sensible dates and figures only', async () => {
  const g = (await contractor.get(`/api/stretches/${CODE}/daily`)).json();
  assert.equal(g.can.submit, true); assert.deepEqual(g.diameters, ['200']);
  assert.equal((await viewer.post(`/api/stretches/${CODE}/daily`, entry(D(-1), 10))).statusCode, 403);
  assert.equal((await contractor.post(`/api/stretches/${CODE}/daily`, entry(D(1), 10))).statusCode, 400); // future
  assert.equal((await contractor.post(`/api/stretches/${CODE}/daily`, entry(D(-40), 10))).statusCode, 400); // too old
  assert.equal((await contractor.post(`/api/stretches/${CODE}/daily`, { log_date: D(-1) })).statusCode, 400); // nothing entered
  assert.equal((await contractor.post(`/api/stretches/${CODE}/daily`, entry(D(-1), LEN * 2))).statusCode, 400); // more than the stretch
  const r = await contractor.post(`/api/stretches/${CODE}/daily`, entry(D(-5), Math.round(LEN * 0.4)));
  assert.equal(r.statusCode, 200, r.body); assert.equal(r.json().late, true);
  assert.equal((await contractor.post(`/api/stretches/${CODE}/daily`, entry(D(-1), Math.round(LEN * 0.4)))).json().late, false);
});

await check('verifying: the AEE of the area, never the submitter; returning needs a reason and comes back to the submitter', async () => {
  const q = (await aee.get('/api/daily/queue')).json().entries as { id: number; stretch_code: string; log_date: string }[];
  assert.equal(q.length, 2);
  const tasks = (await aee.get('/api/my-tasks')).json().tasks as { kind: string; title: string }[];
  assert.ok(tasks.some((t) => t.kind === 'daily' && /Verify 2 daily log/.test(t.title)));
  const first = q.find((x) => x.log_date === D(-5))!;
  assert.equal((await contractor.post(`/api/daily/${first.id}/decide`, { decision: 'accept' })).statusCode, 403);
  assert.equal((await aee.post(`/api/daily/${first.id}/decide`, { decision: 'return' })).statusCode, 400);
  assert.equal((await aee.post(`/api/daily/${first.id}/decide`, { decision: 'return', note: 'Bedding length looks wrong' })).statusCode, 200);
  const mine = (await contractor.get('/api/daily/queue?view=mine')).json().entries as { id: number; status: string; decision_note: string }[];
  assert.equal(mine.find((x) => x.id === first.id)!.status, 'returned');
  assert.ok(((await contractor.get('/api/my-tasks')).json().tasks as { title: string }[]).some((t) => /returned for correction/.test(t.title)));
  const re = await contractor.post(`/api/stretches/${CODE}/daily`, entry(D(-5), Math.round(LEN * 0.4), { quantities: { bedding_m: 5 } }));
  assert.equal(re.statusCode, 200, re.body);
  assert.equal((await aee.get('/api/daily/queue')).json().entries.length, 2);
});

let gateHit = false;
await check('accepting moves the work stretch forward to the running totals, with history; compliance gates still apply', async () => {
  const q = (await aee.get('/api/daily/queue')).json().entries as { id: number; log_date: string }[];
  const first = q.find((x) => x.log_date === D(-5))!;
  let r = await aee.post(`/api/daily/${first.id}/decide`, { decision: 'accept' });
  if (r.statusCode === 409) { // a blocking compliance is not recorded yet: the Commissioner may override with a reason
    gateHit = true;
    assert.match(r.json().error, /Not accepted/);
    assert.equal(((await aee.get('/api/daily/queue')).json().entries as unknown[]).length, 2); // nothing changed
    r = await comm.post(`/api/daily/${first.id}/decide`, { decision: 'accept', override_reason: 'Permission letter seen, upload pending' });
  }
  assert.equal(r.statusCode, 200, r.body);
  const card = (await aee.get(`/api/stretches/${CODE}`)).json();
  assert.equal(card.stretch.status.pipeline, 'partly');
  assert.ok(Math.abs(card.stretch.status.pipe_laid_m - Math.round(LEN * 0.4)) <= 1);
  assert.equal(card.stretch.status.cutting, 'trench_open');
  assert.equal(card.stretch.status.manholes_built, 1);
  assert.equal(card.stretch.status.ics_built, 2);
  const hist = (await aee.get(`/api/stretches/${CODE}/history`)).json();
  assert.ok(JSON.stringify(hist).includes(`Daily log of ${D(-5)} accepted`));
  // an accepted entry is final
  assert.equal((await contractor.post(`/api/stretches/${CODE}/daily`, entry(D(-5), 3))).statusCode, 409);
});

await check('the totals finish the pipe line and back-fill; road restored is counted but its stage stays a status update with photos', async () => {
  const verifier = gateHit ? comm : aee;
  const extra = gateHit ? { override_reason: 'Test' } : {};
  const second = ((await aee.get('/api/daily/queue')).json().entries as { id: number }[])[0];
  assert.equal((await verifier.post(`/api/daily/${second.id}/decide`, { decision: 'accept', ...extra })).statusCode, 200);
  const rest = Math.ceil(LEN - Math.round(LEN * 0.4) * 2) + 1;
  await contractor.post(`/api/stretches/${CODE}/daily`, entry(D(0), rest, { quantities: { backfill_m: Math.ceil(LEN) + 10, road_m: 20, excavation_m: 0 } }));
  const third = ((await aee.get('/api/daily/queue')).json().entries as { id: number }[])[0];
  const r = await verifier.post(`/api/daily/${third.id}/decide`, { decision: 'accept', ...extra });
  assert.equal(r.statusCode, 200, r.body);
  const s = (await aee.get(`/api/stretches/${CODE}`)).json().stretch;
  assert.equal(s.status.pipeline, 'laid');
  assert.equal(s.status.cutting, 'backfilled');
  assert.equal(s.status.restoration, 'pending');
  assert.equal(s.stage, 'backfilled');
  const d = (await aee.get(`/api/stretches/${CODE}/daily`)).json();
  assert.ok(Math.abs(d.totals.pipe_m - (Math.round(LEN * 0.4) * 2 + rest)) < 0.01);
});

await check('reports: a day and a period, accepted entries only, with targets, time lost and the rest of the picture; Excel', async () => {
  const pk = (await comm.post('/api/project/packages', { code: 'PKG-1', name: 'Package 1', wards: [Number((await db.query<{ ward: number }>('SELECT ward FROM stretches WHERE code = $1', [CODE]))[0].ward)] })).statusCode;
  assert.equal(pk, 200);
  const pid = Number((await db.query<{ id: number }>(`SELECT id FROM project_packages WHERE code = 'PKG-1'`))[0].id);
  await db.query(`INSERT INTO project_targets (ulb_id, package_id, month, measure, planned) VALUES (1, $1, date_trunc('month', $2::date), 'pipe_km', 3.1)`, [pid, today]);
  const day = (await aee.get(`/api/daily/report?from=${D(-1)}&to=${D(-1)}`)).json();
  assert.equal(day.entries, 1); assert.equal(day.stretches_worked, 1);
  assert.equal(day.totals.pipe_m, Math.round(LEN * 0.4));
  assert.equal(day.labour.skilled, 3); assert.equal(day.hindrance_hours.rain, 2);
  const per = (await aee.get(`/api/daily/report?from=${D(-6)}&to=${D(0)}&package=${pid}`)).json();
  assert.equal(per.entries, 3); assert.equal(per.series.length, 7);
  assert.equal(per.rows.length, 1); assert.equal(per.rows[0].code, CODE); assert.equal(per.rows[0].pct, 100);
  assert.ok(per.planned.pipe_m > 0);
  assert.equal(per.hindrance_total, 6);
  assert.equal((await aee.get(`/api/daily/report?from=${D(0)}&to=${D(-3)}`)).statusCode, 400);
  const x = await aee.get(`/api/daily/report?from=${D(-6)}&to=${D(0)}&format=xlsx`);
  assert.equal(x.statusCode, 200);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(x.rawPayload as unknown as ArrayBuffer);
  assert.deepEqual(wb.worksheets.map((w) => w.name), ['Summary', 'Work stretches', 'By day', 'Time lost']);
});

console.log(`\n${passed} checks passed (${process.env.DATABASE_URL ? 'postgres' : 'pglite'})${gateHit ? ' · gates: Commissioner override used' : ''}`);
await app.close();
process.exit(0);
