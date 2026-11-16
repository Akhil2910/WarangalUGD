/**
 * Phase 1 end-to-end API test: sign-in, one-time password, sessions, CSRF guard, brute-force guard,
 * protected map data with Range, search, clear 4xx on bad input. Runs on a fresh temporary database.
 * Run:  npm test -w server            (PGlite)
 *       DATABASE_URL=postgres://... npm test -w server   (PostgreSQL: use an empty test database)
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.STATE_DIR = mkdtempSync(path.join(os.tmpdir(), 'wgl-test-'));
const { buildApp } = await import('../app.ts');
const { migrate, openDb } = await import('../db.ts');
const { seedAccounts } = await import('../auth.ts');

const db = await openDb();
await migrate(db, () => {});
await seedAccounts(db, () => {});
await seedAccounts(db, () => {}); // second run must not re-create accounts
const app = await buildApp(db);

const pwFile = readFileSync(path.join(process.env.STATE_DIR, 'initial-passwords.txt'), 'utf8');
const otp = (email: string) => pwFile.split('\n').find((l) => l.includes(email))!.split('one-time password: ')[1].trim();
const seedCount = JSON.parse(readFileSync(new URL('../../seed/accounts.json', import.meta.url), 'utf8')).accounts.length;
assert.equal(pwFile.trim().split('\n').length, seedCount, 'each starting account created once');

const H = { 'x-wgl-request': '1', 'content-type': 'application/json' };
let passed = 0;
async function check(name: string, fn: () => Promise<void>) {
  await fn();
  passed++;
  console.log(`  ok  ${name}`);
}
const cookieOf = (res: { cookies: { name: string; value: string }[] }) => {
  const c = res.cookies.find((x) => x.name === 'wgl_session');
  return c ? `wgl_session=${c.value}` : '';
};

await check('health is public', async () => {
  const r = await app.inject({ url: '/api/health' });
  assert.equal(r.statusCode, 200);
});
await check('map data refused without sign-in; "who am I" answers no user', async () => {
  assert.equal((await app.inject({ url: '/api/auth/me' })).json().user, undefined);
  assert.equal((await app.inject({ url: '/api/search?q=W1' })).statusCode, 401);
  assert.equal((await app.inject({ url: '/data/meta.json' })).statusCode, 401);
  assert.equal((await app.inject({ url: '/data/network.pmtiles' })).statusCode, 401);
});
await check('state-changing call without CSRF header refused (also with encoded path)', async () => {
  const r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'a', password: 'b' } });
  assert.equal(r.statusCode, 403);
  const r2 = await app.inject({ method: 'POST', url: '/%61pi/auth/login', payload: { email: 'a', password: 'b' } });
  assert.equal(r2.statusCode, 403);
});
await check('malformed body gives 400, not 500', async () => {
  const r = await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: '{"email":' });
  assert.equal(r.statusCode, 400);
  const r2 = await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { email: 5 } });
  assert.equal(r2.statusCode, 400);
});
await check('wrong password refused', async () => {
  const r = await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { email: 'viewer@gwmc.local', password: 'wrong-pass' } });
  assert.equal(r.statusCode, 401);
});

let cookie = '';
await check('one-time password signs in but must be changed first (enforced on server)', async () => {
  const r = await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { email: 'VIEWER@gwmc.local', password: otp('viewer@gwmc.local') } });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().mustChangePassword, true);
  cookie = cookieOf(r);
  assert.ok(cookie);
  assert.equal((await app.inject({ url: '/data/meta.json', headers: { cookie } })).statusCode, 403);
  assert.equal((await app.inject({ url: '/api/search?q=W1', headers: { cookie } })).statusCode, 403);
  assert.equal((await app.inject({ url: '/api/auth/me', headers: { cookie } })).statusCode, 200);
});
await check('short new password refused', async () => {
  const r = await app.inject({ method: 'POST', url: '/api/auth/change-password', headers: { ...H, cookie }, payload: { currentPassword: otp('viewer@gwmc.local'), newPassword: 'short' } });
  assert.equal(r.statusCode, 400);
});
const oldCookie = () => cookie;
let staleCookie = '';
await check('changing the password keeps this device signed in and signs out the others', async () => {
  staleCookie = oldCookie();
  const r = await app.inject({ method: 'POST', url: '/api/auth/change-password', headers: { ...H, cookie }, payload: { currentPassword: otp('viewer@gwmc.local'), newPassword: 'trial-viewer-2026' } });
  assert.equal(r.statusCode, 200);
  cookie = cookieOf(r);
  assert.equal((await app.inject({ url: '/api/auth/me', headers: { cookie } })).json().user.must_change_password, false);
  assert.equal((await app.inject({ url: '/data/meta.json', headers: { cookie: staleCookie } })).statusCode, 401);
});
await check('signed-in user gets map data, with HTTP Range for PMTiles', async () => {
  const meta = await app.inject({ url: '/data/meta.json', headers: { cookie } });
  assert.equal(meta.statusCode, 200);
  assert.ok(meta.json().plan.km > 2700);
  const r = await app.inject({ url: '/data/network.pmtiles', headers: { cookie, range: 'bytes=0-126' } });
  assert.equal(r.statusCode, 206);
  assert.equal(r.rawPayload.length, 127);
  assert.equal(r.rawPayload.subarray(0, 7).toString(), 'PMTiles');
});
await check('data paths outside the folder or of other types are refused', async () => {
  for (const u of ['/data/..%2Fapp-state%2Fsession-secret.txt', '/data/secret.txt', '/data/%2e%2e%2fpackage.json']) {
    const r = await app.inject({ url: u, headers: { cookie } });
    assert.ok([400, 404].includes(r.statusCode), `${u} -> ${r.statusCode}`);
  }
});
await check('search finds manholes and wards; DPR road stretches are no longer offered', async () => {
  const s = (q: string) => app.inject({ url: `/api/search?q=${encodeURIComponent(q)}`, headers: { cookie } }).then((r) => r.json().results as { kind: string; label: string }[]);
  assert.equal((await s('W12-001')).length, 0);
  assert.ok((await s('SPS-2C/MH-457')).some((r) => r.kind === 'Manhole'));
  assert.ok((await s('Ward 5')).some((r) => r.kind === 'Ward'));
  assert.equal((await s('x')).length, 0);
});
await check('sign-out clears the session', async () => {
  const r = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { ...H, cookie }, payload: {} });
  assert.equal(r.statusCode, 200);
  const c = r.cookies.find((x) => x.name === 'wgl_session');
  assert.equal(c?.value, '');
});
await check('8 failed sign-ins per email+IP in 15 minutes, then refused even with the right password', async () => {
  for (let i = 0; i < 8; i++) {
    await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { email: 'commissioner@gwmc.local', password: `bad-${i}` } });
  }
  const r = await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { email: 'commissioner@gwmc.local', password: otp('commissioner@gwmc.local') } });
  assert.equal(r.statusCode, 429);
});
await check('audit log records sign-ins and failures', async () => {
  const rows = await db.query<{ action: string; n: string }>('SELECT action, count(*) AS n FROM audit_log GROUP BY action');
  const by = Object.fromEntries(rows.map((r) => [r.action, Number(r.n)]));
  assert.ok(by.sign_in >= 1 && by.sign_in_failed >= 9 && by.password_changed === 1);
});

await app.close();
await db.close();
console.log(`\nPhase 1 API test: ${passed} checks passed on ${db.engine}.`);
