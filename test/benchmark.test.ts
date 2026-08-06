import { describe, expect, it } from 'vitest';
import { buildInterleavedAttempts } from '../src/benchmark/planCommand.js';
import { digest, validateJudgment } from '../src/benchmark/schema.js';
import { buildComparison, computeArmSummary, type TurnDetail } from '../src/dashboard/analysis.js';
import { safeDashboardName } from '../src/dashboard/dashboardCommand.js';
import { normalizeJudgeAnswer } from '../src/judgeCsv/judgeBundle.js';

function turn(caseId: string, verdict: string, evidence = 'sufficient'): TurnDetail {
  return {
    message_id: caseId, case_id: caseId, attempt_index: 0,
    user_query: '', answer_text: 'answer', workspace_memory: '', conversation_memory: '',
    tool_trace: [], downvoted: false, signal_no_tool_call: false, signal_tool_error: false,
    signal_empty_or_refusal: false, signal_no_response: false, signal_latency_outlier: false,
    verdict, category: '', severity: '', rationale: '', eval_category: 'Normal Lookup',
    expected_tool: null, tool_called: null, tokens_total: null, cost_usd: null, steps: null,
    total_time_ms: null, accuracy_score: null, evidence_status: evidence, judge_count: 1,
    disagreement: false, assertion_outcome: 'pass', measurement_eligible: true,
    expected_contract_version: 'contract-v1', assertion_schema_version: 1,
  };
}

describe('benchmark planning and schemas', () => {
  it('creates a deterministic, balanced interleaved schedule', () => {
    const first = buildInterleavedAttempts(['c1', 'c2'], ['baseline', 'candidate'], 2, 42);
    const again = buildInterleavedAttempts(['c1', 'c2'], ['baseline', 'candidate'], 2, 42);
    expect(first).toEqual(again);
    expect(first).toHaveLength(8);
    for (const caseId of ['c1', 'c2']) {
      for (const approachId of ['baseline', 'candidate']) {
        expect(first.filter(a => a.caseId === caseId && a.approachId === approachId)).toHaveLength(2);
      }
    }
  });

  it('canonicalizes object keys when hashing provenance', () => {
    expect(digest({ a: 1, b: 2 })).toBe(digest({ b: 2, a: 1 }));
  });

  it('rejects invalid structured judgments', () => {
    expect(() => validateJudgment({
      messageId: 'm1', verdict: 'good', category: 'other', severity: 'low',
      rationale: 'ok', dimensions: { correctness: 5 }, confidence: 0.9,
      evidenceSufficiency: 'sufficient',
    })).toThrow(/between 0 and 4/);
    expect(() => validateJudgment({
      messageId: 'm2', verdict: 'good', category: 'other', severity: 'low',
      rationale: 'ok', dimensions: {
        correctness: 4, grounding: 4, relevance: 4, scope: 4, chartChoice: 4,
      }, confidence: 0.9, evidenceSufficiency: 'sufficient',
    })).toThrow(/missing usefulness/);
    expect(() => validateJudgment({
      messageId: 'm3', verdict: 'good', category: 'other', severity: 'low',
      rationale: 'ok', dimensions: {
        correctness: 3.5, grounding: 4, relevance: 4, scope: 4, chartChoice: 4, usefulness: 4,
      }, confidence: 0.9, evidenceSufficiency: 'sufficient',
    })).toThrow(/integer between 0 and 4/);
  });

  it('removes harness-only instrumentation before blinded judging', () => {
    const answer = `🧪 *Reasoning harness*\n_pulling the numbers…_\n\nROAS was 3.2x.\n\n---\n*🧪 harness · route lookup · 2s · 10 tokens*`;
    expect(normalizeJudgeAnswer(answer)).toBe('ROAS was 3.2x.');
  });

  it('rejects dashboard path traversal names', () => {
    expect(safeDashboardName('comparison-v1')).toBe('comparison-v1');
    expect(() => safeDashboardName('../outside')).toThrow(/safe/);
    expect(() => safeDashboardName('nested/report')).toThrow(/safe/);
  });
});

describe('matched comparison validity', () => {
  it('computes paired wins and invalidates unmatched arms', () => {
    const a = [turn('c1', 'broken'), turn('c2', 'good')];
    const b = [turn('c1', 'good'), turn('c3', 'good')];
    const comparison = buildComparison(
      computeArmSummary('a', 'baseline', a),
      computeArmSummary('b', 'candidate', b),
      a,
      b,
      [], [], true, true,
      {
        fixtureA: 'fixture-v1', fixtureB: 'fixture-v1',
        promptA: 'prompt-v1', promptB: 'prompt-v1',
        experimentA: 'exp-1', experimentB: 'exp-1', seedA: 42, seedB: 42,
        contractA: 'contract-v1', contractB: 'contract-v1',
        assertionSchemaA: 1, assertionSchemaB: 1,
      }
    );
    expect(comparison.matched).toMatchObject({ wins: 1, losses: 0, ties: 0 });
    expect(comparison.validity?.status).toBe('invalid');
    expect(comparison.validity?.reasons).toContain('arms do not contain identical matched attempts');
  });

  it('marks a small complete matched sample inconclusive', () => {
    const a = [turn('c1', 'broken')];
    const b = [turn('c1', 'good')];
    const comparison = buildComparison(
      computeArmSummary('a', 'baseline', a),
      computeArmSummary('b', 'candidate', b),
      a,
      b,
      [], [], true, true,
      {
        fixtureA: 'fixture-v1', fixtureB: 'fixture-v1',
        promptA: 'prompt-v1', promptB: 'prompt-v1',
        experimentA: 'exp-1', experimentB: 'exp-1', seedA: 42, seedB: 42,
        contractA: 'contract-v1', contractB: 'contract-v1',
        assertionSchemaA: 1, assertionSchemaB: 1,
      }
    );
    expect(comparison.validity?.status).toBe('inconclusive');
    expect(comparison.validity?.judgeCoveragePct).toBe(100);
    expect(comparison.validity?.evidenceCoveragePct).toBe(100);
  });

  it('only makes paired measurements eligible with complete contracts, assertions, and green gates', () => {
    const a = Array.from({ length: 10 }, (_, i) => turn(`c${i}`, 'broken'));
    const b = Array.from({ length: 10 }, (_, i) => turn(`c${i}`, 'good'));
    const comparison = buildComparison(
      computeArmSummary('a', 'baseline', a), computeArmSummary('b', 'candidate', b), a, b,
      [], [], true, true,
      {
        fixtureA: 'fixture-v1', fixtureB: 'fixture-v1',
        promptA: 'prompt-v1', promptB: 'prompt-v1',
        experimentA: 'exp-1', experimentB: 'exp-1', seedA: 42, seedB: 42,
        contractA: 'contract-v1', contractB: 'contract-v1',
        assertionSchemaA: 1, assertionSchemaB: 1,
      }
    );
    expect(comparison.validity?.status).toBe('valid');
    expect(comparison.eligibility).toMatchObject({ eligible: true, decision: 'promote' });

    const red = buildComparison(
      computeArmSummary('a', 'baseline', a), computeArmSummary('b', 'candidate', b), a, b,
      [], [{ class: 'scope-leak', layer: 'auth', severity: 'p0', blocking: true, count: 1 }],
      true, true,
      {
        fixtureA: 'fixture-v1', fixtureB: 'fixture-v1',
        promptA: 'prompt-v1', promptB: 'prompt-v1',
        experimentA: 'exp-1', experimentB: 'exp-1', seedA: 42, seedB: 42,
        contractA: 'contract-v1', contractB: 'contract-v1',
        assertionSchemaA: 1, assertionSchemaB: 1,
      }
    );
    expect(red.eligibility).toMatchObject({ eligible: false, decision: 'reject' });
  });
});
