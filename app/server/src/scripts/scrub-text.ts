/**
 * Replace a piece of text in a work stretch's stored history and name (for trial data typed by mistake).
 *   npm run scrub-text -w server -- W58-S040 "old text" "new text"
 * With the built-in database, stop the app first. On the server, run it with the app's DATABASE_URL.
 */
import { migrate, openDb } from '../db.ts';

const [code, from, to] = process.argv.slice(2);
if (!code || !from || to === undefined) {
  console.error('Usage: npm run scrub-text -w server -- <work stretch code> "old text" "new text"');
  process.exit(1);
}
const db = await openDb();
await migrate(db, () => {});
const like = `%${from}%`;
const h = await db.query<{ n: string }>(
  `WITH u AS (UPDATE stretch_history SET changes = replace(changes::text, $2, $3)::jsonb, note = replace(note, $2, $3)
   WHERE stretch_code = $1 AND (changes::text LIKE $4 OR note LIKE $4) RETURNING 1) SELECT count(*) AS n FROM u`, [code, from, to, like]);
const s = await db.query<{ n: string }>(
  `WITH u AS (UPDATE stretches SET road_name = replace(road_name, $2, $3) WHERE code = $1 AND road_name LIKE $4 RETURNING 1) SELECT count(*) AS n FROM u`, [code, from, to, like]);
console.log(`${code}: ${h[0].n} history entr${Number(h[0].n) === 1 ? 'y' : 'ies'} and ${s[0].n} name changed.`);
await db.close();
