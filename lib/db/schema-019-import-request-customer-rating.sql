-- Customer rating on import requests — sprint 30.
--
-- After the customer approves a quote and the team materialises the
-- triad, the request enters a quasi-terminal "customer_approved"
-- state. Today there's no feedback loop — ops never finds out
-- whether the customer was actually happy with the supplier shortlist
-- + the landed-cost accuracy + the broker handoff.
--
-- This migration adds a per-request customer rating: a 1-5 score, an
-- optional free-text comment, and the actor + timestamp. The rating
-- is recorded ONCE per request — a second rating from the same
-- request supersedes the prior one (last write wins), but the audit
-- chain preserves every event so the supersession is recoverable.
--
-- Why JSONB on the row (not a ratings table):
--   • One-to-one per request — a request has at most one rating
--   • The rating is read together with the rest of the request body
--     (detail page hydrates everything in one query)
--   • Future fields (NPS, per-dimension scores) extend the JSONB
--     shape without a new table or migration
--
-- Shape:
--   {
--     score          int   — 1-5 (CHECK at the data layer)
--     comment        text  — optional free-text (<= 2000 chars)
--     ratedByEmailHash text — actor; raw email NEVER stored
--     ratedAt        text  — ISO timestamp
--   }
--
-- Idempotent — re-runs are no-ops.

ALTER TABLE import_requests
  ADD COLUMN IF NOT EXISTS customer_rating jsonb;

-- Defensive CHECK — customer_rating must be a jsonb object (never
-- an array or scalar). The data-layer iteration assumes
-- typeof === 'object' && !Array.isArray; a malformed scalar would
-- crash the read path.
DO $$
BEGIN
  ALTER TABLE import_requests
    ADD CONSTRAINT import_requests_customer_rating_is_object
    CHECK (customer_rating IS NULL OR jsonb_typeof(customer_rating) = 'object');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
