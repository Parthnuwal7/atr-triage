-- The judge's human-facing insights.md report (headline, systemic issues, clusters, patterns),
-- stored per run so the dashboard can render it alongside the verdicts + deterministic findings.
ALTER TABLE runs ADD COLUMN IF NOT EXISTS insights_md TEXT;
