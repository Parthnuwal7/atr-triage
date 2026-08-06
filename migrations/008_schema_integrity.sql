-- Normalize legacy key types and enforce artifact integrity.
ALTER TABLE findings ALTER COLUMN run_id TYPE TEXT USING run_id::text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'findings_run_fk'
  ) THEN
    ALTER TABLE findings
      ADD CONSTRAINT findings_run_fk FOREIGN KEY (run_id) REFERENCES runs(run_id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS golden_source_turn_uq
  ON golden_queries (source_run_id, source_message_id)
  WHERE source_run_id IS NOT NULL AND source_message_id IS NOT NULL;

ALTER TABLE dashboards ADD COLUMN IF NOT EXISTS compare_run_id    TEXT;
ALTER TABLE dashboards ADD COLUMN IF NOT EXISTS report_type       TEXT NOT NULL DEFAULT 'single';
ALTER TABLE dashboards ADD COLUMN IF NOT EXISTS input_digest      TEXT;
ALTER TABLE dashboards ADD COLUMN IF NOT EXISTS generation_status TEXT NOT NULL DEFAULT 'complete';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'verdict_value_check') THEN
    ALTER TABLE verdicts ADD CONSTRAINT verdict_value_check
      CHECK (verdict IN ('good', 'needs-work', 'broken', 'insufficient-evidence'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'verdict_severity_check') THEN
    ALTER TABLE verdicts ADD CONSTRAINT verdict_severity_check
      CHECK (severity IS NULL OR severity IN ('low', 'med', 'high'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'judgment_confidence_check') THEN
    ALTER TABLE judgments ADD CONSTRAINT judgment_confidence_check
      CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1));
  END IF;
END $$;
