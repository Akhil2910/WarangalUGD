import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const APP_ROOT = path.resolve(here, '..', '..');

function env(name: string, fallback?: string): string | undefined {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

/** Folder with map data (PMTiles, GeoJSON, search index). Served only to signed-in users. */
export const DATA_DIR = path.resolve(env('DATA_DIR', path.join(APP_ROOT, '..', 'app-data'))!);
/** Folder for the embedded database, secrets and uploads when running locally. */
export const STATE_DIR = path.resolve(env('STATE_DIR', path.join(APP_ROOT, '..', 'app-state'))!);
mkdirSync(STATE_DIR, { recursive: true });

/** PostgreSQL connection string in production; when empty the embedded PGlite database is used. */
export const DATABASE_URL = env('DATABASE_URL');
export const PORT = Number(env('PORT', '8787'));
export const HOST = env('HOST', '127.0.0.1')!;
/** Set to 'true' behind HTTPS so cookies get the Secure flag. */
export const COOKIE_SECURE = env('COOKIE_SECURE', 'false') === 'true';
export const WEB_DIST = path.join(APP_ROOT, 'web', 'dist');
export const SEED_FILE = env('SEED_FILE', path.join(APP_ROOT, 'server', 'seed', 'accounts.json'))!;

function loadSecret(): string {
  const fromEnv = env('SESSION_SECRET');
  if (fromEnv) return fromEnv;
  const file = path.join(STATE_DIR, 'session-secret.txt');
  if (!existsSync(file)) writeFileSync(file, randomBytes(48).toString('hex'), { mode: 0o600 });
  return readFileSync(file, 'utf8').trim();
}
export const SESSION_SECRET = loadSecret();
export const SESSION_DAYS = 14;
