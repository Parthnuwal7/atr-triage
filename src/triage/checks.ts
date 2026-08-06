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
const CHALLENGE_RE = /\b(not|isn'?t|cannot|can'?t|no evidence|couldn'?t verify|need to verify|appears|assumption|instead)\b/i;
const REFUSAL_RE = /\b(can'?t|cannot|unable|not able|won'?t)\b/i;

function matchesShape(shape: NonNullable<CaseExpectation['answerShape']>, output: string): boolean {
  if (shape === 'table') return /^\s*\|.+\|\s*$/m.test(output) && /^\s*\|[\s:|-]+\|\s*$/m.test(output);
  if (shape === 'chart') return /```(?:mermaid|vega|json)|!\[[^\]]*\]\(|<svg\b/i.test(output);
  if (shape === 'clarification') return /\?\s*$/.test(output.trim());
  if (shape === 'refusal') return REFUSAL_RE.test(output);
  return output.trim().length >= 20;
}

/**
 * Strip reasoning-harness INSTRUMENTATION so the checks judge the answer, not the scaffolding:
 * the `🧪 *Reasoning harness*` banner, the loading preview (a lone italic line ending in `…` —
 * which can name a platform, e.g. `_…on flipkart…_`, and would otherwise trip scope-leak), and
 * the `---` + `*🧪 harness · route … · steps*` telemetry footer (which inflates length past the
 * empty-answer threshold). Mirrors atr-be's scoring.stripHarnessScaffolding.
 */
export function stripHarnessScaffolding(text: string): string {
  if (!text) return text;
  return text
    .replace(/🧪\s*\*Reasoning harness\*\s*/gi, '')
    .replace(/^\s*_[^\n]*…_\s*$/gm, '') // loading preview line (ends with …)
    .replace(/\n*-{3,}\s*\n+\s*\*?🧪[^\n]*\*?\s*$/gi, '') // --- + harness footer
    .replace(/^\s*\*?🧪[^\n]*\*?\s*$/gm, '') // any stray harness telemetry line
    .trim();
}

/** Run every deterministic assertion over a captured turn. Pure; order = severity-ish. */
export function runDeterministicChecks(input: CheckInput): Finding[] {
  const findings: Finding[] = [];
  const out = stripHarnessScaffolding((input.output || '').trim());
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

  if (expect?.expectedTool) {
    const called = (input.tool_calls ?? []).map(t => t.name);
    if (!called.includes(expect.expectedTool)) {
      findings.push(makeFinding('tool-mismatch', 'assertion',
        `Expected tool "${expect.expectedTool}" was not called.`,
        { expected: expect.expectedTool, called }));
    }
  }

  if (expect?.answerShape && !matchesShape(expect.answerShape, out)) {
    findings.push(makeFinding('shape-mismatch', 'assertion',
      `Answer does not satisfy required "${expect.answerShape}" shape.`,
      { expectedShape: expect.answerShape }));
  }

  if (expect?.premisePolicy === 'challenge' && !CHALLENGE_RE.test(out)) {
    findings.push(makeFinding('premise-failure', 'assertion',
      'Answer accepted a premise that the contract requires it to challenge.',
      { premisePolicy: expect.premisePolicy }));
  }
  if (expect?.premisePolicy === 'verify' && !(input.tool_calls?.length)) {
    findings.push(makeFinding('premise-failure', 'assertion',
      'Answer did not gather tool evidence before resolving a premise that requires verification.',
      { premisePolicy: expect.premisePolicy }));
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
