import { describe, it, expect } from 'vitest';
import { computeGate } from '../src/dashboard/analysis.js';

describe('computeGate', () => {
  const rows = [
    { class: 'cross-tenant', layer: 'auth', severity: 'p0', blocking: true, count: 1 },
    { class: 'over-clarify', layer: 'router', severity: 'med', blocking: false, count: 22 },
    { class: 'api-failure', layer: 'infra', severity: 'high', blocking: false, count: 13 },
  ];

  it('is RED when any blocking finding exists', () => {
    const g = computeGate(rows, true);
    expect(g.status).toBe('red');
    expect(g.total).toBe(36);
    expect(g.blocking).toBe(1);
    expect(g.byClass[0]).toMatchObject({ label: 'over-clarify', value: 22, blocking: false });
    expect(g.byClass.find(c => c.label === 'cross-tenant')?.blocking).toBe(true);
  });

  it('is GREEN when asserted with only non-blocking findings', () => {
    const g = computeGate(rows.filter(r => !r.blocking), true);
    expect(g.status).toBe('green');
    expect(g.blocking).toBe(0);
    expect(g.total).toBe(35);
  });

  it('is GREEN when asserted and totally clean', () => {
    expect(computeGate([], true).status).toBe('green');
  });

  it('is NONE when the run was never asserted', () => {
    expect(computeGate([], false).status).toBe('none');
  });
});
