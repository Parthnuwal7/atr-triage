function esc(s: string): string {
  return s.replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]!));
}

export function renderDonut(segments: Array<{ label: string; value: number; color: string }>): string {
  const total = segments.reduce((a, s) => a + s.value, 0);
  const r = 60, cx = 80, cy = 80, C = 2 * Math.PI * r;
  let offset = 0;
  const arcs = segments
    .filter(s => s.value > 0)
    .map(s => {
      const frac = total > 0 ? s.value / total : 0;
      const len = frac * C;
      const path = `<path d="M ${cx} ${cy - r} A ${r} ${r} 0 ${frac > 0.5 ? 1 : 0} 1 ${cx + r * Math.sin(2 * Math.PI * frac)} ${cy - r * Math.cos(2 * Math.PI * frac)}" fill="none" stroke="${s.color}" stroke-width="24" transform="rotate(${(offset / C) * 360} ${cx} ${cy})"/>`;
      offset += len;
      return path;
    })
    .join('');
  return `<svg width="160" height="160" viewBox="0 0 160 160" role="img">${arcs}</svg>`;
}

/**
 * Overlaid radar ("spider") of two series on 0–100 axes. Series A and B each draw a
 * polygon; higher-is-better on every axis. Pure inline SVG, no chart library.
 */
export function renderRadar(
  axes: Array<{ axis: string; a: number; b: number }>,
  opts: { aColor?: string; bColor?: string; aLabel?: string; bLabel?: string } = {}
): string {
  const aColor = opts.aColor ?? '#1565c0';
  const bColor = opts.bColor ?? '#c62828';
  const size = 340, cx = 170, cy = 160, R = 108;
  const n = Math.max(1, axes.length);
  const at = (i: number, frac: number): [number, number] => {
    const ang = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    return [cx + frac * R * Math.cos(ang), cy + frac * R * Math.sin(ang)];
  };
  const rings = [0.25, 0.5, 0.75, 1]
    .map(r => {
      const pts = axes.map((_, i) => at(i, r).map(v => v.toFixed(1)).join(',')).join(' ');
      return `<polygon points="${pts}" fill="none" stroke="#e0e0e0" stroke-width="1"/>`;
    })
    .join('');
  const spokes = axes
    .map((_, i) => {
      const [x, y] = at(i, 1);
      return `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="#e8e8e8" stroke-width="1"/>`;
    })
    .join('');
  const labels = axes
    .map((ax, i) => {
      const [x, y] = at(i, 1.16);
      const c = Math.cos(-Math.PI / 2 + (i * 2 * Math.PI) / n);
      const anchor = c > 0.3 ? 'start' : c < -0.3 ? 'end' : 'middle';
      return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-size="10" text-anchor="${anchor}" dominant-baseline="middle" fill="#555">${esc(ax.axis)}</text>`;
    })
    .join('');
  const poly = (key: 'a' | 'b', color: string) => {
    const pts = axes.map((ax, i) => at(i, Math.max(0, Math.min(100, ax[key])) / 100).map(v => v.toFixed(1)).join(',')).join(' ');
    return `<polygon points="${pts}" fill="${color}" fill-opacity="0.14" stroke="${color}" stroke-width="2"/>`;
  };
  const legend =
    `<g font-size="11">` +
    `<rect x="8" y="${size - 18}" width="10" height="10" fill="${aColor}" fill-opacity="0.5" stroke="${aColor}"/>` +
    `<text x="22" y="${size - 9}" fill="#333">${esc(opts.aLabel ?? 'A (baseline)')}</text>` +
    `<rect x="150" y="${size - 18}" width="10" height="10" fill="${bColor}" fill-opacity="0.5" stroke="${bColor}"/>` +
    `<text x="164" y="${size - 9}" fill="#333">${esc(opts.bLabel ?? 'B (candidate)')}</text>` +
    `</g>`;
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img">${rings}${spokes}${labels}${poly('a', aColor)}${poly('b', bColor)}${legend}</svg>`;
}

/**
 * Diverging horizontal bars around a centre zero line: positive (improvement) grows
 * right in green, negative (regression) grows left in red. Values in percentage points.
 */
export function renderDivergingBars(items: Array<{ label: string; value: number }>): string {
  if (!items.length) return '<svg width="10" height="10" viewBox="0 0 10 10" role="img"></svg>';
  const barH = 16, gap = 5, labelW = 190, half = 150, pad = 44;
  const w = labelW + half * 2 + pad;
  const maxAbs = Math.max(1, ...items.map(i => Math.abs(i.value)));
  const zeroX = labelW + half;
  const rows = items
    .map((it, i) => {
      const y = i * (barH + gap);
      const len = Math.round((half * Math.abs(it.value)) / maxAbs);
      const pos = it.value >= 0;
      const x = pos ? zeroX : zeroX - len;
      const color = it.value > 0 ? '#2e7d32' : it.value < 0 ? '#c62828' : '#9e9e9e';
      const valX = pos ? zeroX + len + 4 : zeroX - len - 4;
      const valAnchor = pos ? 'start' : 'end';
      const sign = it.value > 0 ? '+' : '';
      return (
        `<text x="0" y="${y + 12}" font-size="11" fill="#333">${esc(it.label)}</text>` +
        `<rect x="${x}" y="${y}" width="${Math.max(1, len)}" height="${barH}" fill="${color}"/>` +
        `<text x="${valX}" y="${y + 12}" font-size="10" text-anchor="${valAnchor}" fill="#555">${sign}${it.value}pp</text>`
      );
    })
    .join('');
  const height = items.length * (barH + gap);
  const axis = `<line x1="${zeroX}" y1="0" x2="${zeroX}" y2="${height}" stroke="#bbb" stroke-width="1"/>`;
  return `<svg width="${w}" height="${height}" viewBox="0 0 ${w} ${height}" role="img">${axis}${rows}</svg>`;
}

/**
 * Grouped bars — one cluster per group, two bars (A vs B) side by side. A is drawn
 * solid, B at half opacity, so the same colour keys the metric while opacity keys the arm.
 */
export function renderGroupedBars(
  groups: Array<{ label: string; a: number; b: number; color?: string }>,
  opts: { aLabel?: string; bLabel?: string } = {}
): string {
  if (!groups.length) return '<svg width="10" height="10" viewBox="0 0 10 10" role="img"></svg>';
  const groupW = 88, barW = 30, top = 8, chartH = 150, base = top + chartH, labelH = 20, legendH = 20;
  const w = groups.length * groupW + 20;
  const height = base + labelH + legendH;
  const max = Math.max(1, ...groups.flatMap(g => [g.a, g.b]));
  const cells = groups
    .map((g, i) => {
      const gx = 10 + i * groupW;
      const color = g.color ?? '#1565c0';
      const hA = Math.round((chartH * g.a) / max);
      const hB = Math.round((chartH * g.b) / max);
      const xA = gx + (groupW / 2 - barW - 3);
      const xB = gx + groupW / 2 + 3;
      return (
        `<rect x="${xA}" y="${base - hA}" width="${barW}" height="${hA}" fill="${color}"/>` +
        `<text x="${xA + barW / 2}" y="${base - hA - 3}" font-size="10" text-anchor="middle" fill="#555">${g.a}</text>` +
        `<rect x="${xB}" y="${base - hB}" width="${barW}" height="${hB}" fill="${color}" fill-opacity="0.5"/>` +
        `<text x="${xB + barW / 2}" y="${base - hB - 3}" font-size="10" text-anchor="middle" fill="#555">${g.b}</text>` +
        `<text x="${gx + groupW / 2}" y="${base + 14}" font-size="11" text-anchor="middle" fill="#333">${esc(g.label)}</text>`
      );
    })
    .join('');
  const ly = base + labelH + 10;
  const legend =
    `<g font-size="11">` +
    `<rect x="10" y="${ly - 9}" width="10" height="10" fill="#666"/>` +
    `<text x="24" y="${ly}" fill="#333">${esc(opts.aLabel ?? 'A')}</text>` +
    `<rect x="90" y="${ly - 9}" width="10" height="10" fill="#666" fill-opacity="0.5"/>` +
    `<text x="104" y="${ly}" fill="#333">${esc(opts.bLabel ?? 'B')}</text>` +
    `</g>`;
  const axis = `<line x1="10" y1="${base}" x2="${w - 10}" y2="${base}" stroke="#ccc" stroke-width="1"/>`;
  return `<svg width="${w}" height="${height}" viewBox="0 0 ${w} ${height}" role="img">${axis}${cells}${legend}</svg>`;
}

export function renderBars(items: Array<{ label: string; value: number }>, color = '#1565c0'): string {
  const max = Math.max(1, ...items.map(i => i.value));
  const barH = 22, gap = 8, w = 320, labelW = 140;
  const rows = items
    .map((it, i) => {
      const y = i * (barH + gap);
      const barW = Math.round(((w - labelW - 40) * it.value) / max);
      return `<text x="0" y="${y + 15}" font-size="12">${esc(it.label)}</text>` +
        `<rect x="${labelW}" y="${y}" width="${barW}" height="${barH}" fill="${color}"/>` +
        `<text x="${labelW + barW + 4}" y="${y + 15}" font-size="12">${it.value}</text>`;
    })
    .join('');
  const height = items.length * (barH + gap);
  return `<svg width="${w}" height="${height}" viewBox="0 0 ${w} ${height}" role="img">${rows}</svg>`;
}
