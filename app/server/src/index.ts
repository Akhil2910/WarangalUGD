import { buildApp } from './app.ts';
import { seedAccounts } from './auth.ts';
import { DATA_DIR, HOST, PORT } from './config.ts';
import { migrate, openDb } from './db.ts';
import { loadComplianceItems } from './seed.ts';

const db = await openDb();
await migrate(db);
await seedAccounts(db, console.log);
await loadComplianceItems(db, console.log);
const app = await buildApp(db, { logger: true });
await app.listen({ port: PORT, host: HOST });
console.log(`Warangal UGD Tracker on http://${HOST}:${PORT}  (database: ${db.engine}, map data: ${DATA_DIR})`);

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    await app.close();
    await db.close();
    process.exit(0);
  });
}
