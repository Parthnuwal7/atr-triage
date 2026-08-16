import { describe, expect, it } from 'vitest';
import { parseEvalJsonl } from '../src/ingestEval/ingestCommand.js';
import { renderDashboardHtml } from '../src/dashboard/renderHtml.js';
import type { AnalysisModel } from '../src/dashboard/analysis.js';

describe('ARIA baseline visual logs', () => {
  it('accepts snake_case logger metadata and retains artifacts', () => {
    const artifacts = { visual_artifacts: { emitted: true, count: 1 }, visual_validation: { data_correct: true } };
    const input = [
      JSON.stringify({ kind: 'run_start', ts: '2026-08-15T00:00:00Z', client_id: 'aria-test-id', model: 'm', cases: 1 }),
      JSON.stringify({ kind: 'case', index: 1, id: 'DATA-01', model: 'm', category: 'Correctness', input: 'q', output: 'a', artifacts }),
      JSON.stringify({ kind: 'run_end', cases: 1, planned_cases: 1, complete: true }),
    ].join('\n');
    const parsed = parseEvalJsonl(input);
    expect(parsed.meta.workspace).toBe('aria-test-id');
    expect(parsed.meta.models).toEqual(['m']);
    expect(parsed.cases[0].artifacts).toMatchObject(artifacts);
    expect(parsed.cases[0].artifacts).toHaveProperty('benchmark_context');
  });

  it('preserves an atomically checkpointed incomplete run as partial', () => {
    const input = [
      JSON.stringify({ kind: 'run_start', cases: 1 }),
      JSON.stringify({ kind: 'case', index: 1, model: 'm', input: 'q', output: 'a' }),
      JSON.stringify({ kind: 'run_end', cases: 1, planned_cases: 2, complete: false }),
    ].join('\n');
    const parsed = parseEvalJsonl(input);
    expect(parsed.meta.ingestionStatus).toBe('partial');
    expect(parsed.meta.expectedCases).toBe(2);
    expect(parsed.cases).toHaveLength(1);
  });

  it('renders visual payload and validation in the turn detail', () => {
    const artifacts = { visual_artifacts: { count: 1, artifacts: [{ visualization_type: 'line_chart' }] }, visual_validation: { data_correct: true } };
    const model: AnalysisModel = {
      runId: 'r', workspace: 'ARIA-test', fromDate: '2026-08-15', toDate: '2026-08-15', total: 1, downvotes: 0,
      verdictSplit: [], byCategory: [], bySignal: [], byTool: [],
      turns: [{
        message_id: 'DATA-01', user_query: 'q', answer_text: 'a', workspace_memory: '', conversation_memory: '', tool_trace: null, artifacts,
        downvoted: false, signal_no_tool_call: false, signal_tool_error: false, signal_empty_or_refusal: false, signal_no_response: false, signal_latency_outlier: false,
        verdict: '(unjudged)', category: '', severity: '', rationale: '', eval_category: 'Correctness', expected_tool: null, tool_called: null,
        tokens_total: null, cost_usd: null, steps: null, total_time_ms: null, accuracy_score: null,
      }],
    };
    const html = renderDashboardHtml(model);
    expect(html).toContain('Visual artifacts and validation');
    expect(html).toContain('line_chart');
    expect(html).toContain('data_correct');
  });
});
