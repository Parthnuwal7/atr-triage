import { describe, it, expect } from 'vitest';
import { parseEvalJsonl } from '../src/ingestEval/ingestCommand.js';

const jsonl = [
  JSON.stringify({ kind: 'run_start', ts: '2026-07-23T10:00:00Z', clientId: 'ws1', models: ['gpt-oss-120b'], cases: 2 }),
  JSON.stringify({
    kind: 'case', index: 1, id: 'LOOK-01', category: 'Normal Lookup', model: 'gpt-oss-120b',
    input: 'what was my roas', output: 'ROAS 3.2', expected_tool: 'queryDatabase', tool_called: 'queryDatabase',
    all_tools_called: ['queryDatabase'], tool_calls: [{ name: 'queryDatabase', args: { metric: 'roas' }, kind: 'success', errorCode: null, rowCount: 5 }],
    steps: 1, tokens_total: 1200, tokens_in: 1000, tokens_out: 200, cost_usd: 0.004,
    total_time_ms: 3200, accuracy_score: 100, overall_score: 92,
    trace: { queriedWorkspace: 'ws-1', tools: [] },
  }),
  JSON.stringify({
    kind: 'case', index: 2, category: 'Navigation', model: 'gpt-oss-120b',
    input: 'how do I create a campaign', output: 'Go to Campaigns → New', expected_tool: 'getNavigationPath', tool_called: 'getNavigationPath',
    all_tools_called: ['getNavigationPath'], tool_calls: [], steps: 0,
    tokens_total: null, tokens_in: null, tokens_out: null, cost_usd: null,
    total_time_ms: 800, accuracy_score: 100, overall_score: 88,
  }),
  JSON.stringify({ kind: 'run_end', ts: '2026-07-23T10:05:00Z', cases: 2 }),
].join('\n');

describe('parseEvalJsonl', () => {
  it('extracts run metadata and all case rows', () => {
    const { meta, cases } = parseEvalJsonl(jsonl);
    expect(meta.workspace).toBe('ws1');
    expect(meta.date).toBe('2026-07-23');
    expect(cases).toHaveLength(2);
    expect(cases[0]).toMatchObject({
      index: 1, id: 'LOOK-01', category: 'Normal Lookup', input: 'what was my roas',
      expected_tool: 'queryDatabase', tool_called: 'queryDatabase',
      tokens_total: 1200, cost_usd: 0.004, steps: 1, accuracy_score: 100,
    });
    expect(cases[1].tokens_total).toBeNull();
    expect(cases[0].trace).toMatchObject({ queriedWorkspace: 'ws-1' });
    expect(cases[1].trace).toBeNull();
  });

  it('ignores run_start/run_end and malformed lines', () => {
    const noisy = jsonl + '\nnot json\n' + JSON.stringify({ kind: 'other' });
    expect(parseEvalJsonl(noisy).cases).toHaveLength(2);
  });

  it('carries scenario_tag so a null id can still resolve a traceable message id', () => {
    // Real runs emit id:null but always set scenario_tag (e.g. LOOK-01). The ingest
    // messageId falls id ?? scenario_tag ?? case-<index>, keeping ids joinable across arms.
    const line = JSON.stringify({
      kind: 'case', index: 7, id: null, scenario_tag: 'NAV-03', category: 'Navigation',
      model: 'm', input: 'q', output: 'a', tokens_total: 10, tokens_in: 8, tokens_out: 2,
    });
    const { cases } = parseEvalJsonl(line);
    expect(cases[0].id).toBeNull();
    expect(cases[0].scenario_tag).toBe('NAV-03');
  });
});
