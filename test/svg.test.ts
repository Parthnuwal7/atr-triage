import { describe, it, expect } from 'vitest';
import { renderDonut, renderBars } from '../src/dashboard/svg.js';

describe('renderDonut', () => {
  it('emits an svg with one arc path per non-zero segment', () => {
    const svg = renderDonut([
      { label: 'good', value: 6, color: '#2e7d32' },
      { label: 'broken', value: 2, color: '#c62828' },
    ]);
    expect(svg).toMatch(/<svg/);
    expect((svg.match(/<path/g) || []).length).toBe(2);
  });
  it('handles an all-zero input without dividing by zero', () => {
    expect(renderDonut([{ label: 'x', value: 0, color: '#000' }])).toMatch(/<svg/);
  });
});

describe('renderBars', () => {
  it('emits one rect per item', () => {
    const svg = renderBars([{ label: 'a', value: 3 }, { label: 'b', value: 1 }]);
    expect((svg.match(/<rect/g) || []).length).toBe(2);
  });
});
