/**
 * Export the whole database to one .sql file that loads into an empty PostgreSQL 16 database:
 *   psql -v ON_ERROR_STOP=1 -d <database> -f wgl-<date>.sql
 * The file holds the tables (from the migrations), every row, and the counters. It does not hold the photos
 * (app-state/files); copy that folder alongside.
 *
 * Run (with the app stopped when the built-in database is used):  npm run export-sql -w server [-- <output file>]
 * The file contains password hashes and citizens' mobile numbers: keep it private.
 */
import { createWriteStream, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STATE_DIR } from '../config.ts';
import { openDb } from '../db.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = path.join(here, '..', 'migrations');
const stamp = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Kolkata' }).replace(/[: ]/g, '-').slice(0, 16);
const out = process.argv[2] ?? path.join(STATE_DIR, 'backups', `wgl-${stamp}.sql`);
mkdirSync(path.dirname(out), { recursive: true });

const db = await openDb();
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;
const ident = (s: string) => `"${s.replace(/"/g, '""')}"`;
const f = createWriteStream(out, { encoding: 'utf8' });
const w = (s: string) => new Promise<void>((res) => (f.write(s + '\n') ? res() : f.once('drain', () => res())));

const tables = (await db.query<{ t: string }>(
  `SELECT table_name AS t FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1`)).map((r) => r.t);
// parents before children (foreign keys)
const deps = await db.query<{ child: string; parent: string }>(
  `SELECT c.conrelid::regclass::text AS child, c.confrelid::regclass::text AS parent FROM pg_constraint c
   JOIN pg_namespace n ON n.oid = c.connamespace WHERE c.contype = 'f' AND n.nspname = 'public'`);
const strip = (s: string) => s.replace(/^public\./, '').replace(/"/g, '');
const order: string[] = [];
const visit = (t: string, seen = new Set<string>()) => {
  if (order.includes(t) || seen.has(t)) return;
  seen.add(t);
  for (const d of deps) if (strip(d.child) === t && strip(d.parent) !== t) visit(strip(d.parent), seen);
  order.push(t);
};
tables.forEach((t) => visit(t));

await w(`-- Warangal UGD Tracker: full database export, ${new Date().toISOString()} (from ${db.engine})`);
await w('-- Load into an EMPTY PostgreSQL 16 database:  psql -v ON_ERROR_STOP=1 -d <database> -f <this file>');
await w('-- Contains password hashes and citizens\' mobile numbers. Keep private. Photos are not inside: copy app-state/files.');
await w('SET client_encoding = \'UTF8\';');
await w('BEGIN;');
await w('CREATE EXTENSION IF NOT EXISTS pgcrypto;');
await w(`CREATE TABLE IF NOT EXISTS schema_migrations (id integer PRIMARY KEY, name text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now());`);
await w('\n-- ---------- tables (the migrations, in order) ----------');
for (const m of readdirSync(MIGRATIONS).filter((x) => /^\d{3}_.+\.sql$/.test(x)).sort()) {
  await w(`\n-- ${m}`);
  await w(readFileSync(path.join(MIGRATIONS, m), 'utf8'));
}
await w('\n-- ---------- rows ----------');
// the migrations may have added rows of their own; the exported rows replace them
await w(`TRUNCATE ${order.map(ident).join(', ')} CASCADE;`);
const counts: Record<string, number> = {};
for (const t of order) {
  const [{ n }] = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${ident(t)}`);
  counts[t] = n;
  if (!n) continue;
  await w(`\n-- ${t}: ${n} rows`);
  const CHUNK = 500;
  for (let off = 0; off < n; off += CHUNK) {
    const rows = await db.query<{ j: unknown }>(`SELECT to_jsonb(x) AS j FROM ${ident(t)} x ORDER BY ctid LIMIT ${CHUNK} OFFSET ${off}`);
    const json = JSON.stringify(rows.map((r) => (typeof r.j === 'string' ? JSON.parse(r.j) : r.j)));
    await w(`INSERT INTO ${ident(t)} SELECT * FROM jsonb_populate_recordset(NULL::${ident(t)}, ${lit(json)}::jsonb);`);
  }
}
await w('\n-- ---------- counters ----------');
const seqs = await db.query<{ seq: string; tbl: string; col: string }>(
  `SELECT s.relname AS seq, t.relname AS tbl, a.attname AS col FROM pg_class s
   JOIN pg_depend d ON d.objid = s.oid AND d.deptype IN ('a', 'i') JOIN pg_class t ON t.oid = d.refobjid
   JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = d.refobjsubid
   JOIN pg_namespace n ON n.oid = s.relnamespace WHERE s.relkind = 'S' AND n.nspname = 'public'`);
for (const s of seqs) {
  const [{ v }] = await db.query<{ v: string | null }>(`SELECT max(${ident(s.col)})::text AS v FROM ${ident(s.tbl)}`);
  if (v !== null) await w(`SELECT setval(${lit(s.seq)}, ${v});`);
}
await w('\n-- ---------- check ----------');
await w(`-- expected rows: ${JSON.stringify(counts)}`);
await w('COMMIT;');
await new Promise<void>((res) => f.end(res));
await db.close();
const total = Object.values(counts).reduce((a, b) => a + b, 0);
console.log(JSON.stringify({ file: out, tables: order.length, rows: total, counts }));
