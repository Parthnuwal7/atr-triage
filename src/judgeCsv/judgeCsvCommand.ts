import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { stringify } from 'csv-stringify/sync';
import type { TriageConfig } from '../config.js';
import { getLocalPool } from '../db.js';

export const JUDGE_CSV_COLUMNS = [
  'run_id', 'run_status', 'captured_cases', 'planned_cases', 'message_id', 'case_id', 'repeat_index', 'model_id', 'scenario_category',
  'user_query', 'answer_text', 'rubric', 'expected_json', 'deterministic_validation_json',
  'path_signature', 'process_trace_json', 'failure_signals_json', 'attempt_history_json',
  'expected_tool', 'tool_called', 'tool_trace', 'visual_artifacts_json',
  'visual_validation_json', 'provenance_json', 'evidence_status', 'terminal_status',
  'ttfb_ms', 'total_time_ms', 'accuracy_score',
  // Filled by the reviewer. Keeping these in the same CSV makes the file directly importable.
  'verdict', 'category', 'severity', 'failure_stage', 'failed_component', 'process_error',
  'causal_evidence', 'likely_root_cause', 'fix_layer', 'rationale', 'dimensions_json', 'confidence',
  'evidence_sufficiency', 'reviewer_notes',
] as const;

export interface JudgeInputTurn {
  run_id?: string;
  run_status?: string | null;
  captured_cases?: number | null;
  planned_cases?: number | null;
  message_id: string;
  case_id?: string | null;
  attempt_index?: number | null;
  model_id?: string | null;
  category: string | null;
  expected_tool: string | null;
  tool_called: string | null;
  user_query: string | null;
  answer_text: string | null;
  tool_trace: unknown;
  artifacts?: unknown;
  provenance?: unknown;
  evidence_status?: string | null;
  ttfb_ms?: number | null;
  total_time_ms?: number | null;
  accuracy_score?: number | null;
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'string') {
    try { return asObject(JSON.parse(value)); } catch { return {}; }
  }
  return typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function json(value: unknown): string {
  return value == null ? '' : JSON.stringify(value);
}

export function buildJudgeCsvRows(turns: JudgeInputTurn[]): Record<string, string>[] {
  return turns.map(turn => {
    const artifacts = asObject(turn.artifacts);
    const context = asObject(artifacts.benchmark_context);
    const expectation = context.expect_all ?? context.expect ?? null;
    const processTrace = asObject(context.process_trace);
    return {
      run_id: turn.run_id ?? '',
      run_status: turn.run_status ?? '',
      captured_cases: turn.captured_cases == null ? '' : String(turn.captured_cases),
      planned_cases: turn.planned_cases == null ? '' : String(turn.planned_cases),
      message_id: turn.message_id,
      case_id: turn.case_id ?? turn.message_id,
      repeat_index: String(turn.attempt_index ?? 0),
      model_id: turn.model_id ?? '',
      scenario_category: turn.category ?? '',
      user_query: turn.user_query ?? '',
      answer_text: turn.answer_text ?? '',
      rubric: typeof context.rubric === 'string' ? context.rubric : '',
      expected_json: json(expectation),
      deterministic_validation_json: json(context.deterministic_validation),
      path_signature: String(processTrace.path_signature ?? ''),
      process_trace_json: json(context.process_trace),
      failure_signals_json: json(context.failure_signals),
      attempt_history_json: json(context.attempt_history),
      expected_tool: turn.expected_tool ?? '',
      tool_called: turn.tool_called ?? '',
      tool_trace: json(turn.tool_trace),
      visual_artifacts_json: json(artifacts.visual_artifacts),
      visual_validation_json: json(artifacts.visual_validation),
      provenance_json: json(turn.provenance),
      evidence_status: turn.evidence_status ?? '',
      terminal_status: String(context.terminal_status ?? ''),
      ttfb_ms: turn.ttfb_ms == null ? '' : String(turn.ttfb_ms),
      total_time_ms: turn.total_time_ms == null ? '' : String(turn.total_time_ms),
      accuracy_score: turn.accuracy_score == null ? '' : String(turn.accuracy_score),
      verdict: '', category: '', severity: '', failure_stage: '', failed_component: '', process_error: '',
      causal_evidence: '', likely_root_cause: '', fix_layer: '', rationale: '', dimensions_json: '',
      confidence: '', evidence_sufficiency: '', reviewer_notes: '',
    };
  });
}

export async function runJudgeCsv(
  cfg: TriageConfig,
  runId: string,
  outPath: string
): Promise<{ rows: number }> {
  const local = getLocalPool(cfg);
  try {
    const { rows } = await local.query<JudgeInputTurn>(
      `SELECT t.run_id, r.ingestion_status AS run_status, r.source_row_count AS captured_cases,
              r.expected_case_count AS planned_cases, message_id, case_id, attempt_index, model_id, category,
              expected_tool, tool_called, user_query, answer_text, tool_trace,
              t.artifacts, t.provenance, evidence_status, ttfb_ms, total_time_ms, accuracy_score
       FROM turns t JOIN runs r ON r.run_id=t.run_id
       WHERE t.run_id=$1 ORDER BY case_id, attempt_index, message_id`,
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
