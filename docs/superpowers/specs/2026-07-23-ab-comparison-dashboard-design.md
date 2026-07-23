# A/B Comparison Dashboard (spider + delta charts)

**Date:** 2026-07-23
**Repo:** `atr-triage`
**Status:** design approved, pending implementation

## Problem

`pnpm triage dashboard --run <id>` renders a single run (verdict-split donut +
failure-category bars). Comparing two runs — e.g. ARIA with vs without the
reasoning harness — means eyeballing two separate HTML files across 31 categories.
There is no view that shows *what* changed or *where*.

## Goal

Add an optional second run to the dashboard and render an A/B comparison:
two radar ("spider") charts plus supporting delta charts, so drift between arms is
readable at a glance.

Single-run output is unchanged; `--compare` is purely additive.

## Command

```
pnpm triage dashboard --run <A> --compare <B> --name aria-ab
```

`--run` is the **baseline** (arm A), `--compare` is the **candidate** (arm B).
Deltas read as B − A.

## Charts

### 1. Quality-dimensions radar — *what kind* of quality moved
Seven axes, 0–100, higher is better, two overlaid polygons:

| Axis | Source |
|---|---|
| Verdict pass % | `verdicts.verdict = 'pass'` / judged turns |
| Tool-routing % | `tool_called` matches `expected_tool` (alias-aware) / turns with an `expected_tool` |
| Accuracy score | mean `turns.accuracy_score` (already 0–100) |
| Speed | inverted median `total_time_ms` |
| Cost efficiency | inverted mean `cost_usd` |
| Error-free % | share of turns whose `answer_text` does **not** start with `ERROR:` |
| Step efficiency | inverted mean `steps` |

**Normalization.** Pass/routing/accuracy/error-free are already percentages.
Speed, cost and steps have no natural 0–100, so they are scaled **relative to the
pair**: the better arm scores 100, the other scores `100 × better/worse`. When only
one run is rendered, these three axes score 100 (nothing to compare against) and
the chart carries a caption saying so — the radar is a *comparison* instrument.

**Zero-denominator rule.** Any axis whose denominator is 0 (e.g. no judged
verdicts) renders as 0 and is listed in a "not measured" caption rather than
silently reading as a failure.

### 2. Category-family radar — *where* it moved
The 31 fixture categories collapse to 7 families; each axis is that family's
verdict pass rate.

| Family | Categories |
|---|---|
| Lookup & Reporting | Normal Lookup, Breakdown, Output-Format, Filter, Scale |
| Ambiguity & Clarify | Ambiguous, Long+Ambiguous, Entity-Disambiguation, Decision Boundary, Preference |
| Intent & Reasoning | Indirect-Intent, Multi-Intent, Metric Semantics, Baseline-Is-this-good, Case-Based |
| Navigation & Product | Navigation, Navigation-Boundary, Navigation-Nonexistent, Meta/Product, Slash Command |
| Safety & Robustness | Adversarial, Hallucination, False-Premise, Data-Availability, Data-Quality |
| Correctness & Temporal | Correctness, Temporal, Linguistic |
| Action & Forecast | Action, Forecast, Recommendation-Lifecycle |

All 31 categories are mapped. An unrecognised category falls into
**Uncategorized**, which is rendered only when non-empty (so fixture growth is
visible rather than silently dropped).

### 3. KPI delta tiles
Pass %, median latency, total cost, error count — each showing A → B and a signed
delta, coloured by direction (improvement vs regression, not by raw sign).

### 4. Per-category delta bars
Diverging horizontal bars, one per category, value = `passRate(B) − passRate(A)` in
percentage points, sorted worst-regression first. This is the actionable view:
exactly which categories the change helped or hurt.

### 5. Verdict split, grouped
pass / partial / fail / error as paired bars (A vs B), replacing the single-run
donut when comparing.

## Implementation

- **`src/dashboard/svg.ts`** — add `renderRadar()`, `renderDivergingBars()`,
  `renderGroupedBars()`, matching the existing hand-rolled inline-SVG style. No
  chart library; output stays a self-contained HTML artifact.
- **`src/dashboard/analysis.ts`** — add `CATEGORY_FAMILIES` map, `loadComparison(local, runA, runB)`
  returning a `ComparisonModel` (per-arm dimension scores, family scores, per-category
  pass rates, KPI totals). Keep `loadAnalysis` untouched for the single-run path.
- **`src/dashboard/renderHtml.ts`** — add `renderComparisonHtml(model)`; existing
  `renderDashboardHtml` unchanged.
- **`src/dashboard/dashboardCommand.ts`** — accept optional `compareRunId`; branch
  to the comparison renderer. Record the dashboard row as today.
- **`src/cli.ts`** — pass `--compare`.

### Related fix (in scope)
`src/ingestEval/ingestCommand.ts` currently derives `messageId = c.id || case-<index>`,
but the eval JSONL carries `scenario_tag` (e.g. `LOOK-01`) and writes `id: null`.
Read it: `c.id ?? c.scenario_tag ?? case-<index>`. This restores traceable ids in the
dashboard and golden set. **No atr-be change is needed** — the field is already emitted.

### Not used
`signal_*` columns are populated only by `extract` (prod path), never by
`ingest-eval`, so they are not used for eval comparisons; "Error-free %" is derived
from the `ERROR:` prefix instead.

## Testing

- Unit (vitest, matching existing `test/`): `CATEGORY_FAMILIES` covers all 31 fixture
  categories exactly once; dimension normalization (relative scaling, zero-denominator
  → 0 + caption); family pass-rate aggregation; diverging-bar ordering.
- Pure-function boundary: analysis returns a model; renderers take the model. Charts
  are asserted on the model, not by parsing SVG.
- Manual: generate a comparison from the two real arms and open the HTML.

## Non-goals
No trends/history view, no tool-confusion matrix, no React app, no new route or
server. Interactivity limited to optional inline vanilla JS (hover labels); no
framework or build step.

## Risk
Low and contained: additive command flag, new render path, existing single-run
output untouched. The main judgement call is the family mapping, which is data, not
logic, and easy to revise.
