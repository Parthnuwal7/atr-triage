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

## Commands

| Command | Purpose |
|---|---|
| `migrate` | Apply local schema |
| `extract --workspace <uuid> --from <d> --to <d> [--all] [--limit N]` | Pull prod turns → CSV + runId |
| `ingest-eval --jsonl <path>` | Ingest an atr-be `run-eval.ts` JSONL → runId |
| `judge-csv --run <runId> --out <csv>` | Emit the CSV to hand to the judge |
| `import --csv <judged.csv> [--run <runId>]` | Load verdicts (`--run` attributes a compact CSV) |
| `dashboard --run <runId> [--name <name>]` | Versioned HTML → `dashboards/` |
| `golden add --run <runId> [--message <id>] [--verdict broken]` | Promote turns into the golden set |
| `golden list` / `golden export --out <file>` | Inspect / export the golden set |

Nothing is written to production. All state lives in the local Postgres.
