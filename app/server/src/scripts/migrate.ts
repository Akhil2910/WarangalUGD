/**
 * Apply pending database changes on their own (the update script runs this BEFORE restarting the app):
 *   npm run migrate -w server
 * Each change is all-or-nothing; on a failure nothing is changed and the exit code is 1.
 */
import { migrate, openDb } from '../db.ts';

const db = await openDb();
try {
  let n = 0;
  await migrate(db, (m) => { n++; console.log(m); });
  console.log(n ? `${n} database change(s) applied.` : 'Database already up to date.');
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  await db.close();
}
