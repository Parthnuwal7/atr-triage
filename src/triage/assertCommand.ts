import { readFileSync } from 'node:fs';
import type { TriageConfig } from '../config.js';
import { getLocalPool } from '../db.js';
import {
  selectTurnsForAssertQuery, insertFindingQuery, clearFindingsForRunQuery, updateTurnRigQuery,
} from '../sql/localQueries.js';
import { assessTurn, type TurnAssessment } from './assess.js';
import { expectationFor, parseExpectations, type ExpectationMap } from './expectations.js';
import type { ToolCallLite } from './checks.js';

export interface TurnRecord {
  message_id: string;
  output: string;
  tool_calls: unknown;
  total_time_ms: number | null;
  ttfb_ms: number | null;
  tool_called: string | null;
}

function toToolCalls(raw: unknown): ToolCallLite[] {
  if (Array.isArray(raw)) return raw as ToolCallLite[];
  if (typeof raw === 'string') { try { const p = JSON.parse(raw); return Array.isArray(p) ? p : []; } catch { return []; } }
  return [];
}

/** Pure: assess every turn and roll up the gate + class histogram. */
export function buildRunReport(turns: TurnRecord[], expectations: ExpectationMap): {
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
      expect: expectationFor(expectations, t.message_id),
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
  const expectations = expectationsPath
    ? parseExpectations(readFileSync(expectationsPath, 'utf8'))
    : {};
  const local = getLocalPool(cfg);
  try {
    const res = await local.query(selectTurnsForAssertQuery, [runId]);
    const report = buildRunReport(res.rows as TurnRecord[], expectations);
    await local.query(clearFindingsForRunQuery, [runId]);
    let total = 0;
    for (const { messageId, assessment } of report.assessments) {
      await local.query(updateTurnRigQuery, [runId, messageId, assessment.rig.status, assessment.rig.reason ?? null]);
      for (const f of assessment.findings) {
        await local.query(insertFindingQuery, [
          runId, messageId, f.class, f.layer, f.detector, f.fixType, f.severity, f.blocking, f.message,
          f.evidence ? JSON.stringify(f.evidence) : null,
        ]);
        total++;
      }
    }
    return { gate: report.gate, findings: total, blocking: report.blockingCount, byClass: report.byClass };
  } finally {
    await local.end();
  }
}
