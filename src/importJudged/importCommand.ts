import { readFileSync, existsSync } from 'node:fs';
import { parse } from 'csv-parse/sync';
import type { TriageConfig } from '../config.js';
import { getLocalPool } from '../db.js';
import { insertVerdictQuery } from '../sql/localQueries.js';
import { siblingInsightsPath, runImportInsights } from './importInsights.js';

export interface JudgedRow {
  run_id: string; message_id: string;
  verdict: string; category: string; severity: string; rationale: string;
}

/**
 * Accepts either the full extract CSV with verdict columns filled, OR a compact
 * judgments table (`message_id,verdict,category,severity,rationale` — no run_id).
 * For the compact form, pass `defaultRunId` so every row is attributed to that run.
 * Only rows with a non-empty verdict AND a resolvable run_id are kept.
 */
export function parseJudgedCsv(text: string, defaultRunId?: string): JudgedRow[] {
  // Drop a leading '#' comment line if present (extract writes one).
  const body = text.replace(/^#[^\n]*\n/, '');
  const records: Record<string, string>[] = parse(body, { columns: true, skip_empty_lines: true });
  return records
    .filter(r => (r.verdict ?? '').trim() !== '')
    .map(r => ({
      run_id: (r.run_id ?? '').trim() || defaultRunId || '',
      message_id: (r.message_id ?? '').trim(),
      verdict: r.verdict.trim(), category: (r.category ?? '').trim(),
      severity: (r.severity ?? '').trim(), rationale: (r.rationale ?? '').trim(),
    }))
    .filter(r => r.run_id !== '' && r.message_id !== '');
}

export async function runImport(
  cfg: TriageConfig,
  csvPath: string,
  defaultRunId?: string
): Promise<{ imported: number; insightsChars?: number }> {
  const rows = parseJudgedCsv(readFileSync(csvPath, 'utf8'), defaultRunId);
  const local = getLocalPool(cfg);
  try {
    for (const r of rows) {
      await local.query(insertVerdictQuery, [r.run_id, r.message_id, r.verdict, r.category, r.severity, r.rationale]);
    }
  } finally {
    await local.end();
  }
  // Auto-attach the sibling insights.md (Cursor writes it next to the judged CSV) when present.
  let insightsChars: number | undefined;
  const runId = defaultRunId ?? rows[0]?.run_id;
  const sib = siblingInsightsPath(csvPath);
  if (runId && sib && existsSync(sib)) {
    insightsChars = (await runImportInsights(cfg, runId, sib)).chars;
  }
  return { imported: rows.length, insightsChars };
}
