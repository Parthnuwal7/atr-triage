import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { TriageConfig } from '../src/config.js';
import { getLocalPool } from '../src/db.js';
import { runMigrations } from '../src/migrate.js';

// In-memory PGlite — no Docker, no files, runs anywhere.
const cfg: TriageConfig = { prodReadUrl: 'unused', localUrl: 'memory://' };

describe('runMigrations (embedded PGlite — no infra needed)', () => {
  const db = getLocalPool(cfg);
  afterAll(async () => { await db.end(); });

  it('creates the five core tables', async () => {
    await runMigrations(db);
    const { rows } = await db.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema='public' ORDER BY table_name`
    );
    const names = rows.map(r => r.table_name);
    for (const t of ['dashboards', 'golden_queries', 'runs', 'turns', 'verdicts']) {
      expect(names).toContain(t);
    }
  });
});
