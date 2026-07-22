export const NOT_POINT_IN_TIME_NOTE =
  'NOTE: memory shown is CURRENT, not as it was at answer time.';

export function formatMemory(rows: Array<{ key?: string; value?: string }>): string {
  return rows
    .map(r => (r.key ? `${r.key}: ${r.value ?? ''}` : `${r.value ?? ''}`))
    .filter(Boolean)
    .join('\n');
}
