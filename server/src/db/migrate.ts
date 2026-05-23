import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { query, transaction } from './pool.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MIGRATIONS_DIR = path.resolve(__dirname, '../migrations');

export async function runMigrations() {
  await query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id text PRIMARY KEY,
      applied_at bigint NOT NULL
    )
  `);

  const files = (await fs.readdir(MIGRATIONS_DIR))
    .filter(file => file.endsWith('.sql'))
    .sort();

  const applied = await query('SELECT id FROM schema_migrations');
  const appliedIds = new Set(applied.rows.map(row => row.id));

  for (const file of files) {
    if (appliedIds.has(file)) continue;
    const sql = await fs.readFile(path.join(MIGRATIONS_DIR, file), 'utf-8');
    await transaction(async (client) => {
      await client.query(sql);
      await client.query(
        'INSERT INTO schema_migrations (id, applied_at) VALUES ($1, $2)',
        [file, Date.now()]
      );
    });
  }
}
