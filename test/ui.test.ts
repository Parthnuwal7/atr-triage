import { describe, it, expect } from 'vitest';
import { matchRoute, toRunSummary } from '../src/ui/handlers.js';
import { renderPage } from '../src/ui/page.js';

describe('matchRoute', () => {
  it('maps the core routes and rejects unknowns', () => {
    expect(matchRoute('GET', '/')).toBe('page');
    expect(matchRoute('GET', '/api/runs')).toBe('runs');
    expect(matchRoute('POST', '/api/ingest')).toBe('ingest');
    expect(matchRoute('POST', '/api/assert')).toBe('assert');
    expect(matchRoute('POST', '/api/judge-csv')).toBe('judge');
    expect(matchRoute('POST', '/api/import')).toBe('import');
    expect(matchRoute('POST', '/api/insights')).toBe('insights');
    expect(matchRoute('POST', '/api/dashboard')).toBe('dashboard');
    expect(matchRoute('GET', '/api/golden')).toBe('goldenList');
    expect(matchRoute('POST', '/api/golden')).toBe('goldenAdd');
    expect(matchRoute('GET', '/dashboards/slice15.html')).toBe('dashboardFile');
    expect(matchRoute('GET', '/nope')).toBeNull();
    expect(matchRoute('DELETE', '/api/runs')).toBeNull();
  });
});

describe('toRunSummary', () => {
  const base = { run_id: 'r1', workspace: 'ws', from_date: '2026-08-04', to_date: '2026-08-04', mode: 'eval' };
  it('derives a RED gate when blocking findings exist', () => {
    const s = toRunSummary({ ...base, turn_count: 15, finding_count: 3, blocking_count: 1 });
    expect(s).toMatchObject({ runId: 'r1', workspace: 'ws', mode: 'eval', turns: 15, findings: 3, blocking: 1, gate: 'red' });
  });
  it('is GREEN with findings but no blocking, and NONE when unasserted', () => {
    expect(toRunSummary({ ...base, turn_count: 5, finding_count: 2, blocking_count: 0 }).gate).toBe('green');
    expect(toRunSummary({ ...base, turn_count: 5, finding_count: 0, blocking_count: 0 }).gate).toBe('none');
    expect(toRunSummary({ ...base, turn_count: 5, finding_count: 0, blocking_count: 0, asserted_count: 5 }).gate).toBe('green');
  });
  it('coerces string counts (pg bigint) to numbers', () => {
    const s = toRunSummary({ ...base, turn_count: '7', finding_count: '0', blocking_count: '0' });
    expect(s.turns).toBe(7);
    expect(typeof s.turns).toBe('number');
  });
});

describe('renderPage', () => {
  it('returns a self-contained HTML page with the run list + actions', () => {
    const html = renderPage();
    expect(html).toMatch(/<!doctype html>/i);
    expect(html).toContain('id="runs"');
    expect(html).toContain('/api/runs');
    expect(html).toContain('/api/assert');
    expect(html).not.toMatch(/https?:\/\//); // no external assets
  });
});
