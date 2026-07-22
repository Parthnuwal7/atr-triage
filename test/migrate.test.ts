import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { loadConfig } from '../src/config.js';
import { getLocalPool } from '../src/db.js';
import { runMigrations } from '../src/migrate.js';

describe('runMigrations (integration — needs `pnpm db:up`)', () => {
  const pool = getLocalPool(loadConfig());
  beforeAll(async () => { await runMigrations(pool); });
  afterAll(async () => { await pool.end(); });

  it('creates the five core tables', async () => {
    const { rows } = await pool.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema='public' ORDER BY table_name`
    );
    const names = rows.map(r => r.table_name);
    for (const t of ['dashboards', 'golden_queries', 'runs', 'turns', 'verdicts']) {
      expect(names).toContain(t);
    }
  });
});
