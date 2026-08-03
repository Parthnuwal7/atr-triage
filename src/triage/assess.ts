import type { ToolCallLite } from './checks.js';
import { runDeterministicChecks } from './checks.js';
import type { CaseExpectation } from './expectations.js';
import { classifyRig, type RigVerdict } from './rigIntegrity.js';
import { makeFinding, type Finding } from './taxonomy.js';
import { runTraceChecks, type TraceLike } from './traceChecks.js';

export interface AssessInput {
  output: string;
  ttfb_ms?: number | null;
  total_time_ms?: number | null;
  tool_called?: string | null;
  all_tools_called?: string[];
  tool_calls?: ToolCallLite[];
  expect?: CaseExpectation;
  /** Per-turn trace (Plan 2) — enables cross-tenant/permission/chart-binding checks. */
  trace?: TraceLike | null;
}

export interface TurnAssessment {
  rig: RigVerdict;
  findings: Finding[];
  blocking: boolean;
}

/** Compose the gate: rig-integrity first (quarantine), then deterministic product checks. */
export function assessTurn(input: AssessInput): TurnAssessment {
  const rig = classifyRig(input);
  if (rig.status === 'failed') {
    const findings = [makeFinding('rig-error', 'assertion', rig.reason ?? 'rig failure')];
    return { rig, findings, blocking: false };
  }
  const findings = runDeterministicChecks({
    output: input.output,
    tool_calls: input.tool_calls,
    expect: input.expect,
  });
  // Trace-backed checks (Plan 2) run only when a trace was captured for this turn.
  if (input.trace) {
    findings.push(...runTraceChecks({ trace: input.trace, expect: input.expect, output: input.output }));
  }
  return { rig, findings, blocking: findings.some(f => f.blocking) };
}
