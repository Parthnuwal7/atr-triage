import type { LocalDb } from '../db.js';

export interface AnalysisModel {
  runId: string;
  workspace: string;
  fromDate: string;
  toDate: string;
  total: number;
  verdictSplit: Array<{ label: string; value: number; color: string }>;
  downvotes: number;
  byCategory: Array<{ label: string; value: number }>;
  bySignal: Array<{ label: string; value: number }>;
  byTool: Array<{ label: string; value: number }>;
  turns: TurnDetail[];
  evalMetrics?: EvalMetrics; // present only for benchmark/eval runs
}

// Mirror of scoring.ts's core tool aliases so dashboard correctness matches the runner.
const TOOL_ALIASES: Record<string, string[]> = {
  queryDatabase: ['queryData', 'executeCardQuery', 'queryDatabase', 'exportDataExcel'],
  queryData: ['queryData', 'executeCardQuery', 'queryDatabase', 'exportDataExcel'],
  executeCardQuery: ['queryData', 'executeCardQuery', 'queryDatabase', 'exportDataExcel'],
  getNavigationPath: ['getNavigationPath', 'getSystemFeatures'],
  getSystemFeatures: ['getSystemFeatures', 'getNavigationPath'],
};

function toolMatches(expected: string | null, called: string | null): boolean {
  if (!expected) return true;
  if (!called) return false;
  return expected === called || (TOOL_ALIASES[expected]?.includes(called) ?? false);
}

function mean(nums: Array<number | null>): number | null {
  const v = nums.filter((n): n is number => n != null);
  return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 100) / 100 : null;
}

function computeEvalMetrics(turns: TurnDetail[]): EvalMetrics | undefined {
  const isEval = turns.some(t => t.expected_tool != null || t.tokens_total != null || t.accuracy_score != null);
  if (!isEval) return undefined;
  const withExpected = turns.filter(t => t.expected_tool != null);
  const cats = new Map<string, TurnDetail[]>();
  for (const t of turns) {
    const c = t.eval_category || '(none)';
    (cats.get(c) ?? cats.set(c, []).get(c)!).push(t);
  }
  const byCategory = [...cats.entries()]
    .map(([category, ts]) => ({
      category,
      total: ts.length,
      broken: ts.filter(t => t.verdict === 'broken').length,
      needsWork: ts.filter(t => t.verdict === 'needs-work').length,
      good: ts.filter(t => t.verdict === 'good').length,
      avgAccuracy: mean(ts.map(t => t.accuracy_score)),
    }))
    .sort((a, b) => b.broken - a.broken || b.total - a.total);
  const costs = turns.map(t => t.cost_usd).filter((n): n is number => n != null);
  return {
    toolTotal: withExpected.length,
    toolCorrect: withExpected.filter(t => toolMatches(t.expected_tool, t.tool_called)).length,
    avgTokens: mean(turns.map(t => t.tokens_total)),
    totalCost: costs.length ? Math.round(costs.reduce((a, b) => a + b, 0) * 10000) / 10000 : null,
    avgSteps: mean(turns.map(t => t.steps)),
    avgLatencyMs: mean(turns.map(t => t.total_time_ms)),
    avgAccuracy: mean(turns.map(t => t.accuracy_score)),
    byCategory,
  };
}

export interface TurnDetail {
  message_id: string;
  user_query: string;
  answer_text: string;
  workspace_memory: string;
  conversation_memory: string;
  tool_trace: unknown; // jsonb → array | null
  downvoted: boolean;
  signal_no_tool_call: boolean;
  signal_tool_error: boolean;
  signal_empty_or_refusal: boolean;
  signal_no_response: boolean;
  signal_latency_outlier: boolean;
  verdict: string; // '(unjudged)' when no verdict row
  category: string; // judge category (hallucination, etc.)
  severity: string;
  rationale: string;
  eval_category: string | null; // benchmark case category (Normal Lookup, Navigation, …)
  // eval/benchmark fields (null for recorded-log runs)
  expected_tool: string | null;
  tool_called: string | null;
  tokens_total: number | null;
  cost_usd: number | null;
  steps: number | null;
  total_time_ms: number | null;
  accuracy_score: number | null;
}

export interface EvalMetrics {
  toolCorrect: number;
  toolTotal: number;
  avgTokens: number | null;
  totalCost: number | null;
  avgSteps: number | null;
  avgLatencyMs: number | null;
  avgAccuracy: number | null;
  byCategory: Array<{
    category: string;
    total: number;
    broken: number;
    needsWork: number;
    good: number;
    avgAccuracy: number | null;
  }>;
}

const VERDICT_COLORS: Record<string, string> = { good: '#2e7d32', 'needs-work': '#f9a825', broken: '#c62828' };

export async function loadAnalysis(local: LocalDb, runId: string): Promise<AnalysisModel> {
  const run = (await local.query('SELECT workspace, from_date, to_date FROM runs WHERE run_id=$1', [runId])).rows[0] ?? {};
  const total = Number((await local.query('SELECT count(*)::int c FROM turns WHERE run_id=$1', [runId])).rows[0].c);
  const downvotes = Number((await local.query('SELECT count(*)::int c FROM turns WHERE run_id=$1 AND downvoted', [runId])).rows[0].c);
  const verdictRows = (await local.query(
    'SELECT verdict, count(*)::int c FROM verdicts WHERE run_id=$1 GROUP BY verdict', [runId])).rows;
  const byCategory = (await local.query(
    `SELECT COALESCE(NULLIF(category,''),'(uncategorized)') label, count(*)::int value
     FROM verdicts WHERE run_id=$1 GROUP BY 1 ORDER BY value DESC`, [runId])).rows;
  const bySignal = (await local.query(
    `SELECT s.label, s.value FROM (
       SELECT 'downvote' label, count(*) FILTER (WHERE downvoted) value FROM turns WHERE run_id=$1
       UNION ALL SELECT 'no_tool_call', count(*) FILTER (WHERE signal_no_tool_call) FROM turns WHERE run_id=$1
       UNION ALL SELECT 'tool_error', count(*) FILTER (WHERE signal_tool_error) FROM turns WHERE run_id=$1
       UNION ALL SELECT 'empty_or_refusal', count(*) FILTER (WHERE signal_empty_or_refusal) FROM turns WHERE run_id=$1
       UNION ALL SELECT 'no_response', count(*) FILTER (WHERE signal_no_response) FROM turns WHERE run_id=$1
       UNION ALL SELECT 'latency_outlier', count(*) FILTER (WHERE signal_latency_outlier) FROM turns WHERE run_id=$1
     ) s WHERE s.value > 0 ORDER BY s.value DESC`, [runId])).rows.map(r => ({ label: r.label, value: Number(r.value) }));
  const byTool = (await local.query(
    `SELECT c->>'toolName' label, count(*)::int value
     FROM turns t, jsonb_array_elements(COALESCE(t.tool_trace,'[]'::jsonb)) c
     WHERE t.run_id=$1 GROUP BY 1 ORDER BY value DESC`, [runId])).rows;
  // ALL turns (not just broken), each with its verdict; broken first, then needs-work, good, unjudged.
  const turns = (await local.query<TurnDetail>(
    `SELECT t.message_id, t.user_query, t.answer_text,
            COALESCE(t.workspace_memory,'') workspace_memory,
            COALESCE(t.conversation_memory,'') conversation_memory,
            t.tool_trace, t.downvoted,
            t.signal_no_tool_call, t.signal_tool_error, t.signal_empty_or_refusal,
            t.signal_no_response, t.signal_latency_outlier,
            COALESCE(v.verdict,'(unjudged)') verdict, COALESCE(v.category,'') category,
            COALESCE(v.severity,'') severity, COALESCE(v.rationale,'') rationale,
            t.category eval_category,
            t.expected_tool, t.tool_called, t.tokens_total, t.cost_usd,
            t.steps, t.total_time_ms, t.accuracy_score
     FROM turns t LEFT JOIN verdicts v USING (run_id, message_id)
     WHERE t.run_id=$1
     ORDER BY CASE COALESCE(v.verdict,'')
                WHEN 'broken' THEN 0 WHEN 'needs-work' THEN 1 WHEN 'good' THEN 2 ELSE 3 END,
              t.created_at`, [runId])).rows;

  return {
    runId, workspace: run.workspace ?? '', fromDate: String(run.from_date ?? ''), toDate: String(run.to_date ?? ''),
    total, downvotes,
    verdictSplit: verdictRows.map(r => ({ label: r.verdict, value: Number(r.c), color: VERDICT_COLORS[r.verdict] ?? '#607d8b' })),
    byCategory: byCategory.map(r => ({ label: r.label, value: Number(r.value) })),
    bySignal, byTool: byTool.map(r => ({ label: r.label ?? '(none)', value: Number(r.value) })),
    turns,
    evalMetrics: computeEvalMetrics(turns),
  };
}
