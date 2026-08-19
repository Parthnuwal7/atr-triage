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
  gate?: GateSummary; // deterministic assert() gate + findings, when the run was asserted
  ingestionStatus?: 'complete' | 'partial';
  expectedCases?: number | null;
}

export interface GateSummary {
  /** red = a blocking finding fired; green = asserted & no blocker; none = never asserted. */
  status: 'red' | 'green' | 'none';
  total: number;
  blocking: number;
  byClass: Array<{ label: string; value: number; blocking: boolean; severity: string; layer: string }>;
}

export interface FindingGroupRow {
  class: string;
  layer: string;
  severity: string;
  blocking: boolean;
  count: number;
}

/** Fold grouped finding rows into the gate summary. `asserted` distinguishes a clean run
 *  (green) from one that was never asserted (none). Pure. */
export function computeGate(rows: FindingGroupRow[], asserted: boolean): GateSummary {
  const byClass = rows
    .map(r => ({ label: r.class, value: Number(r.count), blocking: !!r.blocking, severity: r.severity, layer: r.layer }))
    .sort((a, b) => b.value - a.value);
  const total = byClass.reduce((s, c) => s + c.value, 0);
  const blocking = byClass.filter(c => c.blocking).reduce((s, c) => s + c.value, 0);
  const status: GateSummary['status'] = !asserted ? 'none' : blocking > 0 ? 'red' : 'green';
  return { status, total, blocking, byClass };
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
      insufficient: ts.filter(t => t.verdict === 'insufficient-evidence').length,
      avgAccuracy: mean(ts.map(t => t.accuracy_score)),
    }))
    .sort((a, b) => b.broken - a.broken || b.total - a.total);
  const costs = turns.map(t => t.cost_usd).filter((n): n is number => n != null);
  return {
    judgedTotal: turns.filter(t => ['good', 'needs-work', 'broken'].includes(t.verdict)).length,
    goodTotal: turns.filter(t => t.verdict === 'good').length,
    insufficientTotal: turns.filter(t => t.verdict === 'insufficient-evidence').length,
    manualReviewTotal: turns.filter(t => t.review_status === 'pending').length,
    deterministicPassed: turns.filter(t => t.accuracy_score === 100).length,
    deterministicTotal: turns.filter(t => t.accuracy_score != null).length,
    toolObserved: turns.filter(t => t.tool_called != null).length,
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
  artifacts?: unknown;
  provenance?: unknown;
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
  /** Consensus verdict fields plus the latest individual causal judgment. */
  confidence?: number | null;
  failure_stage?: string | null;
  failed_component?: string | null;
  process_error?: string | null;
  causal_evidence?: unknown;
  likely_root_cause?: string | null;
  fix_layer?: string | null;
  evidence_sufficiency?: string | null;
  fixture_issue?: boolean;
  judge_verdict?: string | null;
  judge_id?: string | null;
  judge_model_id?: string | null;
  deterministic_relation?: string | null;
  reviewer_notes?: string | null;
  review_status?: string | null;
  review_reason?: string | null;
  review_resolution?: string | null;
  review_reviewer?: string | null;
  eval_category: string | null; // benchmark case category (Normal Lookup, Navigation, …)
  // eval/benchmark fields (null for recorded-log runs)
  expected_tool: string | null;
  tool_called: string | null;
  tokens_total: number | null;
  cost_usd: number | null;
  steps: number | null;
  total_time_ms: number | null;
  accuracy_score: number | null;
  case_id?: string | null;
  attempt_index?: number;
  evidence_status?: string;
  judge_count?: number;
  disagreement?: boolean;
  model_id?: string | null;
  dimension_scores?: Record<string, number> | null;
  expected_contract_version?: string | null;
  assertion_schema_version?: number | null;
  assertion_outcome?: 'pass' | 'fail' | 'ineligible' | null;
  measurement_eligible?: boolean;
}

export interface EvalMetrics {
  judgedTotal: number;
  goodTotal: number;
  insufficientTotal: number;
  manualReviewTotal: number;
  deterministicPassed: number;
  deterministicTotal: number;
  toolObserved: number;
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
    insufficient: number;
    avgAccuracy: number | null;
  }>;
}

const VERDICT_COLORS: Record<string, string> = {
  good: '#2e7d32',
  'needs-work': '#f9a825',
  broken: '#c62828',
  'insufficient-evidence': '#607d8b',
};

/** Load every turn for a run with its verdict joined — shared by single-run and comparison paths. */
export async function fetchTurns(local: LocalDb, runId: string): Promise<TurnDetail[]> {
  const turns: TurnDetail[] = [];
  const pageSize = 16;
  for (let offset = 0; ; offset += pageSize) {
    const page = (await local.query<TurnDetail>(
      `SELECT t.message_id, t.user_query, t.answer_text,
              COALESCE(t.workspace_memory,'') workspace_memory,
              COALESCE(t.conversation_memory,'') conversation_memory,
              t.tool_trace, t.artifacts, t.provenance, t.downvoted,
              t.signal_no_tool_call, t.signal_tool_error, t.signal_empty_or_refusal,
              t.signal_no_response, t.signal_latency_outlier,
              COALESCE(v.verdict,'(unjudged)') verdict, COALESCE(v.category,'') category,
              COALESCE(v.severity,'') severity, COALESCE(v.rationale,'') rationale,
              v.confidence, v.failure_stage, v.failed_component, v.process_error,
              j.causal_evidence, v.likely_root_cause, v.fix_layer,
              v.evidence_sufficiency, COALESCE(v.fixture_issue,false) fixture_issue,
              j.verdict judge_verdict, j.judge_id, j.model_id judge_model_id,
              j.deterministic_relation,
              COALESCE(j.judge_metadata->>'reviewer_notes','') reviewer_notes,
              jr.status review_status, jr.reason review_reason,
              jr.resolution review_resolution, jr.reviewer review_reviewer,
              t.category eval_category,
              t.expected_tool, t.tool_called, t.tokens_total, t.cost_usd,
              t.steps, t.total_time_ms, t.accuracy_score,
              t.case_id, t.attempt_index, t.evidence_status, t.model_id,
              t.expected_contract_version, t.assertion_schema_version, t.assertion_outcome,
              t.measurement_eligible,
              COALESCE(v.judge_count,0)::int judge_count, COALESCE(v.disagreement,false) disagreement,
              (SELECT jsonb_object_agg(ds.key, ds.avg_score) FROM (
                 SELECT e.key, avg((e.value)::numeric)::float avg_score
                 FROM judgments j CROSS JOIN LATERAL jsonb_each_text(j.dimensions) e
                 WHERE j.run_id=t.run_id AND j.message_id=t.message_id
                 GROUP BY e.key
               ) ds) dimension_scores
       FROM turns t
       LEFT JOIN verdicts v USING (run_id, message_id)
       LEFT JOIN LATERAL (
         SELECT verdict, judge_id, model_id, causal_evidence, deterministic_relation,
                judge_metadata, judged_at
         FROM judgments
         WHERE run_id=t.run_id AND message_id=t.message_id
         ORDER BY judged_at DESC, judge_id
         LIMIT 1
       ) j ON true
       LEFT JOIN LATERAL (
         SELECT status, reason, resolution, reviewer, created_at
         FROM judgment_reviews
         WHERE run_id=t.run_id AND message_id=t.message_id
         ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, created_at DESC
         LIMIT 1
       ) jr ON true
       WHERE t.run_id=$1
       ORDER BY CASE COALESCE(v.verdict,'')
                  WHEN 'broken' THEN 0 WHEN 'needs-work' THEN 1 WHEN 'good' THEN 2 ELSE 3 END,
                t.created_at, t.message_id
       LIMIT $2 OFFSET $3`, [runId, pageSize, offset])).rows;
    turns.push(...page);
    if (page.length < pageSize) break;
  }
  return turns;
}

export async function loadAnalysis(local: LocalDb, runId: string): Promise<AnalysisModel> {
  const run = (await local.query('SELECT workspace, from_date, to_date, insights_md, ingestion_status, expected_case_count FROM runs WHERE run_id=$1', [runId])).rows[0] ?? {};
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
    `SELECT COALESCE(c->>'toolName', c->>'name') label, count(*)::int value
     FROM turns t, jsonb_array_elements(COALESCE(t.tool_trace,'[]'::jsonb)) c
     WHERE t.run_id=$1 GROUP BY 1 ORDER BY value DESC`, [runId])).rows;
  // Deterministic gate: findings grouped by class + whether the run was asserted at all
  // (turns get a rig_status stamped during assert, so any non-null means it ran).
  const findingRows = (await local.query<FindingGroupRow>(
    `SELECT class, layer, severity, blocking, count(*)::int count
     FROM findings WHERE run_id=$1 GROUP BY class, layer, severity, blocking ORDER BY count DESC`, [runId])).rows;
  const asserted = Number((await local.query(
    'SELECT count(*)::int c FROM turns WHERE run_id=$1 AND rig_status IS NOT NULL', [runId])).rows[0].c) > 0;
  const gate = computeGate(findingRows, asserted);

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
    gate,
    ingestionStatus: run.ingestion_status ?? 'complete',
    expectedCases: run.expected_case_count == null ? null : Number(run.expected_case_count),
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

export interface FindingDeltaRow {
  class: string;
  blocking: boolean;
  a: number; // finding count in arm A
  b: number; // finding count in arm B
  delta: number; // b − a (positive = B introduced more of this class = regression)
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
  gate?: { a: GateSummary; b: GateSummary }; // deterministic safety gate per arm (when both asserted)
  findingDeltas?: FindingDeltaRow[]; // findings-by-class, both arms + delta, worst-regression first
  validity?: BenchmarkValidity;
  matched?: MatchedMetrics;
  matchedCases?: Array<{
    key: string;
    caseId: string;
    category: string;
    query: string;
    verdictA: string;
    verdictB: string;
    delta: number | null;
    evidenceA: string;
    evidenceB: string;
  }>;
  dimensionDeltas?: Array<{ dimension: string; a: number; b: number; delta: number }>;
  eligibility?: PairedEligibility;
}

export interface BenchmarkValidity {
  status: 'valid' | 'inconclusive' | 'invalid';
  reasons: string[];
  matchedCases: number;
  totalA: number;
  totalB: number;
  judgeCoveragePct: number;
  evidenceCoveragePct: number;
  disagreementCount: number;
  assertionCoveragePct?: number;
  measurementEligibilityPct?: number;
}

export interface PairedEligibility {
  eligible: boolean;
  decision: 'promote' | 'reject' | 'inconclusive';
  reasons: string[];
}

export interface MatchedMetrics {
  wins: number;
  losses: number;
  ties: number;
  meanDeltaPct: number | null;
  confidence95: [number, number] | null;
}

/** Merge two arms' grouped findings into per-class A/B/delta rows (worst-regression first). Pure. */
export function buildFindingDeltas(aRows: FindingGroupRow[], bRows: FindingGroupRow[]): FindingDeltaRow[] {
  const acc = new Map<string, FindingDeltaRow>();
  const fold = (rows: FindingGroupRow[], side: 'a' | 'b') => {
    for (const r of rows) {
      const row = acc.get(r.class) ?? { class: r.class, blocking: false, a: 0, b: 0, delta: 0 };
      row[side] += Number(r.count);
      row.blocking = row.blocking || !!r.blocking;
      acc.set(r.class, row);
    }
  };
  fold(aRows, 'a');
  fold(bRows, 'b');
  return [...acc.values()]
    .map(r => ({ ...r, delta: r.b - r.a }))
    // Blocking classes first, then largest regression (delta desc), then bigger absolute counts.
    .sort((x, y) => Number(y.blocking) - Number(x.blocking) || y.delta - x.delta || (y.a + y.b) - (x.a + x.b));
}

/** Pure comparison builder. `loadComparison` is the thin DB wrapper around this.
 *  `aFindings`/`bFindings` + `aAsserted`/`bAsserted` are optional so callers/tests that only
 *  care about the quality axes can omit them; when present they drive the safety-gate section. */
export function buildComparison(
  aArm: ArmSummary,
  bArm: ArmSummary,
  aTurns: TurnDetail[],
  bTurns: TurnDetail[],
  aFindings: FindingGroupRow[] = [],
  bFindings: FindingGroupRow[] = [],
  aAsserted = false,
  bAsserted = false,
  compatibility: {
    fixtureA?: string | null; fixtureB?: string | null;
    promptA?: string | null; promptB?: string | null;
    experimentA?: string | null; experimentB?: string | null;
    seedA?: number | null; seedB?: number | null;
    contractA?: string | null; contractB?: string | null;
    assertionSchemaA?: number | null; assertionSchemaB?: number | null;
  } = {}
): ComparisonModel {
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

  // Safety gate per arm + findings-by-class delta. Only meaningful when at least one arm was
  // asserted; otherwise both gates read "none" and the section renders as not-asserted.
  const gate = { a: computeGate(aFindings, aAsserted), b: computeGate(bFindings, bAsserted) };
  const findingDeltas = buildFindingDeltas(aFindings, bFindings);
  const pairKey = (t: TurnDetail) => `${t.case_id ?? t.message_id}::${t.attempt_index ?? 0}`;
  const aByKey = new Map(aTurns.map(t => [pairKey(t), t]));
  const pairs = bTurns
    .map(b => ({ a: aByKey.get(pairKey(b)), b }))
    .filter((p): p is { a: TurnDetail; b: TurnDetail } => !!p.a);
  const score = (v: string): number | null => v === 'good' ? 1 : v === 'needs-work' ? 0.5 : v === 'broken' ? 0 : null;
  const deltas = pairs
    .map(({ a, b }) => {
      const av = score(a.verdict);
      const bv = score(b.verdict);
      return av == null || bv == null ? null : bv - av;
    })
    .filter((v): v is number => v != null);
  const meanDelta = deltas.length ? deltas.reduce((sum, value) => sum + value, 0) / deltas.length : null;
  const variance = deltas.length > 1 && meanDelta != null
    ? deltas.reduce((sum, value) => sum + ((value - meanDelta) ** 2), 0) / (deltas.length - 1)
    : null;
  const margin = variance == null ? null : 1.96 * Math.sqrt(variance / deltas.length);
  const matched: MatchedMetrics = {
    wins: deltas.filter(d => d > 0).length,
    losses: deltas.filter(d => d < 0).length,
    ties: deltas.filter(d => d === 0).length,
    meanDeltaPct: meanDelta == null ? null : Math.round(meanDelta * 1000) / 10,
    confidence95: meanDelta == null || margin == null
      ? null
      : [Math.round((meanDelta - margin) * 1000) / 10, Math.round((meanDelta + margin) * 1000) / 10],
  };
  const matchedCases = pairs.map(({ a, b }) => {
    const av = score(a.verdict);
    const bv = score(b.verdict);
    return {
      key: pairKey(a),
      caseId: a.case_id ?? a.message_id,
      category: a.eval_category ?? b.eval_category ?? 'Uncategorized',
      query: a.user_query || b.user_query,
      verdictA: a.verdict,
      verdictB: b.verdict,
      delta: av == null || bv == null ? null : bv - av,
      evidenceA: a.evidence_status ?? 'missing',
      evidenceB: b.evidence_status ?? 'missing',
    };
  }).sort((x, y) => (x.delta ?? 0) - (y.delta ?? 0) || x.caseId.localeCompare(y.caseId));
  const allTurns = pairs.flatMap(p => [p.a, p.b]);
  const dimensionNames = [...new Set(allTurns.flatMap(t => Object.keys(t.dimension_scores ?? {})))];
  const dimensionDeltas = dimensionNames.map(dimension => {
    const values = (turns: TurnDetail[]) => turns
      .map(t => t.dimension_scores?.[dimension])
      .filter((value): value is number => value != null);
    const aValues = values(pairs.map(p => p.a));
    const bValues = values(pairs.map(p => p.b));
    const a = aValues.length ? aValues.reduce((sum, value) => sum + value, 0) / aValues.length : 0;
    const b = bValues.length ? bValues.reduce((sum, value) => sum + value, 0) / bValues.length : 0;
    return {
      dimension,
      a: Math.round(a * 100) / 100,
      b: Math.round(b * 100) / 100,
      delta: Math.round((b - a) * 100) / 100,
    };
  }).sort((x, y) => x.delta - y.delta);
  const reasons: string[] = [];
  if (compatibility.fixtureA && compatibility.fixtureB && compatibility.fixtureA !== compatibility.fixtureB) {
    reasons.push('fixture versions differ');
  }
  if (compatibility.promptA && compatibility.promptB && compatibility.promptA !== compatibility.promptB) {
    reasons.push('prompt versions differ');
  }
  if (!compatibility.fixtureA || !compatibility.fixtureB) reasons.push('fixture provenance is missing');
  if (!compatibility.promptA || !compatibility.promptB) reasons.push('judge prompt provenance is missing');
  if (compatibility.experimentA && compatibility.experimentB && compatibility.experimentA !== compatibility.experimentB) {
    reasons.push('experiment ids differ');
  }
  if (compatibility.seedA != null && compatibility.seedB != null && compatibility.seedA !== compatibility.seedB) {
    reasons.push('experiment seeds differ');
  }
  if (!compatibility.contractA || !compatibility.contractB) {
    reasons.push('expected contract provenance is missing');
  } else if (compatibility.contractA !== compatibility.contractB) {
    reasons.push('expected contract versions differ');
  }
  if (compatibility.assertionSchemaA == null || compatibility.assertionSchemaB == null) {
    reasons.push('assertion schema provenance is missing');
  } else if (compatibility.assertionSchemaA !== compatibility.assertionSchemaB) {
    reasons.push('assertion schema versions differ');
  }
  if (pairs.length !== aTurns.length || pairs.length !== bTurns.length) reasons.push('arms do not contain identical matched attempts');
  const judgeCoveragePct = allTurns.length
    ? Math.round(100 * allTurns.filter(t => isJudged(t.verdict)).length / allTurns.length)
    : 0;
  const evidenceCoveragePct = allTurns.length
    ? Math.round(100 * allTurns.filter(t => t.evidence_status === 'sufficient').length / allTurns.length)
    : 0;
  const assertionCoveragePct = allTurns.length
    ? Math.round(100 * allTurns.filter(t => t.assertion_outcome != null).length / allTurns.length)
    : 0;
  const measurementEligibilityPct = allTurns.length
    ? Math.round(100 * allTurns.filter(t => t.measurement_eligible === true).length / allTurns.length)
    : 0;
  if (judgeCoveragePct < 100) reasons.push(`judge coverage is ${judgeCoveragePct}%`);
  if (evidenceCoveragePct < 100) reasons.push(`evidence coverage is ${evidenceCoveragePct}%`);
  if (assertionCoveragePct < 100) reasons.push(`assertion coverage is ${assertionCoveragePct}%`);
  if (measurementEligibilityPct < 100) reasons.push(`measurement eligibility is ${measurementEligibilityPct}%`);
  if (pairs.length === 0) reasons.push('no matched attempts');
  const invalid = reasons.some(r =>
    r.includes('versions differ') || r.includes('ids differ') || r.includes('seeds differ') ||
    r.includes('no matched') || r.includes('identical matched') || r.includes('provenance is missing') ||
    r.includes('assertion coverage') || r.includes('measurement eligibility')
  );
  const validity: BenchmarkValidity = {
    status: invalid ? 'invalid' : reasons.length || deltas.length < 10 ? 'inconclusive' : 'valid',
    reasons: [...reasons, ...(deltas.length > 0 && deltas.length < 10 ? ['fewer than 10 judged pairs'] : [])],
    matchedCases: pairs.length,
    totalA: aTurns.length,
    totalB: bTurns.length,
    judgeCoveragePct,
    evidenceCoveragePct,
    disagreementCount: allTurns.filter(t => t.disagreement).length,
    assertionCoveragePct,
    measurementEligibilityPct,
  };
  const pairedReasons = [...validity.reasons];
  if (gate.a.status !== 'green' || gate.b.status !== 'green') {
    pairedReasons.push('both deterministic safety gates must be green');
  }
  const eligible = validity.status === 'valid' && gate.a.status === 'green' && gate.b.status === 'green';
  const confidence = matched.confidence95;
  const decision: PairedEligibility['decision'] = !eligible
    ? (validity.status === 'invalid' || gate.a.status === 'red' || gate.b.status === 'red' ? 'reject' : 'inconclusive')
    : !confidence || (confidence[0] <= 0 && confidence[1] >= 0)
      ? 'inconclusive'
      : confidence[0] > 0 ? 'promote' : 'reject';
  const eligibility: PairedEligibility = {
    eligible,
    decision,
    reasons: [...new Set(pairedReasons)],
  };

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
    gate,
    findingDeltas,
    validity,
    matched,
    matchedCases,
    dimensionDeltas,
    eligibility,
  };
}

/** Findings grouped by class + whether the run was asserted at all (any turn with a rig_status). */
async function fetchFindings(local: LocalDb, runId: string): Promise<{ rows: FindingGroupRow[]; asserted: boolean }> {
  const rows = (await local.query<FindingGroupRow>(
    `SELECT class, layer, severity, blocking, count(*)::int count
     FROM findings WHERE run_id=$1 GROUP BY class, layer, severity, blocking ORDER BY count DESC`, [runId])).rows;
  const asserted = Number((await local.query(
    'SELECT count(*)::int c FROM turns WHERE run_id=$1 AND rig_status IS NOT NULL', [runId])).rows[0].c) > 0;
  return { rows, asserted };
}

export async function loadComparison(local: LocalDb, runIdA: string, runIdB: string): Promise<ComparisonModel> {
  const runA = (await local.query(
    `SELECT workspace, fixture_version, prompt_version, experiment_id, seed,
            expected_contract_version, assertion_schema_version, ingestion_status
     FROM runs WHERE run_id=$1`, [runIdA]
  )).rows[0] ?? {};
  const runB = (await local.query(
    `SELECT workspace, fixture_version, prompt_version, experiment_id, seed,
            expected_contract_version, assertion_schema_version, ingestion_status
     FROM runs WHERE run_id=$1`, [runIdB]
  )).rows[0] ?? {};
  if (runA.ingestion_status !== 'complete' || runB.ingestion_status !== 'complete') {
    throw new Error('partial runs cannot be used for baseline comparisons; finish the run or inspect its single-run dashboard');
  }
  const wsA = runA.workspace ?? '';
  const wsB = runB.workspace ?? '';
  const aTurns = await fetchTurns(local, runIdA);
  const bTurns = await fetchTurns(local, runIdB);
  const aArm = computeArmSummary(runIdA, wsA, aTurns);
  const bArm = computeArmSummary(runIdB, wsB, bTurns);
  const aF = await fetchFindings(local, runIdA);
  const bF = await fetchFindings(local, runIdB);
  return buildComparison(aArm, bArm, aTurns, bTurns, aF.rows, bF.rows, aF.asserted, bF.asserted, {
    fixtureA: runA.fixture_version, fixtureB: runB.fixture_version,
    promptA: runA.prompt_version, promptB: runB.prompt_version,
    experimentA: runA.experiment_id, experimentB: runB.experiment_id,
    seedA: runA.seed, seedB: runB.seed,
    contractA: runA.expected_contract_version, contractB: runB.expected_contract_version,
    assertionSchemaA: runA.assertion_schema_version, assertionSchemaB: runB.assertion_schema_version,
  });
}
