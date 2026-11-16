/**
 * Set one password for every account (or for one account), with no change asked at sign-in.
 * Everyone already signed in is signed out.
 *
 *   npm run set-password -w server -- "<password>"                 every account
 *   npm run set-password -w server -- "<password>" name@gwmc.local  one account
 *
 * With the built-in database, stop the app first. On the server, run it with the same DATABASE_URL as the app.
 * The password is never stored in the code or written to a file.
 */
import bcrypt from 'bcryptjs';
import { PASSWORD_MIN_LENGTH } from 'shared';
import { audit } from '../auth.ts';
import { migrate, openDb } from '../db.ts';

const [pw, email] = process.argv.slice(2);
if (!pw || pw.length < PASSWORD_MIN_LENGTH) {
  console.error(`Give the password (at least ${PASSWORD_MIN_LENGTH} characters), in quotes.`);
  process.exit(1);
}
const db = await openDb();
await migrate(db, () => {});
const hash = await bcrypt.hash(pw, 10);
const rows = await db.query<{ email: string }>(
  `UPDATE users SET password_hash = $1, must_change_password = false, session_version = session_version + 1, updated_at = now()
   WHERE active ${email ? 'AND lower(email) = lower($2)' : ''} RETURNING email`,
  email ? [hash, email] : [hash],
);
await audit(db, null, 'passwords_set', { accounts: rows.length, one: email ?? null });
console.log(`Password set for ${rows.length} account(s): ${rows.map((r) => r.email).sort().join(', ')}`);
await db.close();
