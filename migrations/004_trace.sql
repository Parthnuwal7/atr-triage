-- Per-turn structured trace (Plan 2): workspace queried, tools, memory, write-intent, cards.
-- Populated from the run-eval JSONL `case.trace` when the backend emitted it (gated).
ALTER TABLE turns ADD COLUMN IF NOT EXISTS trace JSONB;
