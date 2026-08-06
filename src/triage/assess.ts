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
  /** True when ARIA asked a clarifying question (drives the over-clarify check). */
  clarified?: boolean;
  /** Eval gates fail closed when neither a trace nor tool evidence was captured. */
  requireEvidence?: boolean;
  /** Paired evals require a versioned case contract for every measured turn. */
  requireContract?: boolean;
}

export interface TurnAssessment {
  rig: RigVerdict;
  findings: Finding[];
  blocking: boolean;
  outcome: 'pass' | 'fail' | 'ineligible';
  measurementEligible: boolean;
  measurementReasons: string[];
}

/** Compose the gate: rig-integrity first (quarantine), then deterministic product checks. */
export function assessTurn(input: AssessInput): TurnAssessment {
  const rig = classifyRig(input);
  if (rig.status === 'failed') {
    const findings = [makeFinding('rig-error', 'assertion', rig.reason ?? 'rig failure')];
    return {
      rig, findings, blocking: true, outcome: 'ineligible', measurementEligible: false,
      measurementReasons: ['rig failure'],
    };
  }
  const findings = runDeterministicChecks({
    output: input.output,
    tool_calls: input.tool_calls,
    expect: input.expect,
    clarified: input.clarified,
  });
  // Trace-backed checks (Plan 2) run only when a trace was captured for this turn.
  if (input.trace) {
    findings.push(...runTraceChecks({ trace: input.trace, expect: input.expect, output: input.output }));
  }
  const traceRequired = input.expect?.requiredEvidence?.includes('trace') ||
    !!input.expect?.expectedRoute || !!input.expect?.requiredSubgoals?.length ||
    (input.expect?.chart != null && input.expect.chart !== 'optional');
  if (traceRequired && !input.trace) {
    findings.push(makeFinding('trace-missing', 'assertion',
      'The expected contract requires trace evidence, but no trace was captured.'));
  }
  if (input.expect?.requiredEvidence?.includes('tools') && !(input.tool_calls?.length)) {
    findings.push(makeFinding('evidence-missing', 'assertion',
      'The expected contract requires tool evidence, but no tool calls were captured.'));
  }
  if (input.requireContract && !input.expect) {
    findings.push(makeFinding('evidence-missing', 'assertion',
      'No expected contract exists for this measured case.'));
  }
  if (input.requireEvidence && !input.trace && !(input.tool_calls?.length)) {
    findings.push(makeFinding(
      'evidence-missing',
      'assertion',
      'No trace or tool evidence was captured; deterministic safety claims cannot be verified.'
    ));
  }
  const ineligibleClasses = new Set(['rig-error', 'evidence-missing', 'trace-missing']);
  const measurementReasons = findings
    .filter(f => ineligibleClasses.has(f.class))
    .map(f => f.message);
  const measurementEligible = measurementReasons.length === 0;
  return {
    rig,
    findings,
    blocking: findings.some(f => f.blocking),
    outcome: !measurementEligible ? 'ineligible' : findings.length ? 'fail' : 'pass',
    measurementEligible,
    measurementReasons,
  };
}
