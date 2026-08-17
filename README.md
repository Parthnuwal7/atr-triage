# atr-triage

Local, read-only ARIA log triage & grading. Reads the product DB, flags suspicious turns,
ingests LLM-judge verdicts, and produces versioned HTML dashboards + a golden set.

The local store is embedded **PGlite** (real Postgres, in-process) — no Docker, no WSL,
no container. Data persists to the `LOCAL_DATABASE_URL` directory (e.g. `./localdb`).

## Setup
1. `cp .env.example .env` and fill `PROD_READ_DATABASE_URL` (read-only role). Leave
   `LOCAL_DATABASE_URL=./localdb` (a folder path, not a postgres URL).
2. `pnpm install`
3. `pnpm migrate`

## Run ids

Every ingest mints a `runId` (a UUID, PK of the `runs` table) and **prints it**:

```
✓ ingested 245 eval cases · run a5dda80c-c231-4cab-9b85-dc8cad10f00d
```

That id ties together the turns, the verdicts you import, and the dashboard you
generate — pass it to every later step. Each source (or each A/B arm) gets its own
runId, which is what keeps them separate. There is no `runs list` command yet, so
capture it:

```bash
RUN=$(pnpm triage ingest-eval --jsonl ../atr-be/scripts/evals/reports/foo.jsonl \
      | grep -oE '[0-9a-f-]{36}')
```

## Loop A — triage production logs

```
pnpm triage extract --workspace <uuid> --from 2026-07-01 --to 2026-07-07     # → reports/*.csv  (add --all for full sweep)
# judge the CSV with prompts/judge-prompt.md in Cursor/etc → save *.judged.csv
pnpm triage import --csv reports/<file>.judged.csv
pnpm triage dashboard --run <runId> --name july-w1                            # → dashboards/*.html
pnpm triage golden add --run <runId> --message <messageId>
pnpm triage golden export --out golden-benchmark.json
```

Here `message_id` values are real product ids (21-char nanoids).

## Loop B — benchmark eval runs (atr-be)

Grades a `run-eval.ts` JSONL report from the chat evals instead of prod logs.

```bash
# 1. produce the JSONL in atr-be
cd ../atr-be
node scripts/evals/chat-eval.mjs run aria-benchmark
cp scripts/evals/reports/aria-benchmark-last-run.jsonl \
   scripts/evals/reports/aria-no-harness.jsonl          # the suite always writes the same path — copy it

# 2. ingest → prints the runId
cd ../atr-triage
pnpm triage ingest-eval --jsonl ../atr-be/scripts/evals/reports/aria-no-harness.jsonl

# 3. emit the CSV to judge
pnpm triage judge-csv --run <runId> --out reports/aria-no-harness.csv

# 4. judge reports/aria-no-harness.csv with prompts/judge-prompt.md → save as
#    reports/aria-no-harness.judged.csv   (see "Judging" below)

# 5. import the verdicts + build the dashboard
pnpm triage import    --csv reports/aria-no-harness.judged.csv --run <runId>
pnpm triage dashboard --run <runId> --name aria-no-harness      # → dashboards/*.html
```

Repeat for a second arm (e.g. `EVAL_REASON=1` for the reasoning harness) to get two
runIds and two comparable dashboards.

For a trustworthy paired experiment, create the seeded interleaved schedule first:

```bash
pnpm triage plan-benchmark \
  --fixture ../atr-be/scripts/evals/fixtures/eval-aria-benchmark.json \
  --approaches baseline,harness --repeats 3 --seed 42 \
  --prompt-version aria-judge-v2 --out reports/experiment.json
```

The manifest fixes case order, balanced arm order, repeats, fixture version, judge-prompt
version, and provenance. Run each listed attempt with the matching approach configuration,
then pass its linkage to `run-eval.ts`; the runner writes it into the JSONL `run_start` record:

```bash
pnpm tsx scripts/evals/run-eval.ts \
  --experiment-id <experimentId> --approach-id baseline --repeat-index 0 \
  --seed 42 --prompt-version aria-judge-v2 --jsonl-out reports/baseline-r0.jsonl
```

Ingesting that report marks the matching planned attempts complete. Unknown experiment cases
are rejected transactionally instead of silently contaminating the comparison.

Here `message_id` values come from the eval fixture. If the JSONL has `"id": null`,
`ingest-eval` falls back to `case-<index>` (`case-1`, `case-2`, …).

## Judging

The judge only needs to return `message_id` + verdict columns; `import` joins on
`(run_id, message_id)`.

**Rules that prevent the common failures:**

- **Judge the file `judge-csv` just wrote for THIS run** — not an older CSV lying in
  `reports/`. Verdicts keyed to another run's ids fail the import with
  `verdicts_run_id_message_id_fkey … is not present in table "turns"`.
- **Echo `message_id` back verbatim.** Never renumber, reorder, or invent ids.
- **Parse it as real CSV.** `answer_text` contains commas, quotes and newlines;
  naive line/comma splitting corrupts the id column.
- **Return one row per input row** — same count, no skips or merges.

Sanity-check before importing:

```bash
node -e "
const t=require('fs').readFileSync('reports/aria-no-harness.judged.csv','utf8').split('\n').filter(l=>l.trim());
console.log('rows:',t.length-1);
console.log('ids :',t.slice(1,4).map(l=>l.split(',')[0]).join(', '));
"
```
Row count and id format must match the unjudged CSV.

### Blinded Cursor judging bundle

Prefer a single blinded bundle when comparing approaches:

```bash
pnpm triage judge-bundle --runs <baselineRun>,<candidateRun> \
  --prompt-version aria-judge-v2 --out reports/judge-bundle
```

Attach only `reports/judge-bundle/responses.csv` and `prompts/judge-prompt.md` to Cursor.
Do not attach `manifest.json`, because it contains the local mapping back to runs. Ask Cursor
to write `judgments.csv` using the blinded eight-column format in the prompt, then import:

```bash
pnpm triage import-bundle \
  --manifest reports/judge-bundle/manifest.json \
  --judgments reports/judge-bundle/judgments.csv \
  --judge cursor-agent-1
```

The import is all-or-nothing: missing, duplicate, invented, or invalid rows reject the whole
file. Re-run with another `--judge` to measure disagreement. Low-confidence, insufficient-
evidence, and disagreeing responses are queued in `judgment_reviews`.

### Automated Codex causal judging

For a pure baseline ARIA run, use compact, blinded JSON batches rather than sending the raw SSE log:

```bash
pnpm triage codex-bundle --run <runId> --out reports/<runId>-codex --batch-size 8
pnpm triage judge-codex --manifest reports/<runId>-codex/manifest.json
pnpm triage import-codex \
  --manifest reports/<runId>-codex/manifest.json \
  --judge codex-aria-v1
```

The Codex process is ephemeral, read-only, ignores workspace user config/rules, and receives an allowlisted environment that excludes application database URLs. Each case retains compact tool results, retry paths, visual contracts/payloads, deterministic hypotheses, and correlated backend events. Prompt, schema, bundle, and per-case evidence hashes make the result auditable. Completed batches validate and skip on rerun, which keeps the 285-case workflow resumable.

The importer is transactional and requires exactly one matching blind id and evidence digest per case. It persists the first observable failure stage, failed component, process error, causal evidence, likely root cause, fix layer, deterministic relation, and fixture-issue flag. Thin evidence, low confidence, fixture/deterministic conflicts, and unknown root causes are queued in `judgment_reviews`.

Use `judge-codex --dry-run` to validate a manifest without invoking Codex. `--model` is optional; specify it only when the benchmark protocol deliberately pins the judge model.

After importing judgments, generate the auditable per-query and per-tool review files:

```bash
node scripts/build-aria-baseline-review.mjs reports/<run>-codex
```

This writes `baseline-review/case-review.csv`, `tool-trace-summary.csv`, and `baseline-summary.json`. A successful tool call only means execution succeeded; the case verdict still determines whether selection, scope, data use, and synthesis were correct.

## Commands

| Command | Purpose |
|---|---|
| `migrate` | Apply local schema |
| `extract --workspace <uuid> --from <d> --to <d> [--all] [--limit N]` | Pull prod turns → CSV + runId |
| `ingest-eval --jsonl <path>` | Strict, transactional, content-deduplicated eval JSONL ingest → runId |
| `plan-benchmark --fixture <json> --approaches <a,b> --repeats N --seed N --out <json>` | Create a seeded balanced experiment manifest |
| `judge-csv --run <runId> --out <csv>` | Emit the CSV to hand to the judge |
| `judge-bundle --runs <a,b> --prompt-version <v> --out <dir>` | Emit a blinded multi-arm Cursor review bundle |
| `import-bundle --manifest <json> --judgments <csv> --judge <id>` | Strictly import structured judgments and queue disagreements |
| `codex-bundle --run <runId> --out <dir> [--batch-size N]` | Emit compact, blinded and hashed ARIA review batches |
| `judge-codex --manifest <json> [--model <id>] [--dry-run]` | Run/resume read-only ephemeral Codex judging |
| `import-codex --manifest <json> --judge <id>` | Strictly import causal judgments and queue uncertain cases |
| `assert --run <runId> --expectations <json>` | Fail-closed deterministic gate; eval runs require a valid expectations policy |
| `import --csv <judged.csv> [--run <runId>]` | Load verdicts (`--run` attributes a compact CSV) |
| `dashboard --run <runId> [--name <name>]` | Versioned HTML → `dashboards/` |
| `golden add --run <runId> [--message <id>] [--verdict broken]` | Promote turns into the golden set |
| `golden list` / `golden export --out <file>` | Inspect / export the golden set |

Nothing is written to production. All state lives in the local Postgres.

Comparison dashboards also write a structured `.json` report. Their headline decision is
`PROMOTE`, `REJECT`, or `INCONCLUSIVE`, based on matched attempts, 95% uncertainty, benchmark
compatibility, evidence/judge coverage, disagreement, and deterministic safety regressions.
