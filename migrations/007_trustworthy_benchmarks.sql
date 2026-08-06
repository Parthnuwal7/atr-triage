-- Versioned benchmark provenance, paired attempts, and auditable judging.
CREATE TABLE IF NOT EXISTS benchmark_experiments (
  experiment_id      TEXT PRIMARY KEY,
  schema_version     INTEGER NOT NULL DEFAULT 1,
  name               TEXT NOT NULL,
  seed               BIGINT NOT NULL,
  fixture_version    TEXT NOT NULL,
  prompt_version     TEXT NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata           JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS benchmark_attempts (
  experiment_id      TEXT NOT NULL REFERENCES benchmark_experiments(experiment_id) ON DELETE CASCADE,
  case_id            TEXT NOT NULL,
  approach_id        TEXT NOT NULL,
  repeat_index       INTEGER NOT NULL DEFAULT 0,
  sequence_index     INTEGER NOT NULL,
  blind_label        TEXT NOT NULL,
  run_id             TEXT REFERENCES runs(run_id) ON DELETE SET NULL,
  message_id         TEXT,
  status             TEXT NOT NULL DEFAULT 'planned',
  provenance         JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (experiment_id, case_id, approach_id, repeat_index),
  UNIQUE (experiment_id, sequence_index)
);

ALTER TABLE runs ADD COLUMN IF NOT EXISTS schema_version       INTEGER NOT NULL DEFAULT 1;
ALTER TABLE runs ADD COLUMN IF NOT EXISTS experiment_id       TEXT;
ALTER TABLE runs ADD COLUMN IF NOT EXISTS approach_id         TEXT;
ALTER TABLE runs ADD COLUMN IF NOT EXISTS seed                BIGINT;
ALTER TABLE runs ADD COLUMN IF NOT EXISTS fixture_version     TEXT;
ALTER TABLE runs ADD COLUMN IF NOT EXISTS prompt_version      TEXT;
ALTER TABLE runs ADD COLUMN IF NOT EXISTS deployment_version  TEXT;
ALTER TABLE runs ADD COLUMN IF NOT EXISTS source_digest       TEXT;
ALTER TABLE runs ADD COLUMN IF NOT EXISTS provenance          JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE runs ADD COLUMN IF NOT EXISTS ingestion_status    TEXT NOT NULL DEFAULT 'complete';
ALTER TABLE runs ADD COLUMN IF NOT EXISTS expected_case_count INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS runs_source_digest_uq
  ON runs (source_digest) WHERE source_digest IS NOT NULL;

ALTER TABLE turns ADD COLUMN IF NOT EXISTS case_id         TEXT;
ALTER TABLE turns ADD COLUMN IF NOT EXISTS attempt_index   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE turns ADD COLUMN IF NOT EXISTS model_id        TEXT;
ALTER TABLE turns ADD COLUMN IF NOT EXISTS evidence_status TEXT NOT NULL DEFAULT 'missing';
ALTER TABLE turns ADD COLUMN IF NOT EXISTS artifacts       JSONB;
ALTER TABLE turns ADD COLUMN IF NOT EXISTS provenance      JSONB NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX IF NOT EXISTS turns_matched_case_idx
  ON turns (case_id, attempt_index);

CREATE TABLE IF NOT EXISTS judge_batches (
  batch_id          TEXT PRIMARY KEY,
  run_id            TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
  schema_version    INTEGER NOT NULL DEFAULT 1,
  prompt_version    TEXT NOT NULL,
  bundle_digest     TEXT NOT NULL UNIQUE,
  blind_map         JSONB NOT NULL DEFAULT '{}'::jsonb,
  expected_rows     INTEGER NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  imported_at       TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS judgments (
  run_id               TEXT NOT NULL,
  message_id           TEXT NOT NULL,
  judge_id             TEXT NOT NULL,
  batch_id             TEXT REFERENCES judge_batches(batch_id) ON DELETE SET NULL,
  schema_version       INTEGER NOT NULL DEFAULT 1,
  verdict              TEXT NOT NULL,
  category             TEXT,
  severity             TEXT,
  rationale            TEXT NOT NULL,
  dimensions           JSONB NOT NULL DEFAULT '{}'::jsonb,
  confidence           DOUBLE PRECISION,
  evidence_sufficiency TEXT NOT NULL DEFAULT 'sufficient',
  blinded              BOOLEAN NOT NULL DEFAULT TRUE,
  judged_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, message_id, judge_id),
  FOREIGN KEY (run_id, message_id) REFERENCES turns(run_id, message_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS judgment_reviews (
  review_id         BIGSERIAL PRIMARY KEY,
  run_id            TEXT NOT NULL,
  message_id        TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending',
  reason            TEXT NOT NULL,
  resolution        TEXT,
  reviewer          TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at       TIMESTAMPTZ,
  UNIQUE (run_id, message_id, status),
  FOREIGN KEY (run_id, message_id) REFERENCES turns(run_id, message_id) ON DELETE CASCADE
);

ALTER TABLE verdicts ADD COLUMN IF NOT EXISTS judge_count    INTEGER NOT NULL DEFAULT 1;
ALTER TABLE verdicts ADD COLUMN IF NOT EXISTS disagreement   BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE verdicts ADD COLUMN IF NOT EXISTS confidence     DOUBLE PRECISION;
