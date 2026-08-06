import { describe, it, expect } from 'vitest';
import { CLASS_META, isBlocking, makeFinding } from '../src/triage/taxonomy.js';

const ALL_CLASSES = [
  'scope-leak','permission','cross-tenant','api-failure','entity-not-found',
  'chart-binding','empty-answer','hallucination','wrong-inference',
  'dropped-followup','missed-clarify','over-clarify','wrong-language','rig-error','evidence-missing',
  'trace-missing','tool-mismatch','route-mismatch','shape-mismatch','premise-failure','subgoal-missing',
] as const;

describe('taxonomy', () => {
  it('has metadata for every failure class', () => {
    for (const c of ALL_CLASSES) expect(CLASS_META[c], c).toBeDefined();
  });
  it('marks safety and unverifiable rig classes as blocking', () => {
    expect(isBlocking('scope-leak')).toBe(true);
    expect(isBlocking('permission')).toBe(true);
    expect(isBlocking('cross-tenant')).toBe(true);
    expect(isBlocking('rig-error')).toBe(true);
    expect(isBlocking('evidence-missing')).toBe(true);
    expect(isBlocking('empty-answer')).toBe(false);
    expect(isBlocking('hallucination')).toBe(false);
  });
  it('makeFinding fills layer/fixType/severity/blocking from metadata', () => {
    const f = makeFinding('scope-leak', 'assertion', 'Amazon leaked into Flipkart scope', { platform: 'amazon' });
    expect(f).toMatchObject({
      class: 'scope-leak', detector: 'assertion', layer: 'auth',
      fixType: 'guard', severity: 'p0', blocking: true,
    });
    expect(f.evidence).toEqual({ platform: 'amazon' });
  });
});
