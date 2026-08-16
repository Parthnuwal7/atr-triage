# ARIA deep benchmark review workflow

Incomplete local runs are retained as `partial`; their captured cases and failed attempts remain available for diagnosis and judging. Partial runs are visibly labeled and cannot be used as an A/B baseline comparison. Malformed JSON and impossible over-counts remain rejected as corrupt evidence.

After ingesting an ARIA JSONL file, export the evidence-rich review CSV:

```bash
LOCAL_DATABASE_URL=/tmp/aria-triage-<run> pnpm triage ingest-eval \
  --jsonl ../atr-be/logs/<run>/eval.jsonl

LOCAL_DATABASE_URL=/tmp/aria-triage-<run> pnpm triage judge-csv \
  --run <triage-run-id> --out ../atr-be/logs/<run>/aria.review.csv
```

Give `aria.review.csv` and `prompts/aria-baseline-deep-review.md` to the reviewer. The completed `aria.judged.csv` preserves every evidence column and fills both quality judgment and causal diagnosis: first failed stage, failed component, observed process error, exact causal evidence, likely root cause, and fix layer. The same review produces `aria.insights.md` and `aria.benchmark-report.json` for deeper reporting.

Import the per-row verdicts and sibling insights back into triage:

```bash
LOCAL_DATABASE_URL=/tmp/aria-triage-<run> pnpm triage import \
  --csv ../atr-be/logs/<run>/aria.judged.csv --run <triage-run-id>

LOCAL_DATABASE_URL=/tmp/aria-triage-<run> pnpm triage dashboard \
  --run <triage-run-id> --name aria-baseline-<run>
```

The review CSV includes resolved expectations and rubric, answer text, normalized tool evidence, ordered process stages and path signature, every retry path, machine-detected failure signals, complete chart/dashboard payloads and automated visual validation, run/case/repeat/model provenance, terminal state, evidence status, and timing/accuracy fields.

The judge treats automated signals as hypotheses. It must locate the first observable divergence and distinguish it from downstream symptoms—for example, wrong-scope tool data that later creates both an incorrect chart and answer. A hidden internal worker decision remains `unknown`; it must not be invented from private reasoning. Secrets and private model reasoning are not part of the logger output.
