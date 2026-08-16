import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'csv-parse/sync';
import type { TriageConfig } from '../src/config.js';
import { getLocalPool } from '../src/db.js';
import { runMigrations } from '../src/migrate.js';
import { runJudgeCsv } from '../src/judgeCsv/judgeCsvCommand.js';

describe('ARIA review CSV export (embedded PGlite)', () => {
  const root = mkdtempSync(join(tmpdir(), 'aria-review-'));
  const cfg: TriageConfig = { prodReadUrl: 'unused', localUrl: join(root, 'db') };
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('joins run coverage with turn evidence and writes valid CSV', async () => {
    const db = getLocalPool(cfg);
    await runMigrations(db);
    await db.query(
      `INSERT INTO runs (run_id,workspace,from_date,to_date,mode,source_row_count,ingestion_status,expected_case_count)
       VALUES ('run-1','ARIA-test','2026-08-15','2026-08-15','eval',1,'partial',10)`
    );
    await db.query(
      `INSERT INTO turns (run_id,message_id,chat_id,user_query,answer_text,category,case_id,attempt_index,
         model_id,evidence_status,artifacts,provenance)
       VALUES ('run-1','DATA-01','chat-1','Spend?','123','Correctness','DATA-01',0,'m','sufficient',
         $1::jsonb,$2::jsonb)`,
      [
        JSON.stringify({ benchmark_context: { rubric: 'Use seeded value', expect: { kind: 'value', value: 123 }, process_trace: { path_signature: 'tool:queryData:ok > terminal:completed' }, failure_signals: [{ stage: 'visual_data_binding', code: 'visual_expected_data_mismatch' }], attempt_history: [{ attempt: 1, terminal_status: 'completed' }], terminal_status: 'completed' }, visual_validation: { data_correct: true } }),
        JSON.stringify({ fixture_sha256: 'abc' }),
      ]
    );
    await db.end();

    const out = join(root, 'aria.review.csv');
    const result = await runJudgeCsv(cfg, 'run-1', out);
    expect(result.rows).toBe(1);
    const rows = parse(readFileSync(out, 'utf8'), { columns: true, skip_empty_lines: true }) as Record<string, string>[];
    expect(rows[0]).toMatchObject({
      run_id: 'run-1', run_status: 'partial', captured_cases: '1', planned_cases: '10',
      message_id: 'DATA-01', scenario_category: 'Correctness', rubric: 'Use seeded value',
    });
    expect(JSON.parse(rows[0].expected_json)).toEqual({ kind: 'value', value: 123 });
    expect(JSON.parse(rows[0].visual_validation_json)).toEqual({ data_correct: true });
    expect(rows[0].path_signature).toContain('tool:queryData:ok');
    expect(JSON.parse(rows[0].failure_signals_json)[0].stage).toBe('visual_data_binding');
    expect(JSON.parse(rows[0].attempt_history_json)[0].attempt).toBe(1);
    expect(rows[0].failure_stage).toBe('');
    expect(rows[0].likely_root_cause).toBe('');
  });
});
