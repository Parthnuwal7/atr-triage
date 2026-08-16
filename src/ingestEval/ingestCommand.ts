import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { TriageConfig } from '../config.js';
import { getLocalPool } from '../db.js';
import { insertEvalTurnQuery } from '../sql/localQueries.js';
import { BENCHMARK_SCHEMA_VERSION, digest } from '../benchmark/schema.js';
import { buildEvalArtifacts } from './ariaEvidence.js';

export interface EvalCaseRow {
  index: number;
  id: string | null; // benchmark CSV id (e.g. LOOK-01) when present
  scenario_tag: string | null; // stable fixture tag (e.g. LOOK-01); id is usually null, this isn't
  category: string;
  model: string;
  input: string;
  output: string;
  expected_tool: string | null;
  tool_called: string | null;
  tool_calls: unknown; // [{ name, args, kind, errorCode, rowCount }]
  repeat_index: number;
  steps: number | null;
  tokens_total: number | null;
  tokens_in: number | null;
  tokens_out: number | null;
  cost_usd: number | null;
  total_time_ms: number | null;
  accuracy_score: number | null;
  overall_score: number | null;
  trace: unknown; // per-turn TurnTrace (Plan 2) when the backend emitted it, else null
  clarified: boolean; // ARIA asked a clarifying question this turn
  clarify_rounds: number | null; // how many clarifications were auto-resolved
  ttfb_ms: number | null;
  artifacts: unknown;
  provenance: unknown;
}

export interface EvalMeta {
  workspace: string;
  date: string; // YYYY-MM-DD
  models: string[];
  expectedCases: number | null;
  experimentId: string | null;
  approachId: string | null;
  seed: number | null;
  fixtureVersion: string | null;
  promptVersion: string | null;
  deploymentVersion: string | null;
  repeatIndex: number;
  ingestionStatus: 'complete' | 'partial';
}

/** Parse valid rows from complete or partial JSONL. Malformed/impossible evidence is rejected. */
export function parseEvalJsonl(text: string): { meta: EvalMeta; cases: EvalCaseRow[] } {
  let meta: EvalMeta = {
    workspace: 'benchmark', date: new Date().toISOString().slice(0, 10), models: [],
    expectedCases: null, experimentId: null, approachId: null, seed: null,
    fixtureVersion: null, promptVersion: null, deploymentVersion: null,
    repeatIndex: 0, ingestionStatus: 'complete',
  };
  const cases: EvalCaseRow[] = [];
  let sawStart = false;
  let sawEnd = false;
  let lineNo = 0;
  for (const line of text.split('\n')) {
    lineNo++;
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(trimmed);
    } catch (error) {
      throw new Error(`invalid JSONL at line ${lineNo}: ${(error as Error).message}`);
    }
    if (obj.kind === 'run_start') {
      if (sawStart) throw new Error('multiple run_start records');
      sawStart = true;
      meta = {
        workspace: (obj.clientId as string) || (obj.client_id as string) || 'benchmark',
        date: typeof obj.ts === 'string' ? obj.ts.slice(0, 10) : meta.date,
        models: Array.isArray(obj.models) ? (obj.models as string[]) : (typeof obj.model === 'string' ? [obj.model] : []),
        expectedCases: obj.planned_cases == null ? (obj.cases == null ? null : Number(obj.cases)) : Number(obj.planned_cases),
        experimentId: (obj.experiment_id as string) ?? null,
        approachId: (obj.approach_id as string) ?? (obj.approach as string) ?? null,
        seed: obj.seed == null ? null : Number(obj.seed),
        fixtureVersion: (obj.fixture_version as string) ?? (obj.fixture_sha256 as string) ?? null,
        promptVersion: (obj.prompt_version as string) ?? null,
        deploymentVersion: (obj.deployment_version as string) ?? null,
        repeatIndex: obj.repeat_index == null ? 0 : Number(obj.repeat_index),
        ingestionStatus: obj.complete === false ? 'partial' : 'complete',
      };
    } else if (obj.kind === 'case') {
      if (!Number.isFinite(Number(obj.index))) throw new Error(`case at line ${lineNo} has no valid index`);
      if (typeof obj.input !== 'string') throw new Error(`case at line ${lineNo} has no input`);
      if (typeof obj.output !== 'string') throw new Error(`case at line ${lineNo} has no output`);
      cases.push({
        index: Number(obj.index),
        id: (obj.id as string) ?? null,
        scenario_tag: (obj.scenario_tag as string) ?? null,
        category: (obj.category as string) ?? '',
        model: (obj.model as string) ?? '',
        input: (obj.input as string) ?? '',
        output: (obj.output as string) ?? '',
        expected_tool: (obj.expected_tool as string) ?? null,
        tool_called: (obj.tool_called as string) ?? null,
        tool_calls: obj.tool_calls ?? null,
        repeat_index: obj.repeat_index == null ? (obj.repeat == null ? 0 : Number(obj.repeat) - 1) : Number(obj.repeat_index),
        steps: obj.steps == null ? null : Number(obj.steps),
        tokens_total: obj.tokens_total == null ? null : Number(obj.tokens_total),
        tokens_in: obj.tokens_in == null ? null : Number(obj.tokens_in),
        tokens_out: obj.tokens_out == null ? null : Number(obj.tokens_out),
        cost_usd: obj.cost_usd == null ? null : Number(obj.cost_usd),
        total_time_ms: obj.total_time_ms == null ? null : Number(obj.total_time_ms),
        accuracy_score: obj.accuracy_score == null ? null : Number(obj.accuracy_score),
        overall_score: obj.overall_score == null ? null : Number(obj.overall_score),
        trace: obj.trace ?? null,
        clarified: obj.clarified === true,
        clarify_rounds: obj.clarify_rounds == null ? null : Number(obj.clarify_rounds),
        ttfb_ms: obj.ttfb_ms == null ? null : Number(obj.ttfb_ms),
        artifacts: buildEvalArtifacts(obj),
        provenance: obj.provenance ?? null,
      });
    } else if (obj.kind === 'run_end') {
      sawEnd = true;
      if (obj.planned_cases != null) meta.expectedCases = Number(obj.planned_cases);
      if (obj.complete === false) meta.ingestionStatus = 'partial';
      else if (obj.complete === true) meta.ingestionStatus = 'complete';
    }
  }
  if (!cases.length && !sawStart) throw new Error('eval report contains no cases or run metadata');
  // Preserve valid partial evidence. Only impossible over-counts are rejected.
  if (sawStart && !sawEnd) meta.ingestionStatus = 'partial';
  if (meta.expectedCases != null && cases.length > meta.expectedCases) {
    throw new Error(`eval report expected at most ${meta.expectedCases} cases but contains ${cases.length}`);
  }
  if (meta.expectedCases != null && cases.length < meta.expectedCases) meta.ingestionStatus = 'partial';
  const keys = new Set<string>();
  for (const c of cases) {
    const key = (c.id ?? c.scenario_tag ?? 'case-' + c.index) + '::' + c.model + '::r' + c.repeat_index;
    if (keys.has(key)) throw new Error(`duplicate eval case/model: ${key}`);
    keys.add(key);
  }
  return { meta, cases };
}

export async function runIngestEval(
  cfg: TriageConfig,
  jsonlPath: string
): Promise<{ runId: string; ingested: number; duplicate: boolean; status: 'complete' | 'partial' }> {
  const source = readFileSync(jsonlPath, 'utf8');
  const sourceDigest = digest(source);
  const { meta, cases } = parseEvalJsonl(source);
  const runId = randomUUID();
  const local = getLocalPool(cfg);
  try {
    const existing = await local.query<{ run_id: string }>('SELECT run_id FROM runs WHERE source_digest=$1', [sourceDigest]);
    if (existing.rows[0]) {
      const count = await local.query<{ count: number }>('SELECT count(*)::int count FROM turns WHERE run_id=$1', [existing.rows[0].run_id]);
      return { runId: existing.rows[0].run_id, ingested: Number(count.rows[0].count), duplicate: true, status: meta.ingestionStatus };
    }
    await local.query('BEGIN');
    try {
      await local.query(
        `INSERT INTO runs (
           run_id, workspace, from_date, to_date, mode, source_row_count, schema_version,
           experiment_id, approach_id, seed, fixture_version, prompt_version,
           deployment_version, source_digest, provenance, ingestion_status, expected_case_count
         ) VALUES ($1,$2,$3,$4,'eval',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [
          runId, meta.workspace, meta.date, meta.date, cases.length, BENCHMARK_SCHEMA_VERSION,
          meta.experimentId, meta.approachId, meta.seed, meta.fixtureVersion, meta.promptVersion,
          meta.deploymentVersion, sourceDigest,
          JSON.stringify({ sourcePath: jsonlPath, models: meta.models, capturedCases: cases.length, plannedCases: meta.expectedCases }), meta.ingestionStatus, meta.expectedCases,
        ]
      );
      const baseCounts = new Map<string, number>();
      for (const c of cases) {
        const base = c.id ?? c.scenario_tag ?? `case-${c.index}`;
        baseCounts.set(base, (baseCounts.get(base) ?? 0) + 1);
      }
      for (const c of cases) {
        const caseId = c.id ?? c.scenario_tag ?? `case-${c.index}`;
        const messageId = (baseCounts.get(caseId) ?? 0) > 1 ? caseId + '::' + c.model + '::r' + c.repeat_index : caseId;
        const visualEvidence = c.artifacts && typeof c.artifacts === 'object'
          && Boolean((c.artifacts as { visual_artifacts?: { emitted?: boolean } }).visual_artifacts?.emitted);
        const evidenceStatus = c.trace != null || (Array.isArray(c.tool_calls) && c.tool_calls.length) || visualEvidence
          ? 'sufficient'
          : c.output.trim() ? 'partial' : 'missing';
        await local.query(insertEvalTurnQuery, [
          runId, messageId, c.category || 'eval', meta.date, c.input, c.output,
          c.tool_calls == null ? null : JSON.stringify(c.tool_calls),
          c.category, c.expected_tool, c.tool_called, c.tokens_total, c.tokens_in, c.tokens_out,
          c.cost_usd, c.steps, c.total_time_ms, c.accuracy_score, c.overall_score,
          c.trace == null ? null : JSON.stringify(c.trace),
          c.clarified, c.clarify_rounds, c.ttfb_ms, caseId, c.repeat_index, evidenceStatus,
          c.artifacts == null ? null : JSON.stringify(c.artifacts),
          JSON.stringify({ model: c.model, ...(c.provenance && typeof c.provenance === 'object' ? c.provenance as object : {}) }),
          c.model || null,
        ]);
        if (meta.experimentId && meta.approachId) {
          const linked = await local.query(
            `UPDATE benchmark_attempts SET run_id=$5, message_id=$6, status='completed',
               provenance=provenance || $7::jsonb
             WHERE experiment_id=$1 AND case_id=$2 AND approach_id=$3 AND repeat_index=$4
             RETURNING case_id`,
            [
              meta.experimentId, caseId, meta.approachId, c.repeat_index, runId, messageId,
              JSON.stringify({ sourceDigest, model: c.model }),
            ]
          );
          if (!linked.rows.length) {
            throw new Error(`case ${caseId} does not exist in experiment plan ${meta.experimentId}`);
          }
        }
      }
      await local.query('COMMIT');
    } catch (error) {
      await local.query('ROLLBACK');
      throw error;
    }
    return { runId, ingested: cases.length, duplicate: false, status: meta.ingestionStatus };
  } finally {
    await local.end();
  }
}
