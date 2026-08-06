import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LocalDb } from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../migrations');

export async function runMigrations(db: LocalDb): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     TEXT PRIMARY KEY,
      checksum    TEXT NOT NULL,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  const files = readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort();
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    const applied = await db.query<{ checksum: string }>(
      'SELECT checksum FROM schema_migrations WHERE version=$1',
      [file]
    );
    if (applied.rows[0]) {
      if (applied.rows[0].checksum !== checksum) {
        throw new Error(`migration checksum mismatch: ${file}`);
      }
      continue;
    }
    await db.query('BEGIN');
    try {
      await db.exec(sql);
      await db.query(
        'INSERT INTO schema_migrations (version, checksum) VALUES ($1,$2)',
        [file, checksum]
      );
      await db.query('COMMIT');
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    }
  }
}
