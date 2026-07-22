import { describe, it, expect } from 'vitest';
import { toBenchmarkFixture } from '../src/golden/goldenCommand.js';

describe('toBenchmarkFixture', () => {
  it('emits the prompts[] shape atr-be materialize expects, with stable ids', () => {
    const out = toBenchmarkFixture([
      { query: 'roas last week', category: 'Normal Lookup', expected_behavior: 'calls queryDatabase' },
      { query: 'is this good?', category: 'Baseline-Is-this-good', expected_behavior: 'contextualizes' },
    ]) as any;
    expect(out.prompts).toHaveLength(2);
    expect(out.prompts[0]).toMatchObject({ id: 'GOLDEN-001', query: 'roas last week', category: 'Normal Lookup' });
    expect(out.prompts[1].id).toBe('GOLDEN-002');
  });
});
