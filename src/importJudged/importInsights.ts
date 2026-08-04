/**
 * Store a run's insights.md (the judge's human-facing debugging report) against the run, so the
 * dashboard can render it. The judged.csv is imported by importCommand; this is its sibling.
 */
import { readFileSync } from 'node:fs';
import type { TriageConfig } from '../config.js';
import { getLocalPool } from '../db.js';
import { upsertRunInsightsQuery } from '../sql/localQueries.js';

/**
 * Derive the insights.md path that sits beside a judged CSV. Cursor writes `<input>.insights.md`
 * next to `<input>.judged.csv`, so `reports/x.judged.csv` → `reports/x.insights.md`. Pure. Returns
 * null when the path isn't a CSV.
 */
export function siblingInsightsPath(csvPath: string): string | null {
  if (/\.judged\.csv$/i.test(csvPath)) return csvPath.replace(/\.judged\.csv$/i, '.insights.md');
  if (/\.judge\.csv$/i.test(csvPath)) return csvPath.replace(/\.judge\.csv$/i, '.insights.md');
  if (/\.csv$/i.test(csvPath)) return csvPath.replace(/\.csv$/i, '.insights.md');
  return null;
}

/** Read an insights.md and store it on the run. Returns the character count stored. */
export async function runImportInsights(
  cfg: TriageConfig,
  runId: string,
  filePath: string
): Promise<{ chars: number }> {
  const md = readFileSync(filePath, 'utf8');
  const local = getLocalPool(cfg);
  try {
    await local.query(upsertRunInsightsQuery, [runId, md]);
    return { chars: md.length };
  } finally {
    await local.end();
  }
}
