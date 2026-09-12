import 'dotenv/config';
import fs from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Pool } from 'pg';
import { config } from './config.ts';

const migrations = [
  {
    version: '001_initial',
    url: new URL('../db/migrations/001_initial.sql', import.meta.url),
  },
  {
    version: '002_capture_worker',
    url: new URL('../db/migrations/002_capture_worker.sql', import.meta.url),
  },
];

export function createPool() {
  if (!config.databaseUrl) throw new Error('DATABASE_URL is required for PostgreSQL mode');
  return new Pool({
    connectionString: config.databaseUrl,
    ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined,
    max: 10,
    idleTimeoutMillis: 30_000,
  });
}

export async function runMigrations(pool: Pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    for (const migration of migrations) {
      const existing = await client.query('SELECT 1 FROM schema_migrations WHERE version = $1', [migration.version]);
      if (existing.rowCount) continue;
      const sql = await fs.readFile(fileURLToPath(migration.url), 'utf8');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [migration.version]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  const pool = createPool();
  try {
    await runMigrations(pool);
    console.log('Sabre Studio database is up to date.');
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
