/**
 * The six sign-ins: Contractor, PIU officer, PMU officer, PGDMC officer, Commissioner, Financial institution.
 * Run:  npm run test:roles -w server
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.STATE_DIR = mkdtempSync(path.join(os.tmpdir(), 'wgl-test7-'));
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

const pwFile = readFileSync(path.join(process.env.STATE_DIR, 'initial-passwords.txt'), 'utf8');
const otp = (email: string) => pwFile.split('\n').find((l) => l.includes(email))!.split('one-time password: ')[1].trim();
const H = { 'x-wgl-request': '1', 'content-type': 'application/json' };
async function signIn(email: string) {
  const r = await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { email, password: otp(email) } });
  assert.equal(r.statusCode, 200, `${email}: ${r.body}`);
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
const pgdmc = as(await signIn('pgdmc@gwmc.local'));
const finance = as(await signIn('finance@gwmc.local'));
const commissioner = as(await signIn('commissioner@gwmc.local'));

const S0 = full.stretches[0];
let CODE = '';

await check('all six sign in; each has its own role', async () => {
  const roles = await Promise.all([contractor, piu, pmu, pgdmc, finance, commissioner].map(async (x) => (await x.get('/api/auth/me')).json().user.role));
  assert.deepEqual(roles, ['contractor', 'piu_officer', 'pmu_officer', 'pgdmc_officer', 'finance', 'commissioner']);
});

await check('PIU officer makes a work stretch; the contractor cannot', async () => {
  const pipes = S0.pipes.map((p: unknown[]) => p[0]);
  assert.equal((await contractor.post('/api/site/stretches', { name: 'Roles test', dpr_pipes: pipes })).statusCode, 403);
  const r = await piu.post('/api/site/stretches', { name: 'Roles test', dpr_pipes: pipes });
  assert.equal(r.statusCode, 200, r.body);
  CODE = r.json().code;
});

await check('what each can do on a work stretch', async () => {
  const c = async (x: ReturnType<typeof as>) => (await x.get(`/api/stretches/${CODE}`)).json().can;
  const k = await c(contractor);
  assert.ok(k.update && k.record_compliance && k.report_issue && !k.verify && !k.approve);
  const i = await c(piu);
  assert.ok(i.update && i.record_compliance && i.resolve_issue && !i.verify && !i.approve);
  const m = await c(pmu);
  assert.ok(!m.update && !m.record_compliance && m.verify && m.approve);
  for (const x of [pgdmc, finance]) {
    const v = await c(x);
    assert.ok(!v.update && !v.record_compliance && !v.verify && !v.approve && !v.report_issue);
  }
  const co = await c(commissioner);
  assert.ok(co.update && co.verify && co.approve && co.override);
});

await check('monitoring roles see the dashboard, works and compliance; the financial institution sees no grievances', async () => {
  for (const x of [pgdmc, finance, pmu]) {
    assert.equal((await x.get('/api/dashboard')).statusCode, 200);
    assert.equal((await x.get('/api/works')).statusCode, 200);
  }
  assert.equal((await pgdmc.get('/api/grievances')).statusCode, 200);
  assert.equal((await finance.get('/api/grievances')).statusCode, 403);
});

console.log(`\n${passed} checks passed (${db.engine})`);
await app.close();
await db.close();
