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

## Loop
```
pnpm triage extract --workspace <uuid> --from 2026-07-01 --to 2026-07-07     # → reports/*.csv  (add --all for full sweep)
# judge the CSV with prompts/judge-prompt.md in Cursor/etc → save *.judged.csv
pnpm triage import --csv reports/<file>.judged.csv
pnpm triage dashboard --run <runId> --name july-w1                            # → dashboards/*.html
pnpm triage golden add --run <runId> --message <messageId>
pnpm triage golden export --out golden-benchmark.json
```
Nothing is written to production. All state lives in the local Postgres.
