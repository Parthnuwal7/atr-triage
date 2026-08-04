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
  insightsMd?: string; // the judge's insights.md report, when imported
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

/** Load every turn for a run with its verdict joined — shared by single-run and comparison paths. */
export async function fetchTurns(local: LocalDb, runId: string): Promise<TurnDetail[]> {
  return (await local.query<TurnDetail>(
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
}

export async function loadAnalysis(local: LocalDb, runId: string): Promise<AnalysisModel> {
  const run = (await local.query('SELECT workspace, from_date, to_date, insights_md FROM runs WHERE run_id=$1', [runId])).rows[0] ?? {};
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
  const turns = await fetchTurns(local, runId);

  return {
    runId, workspace: run.workspace ?? '', fromDate: String(run.from_date ?? ''), toDate: String(run.to_date ?? ''),
    total, downvotes,
    verdictSplit: verdictRows.map(r => ({ label: r.verdict, value: Number(r.c), color: VERDICT_COLORS[r.verdict] ?? '#607d8b' })),
    byCategory: byCategory.map(r => ({ label: r.label, value: Number(r.value) })),
    bySignal, byTool: byTool.map(r => ({ label: r.label ?? '(none)', value: Number(r.value) })),
    turns,
    evalMetrics: computeEvalMetrics(turns),
    insightsMd: (run.insights_md as string) || undefined,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// A/B comparison (spider + delta charts). Two runs — baseline A vs candidate B.
// Deltas read as B − A. All model-building below is pure over TurnDetail[] so the
// charts can be asserted on the model, not by parsing SVG.
// ─────────────────────────────────────────────────────────────────────────────

/** 31 fixture categories collapsed to 7 families (spec §2). Each category maps once. */
export const CATEGORY_FAMILIES: Record<string, string[]> = {
  'Lookup & Reporting': ['Normal Lookup', 'Breakdown', 'Output-Format', 'Filter', 'Scale'],
  'Ambiguity & Clarify': ['Ambiguous', 'Long+Ambiguous', 'Entity-Disambiguation', 'Decision Boundary', 'Preference'],
  'Intent & Reasoning': ['Indirect-Intent', 'Multi-Intent', 'Metric Semantics', 'Baseline-Is-this-good', 'Case-Based'],
  'Navigation & Product': ['Navigation', 'Navigation-Boundary', 'Navigation-Nonexistent', 'Meta/Product', 'Slash Command'],
  'Safety & Robustness': ['Adversarial', 'Hallucination', 'False-Premise', 'Data-Availability', 'Data-Quality'],
  'Correctness & Temporal': ['Correctness', 'Temporal', 'Linguistic'],
  'Action & Forecast': ['Action', 'Forecast', 'Recommendation-Lifecycle'],
};

const CATEGORY_TO_FAMILY: Record<string, string> = Object.fromEntries(
  Object.entries(CATEGORY_FAMILIES).flatMap(([fam, cats]) => cats.map(c => [c, fam]))
);

/** Family for a category; unrecognised categories collect in "Uncategorized" (rendered only if non-empty). */
export function familyOf(category: string | null): string {
  return (category && CATEGORY_TO_FAMILY[category]) || 'Uncategorized';
}

/** verdict → coarse pass/partial/fail bucket (schema uses good/needs-work/broken). */
function passBucket(verdict: string): 'pass' | 'partial' | 'fail' | 'other' {
  if (verdict === 'good') return 'pass';
  if (verdict === 'needs-work') return 'partial';
  if (verdict === 'broken') return 'fail';
  return 'other';
}

function isJudged(verdict: string): boolean {
  return verdict === 'good' || verdict === 'needs-work' || verdict === 'broken';
}

function isError(t: TurnDetail): boolean {
  return (t.answer_text ?? '').startsWith('ERROR:');
}

function median(nums: number[]): number | null {
  const v = nums.filter(n => n != null).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/** Pass rate (good / judged, 0–100) over a set of turns, or null when nothing is judged. */
function passRate(turns: TurnDetail[]): number | null {
  const judged = turns.filter(t => isJudged(t.verdict));
  if (!judged.length) return null;
  return Math.round((100 * judged.filter(t => t.verdict === 'good').length) / judged.length);
}

export interface ArmSummary {
  runId: string;
  workspace: string;
  total: number;
  judged: number;
  verdictCounts: { pass: number; partial: number; fail: number; unjudged: number; error: number };
  passRatePct: number | null; // null → not measured (no judged turns)
  toolRoutingPct: number | null; // null → no turns carry an expected_tool
  accuracyMean: number | null;
  medianLatencyMs: number | null;
  meanCostUsd: number | null;
  totalCost: number;
  errorFreePct: number | null;
  meanSteps: number | null;
  errorCount: number;
}

/** Pure per-arm rollup. All downstream comparison numbers derive from two of these. */
export function computeArmSummary(runId: string, workspace: string, turns: TurnDetail[]): ArmSummary {
  const total = turns.length;
  const judged = turns.filter(t => isJudged(t.verdict));
  const withExpected = turns.filter(t => t.expected_tool != null);
  const errorCount = turns.filter(isError).length;
  const costs = turns.map(t => t.cost_usd).filter((n): n is number => n != null);
  return {
    runId,
    workspace,
    total,
    judged: judged.length,
    verdictCounts: {
      pass: turns.filter(t => passBucket(t.verdict) === 'pass').length,
      partial: turns.filter(t => passBucket(t.verdict) === 'partial').length,
      fail: turns.filter(t => passBucket(t.verdict) === 'fail').length,
      unjudged: turns.filter(t => !isJudged(t.verdict)).length,
      error: errorCount,
    },
    passRatePct: passRate(turns),
    toolRoutingPct: withExpected.length
      ? Math.round((100 * withExpected.filter(t => toolMatches(t.expected_tool, t.tool_called)).length) / withExpected.length)
      : null,
    accuracyMean: mean(turns.map(t => t.accuracy_score)),
    medianLatencyMs: median(turns.map(t => t.total_time_ms).filter((n): n is number => n != null)),
    meanCostUsd: costs.length ? costs.reduce((a, b) => a + b, 0) / costs.length : null,
    totalCost: costs.length ? Math.round(costs.reduce((a, b) => a + b, 0) * 10000) / 10000 : 0,
    errorFreePct: total ? Math.round((100 * (total - errorCount)) / total) : null,
    meanSteps: mean(turns.map(t => t.steps)),
    errorCount,
  };
}

/**
 * Relative inverted score for a "lower is better" raw metric (latency/cost/steps).
 * The better (smaller) arm scores 100; the other scores 100 × better/worse (spec §1).
 * `measured:false` when either arm lacks the metric → both 0 + a "not measured" caption.
 */
export function relativeInvertedScores(a: number | null, b: number | null): { a: number; b: number; measured: boolean } {
  if (a == null || b == null) return { a: 0, b: 0, measured: false };
  if (a <= 0 && b <= 0) return { a: 100, b: 100, measured: true }; // both best possible — no spread
  const better = Math.min(a, b);
  const score = (v: number) => (v <= 0 ? 100 : Math.max(0, Math.round((100 * better) / v)));
  return { a: score(a), b: score(b), measured: true };
}

export interface RadarAxis {
  axis: string;
  a: number;
  b: number;
}

export interface ComparisonModel {
  a: { runId: string; workspace: string };
  b: { runId: string; workspace: string };
  qualityRadar: RadarAxis[];
  familyRadar: RadarAxis[];
  kpis: Array<{ label: string; a: number; b: number; delta: number; betterIsB: boolean; fmt: 'pct' | 'ms' | 'usd' | 'int' }>;
  categoryDeltas: Array<{ category: string; a: number | null; b: number | null; delta: number }>;
  verdictGroups: Array<{ label: string; a: number; b: number; color: string }>;
  notMeasured: string[]; // axes whose denominator was 0 in either arm
  relativeAxes: string[]; // axes scaled relative to the pair (caption)
}

/** Pure comparison builder. `loadComparison` is the thin DB wrapper around this. */
export function buildComparison(aArm: ArmSummary, bArm: ArmSummary, aTurns: TurnDetail[], bTurns: TurnDetail[]): ComparisonModel {
  const notMeasured: string[] = [];
  const pct = (axis: string, av: number | null, bv: number | null): RadarAxis => {
    if (av == null || bv == null) notMeasured.push(axis);
    return { axis, a: av ?? 0, b: bv ?? 0 };
  };

  const speed = relativeInvertedScores(aArm.medianLatencyMs, bArm.medianLatencyMs);
  const cost = relativeInvertedScores(aArm.meanCostUsd, bArm.meanCostUsd);
  const steps = relativeInvertedScores(aArm.meanSteps, bArm.meanSteps);
  const relativeAxes = ['Speed', 'Cost efficiency', 'Step efficiency'];
  for (const [name, r] of [['Speed', speed], ['Cost efficiency', cost], ['Step efficiency', steps]] as const) {
    if (!r.measured) notMeasured.push(name);
  }

  const qualityRadar: RadarAxis[] = [
    pct('Verdict pass %', aArm.passRatePct, bArm.passRatePct),
    pct('Tool-routing %', aArm.toolRoutingPct, bArm.toolRoutingPct),
    pct('Accuracy', aArm.accuracyMean, bArm.accuracyMean),
    { axis: 'Speed', a: speed.a, b: speed.b },
    { axis: 'Cost efficiency', a: cost.a, b: cost.b },
    pct('Error-free %', aArm.errorFreePct, bArm.errorFreePct),
    { axis: 'Step efficiency', a: steps.a, b: steps.b },
  ];

  // Category-family radar: each axis is that family's verdict pass rate per arm.
  const familyNames = Object.keys(CATEGORY_FAMILIES);
  const familyRadar: RadarAxis[] = familyNames.map(fam => {
    const inFam = (ts: TurnDetail[]) => ts.filter(t => familyOf(t.eval_category) === fam);
    return { axis: fam, a: passRate(inFam(aTurns)) ?? 0, b: passRate(inFam(bTurns)) ?? 0 };
  });

  // Per-category delta bars (pass rate pp, B − A), sorted worst-regression first.
  const allCats = [...new Set([...aTurns, ...bTurns].map(t => t.eval_category || '(none)'))];
  const categoryDeltas = allCats
    .map(cat => {
      const a = passRate(aTurns.filter(t => (t.eval_category || '(none)') === cat));
      const b = passRate(bTurns.filter(t => (t.eval_category || '(none)') === cat));
      return { category: cat, a, b, delta: (b ?? 0) - (a ?? 0) };
    })
    .sort((x, y) => x.delta - y.delta || x.category.localeCompare(y.category));

  const kpis: ComparisonModel['kpis'] = [
    { label: 'Pass %', a: aArm.passRatePct ?? 0, b: bArm.passRatePct ?? 0, delta: (bArm.passRatePct ?? 0) - (aArm.passRatePct ?? 0), betterIsB: (bArm.passRatePct ?? 0) >= (aArm.passRatePct ?? 0), fmt: 'pct' },
    { label: 'Median latency', a: aArm.medianLatencyMs ?? 0, b: bArm.medianLatencyMs ?? 0, delta: (bArm.medianLatencyMs ?? 0) - (aArm.medianLatencyMs ?? 0), betterIsB: (bArm.medianLatencyMs ?? 0) <= (aArm.medianLatencyMs ?? 0), fmt: 'ms' },
    { label: 'Total cost', a: aArm.totalCost, b: bArm.totalCost, delta: Math.round((bArm.totalCost - aArm.totalCost) * 10000) / 10000, betterIsB: bArm.totalCost <= aArm.totalCost, fmt: 'usd' },
    { label: 'Error count', a: aArm.errorCount, b: bArm.errorCount, delta: bArm.errorCount - aArm.errorCount, betterIsB: bArm.errorCount <= aArm.errorCount, fmt: 'int' },
  ];

  const verdictGroups = [
    { label: 'pass', a: aArm.verdictCounts.pass, b: bArm.verdictCounts.pass, color: '#2e7d32' },
    { label: 'partial', a: aArm.verdictCounts.partial, b: bArm.verdictCounts.partial, color: '#f9a825' },
    { label: 'fail', a: aArm.verdictCounts.fail, b: bArm.verdictCounts.fail, color: '#c62828' },
    { label: 'error', a: aArm.verdictCounts.error, b: bArm.verdictCounts.error, color: '#455a64' },
  ];

  return {
    a: { runId: aArm.runId, workspace: aArm.workspace },
    b: { runId: bArm.runId, workspace: bArm.workspace },
    qualityRadar,
    familyRadar,
    kpis,
    categoryDeltas,
    verdictGroups,
    notMeasured: [...new Set(notMeasured)],
    relativeAxes,
  };
}

export async function loadComparison(local: LocalDb, runIdA: string, runIdB: string): Promise<ComparisonModel> {
  const wsA = (await local.query('SELECT workspace FROM runs WHERE run_id=$1', [runIdA])).rows[0]?.workspace ?? '';
  const wsB = (await local.query('SELECT workspace FROM runs WHERE run_id=$1', [runIdB])).rows[0]?.workspace ?? '';
  const aTurns = await fetchTurns(local, runIdA);
  const bTurns = await fetchTurns(local, runIdB);
  const aArm = computeArmSummary(runIdA, wsA, aTurns);
  const bArm = computeArmSummary(runIdB, wsB, bTurns);
  return buildComparison(aArm, bArm, aTurns, bTurns);
}
