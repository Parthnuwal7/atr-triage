import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { stringify } from 'csv-stringify/sync';
import type { TriageConfig } from '../config.js';
import { getLocalPool } from '../db.js';

export const JUDGE_CSV_COLUMNS = [
  'message_id', 'category', 'expected_tool', 'tool_called', 'user_query', 'answer_text', 'tool_trace',
];

export interface JudgeInputTurn {
  message_id: string;
  category: string | null;
  expected_tool: string | null;
  tool_called: string | null;
  user_query: string | null;
  answer_text: string | null;
  tool_trace: unknown;
}

export function buildJudgeCsvRows(turns: JudgeInputTurn[]): Record<string, string>[] {
  return turns.map(t => ({
    message_id: t.message_id,
    category: t.category ?? '',
    expected_tool: t.expected_tool ?? '',
    tool_called: t.tool_called ?? '',
    user_query: t.user_query ?? '',
    answer_text: t.answer_text ?? '',
    tool_trace: t.tool_trace == null ? '' : (typeof t.tool_trace === 'string' ? t.tool_trace : JSON.stringify(t.tool_trace)),
  }));
}

export async function runJudgeCsv(
  cfg: TriageConfig,
  runId: string,
  outPath: string
): Promise<{ rows: number }> {
  const local = getLocalPool(cfg);
  try {
    const { rows } = await local.query<JudgeInputTurn>(
      `SELECT message_id, category, expected_tool, tool_called, user_query, answer_text, tool_trace
       FROM turns WHERE run_id=$1 ORDER BY message_id`,
      [runId]
    );
    const csvRows = buildJudgeCsvRows(rows);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, stringify(csvRows, { header: true, columns: JUDGE_CSV_COLUMNS }));
    return { rows: csvRows.length };
  } finally {
    await local.end();
  }
}
