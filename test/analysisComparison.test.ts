import { describe, it, expect } from 'vitest';
import {
  CATEGORY_FAMILIES,
  familyOf,
  relativeInvertedScores,
  computeArmSummary,
  buildComparison,
  type TurnDetail,
} from '../src/dashboard/analysis.js';

// Minimal TurnDetail factory — only the fields the comparison model reads matter.
function turn(p: Partial<TurnDetail>): TurnDetail {
  return {
    message_id: p.message_id ?? 'm', user_query: '', answer_text: p.answer_text ?? 'ok',
    workspace_memory: '', conversation_memory: '', tool_trace: null, downvoted: false,
    signal_no_tool_call: false, signal_tool_error: false, signal_empty_or_refusal: false,
    signal_no_response: false, signal_latency_outlier: false,
    verdict: p.verdict ?? '(unjudged)', category: '', severity: '', rationale: '',
    eval_category: p.eval_category ?? null,
    expected_tool: p.expected_tool ?? null, tool_called: p.tool_called ?? null,
    tokens_total: p.tokens_total ?? null, cost_usd: p.cost_usd ?? null,
    steps: p.steps ?? null, total_time_ms: p.total_time_ms ?? null,
    accuracy_score: p.accuracy_score ?? null,
  };
}

describe('CATEGORY_FAMILIES', () => {
  it('maps exactly 31 categories, each to a single family', () => {
    const all = Object.values(CATEGORY_FAMILIES).flat();
    expect(all).toHaveLength(31);
    expect(new Set(all).size).toBe(31); // no duplicates
    expect(Object.keys(CATEGORY_FAMILIES)).toHaveLength(7);
  });

  it('familyOf resolves known categories and buckets the rest as Uncategorized', () => {
    expect(familyOf('Normal Lookup')).toBe('Lookup & Reporting');
    expect(familyOf('Adversarial')).toBe('Safety & Robustness');
    expect(familyOf('Slash Command')).toBe('Navigation & Product');
    expect(familyOf('Something New')).toBe('Uncategorized');
    expect(familyOf(null)).toBe('Uncategorized');
  });
});

describe('relativeInvertedScores (lower raw is better)', () => {
  it('gives the smaller value 100 and scales the larger down', () => {
    expect(relativeInvertedScores(1000, 2000)).toEqual({ a: 100, b: 50, measured: true });
    expect(relativeInvertedScores(4, 1)).toEqual({ a: 25, b: 100, measured: true });
  });
  it('flags not-measured when either side is null', () => {
    expect(relativeInvertedScores(null, 5)).toEqual({ a: 0, b: 0, measured: false });
  });
  it('treats two zeros as a tie at 100', () => {
    expect(relativeInvertedScores(0, 0)).toEqual({ a: 100, b: 100, measured: true });
  });
});

describe('buildComparison', () => {
  const aTurns = [
    turn({ eval_category: 'Normal Lookup', verdict: 'good', expected_tool: 'queryDatabase', tool_called: 'queryData', accuracy_score: 80, total_time_ms: 2000, cost_usd: 0.01, steps: 2 }),
    turn({ eval_category: 'Normal Lookup', verdict: 'broken', expected_tool: 'queryDatabase', tool_called: null, accuracy_score: 40, total_time_ms: 4000, cost_usd: 0.02, steps: 3, answer_text: 'ERROR: boom' }),
    turn({ eval_category: 'Adversarial', verdict: 'good', accuracy_score: 90, total_time_ms: 1000, cost_usd: 0.01, steps: 1 }),
  ];
  const bTurns = [
    turn({ eval_category: 'Normal Lookup', verdict: 'good', expected_tool: 'queryDatabase', tool_called: 'queryDatabase', accuracy_score: 95, total_time_ms: 1000, cost_usd: 0.005, steps: 1 }),
    turn({ eval_category: 'Normal Lookup', verdict: 'good', expected_tool: 'queryDatabase', tool_called: 'queryData', accuracy_score: 85, total_time_ms: 1500, cost_usd: 0.006, steps: 1 }),
    turn({ eval_category: 'Adversarial', verdict: 'broken', accuracy_score: 30, total_time_ms: 900, cost_usd: 0.004, steps: 1 }),
  ];
  const A = computeArmSummary('run-a', 'wsA', aTurns);
  const B = computeArmSummary('run-b', 'wsB', bTurns);
  const model = buildComparison(A, B, aTurns, bTurns);

  it('summarises pass rate, tool routing (alias-aware) and errors per arm', () => {
    expect(A.passRatePct).toBe(67); // 2 good of 3 judged
    expect(A.toolRoutingPct).toBe(50); // queryData matches, null does not
    expect(A.errorCount).toBe(1);
    expect(B.toolRoutingPct).toBe(100); // both alias-match
    expect(B.errorCount).toBe(0);
  });

  it('scores relative axes by the pair — faster/cheaper B beats A', () => {
    const speed = model.qualityRadar.find(x => x.axis === 'Speed')!;
    const cost = model.qualityRadar.find(x => x.axis === 'Cost efficiency')!;
    expect(speed.b).toBe(100); // B has the lower median latency
    expect(speed.a).toBeLessThan(100);
    expect(cost.b).toBe(100);
  });

  it('orders category deltas worst-regression first', () => {
    // Normal Lookup: A 50% → B 100% (+50). Adversarial: A 100% → B 0% (−100).
    expect(model.categoryDeltas[0]).toMatchObject({ category: 'Adversarial', delta: -100 });
    expect(model.categoryDeltas.at(-1)).toMatchObject({ category: 'Normal Lookup', delta: 50 });
  });

  it('builds one family axis per family and aggregates pass rate', () => {
    expect(model.familyRadar).toHaveLength(7);
    const lookup = model.familyRadar.find(x => x.axis === 'Lookup & Reporting')!;
    expect(lookup.a).toBe(50);
    expect(lookup.b).toBe(100);
  });

  it('colours KPI direction by metric (lower latency/cost/errors is better)', () => {
    const latency = model.kpis.find(k => k.label === 'Median latency')!;
    expect(latency.betterIsB).toBe(true); // B faster
    const pass = model.kpis.find(k => k.label === 'Pass %')!;
    expect(pass.betterIsB).toBe(true); // B 100% vs A 67%
  });

  it('lists axes with zero denominator as not-measured instead of silent zero', () => {
    const noJudge = [turn({ eval_category: 'Filter', verdict: '(unjudged)' })];
    const m2 = buildComparison(
      computeArmSummary('a', 'wsA', noJudge),
      computeArmSummary('b', 'wsB', noJudge),
      noJudge, noJudge
    );
    expect(m2.notMeasured).toContain('Verdict pass %');
    expect(m2.notMeasured).toContain('Tool-routing %');
  });
});
