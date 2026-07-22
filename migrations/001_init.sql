CREATE TABLE IF NOT EXISTS runs (
  run_id        TEXT PRIMARY KEY,
  workspace     TEXT NOT NULL,
  from_date     DATE NOT NULL,
  to_date       DATE NOT NULL,
  mode          TEXT NOT NULL,            -- 'filtered' | 'all'
  source_row_count INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS turns (
  run_id             TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
  message_id         TEXT NOT NULL,
  chat_id            TEXT NOT NULL,
  created_at         TIMESTAMPTZ,
  user_query         TEXT,
  enriched_query     TEXT,
  answer_text        TEXT,
  footer_latency_ms  INT,
  workspace_memory   TEXT,
  user_preferences   TEXT,
  conversation_memory TEXT,
  downvoted          BOOLEAN NOT NULL DEFAULT false,
  signal_no_tool_call     BOOLEAN NOT NULL DEFAULT false,
  signal_tool_error       BOOLEAN NOT NULL DEFAULT false,
  signal_empty_or_refusal BOOLEAN NOT NULL DEFAULT false,
  signal_no_response      BOOLEAN NOT NULL DEFAULT false,
  signal_latency_outlier  BOOLEAN NOT NULL DEFAULT false,
  tool_trace         JSONB,
  PRIMARY KEY (run_id, message_id)
);

CREATE TABLE IF NOT EXISTS verdicts (
  run_id     TEXT NOT NULL,
  message_id TEXT NOT NULL,
  verdict    TEXT NOT NULL,
  category   TEXT,
  severity   TEXT,
  rationale  TEXT,
  judged_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, message_id),
  FOREIGN KEY (run_id, message_id) REFERENCES turns(run_id, message_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS golden_queries (
  id                SERIAL PRIMARY KEY,
  source_run_id     TEXT,
  source_message_id TEXT,
  query             TEXT NOT NULL,
  expected_behavior TEXT,
  category          TEXT,
  added_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dashboards (
  id         SERIAL PRIMARY KEY,
  run_id     TEXT NOT NULL,
  name       TEXT NOT NULL,
  html_path  TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
