import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { TriageConfig } from '../src/config.js';
import { getLocalPool } from '../src/db.js';
import { runMigrations } from '../src/migrate.js';

// In-memory PGlite — no Docker, no files, runs anywhere.
const cfg: TriageConfig = { prodReadUrl: 'unused', localUrl: 'memory://' };

describe('runMigrations (embedded PGlite — no infra needed)', () => {
  const db = getLocalPool(cfg);
  afterAll(async () => { await db.end(); });

  it('creates core and benchmark audit tables', async () => {
    await runMigrations(db);
    const { rows } = await db.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema='public' ORDER BY table_name`
    );
    const names = rows.map(r => r.table_name);
    for (const t of [
      'dashboards', 'golden_queries', 'runs', 'turns', 'verdicts',
      'benchmark_experiments', 'benchmark_attempts', 'judge_batches', 'judgments', 'judgment_reviews',
      'expected_contracts', 'assertion_results',
      'schema_migrations',
    ]) {
      expect(names).toContain(t);
    }
    const first = await db.query<{ count: number }>('SELECT count(*)::int count FROM schema_migrations');
    await runMigrations(db);
    const second = await db.query<{ count: number }>('SELECT count(*)::int count FROM schema_migrations');
    expect(second.rows[0].count).toBe(first.rows[0].count);

    const findingType = await db.query<{ data_type: string }>(
      `SELECT data_type FROM information_schema.columns
       WHERE table_name='findings' AND column_name='run_id'`
    );
    expect(findingType.rows[0].data_type).toBe('text');
    const assertionColumns = await db.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name='assertion_results'`
    );
    expect(assertionColumns.rows.map(row => row.column_name)).toEqual(expect.arrayContaining([
      'contract_version', 'outcome', 'measurement_eligible', 'measurement_reasons',
    ]));
  });
});
