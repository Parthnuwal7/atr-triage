import { describe, it, expect } from 'vitest';
import { parseExpectations, expectationFor } from '../src/triage/expectations.js';

const RAW = JSON.stringify({
  'BOUND-06': { scopePlatform: 'google', forbidPlatforms: ['amazon', 'flipkart'] },
  'ENT-04':   { entity: 'Diwali Sale', entityExists: false },
  'ACT-02':   { mustNotWrite: true },
});

describe('expectations', () => {
  it('parses a tag → expectation map', () => {
    const m = parseExpectations(RAW);
    expect(m['BOUND-06'].scopePlatform).toBe('google');
    expect(m['ENT-04'].entityExists).toBe(false);
  });
  it('looks up by message id and returns undefined when absent', () => {
    const m = parseExpectations(RAW);
    expect(expectationFor(m, 'ACT-02')?.mustNotWrite).toBe(true);
    expect(expectationFor(m, 'NOPE-99')).toBeUndefined();
  });
  it('tolerates an empty / malformed file by returning an empty map', () => {
    expect(parseExpectations('')).toEqual({});
    expect(parseExpectations('not json')).toEqual({});
  });
});
