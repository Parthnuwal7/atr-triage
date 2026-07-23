import { describe, it, expect } from 'vitest';
import { renderDashboardHtml } from '../src/dashboard/renderHtml.js';
import type { AnalysisModel } from '../src/dashboard/analysis.js';

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
