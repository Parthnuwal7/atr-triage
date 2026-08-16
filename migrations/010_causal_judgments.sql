-- Causal ARIA judgments retain both the diagnosis and its evidence provenance.
ALTER TABLE judgments ADD COLUMN IF NOT EXISTS failure_stage       TEXT;
ALTER TABLE judgments ADD COLUMN IF NOT EXISTS failed_component    TEXT;
ALTER TABLE judgments ADD COLUMN IF NOT EXISTS process_error        TEXT;
ALTER TABLE judgments ADD COLUMN IF NOT EXISTS causal_evidence      JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE judgments ADD COLUMN IF NOT EXISTS likely_root_cause    TEXT;
ALTER TABLE judgments ADD COLUMN IF NOT EXISTS fix_layer             TEXT;
ALTER TABLE judgments ADD COLUMN IF NOT EXISTS fixture_issue         BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE judgments ADD COLUMN IF NOT EXISTS deterministic_relation TEXT;
ALTER TABLE judgments ADD COLUMN IF NOT EXISTS evidence_digest       TEXT;
ALTER TABLE judgments ADD COLUMN IF NOT EXISTS prompt_version        TEXT;
ALTER TABLE judgments ADD COLUMN IF NOT EXISTS model_id              TEXT;
ALTER TABLE judgments ADD COLUMN IF NOT EXISTS judge_metadata        JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE verdicts ADD COLUMN IF NOT EXISTS failure_stage        TEXT;
ALTER TABLE verdicts ADD COLUMN IF NOT EXISTS failed_component     TEXT;
ALTER TABLE verdicts ADD COLUMN IF NOT EXISTS process_error         TEXT;
ALTER TABLE verdicts ADD COLUMN IF NOT EXISTS likely_root_cause     TEXT;
ALTER TABLE verdicts ADD COLUMN IF NOT EXISTS fix_layer              TEXT;
ALTER TABLE verdicts ADD COLUMN IF NOT EXISTS evidence_sufficiency  TEXT;
ALTER TABLE verdicts ADD COLUMN IF NOT EXISTS fixture_issue          BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE verdicts ADD COLUMN IF NOT EXISTS evidence_digest        TEXT;
