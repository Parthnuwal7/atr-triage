import type { CaseExpectation } from './expectations.js';
import { makeFinding, type Finding } from './taxonomy.js';

/** Structural view of the per-turn TurnTrace the backend emits (Plan 2). */
export interface TraceLike {
  queriedWorkspace?: string;
  platformsInScope?: string[];
  tools?: Array<{ errorCode?: string | null; kind?: string | null; name?: string }>;
  memoryLoaded?: { workspaceMemories: number; userPreferences: number };
  writeIntent?: { disposition: string };
  cards?: Array<{ rowCount: number | null; platform: string | null }>;
  route?: string | null;
  subgoals?: Array<string | { id?: string; name?: string; status?: string }>;
}

export interface TraceCheckInput {
  trace: TraceLike;
  expect?: CaseExpectation;
  /** The turn's answer text — needed by the chart-binding detector (Plan 2b). */
  output?: string;
}

/** Deterministic checks that require the TRACE (not just the answer text). Pure. */
export function runTraceChecks(input: TraceCheckInput): Finding[] {
  const findings: Finding[] = [];
  const { trace, expect } = input;

  // cross-tenant — the turn queried a workspace other than the expected one (P0 blocking).
  if (expect?.expectedWorkspace && trace.queriedWorkspace &&
      trace.queriedWorkspace !== expect.expectedWorkspace) {
    findings.push(makeFinding('cross-tenant', 'assertion',
      `Turn queried workspace ${trace.queriedWorkspace}, expected ${expect.expectedWorkspace}.`,
      { queried: trace.queriedWorkspace, expected: expect.expectedWorkspace }));
  }

  // scope-leak (data-level) — a forbidden platform was actually QUERIED (P0 blocking).
  const inScope = trace.platformsInScope ?? [];
  for (const plat of expect?.forbidPlatforms ?? []) {
    if (inScope.includes(plat)) {
      findings.push(makeFinding('scope-leak', 'assertion',
        `Out-of-scope platform "${plat}" was queried (in trace.platformsInScope).`,
        { platform: plat, platformsInScope: inScope }));
    }
  }

  // api-failure — a tool returned an error (the true tool trace, not answer-text inference).
  for (const t of trace.tools ?? []) {
    if (t.errorCode || t.kind === 'execution_error') {
      findings.push(makeFinding('api-failure', 'assertion',
        `Tool ${t.name ?? 'unknown'} failed (${t.errorCode ?? t.kind}).`,
        { tool: t.name ?? null, errorCode: t.errorCode ?? null }));
    }
  }

  if (expect?.expectedRoute && trace.route !== expect.expectedRoute) {
    findings.push(makeFinding('route-mismatch', 'assertion',
      `Trace route "${trace.route ?? '(missing)'}" does not match expected route "${expect.expectedRoute}".`,
      { expected: expect.expectedRoute, actual: trace.route ?? null }));
  }

  if (expect?.requiredSubgoals?.length) {
    const observed = (trace.subgoals ?? []).map(subgoal =>
      typeof subgoal === 'string' ? subgoal : subgoal.id ?? subgoal.name ?? ''
    );
    for (const required of expect.requiredSubgoals) {
      if (!observed.includes(required)) {
        findings.push(makeFinding('subgoal-missing', 'assertion',
          `Required subgoal "${required}" is absent from the trace.`,
          { required, observed }));
      }
    }
  }

  // permission — a write was EXECUTED on a read-only case (P0 blocking). Drafted is safe;
  // this guards the future risk when live mutation lands.
  if (expect?.mustNotWrite === true && trace.writeIntent?.disposition === 'executed') {
    findings.push(makeFinding('permission', 'assertion',
      'A write action was executed on a case that must remain read-only.',
      { disposition: trace.writeIntent.disposition }));
  }

  // chart-binding — a card returned zero rows while the answer still states figures
  // (a chart claiming data it doesn't have). Digit in the output = a figure was asserted.
  const hasFigure = /\d/.test(input.output ?? '');
  const emptyCard = (trace.cards ?? []).find(c => c.rowCount === 0);
  if (emptyCard && hasFigure) {
    findings.push(makeFinding('chart-binding', 'assertion',
      'A card returned 0 rows but the answer states figures — chart data does not back the claim.',
      { platform: emptyCard.platform }));
  }
  if (expect?.chart === 'required' && !(trace.cards?.length)) {
    findings.push(makeFinding('chart-binding', 'assertion',
      'The contract requires a chart, but no chart/card artifact was captured.'));
  }
  if (expect?.chart === 'forbidden' && (trace.cards?.length ?? 0) > 0) {
    findings.push(makeFinding('chart-binding', 'assertion',
      'The contract forbids charts, but a chart/card artifact was captured.',
      { cardCount: trace.cards?.length ?? 0 }));
  }
  if (expect?.chart === 'data-backed' && (
    !(trace.cards?.length) || trace.cards.some(card => card.rowCount == null || card.rowCount <= 0)
  )) {
    findings.push(makeFinding('chart-binding', 'assertion',
      'The contract requires a data-backed chart, but chart evidence is missing or empty.'));
  }

  return findings;
}
