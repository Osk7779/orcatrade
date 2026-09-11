-- Actual outcome on import requests — sprint 81 (Track B phase 2).
--
-- The operator wedge quotes a landed cost (landed_quote jsonb) but
-- had no loop capturing what the customer ACTUALLY paid once the
-- shipment completed. Saved plans got that loop in BG-1.4; this
-- migration gives the wedge the same primitive, and the Quote
-- Accuracy Ledger (/api/accuracy, sprint 80) merges both corpora.
--
-- Why JSONB on the row (not a table): same rationale as
-- customer_rating (schema-019) — one actual per request bound
-- tightly to the row, read together with the quote it scores;
-- last-write-wins with the supersession preserved in the audit
-- chain.
--
-- Per-record shape:
--   {
--     landedCents   int    — integer euro-cents (ADR 0004)
--     currency      'EUR'
--     reportedAt    ISO timestamp
--     byEmailHash   string — actor; raw email NEVER stored
--     notes         string — optional, ≤500 chars, stays on the
--                            row (never in the audit chain head)
--   }

ALTER TABLE import_requests
  ADD COLUMN IF NOT EXISTS actual_outcome jsonb;

-- Defensive CHECK — must be a jsonb object (never an array or
-- scalar); the read path assumes typeof === 'object'.
DO $$
BEGIN
  ALTER TABLE import_requests
    ADD CONSTRAINT import_requests_actual_outcome_is_object
    CHECK (actual_outcome IS NULL OR jsonb_typeof(actual_outcome) = 'object');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Partial index for the ledger corpus cut: only rows that have BOTH
-- an actual and a quote can be scored.
CREATE INDEX IF NOT EXISTS import_requests_actual_outcome_idx
  ON import_requests (org_id)
  WHERE actual_outcome IS NOT NULL;
