-- Versioned triage contracts and fail-closed paired-rollout measurement state.
ALTER TABLE runs ADD COLUMN IF NOT EXISTS expected_contract_version TEXT;
ALTER TABLE runs ADD COLUMN IF NOT EXISTS assertion_schema_version  INTEGER;
ALTER TABLE runs ADD COLUMN IF NOT EXISTS outcome                   TEXT;
ALTER TABLE runs ADD COLUMN IF NOT EXISTS measurement_eligible      BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE runs ADD COLUMN IF NOT EXISTS measurement_reasons       JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE turns ADD COLUMN IF NOT EXISTS expected_contract_version TEXT;
ALTER TABLE turns ADD COLUMN IF NOT EXISTS assertion_schema_version  INTEGER;
ALTER TABLE turns ADD COLUMN IF NOT EXISTS assertion_outcome         TEXT;
ALTER TABLE turns ADD COLUMN IF NOT EXISTS measurement_eligible      BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE turns ADD COLUMN IF NOT EXISTS measurement_reasons       JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE findings ADD COLUMN IF NOT EXISTS contract_version        TEXT;
ALTER TABLE findings ADD COLUMN IF NOT EXISTS assertion_schema_version INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS expected_contracts (
  contract_version TEXT NOT NULL,
  schema_version   INTEGER NOT NULL,
  case_id          TEXT NOT NULL,
  contract         JSONB NOT NULL,
  contract_digest  TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (contract_version, case_id)
);

CREATE TABLE IF NOT EXISTS assertion_results (
  run_id            TEXT NOT NULL,
  message_id        TEXT NOT NULL,
  schema_version    INTEGER NOT NULL,
  contract_version  TEXT,
  outcome           TEXT NOT NULL,
  measurement_eligible BOOLEAN NOT NULL,
  measurement_reasons  JSONB NOT NULL DEFAULT '[]'::jsonb,
  findings_count    INTEGER NOT NULL DEFAULT 0,
  blocking_count    INTEGER NOT NULL DEFAULT 0,
  assessed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, message_id),
  FOREIGN KEY (run_id, message_id) REFERENCES turns(run_id, message_id) ON DELETE CASCADE,
  CHECK (outcome IN ('pass', 'fail', 'ineligible'))
);

CREATE INDEX IF NOT EXISTS assertion_results_measurement_idx
  ON assertion_results (run_id, measurement_eligible);
