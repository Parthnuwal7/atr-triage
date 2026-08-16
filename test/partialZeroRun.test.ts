import { describe, expect, it } from 'vitest';
import { parseEvalJsonl } from '../src/ingestEval/ingestCommand.js';

describe('zero-case partial runs', () => {
  it('preserves run metadata when execution stopped before the first case', () => {
    const input = [
      JSON.stringify({ kind: 'run_start', run_id: 'failed-before-first-case', cases: 0, planned_cases: 10, complete: false }),
      JSON.stringify({ kind: 'run_end', cases: 0, planned_cases: 10, complete: false }),
    ].join('\n');
    const parsed = parseEvalJsonl(input);
    expect(parsed.meta.ingestionStatus).toBe('partial');
    expect(parsed.meta.expectedCases).toBe(10);
    expect(parsed.cases).toHaveLength(0);
  });

  it('still rejects input with neither cases nor run metadata', () => {
    expect(() => parseEvalJsonl('')).toThrow(/no cases or run metadata/);
  });
});
