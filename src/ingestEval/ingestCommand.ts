import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { TriageConfig } from '../config.js';
import { getLocalPool } from '../db.js';
import { insertRunQuery, insertEvalTurnQuery } from '../sql/localQueries.js';

export interface EvalCaseRow {
  index: number;
  id: string | null; // benchmark CSV id (e.g. LOOK-01) when present
  category: string;
  model: string;
  input: string;
  output: string;
  expected_tool: string | null;
  tool_called: string | null;
  tool_calls: unknown; // [{ name, args, kind, errorCode, rowCount }]
  steps: number | null;
  tokens_total: number | null;
  tokens_in: number | null;
  tokens_out: number | null;
  cost_usd: number | null;
  total_time_ms: number | null;
  accuracy_score: number | null;
  overall_score: number | null;
}

export interface EvalMeta {
  workspace: string;
  date: string; // YYYY-MM-DD
  models: string[];
}

/** Parse a run-eval.ts JSONL report into run metadata + case rows. Pure/testable. */
export function parseEvalJsonl(text: string): { meta: EvalMeta; cases: EvalCaseRow[] } {
  let meta: EvalMeta = { workspace: 'benchmark', date: new Date().toISOString().slice(0, 10), models: [] };
  const cases: EvalCaseRow[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue; // skip malformed lines
    }
    if (obj.kind === 'run_start') {
      meta = {
        workspace: (obj.clientId as string) || 'benchmark',
        date: typeof obj.ts === 'string' ? obj.ts.slice(0, 10) : meta.date,
        models: Array.isArray(obj.models) ? (obj.models as string[]) : [],
      };
    } else if (obj.kind === 'case') {
      cases.push({
        index: Number(obj.index),
        id: (obj.id as string) ?? null,
        category: (obj.category as string) ?? '',
        model: (obj.model as string) ?? '',
        input: (obj.input as string) ?? '',
        output: (obj.output as string) ?? '',
        expected_tool: (obj.expected_tool as string) ?? null,
        tool_called: (obj.tool_called as string) ?? null,
        tool_calls: obj.tool_calls ?? null,
        steps: obj.steps == null ? null : Number(obj.steps),
        tokens_total: obj.tokens_total == null ? null : Number(obj.tokens_total),
        tokens_in: obj.tokens_in == null ? null : Number(obj.tokens_in),
        tokens_out: obj.tokens_out == null ? null : Number(obj.tokens_out),
        cost_usd: obj.cost_usd == null ? null : Number(obj.cost_usd),
        total_time_ms: obj.total_time_ms == null ? null : Number(obj.total_time_ms),
        accuracy_score: obj.accuracy_score == null ? null : Number(obj.accuracy_score),
        overall_score: obj.overall_score == null ? null : Number(obj.overall_score),
      });
    }
  }
  return { meta, cases };
}

export async function runIngestEval(
  cfg: TriageConfig,
  jsonlPath: string
): Promise<{ runId: string; ingested: number }> {
  const { meta, cases } = parseEvalJsonl(readFileSync(jsonlPath, 'utf8'));
  const runId = randomUUID();
  const local = getLocalPool(cfg);
  try {
    await local.query(insertRunQuery, [runId, meta.workspace, meta.date, meta.date, 'eval', cases.length]);
    for (const c of cases) {
      const messageId = c.id || `case-${c.index}`; // prefer the CSV id (LOOK-01) so results trace back
      await local.query(insertEvalTurnQuery, [
        runId, messageId, c.category || 'eval', meta.date, c.input, c.output,
        c.tool_calls == null ? null : JSON.stringify(c.tool_calls),
        c.category, c.expected_tool, c.tool_called, c.tokens_total, c.tokens_in, c.tokens_out,
        c.cost_usd, c.steps, c.total_time_ms, c.accuracy_score, c.overall_score,
      ]);
    }
    return { runId, ingested: cases.length };
  } finally {
    await local.end();
  }
}
