import 'dotenv/config';
import { runMigrations } from '../src/db/migrate.js';
import { closePool } from '../src/db/pool.js';

runMigrations()
  .then(async () => {
    await closePool();
  })
  .catch(async (err) => {
    console.error(err);
    await closePool();
    process.exit(1);
  });
