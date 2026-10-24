-- Supplier pick recording — sprint 28.
--
-- The "AI-native operator" promise from the apex plan calls for a
-- platform that learns from every approval. Sprint 1 ships shortlists;
-- sprint 28 closes the loop by recording WHICH country ops actually
-- picks at materialise time, then feeding the historical signal back
-- into the next quote's shortlist ("Your team picked this country 7
-- times in the last 90 days").
--
-- Storage: a single supplier_pick JSONB on the import_request, NOT a
-- separate picks table. Why:
--   • One-to-one per request — a request has exactly one materialised
--     pick at most. Normalised representation would mean a table that
--     joins back to import_requests on every read.
--   • The pick is set ONCE at materialise time and never updated.
--     Append-only via the data layer; a supersession (e.g. ops changes
--     mind post-approval) is a separate event that doesn't rewrite
--     this field.
--   • Aggregation queries (sprint 28 ch 2) read this field directly
--     across rows; no join required.
--
-- Each entry shape:
--   {
--     country          text   — 'CN' | 'VN' | 'IN' | etc. (ISO-2)
--     rationaleCategory text  — categorised reason for the pick
--                              (cost / lead-time / compliance /
--                              past-relationship / other)
--     rationale         text  — free-text rationale (<= 500 chars)
--     hsPrefix6         text  — first 6 digits of the HS code, indexed
--                              so the aggregate query is fast
--     pickedByEmailHash text  — ops actor; raw email NEVER stored
--     pickedAt          text  — ISO timestamp at materialise time
--   }
--
-- The partial index on (org_id, hsPrefix6) WHERE supplier_pick IS NOT
-- NULL is the workhorse for the aggregate query. Aggregating across
-- 10k requests at 30k rows would be a full-table scan without it.
--
-- Idempotent — re-runs are no-ops.

ALTER TABLE import_requests
  ADD COLUMN IF NOT EXISTS supplier_pick jsonb;

-- Aggregate-query covering index. The query reads org_id +
-- supplier_pick->>'hsPrefix6' + supplier_pick->>'country'. We index
-- on (org_id, hsPrefix6) — Postgres extracts the JSONB key efficiently
-- per row given this filter. Partial: rows with no pick (the customer
-- hasn't approved yet) fall out of the index entirely so it stays
-- compact.
CREATE INDEX IF NOT EXISTS import_requests_supplier_pick_lookup_idx
  ON import_requests (org_id, ((supplier_pick->>'hsPrefix6')))
  WHERE supplier_pick IS NOT NULL;
