/**
 * Check the database before an update:  npm run db-check -w server
 * Prints the database and user, pending database changes, and whether the app's user owns every table.
 * Exit code: 0 = ready; 2 = changes are pending but the user does not own the tables (run deploy/fix-db-owner.sh); 1 = cannot connect.
 */
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATABASE_URL, ENV_FILE } from '../config.ts';
import { openDb } from '../db.ts';

const MIGRATIONS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
let db;
try {
  db = await openDb();
  await db.query('SELECT 1');
} catch (e) {
  console.error(`Cannot connect to the database: ${(e as Error).message}`);
  console.error(DATABASE_URL ? 'Check DATABASE_URL in the settings file.' : `DATABASE_URL is not set. Put it in ${ENV_FILE}.`);
  process.exit(1);
}
const files = readdirSync(MIGRATIONS).filter((f) => /^\d{3}_.+\.sql$/.test(f)).sort();
const done = new Set((await db.query<{ id: number }>('SELECT id FROM schema_migrations').catch(() => [])).map((r) => Number(r.id)));
const pending = files.filter((f) => !done.has(Number(f.slice(0, 3))));
console.log(`database: ${db.engine}${DATABASE_URL ? ` (${DATABASE_URL.replace(/\/\/([^:]+):[^@]*@/, '//$1:****@')})` : ''}`);
console.log(`pending database changes: ${pending.length ? pending.join(', ') : 'none'}`);
let problem = false;
if (db.engine === 'postgres') {
  const [{ u, d }] = await db.query<{ u: string; d: string }>('SELECT current_user AS u, current_database() AS d');
  const notMine = await db.query<{ tablename: string; tableowner: string }>(
    `SELECT tablename, tableowner FROM pg_tables WHERE schemaname = 'public' AND tableowner <> current_user ORDER BY tablename`);
  const [{ c }] = await db.query<{ c: boolean }>(`SELECT has_schema_privilege(current_user, 'public', 'CREATE') AS c`);
  console.log(`user: ${u} · database: ${d}`);
  if (notMine.length) {
    const owners = [...new Set(notMine.map((t) => t.tableowner))].join(', ');
    console.log(`tables NOT owned by ${u}: ${notMine.length} (owned by ${owners})`);
    problem = true;
  } else console.log(`all tables owned by ${u}: yes`);
  if (!c) { console.log(`${u} may create tables in schema public: NO`); problem = true; }
}
await db.close();
if (problem && pending.length) {
  console.log('NOT READY: the pending changes would be refused. Run once:  bash deploy/fix-db-owner.sh');
  process.exit(2);
}
console.log(problem ? 'READY (but fix ownership before the next database change: bash deploy/fix-db-owner.sh)' : 'READY');
