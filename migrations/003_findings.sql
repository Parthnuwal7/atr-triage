-- Deterministic triage findings + rig-integrity status on eval turns.

-- ttfb_ms wasn't added in 002; the rig-integrity classifier needs it (a -1 marks
-- "no first byte" = an empty capture). Nullable — ingest may not populate it yet.
ALTER TABLE turns ADD COLUMN IF NOT EXISTS ttfb_ms    INTEGER;
ALTER TABLE turns ADD COLUMN IF NOT EXISTS rig_status TEXT;
ALTER TABLE turns ADD COLUMN IF NOT EXISTS rig_reason TEXT;

CREATE TABLE IF NOT EXISTS findings (
  id          BIGSERIAL PRIMARY KEY,
  run_id      UUID NOT NULL,
  message_id  TEXT NOT NULL,
  class       TEXT NOT NULL,
  layer       TEXT NOT NULL,
  detector    TEXT NOT NULL,
  fix_type    TEXT NOT NULL,
  severity    TEXT NOT NULL,
  blocking    BOOLEAN NOT NULL DEFAULT FALSE,
  message     TEXT NOT NULL,
  evidence    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS findings_run_idx ON findings (run_id);
CREATE INDEX IF NOT EXISTS findings_class_idx ON findings (run_id, class);
