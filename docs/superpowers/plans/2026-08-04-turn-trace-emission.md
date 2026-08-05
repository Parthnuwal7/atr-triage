# Turn-Trace Emission + Trace-Backed Checks (Plan 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Emit a gated, structured per-turn trace from the ARIA composable endpoint (workspace queried, tool/step trace, memory loaded, write-intent disposition, per-card row counts), capture it through run-eval, and add the trace-backed deterministic checks Phase 0 could not build from answer text alone — `cross-tenant`, `permission`, `chart-binding`, plus a real tool-trace that fixes the blind capture.

**Architecture:** A request-scoped `TraceCollector` accrues facts during a turn; the controller assembles a `TurnTrace` from it plus the harness `ReasoningTrace` and emits a `trace` SSE chunk — **only when the request is flagged for eval** — right before `[DONE]`. run-eval parses that chunk into a JSONL `trace` object. atr-triage ingests `trace` onto the turn and runs new assertion modules against it, reusing the Phase 0 taxonomy/`Finding` contract and the `triage assert` gate.

**Tech Stack:** atr-be — TypeScript (non-strict), Fastify, vitest (`src/test/unit/**/*.unit.test.ts` via the project config), `reply.raw.write` SSE. atr-triage — TypeScript ESM, tsx, vitest (`test/**/*.test.ts`), PGlite.

## Global Constraints

- **Two repos.** atr-be tasks (T1–T4, T7) and atr-triage tasks (T5–T6, T8) are committed in their own repos. Each task header names its repo.
- **atr-be tests** live in `src/test/unit/**/*.unit.test.ts`; run one with `npx vitest run --config vitest.vitals.config.ts <path>` (the same config the memoryService unit test uses). Confirm the exact config filename by grepping `package.json` scripts before running.
- **atr-triage tests** live in `test/*.test.ts`; run with `npx vitest run test/<name>.test.ts`. ESM imports use the `.js` extension.
- **The trace is internal data.** It MUST NOT reach a normal user. Emission is gated on an explicit eval signal (`x-aria-eval-trace: 1` header OR `context.evalTrace === true`) AND `config.NODE_ENV !== 'production'`. Both conditions required. Default = no emission.
- **Fail-open, always.** Trace collection/emission is wrapped so any error is swallowed — observability must never break or alter an answer (mirror `writeLocalTrace`/`recordHarnessTrace`).
- **On-wire shape:** new SSE chunks MUST mirror the existing `tool-call` chunk exactly (backend `reply.raw.write(createStreamChunk('trace', payload))`; run-eval reads `parsed.type` + top-level fields). Before adding the type, capture one existing chunk's raw JSON to confirm whether payload fields are top-level or nested under `data`, and match it.
- **Reuse Phase 0 contracts.** New checks return `Finding[]` via `makeFinding` from `src/triage/taxonomy.js`; `permission`/`cross-tenant`/`chart-binding` already exist in the taxonomy (blocking: scope-leak/permission/cross-tenant).
- **Write-actions are drafts today.** ARIA prepares a `PendingWorkspaceAction` (no live mutation). The `permission` check therefore asserts *disposition* (`drafted` = safe, `executed` = the future risk), not a live authz call.

---

## Phase 2a — Cheap trace fields (workspace, tools, memory) + trace-backed checks

### Task 1 (atr-be): `TurnTrace` type + pure builder

**Files:**
- Create: `src/service/chatbot/reasoning/turnTrace.ts`
- Test: `src/test/unit/chatbot/turnTrace.unit.test.ts`

**Interfaces:**
- Produces:
  - `interface TraceToolCall { name: string; kind: string | null; errorCode: string | null; rowCount: number | null }`
  - `interface TraceCard { cardKey: string | null; toolName: string; rowCount: number | null; platform: string | null }`
  - `interface TraceWriteIntent { type: string; disposition: 'drafted' | 'executed' | 'refused' | 'none'; targetAccounts: string[] }`
  - `interface TurnTrace { queriedWorkspace: string; userId: string | null; scopePlatform: string | null; platformsInScope: string[]; tools: TraceToolCall[]; cards: TraceCard[]; memoryLoaded: { workspaceMemories: number; userPreferences: number }; writeIntent: TraceWriteIntent; errorCodes: string[]; route: { type: string; focus: string | null; confidence: number } | null; fellBack: boolean; ms: number }`
  - `interface BuildTurnTraceInput { queriedWorkspace: string; userId?: string | null; scopePlatform?: string | null; platformsInScope?: string[]; tools?: TraceToolCall[]; cards?: TraceCard[]; memoryLoaded?: { workspaceMemories: number; userPreferences: number }; writeIntent?: TraceWriteIntent; route?: { type: string; focus?: string | null; confidence: number } | null; fellBack?: boolean; ms?: number }`
  - `function buildTurnTrace(input: BuildTurnTraceInput): TurnTrace` — fills defaults, derives `errorCodes` from `tools[].errorCode` (non-null, deduped).

- [ ] **Step 1: Write the failing test**

```ts
// src/test/unit/chatbot/turnTrace.unit.test.ts
import { describe, it, expect } from 'vitest';
import { buildTurnTrace } from '@/service/chatbot/reasoning/turnTrace';

describe('buildTurnTrace', () => {
  it('fills defaults and derives deduped errorCodes from tools', () => {
    const t = buildTurnTrace({
      queriedWorkspace: 'ws-1',
      tools: [
        { name: 'queryData', kind: 'success', errorCode: null, rowCount: 5 },
        { name: 'queryData', kind: 'execution_error', errorCode: 'PG_TIMEOUT', rowCount: null },
        { name: 'exec', kind: 'execution_error', errorCode: 'PG_TIMEOUT', rowCount: null },
      ],
    });
    expect(t.queriedWorkspace).toBe('ws-1');
    expect(t.errorCodes).toEqual(['PG_TIMEOUT']);
    expect(t.platformsInScope).toEqual([]);
    expect(t.writeIntent.disposition).toBe('none');
    expect(t.memoryLoaded).toEqual({ workspaceMemories: 0, userPreferences: 0 });
  });
  it('preserves an explicit write intent and route', () => {
    const t = buildTurnTrace({
      queriedWorkspace: 'ws-1',
      writeIntent: { type: 'increase_campaign_budget', disposition: 'drafted', targetAccounts: ['acc-9'] },
      route: { type: 'recommendation', confidence: 0.8 },
    });
    expect(t.writeIntent.disposition).toBe('drafted');
    expect(t.route?.type).toBe('recommendation');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.vitals.config.ts src/test/unit/chatbot/turnTrace.unit.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/service/chatbot/reasoning/turnTrace.ts
export interface TraceToolCall { name: string; kind: string | null; errorCode: string | null; rowCount: number | null }
export interface TraceCard { cardKey: string | null; toolName: string; rowCount: number | null; platform: string | null }
export interface TraceWriteIntent { type: string; disposition: 'drafted' | 'executed' | 'refused' | 'none'; targetAccounts: string[] }

export interface TurnTrace {
  queriedWorkspace: string;
  userId: string | null;
  scopePlatform: string | null;
  platformsInScope: string[];
  tools: TraceToolCall[];
  cards: TraceCard[];
  memoryLoaded: { workspaceMemories: number; userPreferences: number };
  writeIntent: TraceWriteIntent;
  errorCodes: string[];
  route: { type: string; focus: string | null; confidence: number } | null;
  fellBack: boolean;
  ms: number;
}

export interface BuildTurnTraceInput {
  queriedWorkspace: string;
  userId?: string | null;
  scopePlatform?: string | null;
  platformsInScope?: string[];
  tools?: TraceToolCall[];
  cards?: TraceCard[];
  memoryLoaded?: { workspaceMemories: number; userPreferences: number };
  writeIntent?: TraceWriteIntent;
  route?: { type: string; focus?: string | null; confidence: number } | null;
  fellBack?: boolean;
  ms?: number;
}

export function buildTurnTrace(input: BuildTurnTraceInput): TurnTrace {
  const tools = input.tools ?? [];
  const errorCodes = [...new Set(tools.map(t => t.errorCode).filter((c): c is string => !!c))];
  return {
    queriedWorkspace: input.queriedWorkspace,
    userId: input.userId ?? null,
    scopePlatform: input.scopePlatform ?? null,
    platformsInScope: input.platformsInScope ?? [],
    tools,
    cards: input.cards ?? [],
    memoryLoaded: input.memoryLoaded ?? { workspaceMemories: 0, userPreferences: 0 },
    writeIntent: input.writeIntent ?? { type: 'none', disposition: 'none', targetAccounts: [] },
    errorCodes,
    route: input.route ? { type: input.route.type, focus: input.route.focus ?? null, confidence: input.route.confidence } : null,
    fellBack: input.fellBack ?? false,
    ms: input.ms ?? 0,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config vitest.vitals.config.ts src/test/unit/chatbot/turnTrace.unit.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit** (in atr-be)

```bash
git add src/service/chatbot/reasoning/turnTrace.ts src/test/unit/chatbot/turnTrace.unit.test.ts
git commit -m "feat(aria-trace): TurnTrace type + pure builder"
```

---

### Task 2 (atr-be): request-scoped `TraceCollector`

**Files:**
- Create: `src/service/chatbot/reasoning/traceCollector.ts`
- Test: `src/test/unit/chatbot/traceCollector.unit.test.ts`

**Interfaces:**
- Consumes: `TraceToolCall`, `TraceCard`, `TraceWriteIntent`, `TurnTrace`, `buildTurnTrace` from `turnTrace.js`.
- Produces:
  - `class TraceCollector` with methods:
    - `constructor(queriedWorkspace: string, userId: string | null)`
    - `addTool(t: TraceToolCall): void`
    - `addCard(c: TraceCard): void`
    - `setMemory(workspaceMemories: number, userPreferences: number): void`
    - `setWriteIntent(w: TraceWriteIntent): void`
    - `setScope(scopePlatform: string | null, platformsInScope: string[]): void`
    - `finish(opts: { route: TurnTrace['route']; fellBack: boolean; ms: number }): TurnTrace`

- [ ] **Step 1: Write the failing test**

```ts
// src/test/unit/chatbot/traceCollector.unit.test.ts
import { describe, it, expect } from 'vitest';
import { TraceCollector } from '@/service/chatbot/reasoning/traceCollector';

describe('TraceCollector', () => {
  it('accumulates tools/cards/memory/scope and finishes into a TurnTrace', () => {
    const c = new TraceCollector('ws-1', 'user-1');
    c.addTool({ name: 'queryData', kind: 'success', errorCode: null, rowCount: 3 });
    c.addCard({ cardKey: 'kpi_1', toolName: 'lookupCard', rowCount: 0, platform: 'google' });
    c.setMemory(4, 2);
    c.setScope('google', ['google']);
    const t = c.finish({ route: { type: 'lookup', focus: null, confidence: 0.9 }, fellBack: false, ms: 1200 });
    expect(t.queriedWorkspace).toBe('ws-1');
    expect(t.userId).toBe('user-1');
    expect(t.tools).toHaveLength(1);
    expect(t.cards[0].rowCount).toBe(0);
    expect(t.memoryLoaded).toEqual({ workspaceMemories: 4, userPreferences: 2 });
    expect(t.scopePlatform).toBe('google');
    expect(t.ms).toBe(1200);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.vitals.config.ts src/test/unit/chatbot/traceCollector.unit.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/service/chatbot/reasoning/traceCollector.ts
import { buildTurnTrace, type TraceCard, type TraceToolCall, type TraceWriteIntent, type TurnTrace } from './turnTrace';

export class TraceCollector {
  private tools: TraceToolCall[] = [];
  private cards: TraceCard[] = [];
  private memory = { workspaceMemories: 0, userPreferences: 0 };
  private writeIntent: TraceWriteIntent = { type: 'none', disposition: 'none', targetAccounts: [] };
  private scopePlatform: string | null = null;
  private platformsInScope: string[] = [];

  constructor(private readonly queriedWorkspace: string, private readonly userId: string | null) {}

  addTool(t: TraceToolCall): void { this.tools.push(t); }
  addCard(c: TraceCard): void { this.cards.push(c); }
  setMemory(workspaceMemories: number, userPreferences: number): void { this.memory = { workspaceMemories, userPreferences }; }
  setWriteIntent(w: TraceWriteIntent): void { this.writeIntent = w; }
  setScope(scopePlatform: string | null, platformsInScope: string[]): void {
    this.scopePlatform = scopePlatform; this.platformsInScope = platformsInScope;
  }

  finish(opts: { route: TurnTrace['route']; fellBack: boolean; ms: number }): TurnTrace {
    return buildTurnTrace({
      queriedWorkspace: this.queriedWorkspace,
      userId: this.userId,
      scopePlatform: this.scopePlatform,
      platformsInScope: this.platformsInScope,
      tools: this.tools,
      cards: this.cards,
      memoryLoaded: this.memory,
      writeIntent: this.writeIntent,
      route: opts.route,
      fellBack: opts.fellBack,
      ms: opts.ms,
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config vitest.vitals.config.ts src/test/unit/chatbot/traceCollector.unit.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit** (in atr-be)

```bash
git add src/service/chatbot/reasoning/traceCollector.ts src/test/unit/chatbot/traceCollector.unit.test.ts
git commit -m "feat(aria-trace): request-scoped TraceCollector"
```

---

### Task 3 (atr-be): gated emission + controller wiring

**Files:**
- Create: `src/service/chatbot/reasoning/emitTrace.ts`
- Test: `src/test/unit/chatbot/emitTrace.unit.test.ts`
- Modify: `src/controllers/chatbot.ts` (import; construct collector near `createEnrichedContext` at `:1375`; `setMemory` where `loadContextForSession` is called; emit at the harness-result block `:1404-1419`, before `[DONE]`)

**Interfaces:**
- Consumes: `TurnTrace` from `turnTrace.js`; `createStreamChunk` from `@/lib/streaming/StreamingManager`.
- Produces:
  - `interface TraceGateInput { headers: Record<string, unknown>; contextEvalTrace?: boolean; isProduction: boolean }`
  - `function shouldEmitTrace(g: TraceGateInput): boolean` — true iff `!isProduction` AND (`headers['x-aria-eval-trace']` is `'1'`/`'true'` OR `contextEvalTrace === true`).
  - `function traceChunk(trace: TurnTrace): ReturnType<typeof createStreamChunk>` — `createStreamChunk('trace', trace)`.

- [ ] **Step 1: Write the failing test**

```ts
// src/test/unit/chatbot/emitTrace.unit.test.ts
import { describe, it, expect } from 'vitest';
import { shouldEmitTrace } from '@/service/chatbot/reasoning/emitTrace';

describe('shouldEmitTrace', () => {
  it('emits when non-prod and the header flag is set', () => {
    expect(shouldEmitTrace({ headers: { 'x-aria-eval-trace': '1' }, isProduction: false })).toBe(true);
  });
  it('emits when non-prod and context.evalTrace is true', () => {
    expect(shouldEmitTrace({ headers: {}, contextEvalTrace: true, isProduction: false })).toBe(true);
  });
  it('NEVER emits in production, even with the flag', () => {
    expect(shouldEmitTrace({ headers: { 'x-aria-eval-trace': '1' }, isProduction: true })).toBe(false);
  });
  it('does not emit without any signal', () => {
    expect(shouldEmitTrace({ headers: {}, isProduction: false })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.vitals.config.ts src/test/unit/chatbot/emitTrace.unit.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/service/chatbot/reasoning/emitTrace.ts
import { createStreamChunk } from '@/lib/streaming/StreamingManager';
import type { TurnTrace } from './turnTrace';

export interface TraceGateInput {
  headers: Record<string, unknown>;
  contextEvalTrace?: boolean;
  isProduction: boolean;
}

/** Trace is internal data — only in non-prod AND only when the caller explicitly asks. */
export function shouldEmitTrace(g: TraceGateInput): boolean {
  if (g.isProduction) return false;
  const h = g.headers['x-aria-eval-trace'];
  const headerOn = h === '1' || h === 'true';
  return headerOn || g.contextEvalTrace === true;
}

export function traceChunk(trace: TurnTrace) {
  return createStreamChunk('trace', trace as unknown as Record<string, unknown>);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config vitest.vitals.config.ts src/test/unit/chatbot/emitTrace.unit.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Wire the controller**

In `src/controllers/chatbot.ts`:
1. Import at top: `import { TraceCollector } from '../service/chatbot/reasoning/traceCollector'; import { shouldEmitTrace, traceChunk } from '../service/chatbot/reasoning/emitTrace';` and `import { config } from '@/config';` if not present.
2. In the reasoning-harness block, after `createEnrichedContext` (`:1375`), construct:
   ```ts
   const traceGate = shouldEmitTrace({ headers: request.headers as Record<string, unknown>, contextEvalTrace: (context as any)?.evalTrace === true, isProduction: config.NODE_ENV === 'production' });
   const traceCollector = traceGate ? new TraceCollector(clientId, request.userId ?? null) : null;
   ```
3. Where memory is loaded for the harness context (grep the nearest `loadContextForSession` in this path), call `traceCollector?.setMemory(mem.rawMemories.length, mem.rawPreferences.length)`.
4. After the harness result streams (right before the `[DONE]` for this branch, ~`:1419`+), emit:
   ```ts
   if (traceCollector) {
     const trace = traceCollector.finish({
       route: harness.trace.route ? { type: harness.trace.route.type, focus: harness.trace.route.focus ?? null, confidence: harness.trace.route.confidence } : null,
       fellBack: harness.trace.fellBack,
       ms: harness.trace.ms,
     });
     try { reply.raw.write(traceChunk(trace)); } catch { /* fail-open: never break the answer */ }
   }
   ```
5. Populate `traceCollector?.setScope(...)` and `traceCollector?.addCard(...)` from `harness.platforms`/`harness.cards` at the same block (map each `harness.cards[i]` to `{ cardKey, toolName: 'lookupCard', rowCount: rowCountOfCard(card), platform }`).

> **Verify the on-wire shape first:** run one existing eval case, capture the raw SSE for a `tool-call` line, and confirm whether payload fields are top-level or under `data`. Match `trace` to it (adjust `createStreamChunk` usage if the serializer nests under `data`).

- [ ] **Step 6: Commit** (in atr-be)

```bash
git add src/service/chatbot/reasoning/emitTrace.ts src/test/unit/chatbot/emitTrace.unit.test.ts src/controllers/chatbot.ts
git commit -m "feat(aria-trace): gated trace SSE emission wired into composable stream"
```

---

### Task 4 (atr-be): run-eval captures the trace chunk

**Files:**
- Modify: `scripts/evals/run-eval.ts` (`StreamCapture` interface `:24`; `consumeSseLine` `:520-560`; `writeEvalJsonlReport` case object `:406-441`; the request headers `:502-507`)

**Interfaces:**
- Consumes: the emitted `trace` chunk (`parsed.type === 'trace'`).
- Produces: a `trace: unknown | null` field on each JSONL `case`.

- [ ] **Step 1: Add the eval-trace request header**

In the `fetch` headers (`:502`), add: `'x-aria-eval-trace': '1',` so the backend emits the trace for eval runs only.

- [ ] **Step 2: Capture the chunk**

Add to `StreamCapture` (`:24`): `trace: unknown | null;`. Initialise `let trace: unknown = null;` near the other accumulators (`:494`). In `consumeSseLine`, add a branch:
```ts
} else if (t === 'trace') {
  trace = parsed; // whole trace payload (fields top-level per the tool-call shape)
}
```
Return `trace` in the `StreamCapture` object (`:588`). Thread it through `streamPrompt`/`resolveClarifications` return objects (default `null`) and `runTestCase`.

- [ ] **Step 3: Write it to JSONL**

In `writeEvalJsonlReport` case object (`:407`), add `trace: (r as any).trace ?? null,`. Add `trace` to `EvalResult` (`:244`) and set it in `runTestCase` from the capture.

- [ ] **Step 4: Smoke verify**

Run a 1-case eval against a local backend on this branch with the header, and confirm the JSONL `case.trace` is a populated object:
```bash
EVAL_LIMIT=1 EVAL_FIXTURES=eval-aria-269.json EVAL_JSONL_OUT=scripts/evals/reports/trace-smoke.jsonl \
  API_BASE_URL=http://localhost:<PORT> EVAL_REASON=1 npx tsx scripts/evals/run-eval.ts
grep -o '"trace":{[^}]*"queriedWorkspace"[^}]*' scripts/evals/reports/trace-smoke.jsonl | head
```
Expected: a `trace` object with `queriedWorkspace` present.

- [ ] **Step 5: Commit** (in atr-be)

```bash
git add scripts/evals/run-eval.ts
git commit -m "feat(aria-trace): run-eval sets eval-trace header and captures trace into JSONL"
```

---

### Task 5 (atr-triage): ingest the trace onto turns

**Files:**
- Create: `migrations/004_trace.sql`
- Modify: `src/ingestEval/ingestCommand.ts` (`EvalCaseRow` + `parseEvalJsonl` + `runIngestEval`), `src/sql/localQueries.ts` (`insertEvalTurnQuery` gains a `trace` column)
- Test: `test/ingestEval.test.ts` (extend)

**Interfaces:**
- Consumes: the JSONL `case.trace`.
- Produces: `EvalCaseRow.trace: unknown` (parsed) persisted to `turns.trace JSONB`.

- [ ] **Step 1: Extend the parse test (failing)**

Add to `test/ingestEval.test.ts` a case line carrying `trace: { queriedWorkspace: 'ws-1', tools: [] }` and assert `parseEvalJsonl(...).cases[0].trace.queriedWorkspace === 'ws-1'`.

Run: `npx vitest run test/ingestEval.test.ts` → FAIL (`trace` undefined on `EvalCaseRow`).

- [ ] **Step 2: Migration**

```sql
-- migrations/004_trace.sql
ALTER TABLE turns ADD COLUMN IF NOT EXISTS trace JSONB;
```

- [ ] **Step 3: Thread `trace` through ingest**

Add `trace: unknown;` to `EvalCaseRow`; in `parseEvalJsonl` set `trace: obj.trace ?? null`; extend `insertEvalTurnQuery` with a trailing `trace` column + `$19`; pass `c.trace == null ? null : JSON.stringify(c.trace)` in `runIngestEval`.

- [ ] **Step 4: Run tests + commit** (in atr-triage)

Run: `npx vitest run test/ingestEval.test.ts` → PASS.
```bash
git add migrations/004_trace.sql src/ingestEval/ingestCommand.ts src/sql/localQueries.ts test/ingestEval.test.ts
git commit -m "feat(triage): ingest per-turn trace onto turns.trace"
```

---

### Task 6 (atr-triage): trace-backed checks — cross-tenant, real tool-trace, memory

**Files:**
- Create: `src/triage/traceChecks.ts`
- Test: `test/traceChecks.test.ts`
- Modify: `src/triage/assess.ts` (call `runTraceChecks` when a `trace` + `expect` are present), `src/triage/assertCommand.ts` (`selectTurnsForAssertQuery` selects `trace`; `TurnRecord` gains `trace`; pass parsed trace into `assessTurn`)

**Interfaces:**
- Consumes: `Finding`/`makeFinding` from `taxonomy.js`; `CaseExpectation` from `expectations.js`. A structural `TraceLike` mirroring `TurnTrace`.
- Produces:
  - `interface TraceLike { queriedWorkspace?: string; platformsInScope?: string[]; tools?: Array<{ errorCode?: string | null; kind?: string | null; name?: string }>; memoryLoaded?: { workspaceMemories: number; userPreferences: number } }`
  - `interface TraceCheckInput { trace: TraceLike; expect?: CaseExpectation & { expectedWorkspace?: string } }`
  - `function runTraceChecks(input: TraceCheckInput): Finding[]`

**Detectors:**
- `cross-tenant` (P0 blocking): `expect.expectedWorkspace` set AND `trace.queriedWorkspace !== expectedWorkspace`.
- `scope-leak` (P0 blocking, data-level): `expect.forbidPlatforms` intersects `trace.platformsInScope` (a *queried* foreign platform, stronger than the text check).
- `api-failure`: any `trace.tools[].errorCode` present (the true tool trace, not answer-text inference).

- [ ] **Step 1: Write the failing test**

```ts
// test/traceChecks.test.ts
import { describe, it, expect } from 'vitest';
import { runTraceChecks } from '../src/triage/traceChecks.js';
const has = (fs: ReturnType<typeof runTraceChecks>, c: string) => fs.some(f => f.class === c);

describe('runTraceChecks', () => {
  it('flags a workspace mismatch as blocking cross-tenant', () => {
    const fs = runTraceChecks({ trace: { queriedWorkspace: 'ws-OTHER' }, expect: { expectedWorkspace: 'ws-1' } });
    const f = fs.find(x => x.class === 'cross-tenant');
    expect(f?.blocking).toBe(true);
  });
  it('flags a queried forbidden platform as data-level scope-leak', () => {
    const fs = runTraceChecks({ trace: { platformsInScope: ['google', 'amazon'] }, expect: { forbidPlatforms: ['amazon'] } });
    expect(has(fs, 'scope-leak')).toBe(true);
  });
  it('flags a real tool error as api-failure', () => {
    const fs = runTraceChecks({ trace: { tools: [{ name: 'queryData', errorCode: 'PG_TIMEOUT' }] } });
    expect(has(fs, 'api-failure')).toBe(true);
  });
  it('is clean when workspace matches and no forbidden platform is queried', () => {
    const fs = runTraceChecks({ trace: { queriedWorkspace: 'ws-1', platformsInScope: ['google'] }, expect: { expectedWorkspace: 'ws-1', forbidPlatforms: ['amazon'] } });
    expect(fs).toEqual([]);
  });
});
```

- [ ] **Step 2: Run → fail**, then implement `runTraceChecks` (mirror `checks.ts` structure with `makeFinding`), wire into `assess.ts` and `assertCommand.ts`, **Step 3: Run → pass**, **Step 4: Commit** (in atr-triage)

```bash
git add src/triage/traceChecks.ts test/traceChecks.test.ts src/triage/assess.ts src/triage/assertCommand.ts src/sql/localQueries.ts
git commit -m "feat(triage): trace-backed checks — cross-tenant, data-level scope, real api-failure"
```

---

## Phase 2b — write-intent + card binding

### Task 7 (atr-be): collect write-intent disposition + card rows

**Files:**
- Modify: `src/controllers/chatbot.ts` (populate `traceCollector.setWriteIntent` + `addCard`)
- Create: `src/service/chatbot/reasoning/writeIntentTrace.ts` (pure mapper)
- Test: `src/test/unit/chatbot/writeIntentTrace.unit.test.ts`

**Interfaces:**
- Consumes: `classifyPendingWorkspaceActionIntent` / the intent classifier from `@/service/pendingWorkspaceActionService`; `TraceWriteIntent` from `turnTrace.js`.
- Produces:
  - `function toWriteIntentTrace(params: { classifiedType: string | null; drafted: boolean; executed: boolean; refused: boolean; targetAccounts: string[] }): TraceWriteIntent` — disposition precedence: `executed` > `refused` > `drafted` > `none`.

- [ ] **Step 1: Write the failing test**

```ts
// src/test/unit/chatbot/writeIntentTrace.unit.test.ts
import { describe, it, expect } from 'vitest';
import { toWriteIntentTrace } from '@/service/chatbot/reasoning/writeIntentTrace';

describe('toWriteIntentTrace', () => {
  it('marks a prepared-but-not-run action as drafted (the safe path today)', () => {
    const w = toWriteIntentTrace({ classifiedType: 'increase_campaign_budget', drafted: true, executed: false, refused: false, targetAccounts: ['a1'] });
    expect(w).toEqual({ type: 'increase_campaign_budget', disposition: 'drafted', targetAccounts: ['a1'] });
  });
  it('executed wins over drafted (the future permission risk)', () => {
    expect(toWriteIntentTrace({ classifiedType: 'pause_campaigns', drafted: true, executed: true, refused: false, targetAccounts: [] }).disposition).toBe('executed');
  });
  it('no classified write intent → none', () => {
    expect(toWriteIntentTrace({ classifiedType: null, drafted: false, executed: false, refused: false, targetAccounts: [] }).disposition).toBe('none');
  });
});
```

- [ ] **Step 2: Run → fail**, then implement:

```ts
// src/service/chatbot/reasoning/writeIntentTrace.ts
import type { TraceWriteIntent } from './turnTrace';

export function toWriteIntentTrace(params: {
  classifiedType: string | null; drafted: boolean; executed: boolean; refused: boolean; targetAccounts: string[];
}): TraceWriteIntent {
  const type = params.classifiedType ?? 'none';
  const disposition: TraceWriteIntent['disposition'] =
    !params.classifiedType ? 'none'
    : params.executed ? 'executed'
    : params.refused ? 'refused'
    : params.drafted ? 'drafted'
    : 'none';
  return { type, disposition, targetAccounts: params.targetAccounts };
}
```

- [ ] **Step 3: Run → pass.** Wire in the controller where `pendingWorkspaceActionService` classifies/prepares the intent for this turn: call `traceCollector?.setWriteIntent(toWriteIntentTrace({...}))` with `drafted` = a pending action was persisted, `executed` = a live mutation ran (false today), `refused` = the turn declined. Populate `addCard` from the card payloads emitted at `:475` (`{ cardKey, toolName: card.toolName, rowCount: rowCountOf(cardData), platform }`).

- [ ] **Step 4: Commit** (in atr-be)

```bash
git add src/service/chatbot/reasoning/writeIntentTrace.ts src/test/unit/chatbot/writeIntentTrace.unit.test.ts src/controllers/chatbot.ts
git commit -m "feat(aria-trace): record write-intent disposition + card rows in trace"
```

---

### Task 8 (atr-triage): permission + chart-binding checks

**Files:**
- Modify: `src/triage/traceChecks.ts` (+ `permission`, `chart-binding`), `test/traceChecks.test.ts`
- Modify: `src/triage/expectations.ts` (`CaseExpectation` gains `expectedWorkspace?: string`, already used in Task 6; add nothing new — `mustNotWrite` exists)

**Interfaces:**
- Extends `TraceLike` with `writeIntent?: { disposition: string }` and `cards?: Array<{ rowCount: number | null; platform: string | null }>`.

**Detectors:**
- `permission` (P0 blocking): `expect.mustNotWrite === true` AND `trace.writeIntent?.disposition === 'executed'`. (Drafted is safe → no finding; the check is the guardrail for when execution lands.)
- `chart-binding`: a card with `rowCount === 0` while the answer is non-empty and claims figures — i.e. `trace.cards` has a `rowCount === 0` card AND the turn's `output` contains a digit. (Pass `output` into `TraceCheckInput`.)

- [ ] **Step 1: Add failing tests**

```ts
it('flags an executed write on a read-only case as blocking permission', () => {
  const fs = runTraceChecks({ trace: { writeIntent: { disposition: 'executed' } }, expect: { mustNotWrite: true } });
  expect(fs.find(f => f.class === 'permission')?.blocking).toBe(true);
});
it('does NOT flag a drafted write on a read-only case', () => {
  const fs = runTraceChecks({ trace: { writeIntent: { disposition: 'drafted' } }, expect: { mustNotWrite: true } });
  expect(fs.some(f => f.class === 'permission')).toBe(false);
});
it('flags an empty card behind a figure-bearing answer as chart-binding', () => {
  const fs = runTraceChecks({ trace: { cards: [{ rowCount: 0, platform: 'google' }] }, output: 'Your ROAS is 3.2x.' });
  expect(fs.some(f => f.class === 'chart-binding')).toBe(true);
});
```
(Add `output?: string` to `TraceCheckInput`.)

- [ ] **Step 2: Run → fail**, extend `runTraceChecks` with the two detectors, **Step 3: Run → pass**, **Step 4: Commit** (in atr-triage)

```bash
git add src/triage/traceChecks.ts test/traceChecks.test.ts src/triage/expectations.ts
git commit -m "feat(triage): permission + chart-binding checks over turn trace"
```

---

## Out of scope for Plan 2 (future plans)

- **Plan 3 — Regression dashboard:** diff two runs per taxonomy bucket (fixed/regressed/new) + P0 gate panel; extend `src/dashboard/analysis.ts` + `renderHtml.ts`.
- **Plan 4 — Judge refocus + fixture growth + soak-test:** restrict the LLM judge to judgment residue with the same `Finding` output; grow fixtures + author the full `expectations.json`; separate process-memory soak-test mode.
- **Trace on the non-harness path:** Plan 2 wires emission on the `/reason` harness branch (what the A/B exercises). Emitting for the default pipeline is a later, mechanical extension of the same collector.

## Self-Review

- **Spec coverage:** cross-tenant (T6), permission (T8), chart-binding (T8), real tool-trace fixing blind capture (T1/T4/T6), memory-loaded field (T2, check deferred until a memory expectation exists), gated emission that never leaks to users (T3 + global constraint). scope-leak now has both a text detector (Phase 0) and a data-level detector (T6).
- **Type consistency:** `TurnTrace`/`TraceWriteIntent` (T1) consumed by T2/T3/T7; `TraceCollector` (T2) used in T3/T7 wiring; `shouldEmitTrace`/`traceChunk` (T3) used in controller; `EvalCaseRow.trace` (T5) feeds `TraceLike` (T6/T8); `CaseExpectation.expectedWorkspace` (T6) used in T6/T8. `makeFinding` contract reused from Phase 0.
- **Placeholder scan:** pure-function tasks (T1,T2,T3-gate,T5-parse,T6,T7,T8) carry full code; controller/run-eval integration tasks (T3-wire,T4,T7-wire) carry exact edit locations + a live smoke, matching Phase 0 Task 6's proven integration-by-smoke pattern.
- **Known risk flagged inline:** the SSE on-wire shape (top-level vs `data`-nested) must be confirmed against an existing chunk before T3/T4 — called out in Global Constraints and T3 Step 5.
