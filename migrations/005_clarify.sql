-- Clarification signals (run-eval): did ARIA ask a clarifying question this turn, and how
-- many rounds were auto-resolved. Lets triage LABEL clarify turns instead of mistaking the
-- clarify text for a bad answer, and drives the over-clarify check.
ALTER TABLE turns ADD COLUMN IF NOT EXISTS clarified      BOOLEAN;
ALTER TABLE turns ADD COLUMN IF NOT EXISTS clarify_rounds INTEGER;
