import { readFileSync } from 'node:fs';
import { parse } from 'csv-parse/sync';
import type { TriageConfig } from '../config.js';
import { getLocalPool } from '../db.js';
import { insertVerdictQuery } from '../sql/localQueries.js';

export interface JudgedRow {
  run_id: string; message_id: string;
  verdict: string; category: string; severity: string; rationale: string;
}

export function parseJudgedCsv(text: string): JudgedRow[] {
  // Drop a leading '#' comment line if present (extract writes one).
  const body = text.replace(/^#[^\n]*\n/, '');
  const records: Record<string, string>[] = parse(body, { columns: true, skip_empty_lines: true });
  return records
    .filter(r => (r.verdict ?? '').trim() !== '')
    .map(r => ({
      run_id: r.run_id, message_id: r.message_id,
      verdict: r.verdict.trim(), category: (r.category ?? '').trim(),
      severity: (r.severity ?? '').trim(), rationale: (r.rationale ?? '').trim(),
    }));
}

export async function runImport(cfg: TriageConfig, csvPath: string): Promise<{ imported: number }> {
  const rows = parseJudgedCsv(readFileSync(csvPath, 'utf8'));
  const local = getLocalPool(cfg);
  try {
    for (const r of rows) {
      await local.query(insertVerdictQuery, [r.run_id, r.message_id, r.verdict, r.category, r.severity, r.rationale]);
    }
    return { imported: rows.length };
  } finally {
    await local.end();
  }
}
