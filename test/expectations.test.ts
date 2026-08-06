import { describe, it, expect } from 'vitest';
import { expectationMetadata, parseExpectations, expectationFor } from '../src/triage/expectations.js';

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
  it('fails closed on malformed or structurally invalid policy', () => {
    expect(() => parseExpectations('')).toThrow(/invalid expectations JSON/);
    expect(() => parseExpectations('not json')).toThrow(/invalid expectations JSON/);
    expect(() => parseExpectations('[]')).toThrow(/must be an object/);
    expect(() => parseExpectations('{"A":{"unexpected":true}}')).toThrow(/unknown expectation field/);
  });
  it('loads a versioned paired-rollout contract and exposes its provenance', () => {
    const map = parseExpectations(JSON.stringify({
      schemaVersion: 1,
      contractVersion: 'fixture-2026-08-06',
      cases: {
        'FALSE-01': {
          requiredEvidence: ['trace', 'tools'], expectedTool: 'queryData',
          expectedRoute: 'analysis', premisePolicy: 'verify',
          requiredSubgoals: ['verify-trend'], chart: 'data-backed',
        },
      },
    }));
    expect(expectationMetadata(map)).toEqual({
      schemaVersion: 1, contractVersion: 'fixture-2026-08-06',
    });
    expect(expectationFor(map, 'FALSE-01::model-a')?.expectedRoute).toBe('analysis');
  });
});
