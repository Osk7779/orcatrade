-- Import-request revision lineage — sprint 16.
--
-- Builds on schema-012-import-requests.sql. When the team rejects a
-- request with a structured reason (price target unrealistic /
-- compliance blocker / origin restriction / out of scope), the customer
-- receives an email with the reason + a "Revise this request" CTA that
-- pre-fills /imports/new with the original request and stamps the new
-- row with a back-reference to the original.
--
-- Without this lineage:
--   • A declined customer must re-type the form from scratch
--   • Ops has no record that "this declined request later succeeded
--     after revision" — the cohort that matters most for product
--     learning is silent
--   • The activity feed shows two unrelated requests instead of a
--     coherent customer narrative
--
-- The team_review_state.declineReason field is enum-validated at the
-- data layer (lib/db/import-requests.js DECLINE_REASONS) rather than
-- via a SQL CHECK constraint, because CHECK on a JSONB sub-path is
-- clunky to express and the validation logic also needs to mirror in
-- the TypeScript surface for the form. The data-layer enum is the
-- single source of truth + a drift-guard test pins parity between
-- the JS constant and the TS mirror.
--
-- Idempotent — re-runs are no-ops.

-- The lineage column. text (matches the existing external_id column
-- shape — ir_<16hex>) rather than bigint FK because:
--   • Cross-org references must be forbidden (an org should never see
--     "this was revised from a request in another org"); the absence
--     of an FK means there's no implicit privacy leak via a JOIN. The
--     data layer enforces same-org lookup explicitly.
--   • A future cross-tenant export shouldn't drag a fragile FK.
ALTER TABLE import_requests
  ADD COLUMN IF NOT EXISTS revised_from_external_id text;

-- Index for the reverse lookup ("show me every revision of ir_xxx").
-- Used by the detail page's lineage panel + by an eventual ops
-- analytics surface ("which decline reasons most commonly recover via
-- revision"). Partial — only revisions carry the column, so this stays
-- compact.
CREATE INDEX IF NOT EXISTS import_requests_revised_from_idx
  ON import_requests (org_id, revised_from_external_id)
  WHERE revised_from_external_id IS NOT NULL;
