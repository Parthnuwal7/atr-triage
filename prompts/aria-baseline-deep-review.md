# ARIA baseline deep benchmark review

Review the attached `*.review.csv`, which contains one captured ARIA benchmark response per row. The run is pure baseline ARIA; do not assume an ambiguity resolver or reasoning harness exists.

Your primary task is causal diagnosis: when a response is wrong, identify the first observable stage where the execution diverged, explain how that caused the final error, and distinguish the root cause from downstream symptoms. Use the row's resolved `expected_json` and `rubric` as the case-specific source of truth. Do not substitute figures from another workspace or an older benchmark. Treat `deterministic_validation_json` and `failure_signals_json` as diagnostic hypotheses, not infallible judges.

## Evidence columns

- `run_status`, `captured_cases`, `planned_cases`: completion and coverage; partial rows remain judgeable but cannot represent a full benchmark rate.
- `scenario_category`, `user_query`, `answer_text`: intended behavior and final response.
- `expected_json`, `rubric`: resolved seeded ground truth and behavioral contract.
- `path_signature`, `process_trace_json`: ordered request, route/status, planning, tool, visual, synthesis, and terminal evidence for every retry. Tool calls and results are paired where observable.
- `failure_signals_json`: automatically detected candidate failures. Verify them against raw evidence before accepting them.
- `attempt_history_json`: every retry, including incomplete attempts and their outputs/errors.
- `tool_trace`, `expected_tool`, `tool_called`: normalized routing and data-retrieval evidence retained by triage.
- `visual_artifacts_json`: emitted chart/dashboard/card payloads, including raw data.
- `visual_validation_json`: automated schema, expected-point, comparison, and narrative checks.
- `terminal_status`, `evidence_status`, timings, model/repeat/provenance: execution quality and repeatability context.

An empty tool trace means tool evidence is unavailable; it does not by itself prove hallucination. Baseline SSE does not expose every internal worker decision. If a route or internal decision is marked unobservable, report it as unknown rather than inferring hidden reasoning. No private model reasoning is logged. If evidence is insufficient for a correctness or causal claim, use `insufficient-evidence` instead of guessing. `render_status: not_observed` means this API run did not test browser rendering; do not penalize it as a rendering failure.

## Causal review method

For each row:

1. Compare the answer and any visual payload with the rubric and expected values.
2. Read attempts and stages in time order; retries are evidence, not discarded noise.
3. Find the first observable divergence. Examples: wrong route, required tool not selected, tool error, empty/wrong-scope data, correct tool data bound incorrectly into a chart, or correct evidence synthesized into a wrong answer.
4. Cite the specific route, tool call/result, artifact field, validation mismatch, error, or retry difference proving that divergence.
5. State the causal chain from first divergence to final symptom. Do not label answer synthesis as the root cause when an earlier tool/data failure explains it.
6. If the trace proves only the symptom, leave the root cause unknown and lower confidence.

## Per-row judgment

Preserve every input row and every evidence column exactly. Fill only the review columns:

- `verdict`: `good`, `needs-work`, `broken`, or `insufficient-evidence`.
- `category`: closest user-visible failure class, such as `hallucination`, `wrong-data`, `wrong-scope`, `missed-clarify`, `wrong-refusal`, `tool-error`, `empty-result`, `visual-missing`, `visual-schema`, `visual-data`, `visual-comparison`, `visual-narrative`, `formatting`, or `other`. Leave blank for clean `good` rows.
- `severity`: `low`, `med`, or `high`.
- `failure_stage`: first observable failed stage: `request`, `model-routing`, `planning`, `tool-selection`, `tool-execution`, `data-retrieval`, `visual-generation`, `visual-data-binding`, `answer-synthesis`, `streaming`, `stability`, `none`, or `unknown`.
- `failed_component`: responsible observable route, tool, card/dashboard, stream, or synthesizer; use `unknown` when not established.
- `process_error`: concise description of what went wrong at that stage.
- `causal_evidence`: compact citation to exact trace evidence, such as a stage index/time, tool name plus result/error/row count, artifact field/value, or two differing retry paths.
- `likely_root_cause`: careful causal explanation. Clearly mark inference when direct proof is absent.
- `fix_layer`: `routing`, `planner`, `tool`, `data`, `visualization`, `synthesis`, `infra`, `none`, or `unknown`.
- `rationale`: one concise evidence-based verdict sentence.
- `dimensions_json`: integer scores from 0–4 for `correctness`, `grounding`, `relevance`, `scope`, `chartChoice`, and `usefulness`.
- `confidence`: 0–1, reflecting both correctness and causal confidence.
- `evidence_sufficiency`: `sufficient`, `partial`, `missing`, or `contradictory`.
- `reviewer_notes`: optional compact debugging detail, including downstream symptoms or alternate hypotheses.

For a clean row, use `failure_stage=none`, `failed_component=none`, `process_error` and `likely_root_cause` blank, and `fix_layer=none`. For visual assessment, separately decide whether the artifact was emitted, structurally usable, appropriate for the question, scoped to the right platform/account/date window, contains the correct points and comparison, and agrees with the written answer. A correct answer with a wrong chart is not fully `good`; identify `visual-generation` or `visual-data-binding` as appropriate and cite the bad payload value.

Write the completed file as `<input-stem>.judged.csv` using real CSV quoting. Do not skip or reorder rows.

## Deep report

After the judged CSV is complete, write `<input-stem>.insights.md` containing:

1. Run integrity: complete/partial status, captured/planned coverage, errors/timeouts, and evidence sufficiency.
2. Headline quality: verdict counts and rates, clearly labeled as partial when applicable.
3. Process-stage funnel: route, planning, tool selection/execution, retrieval, visual binding, synthesis, and terminal failure counts.
4. Root-cause analysis: first-failure-stage and fix-layer counts, causal chains, and example message ids. Keep downstream symptoms separate.
5. Numeric correctness: exact-value, ratio, temporal, false-premise, missing-data, and hallucination findings.
6. Visual correctness: emission rate, schema/type, scope, data-point, comparison, and narrative-consistency findings. Keep browser rendering separate as not observed.
7. Routing/tool performance: wrong/missing/error calls and the evidence for the responsible layer.
8. Performance: TTFB/TTFT/total latency distribution and timeout/retry outliers when available.
9. Stability: disagreement and path divergence across attempts/repeats for the same `case_id`.
10. Ranked systemic issues, watch-list cases with thin evidence, and recommended next experiments without proposing ambiguity-resolver or harness changes unless explicitly asked.

Also write `<input-stem>.benchmark-report.json` with machine-readable totals plus per-category, per-visual, per-tool, per-path, per-failure-stage, per-fix-layer, and per-repeat aggregates corresponding to the markdown report. Never claim full-benchmark rates for a partial run.
