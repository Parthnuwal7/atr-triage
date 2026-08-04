import { describe, it, expect } from 'vitest';
import { renderDashboardHtml, renderComparisonHtml } from '../src/dashboard/renderHtml.js';
import type { AnalysisModel, ComparisonModel } from '../src/dashboard/analysis.js';

const turn = (over: Partial<AnalysisModel['turns'][number]> = {}): AnalysisModel['turns'][number] => ({
  message_id: 'a1', user_query: 'q1', answer_text: 'wrong', workspace_memory: '', conversation_memory: '',
  tool_trace: null, downvoted: false, signal_no_tool_call: false, signal_tool_error: false,
  signal_empty_or_refusal: false, signal_no_response: false, signal_latency_outlier: false,
  verdict: 'broken', category: 'hallucination', severity: 'high', rationale: 'made up',
  eval_category: null, expected_tool: null, tool_called: null, tokens_total: null,
  cost_usd: null, steps: null, total_time_ms: null, accuracy_score: null, ...over,
});

const model: AnalysisModel = {
  runId: 'r1', workspace: 'ws1', fromDate: '2026-07-01', toDate: '2026-07-07',
  total: 8, downvotes: 2,
  verdictSplit: [{ label: 'good', value: 6, color: '#2e7d32' }, { label: 'broken', value: 2, color: '#c62828' }],
  byCategory: [{ label: 'hallucination', value: 2 }],
  bySignal: [{ label: 'downvote', value: 2 }],
  byTool: [{ label: 'queryDatabase', value: 5 }],
  turns: [turn()],
};

describe('renderDashboardHtml', () => {
  it('is a self-contained HTML doc with no external references', () => {
    const html = renderDashboardHtml(model);
    expect(html).toMatch(/<!doctype html>/i);
    expect(html).not.toMatch(/https?:\/\//); // no external assets
    expect(html).toContain('ws1');
    expect(html).toContain('hallucination');
    expect(html).toContain('queryDatabase');
    expect(html).toContain('made up'); // rationale rendered in detail block
  });
  it('renders the deterministic gate banner + findings when a gate is present', () => {
    const withGate: AnalysisModel = {
      ...model,
      gate: {
        status: 'red', total: 5, blocking: 1,
        byClass: [
          { label: 'over-clarify', value: 4, blocking: false, severity: 'med', layer: 'router' },
          { label: 'cross-tenant', value: 1, blocking: true, severity: 'p0', layer: 'auth' },
        ],
      },
    };
    const html = renderDashboardHtml(withGate);
    expect(html).toContain('GATE RED');
    expect(html).toContain('cross-tenant');
    expect(html).toContain('over-clarify');
    expect(html).toContain('1 blocking');
  });
  it('shows a not-asserted notice when there is no gate', () => {
    expect(renderDashboardHtml(model)).toContain('Not asserted');
  });
  it('renders interactive filter chips and expandable rows', () => {
    const html = renderDashboardHtml(model);
    expect(html).toContain('class="chip'); // filter chips
    expect(html).toContain('tr.turn');     // clickable-row styling/script
    expect(html).toContain('<script>');    // inline interactivity
  });
  it('escapes HTML in turn text', () => {
    const evil: AnalysisModel = { ...model, turns: [turn({ user_query: '<script>x</script>', answer_text: '' })] };
    expect(renderDashboardHtml(evil)).not.toContain('<script>x</script>');
  });

  it('renders the benchmark-metrics section when evalMetrics present', () => {
    const evalModel: AnalysisModel = {
      ...model,
      evalMetrics: {
        toolCorrect: 8, toolTotal: 10, avgTokens: 1200, totalCost: 0.42, avgSteps: 1.4,
        avgLatencyMs: 3200, avgAccuracy: 86,
        byCategory: [{ category: 'Normal Lookup', total: 5, broken: 1, needsWork: 1, good: 3, avgAccuracy: 90 }],
      },
    };
    const html = renderDashboardHtml(evalModel);
    expect(html).toContain('Benchmark metrics');
    expect(html).toContain('Tool-call correct');
    expect(html).toContain('80%'); // 8/10
    expect(html).toContain('Normal Lookup');
  });
});

describe('renderComparisonHtml', () => {
  const cmp: ComparisonModel = {
    a: { runId: 'run-a', workspace: 'no-harness' },
    b: { runId: 'run-b', workspace: 'harness' },
    qualityRadar: [
      { axis: 'Verdict pass %', a: 60, b: 75 },
      { axis: 'Speed', a: 80, b: 100 },
    ],
    familyRadar: [{ axis: 'Lookup & Reporting', a: 50, b: 90 }],
    kpis: [
      { label: 'Pass %', a: 60, b: 75, delta: 15, betterIsB: true, fmt: 'pct' },
      { label: 'Total cost', a: 2.28, b: 3.1, delta: 0.82, betterIsB: false, fmt: 'usd' },
    ],
    categoryDeltas: [
      { category: 'Adversarial', a: 100, b: 40, delta: -60 },
      { category: 'Normal Lookup', a: 50, b: 90, delta: 40 },
    ],
    verdictGroups: [{ label: 'pass', a: 6, b: 8, color: '#2e7d32' }],
    notMeasured: ['Cost efficiency'],
    relativeAxes: ['Speed', 'Cost efficiency', 'Step efficiency'],
  };

  it('is a self-contained A/B doc with both arms, deltas and captions', () => {
    const html = renderComparisonHtml(cmp);
    expect(html).toMatch(/<!doctype html>/i);
    expect(html).not.toMatch(/https?:\/\//); // no external assets
    expect(html).toContain('no-harness');
    expect(html).toContain('harness');
    expect(html).toContain('+15pp');       // improvement tile
    expect(html).toContain('Adversarial'); // worst-regression category
    expect(html).toContain('Not measured'); // zero-denominator caption
  });
});
