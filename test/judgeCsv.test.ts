import { describe, it, expect } from 'vitest';
import { buildJudgeCsvRows, JUDGE_CSV_COLUMNS } from '../src/judgeCsv/judgeCsvCommand.js';

describe('buildJudgeCsvRows', () => {
  it('emits judge-input columns with tool trace serialized', () => {
    const rows = buildJudgeCsvRows([
      {
        message_id: 'case-1', category: 'Normal Lookup', expected_tool: 'queryDatabase',
        tool_called: 'queryDatabase', user_query: 'roas?', answer_text: 'ROAS 3.2',
        tool_trace: [{ name: 'queryDatabase', kind: 'success', rowCount: 5 }],
      },
    ]);
    expect(rows).toHaveLength(1);
    for (const c of JUDGE_CSV_COLUMNS) expect(rows[0]).toHaveProperty(c);
    expect(rows[0].message_id).toBe('case-1');
    expect(rows[0].expected_tool).toBe('queryDatabase');
    expect(JSON.parse(rows[0].tool_trace)).toEqual([{ name: 'queryDatabase', kind: 'success', rowCount: 5 }]);
  });

  it('handles null tool_trace as empty string', () => {
    const rows = buildJudgeCsvRows([
      { message_id: 'case-2', category: 'Nav', expected_tool: null, tool_called: null, user_query: 'q', answer_text: 'a', tool_trace: null },
    ]);
    expect(rows[0].tool_trace).toBe('');
  });
});
