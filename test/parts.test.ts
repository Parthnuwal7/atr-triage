import { describe, it, expect } from 'vitest';
import { partsAdapter } from '../src/extract/parts.js';

describe('parts.answerText', () => {
  it('concatenates text parts', () => {
    const parts = [{ type: 'text', text: 'Your ROAS was 3.2' }, { type: 'plan', tasks: [] }];
    expect(partsAdapter.answerText(parts)).toBe('Your ROAS was 3.2');
  });
  it('returns empty string for non-array/malformed parts', () => {
    expect(partsAdapter.answerText(null)).toBe('');
    expect(partsAdapter.answerText({})).toBe('');
  });
});

describe('parts.footerLatencyMs', () => {
  it('parses seconds from the metrics footer into ms', () => {
    const parts = [{ type: 'text', text: 'Answer.\n\n---\n*⚙️ normal · 3.2s · 1,000 tokens*' }];
    expect(partsAdapter.footerLatencyMs(parts)).toBe(3200);
  });
  it('returns null when no footer present', () => {
    expect(partsAdapter.footerLatencyMs([{ type: 'text', text: 'no footer' }])).toBeNull();
  });
});

describe('parts.toolTrace', () => {
  it('extracts a tool-trace part when present', () => {
    const parts = [
      { type: 'text', text: 'ok' },
      { type: 'tool-trace', calls: [{ toolName: 'queryDatabase', kind: 'ok', errorCode: null, rowCount: 42 }] },
    ];
    expect(partsAdapter.toolTrace(parts)).toEqual([
      { toolName: 'queryDatabase', kind: 'ok', errorCode: null, rowCount: 42 },
    ]);
  });
  it('returns null when no tool-trace part exists (historical turn)', () => {
    expect(partsAdapter.toolTrace([{ type: 'text', text: 'ok' }])).toBeNull();
  });
});
