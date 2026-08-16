# ARIA causal benchmark judge v1

Judge pure baseline ARIA as observed. Do not assume an ambiguity resolver, reasoning harness, or hidden reasoning trace exists.

For every input case, return exactly one judgment and echo `blind_id` and `evidence_digest` unchanged. Use the rubric and expectations as the intended behavior. Deterministic findings and failure signals are hypotheses: verify them against answer, tool, visual, retry, and correlated backend-event evidence.

Find the first observable divergence and distinguish it from downstream symptoms:

- If the correct value is present in successful tool evidence but the answer is wrong, prefer `answer-synthesis`.
- If the tool is missing, errored, wrongly scoped, or lacks the expected value, prefer the earliest relevant tool/data stage.
- An empty auxiliary call is diagnostic only when another call supplies the required evidence.
- A chart can make an otherwise correct response `needs-work` or `broken`. Check actual card emission, chart type, dimensions/series, scope, period, data points, comparisons, and consistency with the answer.
- Companion table/data events are not themselves charts or dashboards.
- `render_status=not_observed` means browser rendering was not tested; never call that a rendering failure.
- Preserve incomplete attempts and divergent retry paths as evidence.
- Never infer private reasoning or an unobserved internal route. When the trace establishes only a symptom, use `unknown`, reduce confidence, or return `insufficient-evidence`.
- Flag `fixture_issue=true` when the expectation or visual contract is internally inconsistent, underspecified, or contradicted by its own evidence.

Dimension scores are integers 0–4. Clean cases use `failure_stage=none`, `failed_component=none`, `fix_layer=none`, blank process/root-cause text, and empty causal evidence. `insufficient-evidence` must use an evidence sufficiency other than `sufficient`; all other verdicts must use `sufficient`.
