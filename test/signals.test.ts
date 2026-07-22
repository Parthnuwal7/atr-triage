import { describe, it, expect } from 'vitest';
import { computeSignals, isDataLookingQuery, isRefusal } from '../src/extract/signals.js';
import type { Turn } from '../src/types.js';

const base: Turn = {
  chatId: 'c1', userMessageId: 'u1', assistantMessageId: 'a1', createdAt: '2026-07-01T10:00:05Z',
  userQuery: 'what was my roas last week?', enrichedQuery: null, answerText: 'Your ROAS was 3.2',
  footerLatencyMs: 2000, toolTrace: [{ toolName: 'queryDatabase', kind: 'ok', errorCode: null, rowCount: 5 }],
  downvoted: false,
};

describe('isDataLookingQuery', () => {
  it('flags metric/data questions', () => {
    expect(isDataLookingQuery('what was my roas last week')).toBe(true);
    expect(isDataLookingQuery('show spend by campaign')).toBe(true);
  });
  it('does not flag navigation/greeting/meta', () => {
    expect(isDataLookingQuery('how do I create a campaign')).toBe(false);
    expect(isDataLookingQuery('hello')).toBe(false);
  });
});

describe('isRefusal', () => {
  it('detects refusal/empty answers', () => {
    expect(isRefusal("I can't help with that")).toBe(true);
    expect(isRefusal('No data available for this period')).toBe(true);
    expect(isRefusal('')).toBe(true);
  });
  it('passes a normal answer', () => {
    expect(isRefusal('Your ROAS was 3.2')).toBe(false);
  });
});

describe('computeSignals', () => {
  const opts = { latencyOutlierMs: 15000 };
  it('all-clear for a healthy data turn', () => {
    expect(computeSignals(base, opts)).toEqual({
      noToolCall: false, toolError: false, emptyOrRefusal: false, noResponse: false, latencyOutlier: false,
    });
  });
  it('flags no-response when assistant is missing', () => {
    const t: Turn = { ...base, assistantMessageId: null, answerText: '', toolTrace: null };
    expect(computeSignals(t, opts).noResponse).toBe(true);
  });
  it('flags tool-error from the trace', () => {
    const t: Turn = { ...base, toolTrace: [{ toolName: 'queryDatabase', kind: 'error', errorCode: 'E', rowCount: null }] };
    expect(computeSignals(t, opts).toolError).toBe(true);
  });
  it("flags tool-error for atr-be's real kind values", () => {
    const execErr: Turn = { ...base, toolTrace: [{ toolName: 'queryDatabase', kind: 'execution_error', errorCode: 'E_TOOL', rowCount: null }] };
    expect(computeSignals(execErr, opts).toolError).toBe(true);
    const policy: Turn = { ...base, toolTrace: [{ toolName: 'queryDatabase', kind: 'policy_rejection', errorCode: 'POLICY', rowCount: null }] };
    expect(computeSignals(policy, opts).toolError).toBe(true);
  });
  it('flags no-tool-call only for data queries with a trace showing no calls', () => {
    const dataNoTool: Turn = { ...base, toolTrace: [] };
    expect(computeSignals(dataNoTool, opts).noToolCall).toBe(true);
    const navNoTool: Turn = { ...base, userQuery: 'how do I create a campaign', toolTrace: [] };
    expect(computeSignals(navNoTool, opts).noToolCall).toBe(false);
  });
  it('does NOT assert no-tool-call for historical turns (trace null)', () => {
    const historical: Turn = { ...base, toolTrace: null };
    expect(computeSignals(historical, opts).noToolCall).toBe(false);
  });
  it('flags latency outliers', () => {
    expect(computeSignals({ ...base, footerLatencyMs: 20000 }, opts).latencyOutlier).toBe(true);
  });
});
