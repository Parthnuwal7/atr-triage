import { readFileSync } from 'node:fs';
import type { TriageConfig } from '../config.js';
import { getLocalPool } from '../db.js';
import {
  selectTurnsForAssertQuery, insertFindingQuery, clearFindingsForRunQuery, updateTurnRigQuery,
} from '../sql/localQueries.js';
import { assessTurn, type TurnAssessment } from './assess.js';
import {
  expectationFor, expectationMetadata, parseExpectations, type ExpectationMap,
} from './expectations.js';
import type { ToolCallLite } from './checks.js';
import type { TraceLike } from './traceChecks.js';
import { digest } from '../benchmark/schema.js';

export interface TurnRecord {
  message_id: string;
  output: string;
  tool_calls: unknown;
  total_time_ms: number | null;
  ttfb_ms: number | null;
  tool_called: string | null;
  trace?: unknown;
  clarified?: boolean | null;
}

function toToolCalls(raw: unknown): ToolCallLite[] {
  if (Array.isArray(raw)) return raw as ToolCallLite[];
  if (typeof raw === 'string') { try { const p = JSON.parse(raw); return Array.isArray(p) ? p : []; } catch { return []; } }
  return [];
}

/** Trace comes back from JSONB as an object (PGlite) or a string — normalize to an object. */
function toTrace(raw: unknown): TraceLike | null {
  if (!raw) return null;
  if (typeof raw === 'string') { try { return JSON.parse(raw) as TraceLike; } catch { return null; } }
  if (typeof raw === 'object') return raw as TraceLike;
  return null;
}

/** Pure: assess every turn and roll up the gate + class histogram. */
export function buildRunReport(
  turns: TurnRecord[],
  expectations: ExpectationMap,
  requireEvidence = false,
  requireContract = false
): {
  assessments: Array<{ messageId: string; assessment: TurnAssessment }>;
  gate: 'red' | 'green';
  blockingCount: number;
  byClass: Record<string, number>;
} {
  const assessments = turns.map(t => ({
    messageId: t.message_id,
    assessment: assessTurn({
      output: t.output,
      ttfb_ms: t.ttfb_ms,
      total_time_ms: t.total_time_ms,
      tool_called: t.tool_called,
      tool_calls: toToolCalls(t.tool_calls),
      trace: toTrace(t.trace),
      clarified: t.clarified === true,
      expect: expectationFor(expectations, t.message_id),
      requireEvidence,
      requireContract,
    }),
  }));
  const byClass: Record<string, number> = {};
  let blockingCount = 0;
  for (const { assessment } of assessments) {
    for (const f of assessment.findings) {
      byClass[f.class] = (byClass[f.class] ?? 0) + 1;
      if (f.blocking) blockingCount++;
    }
  }
  return { assessments, gate: blockingCount > 0 ? 'red' : 'green', blockingCount, byClass };
}

export async function runAssert(
  cfg: TriageConfig, runId: string, expectationsPath?: string
): Promise<{ gate: 'red' | 'green'; findings: number; blocking: number; byClass: Record<string, number> }> {
  const local = getLocalPool(cfg);
  try {
    const res = await local.query(selectTurnsForAssertQuery, [runId]);
    if (!res.rows.length) throw new Error(`run ${runId} has no turns; assertion cannot pass`);
    const run = await local.query<{ mode: string; experiment_id: string | null }>(
      'SELECT mode, experiment_id FROM runs WHERE run_id=$1', [runId]
    );
    if (!run.rows[0]) throw new Error(`unknown run: ${runId}`);
    if (run.rows[0].mode === 'eval' && !expectationsPath) {
      throw new Error('eval assertions require an expectations file; refusing an unscoped green gate');
    }
    const expectations = expectationsPath
      ? parseExpectations(readFileSync(expectationsPath, 'utf8'))
      : {};
    const contract = expectationMetadata(expectations);
    if (run.rows[0].experiment_id && !contract.contractVersion) {
      throw new Error('paired experiment assertions require versioned expected contracts');
    }
    const report = buildRunReport(
      res.rows as TurnRecord[],
      expectations,
      run.rows[0].mode === 'eval',
      !!run.rows[0].experiment_id
    );
    await local.query('BEGIN');
    try {
      await local.query(clearFindingsForRunQuery, [runId]);
      await local.query('DELETE FROM assertion_results WHERE run_id=$1', [runId]);
      if (contract.contractVersion) {
        for (const [caseId, expected] of Object.entries(expectations)) {
          await local.query(
            `INSERT INTO expected_contracts (
               contract_version, schema_version, case_id, contract, contract_digest
             ) VALUES ($1,$2,$3,$4,$5)
             ON CONFLICT (contract_version,case_id) DO UPDATE SET
               schema_version=EXCLUDED.schema_version, contract=EXCLUDED.contract,
               contract_digest=EXCLUDED.contract_digest`,
            [
              contract.contractVersion, contract.schemaVersion, caseId,
              JSON.stringify(expected), digest(expected),
            ]
          );
        }
      }
      let total = 0;
      for (const { messageId, assessment } of report.assessments) {
        await local.query(updateTurnRigQuery, [runId, messageId, assessment.rig.status, assessment.rig.reason ?? null]);
        for (const f of assessment.findings) {
          await local.query(insertFindingQuery, [
            runId, messageId, f.class, f.layer, f.detector, f.fixType, f.severity, f.blocking, f.message,
            f.evidence ? JSON.stringify(f.evidence) : null,
            contract.contractVersion, contract.schemaVersion,
          ]);
          total++;
        }
        await local.query(
          `INSERT INTO assertion_results (
             run_id, message_id, schema_version, contract_version, outcome,
             measurement_eligible, measurement_reasons, findings_count, blocking_count
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            runId, messageId, contract.schemaVersion, contract.contractVersion, assessment.outcome,
            assessment.measurementEligible, JSON.stringify(assessment.measurementReasons),
            assessment.findings.length, assessment.findings.filter(f => f.blocking).length,
          ]
        );
        await local.query(
          `UPDATE turns SET expected_contract_version=$3, assertion_schema_version=$4,
             assertion_outcome=$5, measurement_eligible=$6, measurement_reasons=$7
           WHERE run_id=$1 AND message_id=$2`,
          [
            runId, messageId, contract.contractVersion, contract.schemaVersion, assessment.outcome,
            assessment.measurementEligible, JSON.stringify(assessment.measurementReasons),
          ]
        );
      }
      const measurementEligible = report.assessments.length > 0 &&
        report.assessments.every(item => item.assessment.measurementEligible) &&
        (!run.rows[0].experiment_id || contract.contractVersion != null);
      const runReasons = report.assessments.flatMap(item => item.assessment.measurementReasons);
      const outcome = !measurementEligible ? 'ineligible' : report.blockingCount ? 'fail' : 'pass';
      await local.query(
        `UPDATE runs SET expected_contract_version=$2, assertion_schema_version=$3,
           outcome=$4, measurement_eligible=$5, measurement_reasons=$6 WHERE run_id=$1`,
        [
          runId, contract.contractVersion, contract.schemaVersion, outcome, measurementEligible,
          JSON.stringify([...new Set(runReasons)]),
        ]
      );
      await local.query('COMMIT');
      return { gate: report.gate, findings: total, blocking: report.blockingCount, byClass: report.byClass };
    } catch (error) {
      await local.query('ROLLBACK');
      throw error;
    }
  } finally {
    await local.end();
  }
}
