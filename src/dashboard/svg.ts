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
