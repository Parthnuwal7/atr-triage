import { describe, it, expect } from 'vitest';
import { renderDashboardHtml } from '../src/dashboard/renderHtml.js';
import type { AnalysisModel } from '../src/dashboard/analysis.js';

const model: AnalysisModel = {
  runId: 'r1', workspace: 'ws1', fromDate: '2026-07-01', toDate: '2026-07-07',
  total: 8, downvotes: 2,
  verdictSplit: [{ label: 'good', value: 6, color: '#2e7d32' }, { label: 'broken', value: 2, color: '#c62828' }],
  byCategory: [{ label: 'hallucination', value: 2 }],
  bySignal: [{ label: 'downvote', value: 2 }],
  byTool: [{ label: 'queryDatabase', value: 5 }],
  brokenTurns: [{ message_id: 'a1', user_query: 'q1', answer_text: 'wrong', category: 'hallucination', rationale: 'made up' }],
};

describe('renderDashboardHtml', () => {
  it('is a self-contained HTML doc with no external references', () => {
    const html = renderDashboardHtml(model);
    expect(html).toMatch(/<!doctype html>/i);
    expect(html).not.toMatch(/https?:\/\//); // no external assets
    expect(html).toContain('ws1');
    expect(html).toContain('hallucination');
    expect(html).toContain('queryDatabase');
    expect(html).toContain('made up'); // broken-turn rationale rendered
  });
  it('escapes HTML in turn text', () => {
    const evil = { ...model, brokenTurns: [{ message_id: 'a1', user_query: '<script>x</script>', answer_text: '', category: '', rationale: '' }] };
    expect(renderDashboardHtml(evil)).not.toContain('<script>x</script>');
  });
});
