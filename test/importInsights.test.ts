import { describe, it, expect } from 'vitest';
import { siblingInsightsPath } from '../src/importJudged/importInsights.js';

describe('siblingInsightsPath', () => {
  it('derives the insights path from a .judged.csv', () => {
    expect(siblingInsightsPath('reports/noharness.judged.csv')).toBe('reports/noharness.insights.md');
  });
  it('derives from a .judge.csv too', () => {
    expect(siblingInsightsPath('reports/foo.judge.csv')).toBe('reports/foo.insights.md');
  });
  it('falls back to swapping any .csv extension', () => {
    expect(siblingInsightsPath('reports/bar.csv')).toBe('reports/bar.insights.md');
  });
  it('returns null for a non-csv path', () => {
    expect(siblingInsightsPath('reports/bar.txt')).toBeNull();
  });
});
