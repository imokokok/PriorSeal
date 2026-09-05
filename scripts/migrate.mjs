import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import pg from 'pg';

const { Pool } = pg;
const connectionString = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL_UNPOOLED or DATABASE_URL is required for migrations');

const migrationsDirectory = new URL('../migrations/', import.meta.url);
const files = (await readdir(migrationsDirectory)).filter((file) => /^\d+_.+\.sql$/.test(file)).sort();
const pool = new Pool({ connectionString });
const client = await pool.connect();

try {
  await client.query("SELECT pg_advisory_lock(hashtext('runproof:migrations'))");
  await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
  for (const name of files) {
    const sql = await readFile(join(migrationsDirectory.pathname, name), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    const applied = await client.query('SELECT checksum FROM schema_migrations WHERE name = $1', [name]);
    if (applied.rows[0]) {
      if (applied.rows[0].checksum !== checksum) throw new Error(`Migration checksum mismatch: ${name}`);
      continue;
    }
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [name, checksum]);
      await client.query('COMMIT');
      console.log(`Applied ${name}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }
} finally {
  await client.query("SELECT pg_advisory_unlock(hashtext('runproof:migrations'))").catch(() => {});
  client.release();
  await pool.end();
}
