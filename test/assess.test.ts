import { describe, it, expect } from 'vitest';
import { assessTurn } from '../src/triage/assess.js';

describe('assessTurn', () => {
  it('quarantines a rig failure and does not run product checks', () => {
    const a = assessTurn({ output: 'ERROR: HTTP 500', ttfb_ms: -1, expect: { forbidPlatforms: ['amazon'] } });
    expect(a.rig.status).toBe('failed');
    expect(a.findings.map(f => f.class)).toEqual(['rig-error']);
    expect(a.blocking).toBe(true);
  });
  it('runs product checks on a valid turn and reports blocking on a scope leak', () => {
    const a = assessTurn({
      output: 'On Amazon your ROAS is 4.2x.', ttfb_ms: 100,
      expect: { scopePlatform: 'google', forbidPlatforms: ['amazon'] },
    });
    expect(a.rig.status).toBe('ok');
    expect(a.findings.some(f => f.class === 'scope-leak')).toBe(true);
    expect(a.blocking).toBe(true);
  });
  it('reports a clean turn with no findings and not blocking', () => {
    const a = assessTurn({ output: 'Your Google ROAS was 1.8x.', ttfb_ms: 100 });
    expect(a.findings).toEqual([]);
    expect(a.blocking).toBe(false);
    expect(a).toMatchObject({ outcome: 'pass', measurementEligible: true });
  });
  it('fails closed and excludes a turn from measurement when contract evidence is missing', () => {
    const a = assessTurn({
      output: 'ROAS increased last week.', ttfb_ms: 100,
      expect: { requiredEvidence: ['trace'], expectedRoute: 'analysis' },
    });
    expect(a.findings.map(f => f.class)).toContain('trace-missing');
    expect(a).toMatchObject({ outcome: 'ineligible', measurementEligible: false, blocking: true });
  });
});
