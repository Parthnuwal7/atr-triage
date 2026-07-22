import { describe, it, expect } from 'vitest';
import { buildCsvRows, CSV_COLUMNS } from '../src/extract/extractCommand.js';
import type { Turn, Signals, MemoryContext } from '../src/types.js';

const turn: Turn = {
  chatId: 'c1', userMessageId: 'u1', assistantMessageId: 'a1', createdAt: '2026-07-01T10:00:05Z',
  userQuery: 'roas last week?', enrichedQuery: null, answerText: 'ROAS was 3.2',
  footerLatencyMs: 2000, toolTrace: [{ toolName: 'queryDatabase', kind: 'ok', errorCode: null, rowCount: 5 }],
  downvoted: true,
};
const signals: Signals = { noToolCall: false, toolError: false, emptyOrRefusal: false, noResponse: false, latencyOutlier: false };
const mem: MemoryContext = { workspaceMemory: 'currency: INR', userPreferences: '', conversationMemory: '' };

describe('buildCsvRows', () => {
  it('produces one row per turn with all columns present and empty verdict fields', () => {
    const rows = buildCsvRows([turn], new Map([['a1', signals]]), new Map([['c1', mem]]));
    expect(rows).toHaveLength(1);
    const r = rows[0];
    for (const col of CSV_COLUMNS) expect(r).toHaveProperty(col);
    expect(r.user_query).toBe('roas last week?');
    expect(r.downvoted).toBe('true');
    expect(r.workspace_memory).toBe('currency: INR');
    expect(r.verdict).toBe('');
  });

  it('serializes tool_trace as JSON', () => {
    const rows = buildCsvRows([turn], new Map([['a1', signals]]), new Map([['c1', mem]]));
    expect(JSON.parse(rows[0].tool_trace)).toEqual(turn.toolTrace);
  });
});
