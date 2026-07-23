-- Eval/benchmark runs reuse the `turns` table with these additional per-case columns.
ALTER TABLE turns ADD COLUMN IF NOT EXISTS category       TEXT;
ALTER TABLE turns ADD COLUMN IF NOT EXISTS expected_tool  TEXT;
ALTER TABLE turns ADD COLUMN IF NOT EXISTS tool_called    TEXT;
ALTER TABLE turns ADD COLUMN IF NOT EXISTS tokens_total   INT;
ALTER TABLE turns ADD COLUMN IF NOT EXISTS tokens_in      INT;
ALTER TABLE turns ADD COLUMN IF NOT EXISTS tokens_out     INT;
ALTER TABLE turns ADD COLUMN IF NOT EXISTS cost_usd       DOUBLE PRECISION;
ALTER TABLE turns ADD COLUMN IF NOT EXISTS steps          INT;
ALTER TABLE turns ADD COLUMN IF NOT EXISTS total_time_ms  INT;
ALTER TABLE turns ADD COLUMN IF NOT EXISTS accuracy_score INT;
ALTER TABLE turns ADD COLUMN IF NOT EXISTS overall_score  INT;
