/**
 * One database interface for both engines: PostgreSQL in production (DATABASE_URL) and the embedded
 * PGlite for local trials. The same SQL runs on both.
 *
 * Migrations: numbered .sql files in ./migrations, applied once each, in order, at start-up.
 * They are additive only: never drop or empty data (see docs, "Data safety").
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATABASE_URL, STATE_DIR } from './config.ts';

export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
  /** Run fn in one transaction: everything is saved, or nothing. */
  tx<T>(fn: (q: Db['query']) => Promise<T>): Promise<T>;
  engine: 'postgres' | 'pglite';
}

export async function openDb(): Promise<Db> {
  if (DATABASE_URL) {
    const pg = (await import('pg')).default;
    // a DATE column comes back as its text (2026-11-19), never as a local-midnight time that shifts a day when converted
    pg.types.setTypeParser(1082, (v: string) => v);
    const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 10 });
    return {
      engine: 'postgres',
      async query(sql, params = []) {
        return (await pool.query(sql, params as unknown[])).rows;
      },
      async exec(sql) {
        await pool.query(sql);
      },
      async close() {
        await pool.end();
      },
      async tx(fn) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const out = await fn(async (sql, params = []) => (await client.query(sql, params as unknown[])).rows);
          await client.query('COMMIT');
          return out;
        } catch (e) {
          await client.query('ROLLBACK');
          throw e;
        } finally {
          client.release();
        }
      },
    };
  }
  const { PGlite } = await import('@electric-sql/pglite');
  const pgl = new PGlite(path.join(STATE_DIR, 'pglite'), { parsers: { 1082: (v: string) => v } }); // DATE as text, as for PostgreSQL
  await pgl.waitReady;
  return {
    engine: 'pglite',
    async query(sql, params = []) {
      return (await pgl.query(sql, params as unknown[])).rows as never[];
    },
    async exec(sql) {
      await pgl.exec(sql);
    },
    async close() {
      await pgl.close();
    },
    async tx(fn) {
      return pgl.transaction((t) => fn(async (sql, params = []) => (await t.query(sql, params as unknown[])).rows as never[]));
    },
  };
}

const MIGRATIONS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

export async function migrate(db: Db, log: (m: string) => void = console.log): Promise<void> {
  // create the list of applied changes only when missing (asking to create needs a right the app's user may not have)
  const known = (await db.query<{ t: string | null }>(`SELECT to_regclass('schema_migrations')::text AS t`))[0]?.t;
  if (!known) await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id integer PRIMARY KEY, name text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
  const done = new Set((await db.query<{ id: number }>('SELECT id FROM schema_migrations')).map((r) => Number(r.id)));
  const files = readdirSync(MIGRATIONS).filter((f) => /^\d{3}_.+\.sql$/.test(f)).sort();
  for (const f of files) {
    const id = Number(f.slice(0, 3));
    if (done.has(id)) continue;
    const sql = readFileSync(path.join(MIGRATIONS, f), 'utf8');
    if (/\b(DROP\s+(TABLE|COLUMN|SCHEMA)|TRUNCATE)\b/i.test(sql)) {
      throw new Error(`Migration ${f} drops or empties data; migrations must be additive.`);
    }
    try {
      await db.exec(`BEGIN;\n${sql}\nINSERT INTO schema_migrations (id, name) VALUES (${id}, '${f.replace(/'/g, "''")}');\nCOMMIT;`);
    } catch (e) {
      await db.exec('ROLLBACK').catch(() => {});
      const err = e as { code?: string; message?: string };
      if (err.code === '42501' || /permission denied|must be owner/i.test(err.message ?? '')) {
        const who = (await db.query<{ u: string }>('SELECT current_user AS u').catch(() => [{ u: '?' }]))[0]?.u;
        throw new Error(`Database change ${f} was refused: the database user "${who}" does not own the app's tables (${err.message}). `
          + 'Nothing was changed. Fix once with:  bash deploy/fix-db-owner.sh   (see docs/04-Server-Setup.md).');
      }
      throw new Error(`Database change ${f} failed and was undone: ${err.message}`);
    }
    log(`migration applied: ${f}`);
  }
}
