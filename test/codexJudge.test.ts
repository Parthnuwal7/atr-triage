import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { TriageConfig } from '../src/config.js';
import { getLocalPool } from '../src/db.js';
import { runMigrations } from '../src/migrate.js';
import {
  buildCodexReviewBundle,
  buildCompactReviewCase,
  compactValue,
  codexJudgeEnvironment,
  importCodexJudgments,
  runCodexJudge,
} from '../src/codexJudge/codexJudge.js';

describe('compact Codex ARIA judging', () => {
  const root = mkdtempSync(join(tmpdir(), 'aria-codex-judge-'));
  const cfg: TriageConfig = { prodReadUrl: 'unused', localUrl: join(root, 'db') };
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('does not expose application database credentials to the Codex subprocess', () => {
    const env = codexJudgeEnvironment({
      PATH: '/bin', OPENAI_API_KEY: 'judge-key',
      PROD_READ_DATABASE_URL: 'postgres://secret', LOCAL_DATABASE_URL: './private-db',
    });
    expect(env).toMatchObject({ PATH: '/bin', OPENAI_API_KEY: 'judge-key' });
    expect(env).not.toHaveProperty('PROD_READ_DATABASE_URL');
    expect(env).not.toHaveProperty('LOCAL_DATABASE_URL');
  });

  it('uses a strict Structured Outputs-compatible judgment schema', () => {
    const schema = JSON.parse(readFileSync(join(process.cwd(), 'prompts/aria-codex-judge-output.schema.json'), 'utf8'));
    const visit = (node: any): void => {
      if (!node || typeof node !== 'object') return;
      if (node.properties) {
        expect(node.type).toBe('object');
        expect(node.additionalProperties).toBe(false);
        expect(new Set(node.required)).toEqual(new Set(Object.keys(node.properties)));
        for (const property of Object.values<any>(node.properties)) {
          expect(property.type || property.anyOf || property.$ref).toBeTruthy();
        }
      }
      if (node.items) visit(node.items);
      if (node.properties) Object.values(node.properties).forEach(visit);
      if (node.anyOf) node.anyOf.forEach(visit);
    };
    visit(schema);
    expect(JSON.stringify(schema)).not.toContain('minLength');
  });

  it('keeps causal and visual evidence while bounding noisy arrays', () => {
    const compacted = compactValue(Array.from({ length: 45 }, (_, index) => ({ index })));
    expect(compacted).toHaveLength(41);
    expect(compacted[40]).toEqual({ omitted_items: 5 });

    const review = buildCompactReviewCase({
      run_id: 'run', message_id: 'CASE-01', case_id: 'CASE-01', category: 'Correctness',
      user_query: 'Chart spend', answer_text: 'Spend was 100',
      tool_trace: [{ name: 'queryData', status: 'ok', result: { rows: [{ spend: 100 }] } }],
      trace: null, evidence_status: 'sufficient', total_time_ms: 200, ttfb_ms: 20,
      model_id: 'm', attempt_index: 0,
      artifacts: {
        visual_contract: { expected: true, expected_values: [100] },
        visual_artifacts: { count: 1, artifacts: [{ artifact_kind: 'chart_or_dashboard_card', raw_payload: { data: [{ spend: 100 }] } }] },
        benchmark_context: {
          rubric: 'Use spend 100', expect: { kind: 'value', value: 100 },
          failure_signals: [], server_events: [{ event_id: 'r:1', event_type: 'tool_execution_completed', detail: { row_count: 1 } }],
        },
      },
    }, 'blind-1');
    expect(review.evidence_digest).toMatch(/^[a-f0-9]{64}$/);
    expect(review).toMatchObject({ blind_id: 'blind-1', case_id: 'CASE-01' });
    expect(JSON.stringify(review)).toContain('tool_execution_completed');
    expect(JSON.stringify(review)).toContain('chart_or_dashboard_card');
  });

  it('builds resumable blinded batches with provenance hashes', async () => {
    const db = getLocalPool(cfg);
    await runMigrations(db);
    await db.query(
      `INSERT INTO runs (run_id,workspace,from_date,to_date,mode,source_row_count)
       VALUES ('run-1','local','2026-08-16','2026-08-16','eval',1)`
    );
    await db.query(
      `INSERT INTO turns (
         run_id,message_id,chat_id,user_query,answer_text,category,case_id,attempt_index,
         evidence_status,artifacts,provenance,model_id
       ) VALUES ('run-1','CASE-01','chat','Query','Answer','Correctness','CASE-01',0,
         'sufficient',$1::jsonb,'{}'::jsonb,'m')`,
      [JSON.stringify({ benchmark_context: { rubric: 'Be correct', expect: { kind: 'value', value: 1 } } })]
    );
    await db.end();

    const out = join(root, 'bundle');
    const built = await buildCodexReviewBundle(cfg, 'run-1', out, 1);
    expect(built).toMatchObject({ cases: 1, batches: 1 });
    const manifest = JSON.parse(readFileSync(built.manifestPath, 'utf8'));
    expect(manifest.schema).toBe('aria-codex-review-manifest/v1');
    expect(Object.keys(manifest.mapping)).toHaveLength(1);
    const dryRun = runCodexJudge(built.manifestPath, { dryRun: true });
    expect(dryRun).toEqual({ completed: 0, skipped: 0, batches: 1 });

    const [blindId, target] = Object.entries(manifest.mapping)[0] as [string, any];
    const judgment = {
      schema: 'aria-codex-judgments/v1',
      judgments: [{
        blind_id: blindId,
        evidence_digest: target.evidence_digest,
        verdict: 'good', category: '', severity: 'low',
        failure_stage: 'none', failed_component: 'none',
        process_error: '', causal_evidence: [], likely_root_cause: '', fix_layer: 'none',
        rationale: 'The answer satisfies the supplied rubric and no contradictory evidence is present.',
        dimensions: { correctness: 4, grounding: 4, relevance: 4, scope: 4, chartChoice: 4, usefulness: 4 },
        confidence: 0.9, evidence_sufficiency: 'sufficient',
        fixture_issue: false, deterministic_relation: 'not-applicable',
        reviewer_notes: '',
      }],
    };
    writeFileSync(join(out, target.output_file), JSON.stringify(judgment));
    const imported = await importCodexJudgments(cfg, built.manifestPath, 'codex-test', 'test-model');
    expect(imported).toEqual({ imported: 1, reviews: 0 });
    const verifyDb = getLocalPool(cfg);
    const stored = await verifyDb.query<any>('SELECT failure_stage,evidence_digest FROM judgments');
    expect(stored.rows[0]).toMatchObject({ failure_stage: 'none', evidence_digest: target.evidence_digest });
    const verdict = await verifyDb.query<any>('SELECT judge_count,disagreement FROM verdicts');
    expect(verdict.rows[0]).toMatchObject({ judge_count: 1, disagreement: false });
    await verifyDb.end();
  });
});
