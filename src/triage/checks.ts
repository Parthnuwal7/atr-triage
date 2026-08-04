import type { CaseExpectation } from './expectations.js';
import { makeFinding, type Finding } from './taxonomy.js';

export interface ToolCallLite {
  name: string;
  kind?: string | null;
  errorCode?: string | null;
}

export interface CheckInput {
  output: string;
  tool_calls?: ToolCallLite[];
  expect?: CaseExpectation;
  /** True when ARIA asked a clarifying question on this turn (from run-eval `clarified`). */
  clarified?: boolean;
}

/** Canonical platform token → the surface aliases that would appear in an answer. */
export const PLATFORM_LABELS: Record<string, string[]> = {
  amazon: ['amazon'],
  flipkart: ['flipkart'],
  google: ['google'],
  meta: ['meta', 'facebook', 'instagram'],
  blinkit: ['blinkit'],
  zepto: ['zepto'],
  instamart: ['instamart'],
  bigbasket: ['bigbasket', 'big basket'],
  linkedin: ['linkedin'],
};

const NOT_FOUND_RE = /\b(no|not|couldn'?t|could not|don'?t|do not|isn'?t|no such|doesn'?t)\b[^.]*\b(find|found|exist|match|campaign|any)\b/i;

/** Run every deterministic assertion over a captured turn. Pure; order = severity-ish. */
export function runDeterministicChecks(input: CheckInput): Finding[] {
  const findings: Finding[] = [];
  const out = (input.output || '').trim();
  const lower = out.toLowerCase();
  const expect = input.expect;

  // api-failure — a tool returned an error (transport ERROR: is rig-integrity's job).
  for (const t of input.tool_calls ?? []) {
    if (t.kind === 'execution_error' || (t.errorCode && t.errorCode.length > 0)) {
      findings.push(makeFinding('api-failure', 'assertion',
        `Tool ${t.name} failed (${t.errorCode ?? t.kind}).`,
        { tool: t.name, errorCode: t.errorCode ?? null, kind: t.kind ?? null }));
    }
  }

  // empty-answer — a stub/header with no actual answer.
  if (out.length > 0 && out.length < 20) {
    findings.push(makeFinding('empty-answer', 'assertion',
      `Answer is only ${out.length} chars — stub/header with no content.`, { length: out.length }));
  }

  // scope-leak — an out-of-scope platform surfaced in the answer (P0 blocking).
  for (const plat of expect?.forbidPlatforms ?? []) {
    const aliases = PLATFORM_LABELS[plat] ?? [plat];
    if (aliases.some(a => lower.includes(a))) {
      findings.push(makeFinding('scope-leak', 'assertion',
        `Out-of-scope platform "${plat}" appeared in a ${expect?.scopePlatform ?? 'scoped'} answer.`,
        { platform: plat, scope: expect?.scopePlatform ?? null }));
    }
  }

  // over-clarify — the query named a platform (expect.scopePlatform) yet ARIA still asked a
  // clarifying question instead of answering (e.g. "Google spend?" → "Which Google?"). A router
  // over-clarification: it should have proceeded on the specified scope.
  if (input.clarified && expect?.scopePlatform) {
    findings.push(makeFinding('over-clarify', 'assertion',
      `Query specified platform "${expect.scopePlatform}" but ARIA asked to clarify instead of answering.`,
      { scopePlatform: expect.scopePlatform }));
  }

  // entity-not-found — a named entity that does not exist was presented as real.
  if (expect?.entity && expect.entityExists === false) {
    const named = lower.includes(expect.entity.toLowerCase());
    const disclaimed = NOT_FOUND_RE.test(out);
    if (named && !disclaimed) {
      findings.push(makeFinding('entity-not-found', 'assertion',
        `Entity "${expect.entity}" does not exist but the answer treats it as real.`,
        { entity: expect.entity }));
    }
  }

  return findings;
}
