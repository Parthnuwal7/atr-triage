import { describe, expect, it } from 'vitest';
import { buildEvalArtifacts } from '../src/ingestEval/ariaEvidence.js';
import { buildJudgeCsvRows, JUDGE_CSV_COLUMNS } from '../src/judgeCsv/judgeCsvCommand.js';

describe('ARIA deep-review evidence', () => {
  it('preserves resolved expectations, rubric, deterministic checks, and turn diagnostics', () => {
    const artifacts = buildEvalArtifacts({
      rubric: 'Must report the seeded spend.',
      expect: { kind: 'value', value: 123 },
      deterministic_validation: { asserted: true, passed: true },
      process_trace: { path_signature: 'route:analysis > tool:queryData:ok > terminal:completed', attempts: [] },
      failure_signals: [{ stage: 'answer_synthesis', code: 'expected_answer_contract_failed' }],
      attempt_history: [{ attempt: 1, terminal_status: 'completed' }],
      terminal_status: 'completed',
      turns: [{ turn: 1, message_id: 'm1', terminal_status: 'completed', timings: { total_ms: 900 }, errors: [] }],
      artifacts: {
        visual_artifacts: { emitted: true, count: 1, artifacts: [{ visualization_type: 'bar_chart' }] },
        visual_validation: { data_correct: true, comparison_correct: null },
      },
    });
    expect(artifacts?.benchmark_context).toMatchObject({
      rubric: 'Must report the seeded spend.', expect: { kind: 'value', value: 123 },
      terminal_status: 'completed',
      process_trace: { path_signature: 'route:analysis > tool:queryData:ok > terminal:completed' },
    });
  });

  it('exports a directly judgeable CSV row with blank review columns', () => {
    const artifacts = buildEvalArtifacts({
      rubric: 'Must report the seeded spend.',
      expect: { kind: 'value', value: 123 },
      deterministic_validation: { asserted: true, passed: true },
      process_trace: { path_signature: 'route:analysis > tool:queryData:ok > terminal:completed', attempts: [] },
      failure_signals: [{ stage: 'answer_synthesis', code: 'expected_answer_contract_failed' }],
      attempt_history: [{ attempt: 1, terminal_status: 'completed' }],
      terminal_status: 'completed',
      artifacts: {
        visual_artifacts: { emitted: true, count: 1 },
        visual_validation: { data_correct: true },
      },
    });
    const [row] = buildJudgeCsvRows([{
      run_id: 'run-1', message_id: 'DATA-01', case_id: 'DATA-01', attempt_index: 2,
      model_id: 'm', category: 'Correctness', user_query: 'Spend?', answer_text: '₹123',
      expected_tool: null, tool_called: 'queryData', tool_trace: [{ name: 'queryData' }],
      artifacts, provenance: { fixture_sha256: 'abc' }, evidence_status: 'sufficient',
      ttfb_ms: 100, total_time_ms: 900, accuracy_score: 100,
    }]);
    for (const column of JUDGE_CSV_COLUMNS) expect(row).toHaveProperty(column);
    expect(row.scenario_category).toBe('Correctness');
    expect(JSON.parse(row.expected_json)).toEqual({ kind: 'value', value: 123 });
    expect(JSON.parse(row.visual_validation_json)).toEqual({ data_correct: true });
    expect(row.repeat_index).toBe('2');
    expect(row.path_signature).toContain('tool:queryData:ok');
    expect(JSON.parse(row.failure_signals_json)[0].stage).toBe('answer_synthesis');
    expect(JSON.parse(row.attempt_history_json)[0].attempt).toBe(1);
    expect(row.failure_stage).toBe('');
    expect(row.causal_evidence).toBe('');
    expect(row.verdict).toBe('');
    expect(row.category).toBe('');
  });
});
