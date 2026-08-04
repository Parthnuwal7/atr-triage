import { describe, it, expect } from 'vitest';
import { renderDonut, renderBars, renderRadar, renderDivergingBars, renderGroupedBars } from '../src/dashboard/svg.js';

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

describe('renderRadar', () => {
  const axes = [
    { axis: 'Pass', a: 80, b: 90 },
    { axis: 'Speed', a: 60, b: 100 },
    { axis: 'Cost', a: 100, b: 70 },
  ];
  it('draws two overlaid series polygons plus grid rings', () => {
    const svg = renderRadar(axes);
    expect(svg).toMatch(/<svg/);
    // 2 series polygons + 4 ring polygons
    expect((svg.match(/<polygon/g) || []).length).toBe(6);
    expect(svg).toContain('Pass');
  });
  it('escapes axis labels', () => {
    expect(renderRadar([{ axis: '<x>', a: 1, b: 2 }])).toContain('&lt;x&gt;');
  });
});

describe('renderDivergingBars', () => {
  it('emits one bar per item and a zero axis line', () => {
    const svg = renderDivergingBars([{ label: 'up', value: 10 }, { label: 'down', value: -20 }]);
    expect((svg.match(/<rect/g) || []).length).toBe(2);
    expect(svg).toMatch(/<line/);
    expect(svg).toContain('+10pp');
    expect(svg).toContain('-20pp');
  });
  it('degrades to an empty svg with no items', () => {
    expect(renderDivergingBars([])).toMatch(/<svg/);
  });
});

describe('renderGroupedBars', () => {
  it('emits two bars per group (A solid, B half-opacity)', () => {
    const svg = renderGroupedBars([
      { label: 'pass', a: 5, b: 8, color: '#2e7d32' },
      { label: 'fail', a: 3, b: 1, color: '#c62828' },
    ]);
    expect((svg.match(/<rect/g) || []).length).toBe(4 + 2); // 2 groups × (A+B) + 2 legend swatches
    expect(svg).toContain('fill-opacity="0.5"');
  });
});
