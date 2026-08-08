-- Internal ops notes on import requests — sprint 55.
--
-- Sprint 18 shipped customer↔ops messaging: both sides can see
-- the entire thread. Real CRM workflows need a SECOND channel
-- where ops can leave annotations that the CUSTOMER never sees,
-- even when logged in. Sprint 55 adds that channel.
--
-- Why JSONB on the row (not an internal_notes table):
--   • Per-request — notes are tightly bound to a single request,
--     read together with the rest of the row body
--   • Same query path as messages/evidence/supplier_pick — one
--     SELECT hydrates the detail page
--   • Future fields (note categories, mentions, threading) extend
--     the JSONB shape without a new migration
--
-- Per-note shape:
--   {
--     id           string — generated server-side
--     body         text   — free-text (<= 4000 chars)
--     byEmailHash  string — actor; raw email NEVER stored
--     at           string — ISO timestamp
--   }
--
-- RBAC discipline (enforced at the data + handler + render layers):
--   • appendInternalNote is ops-role-only at the handler
--   • The detail endpoint REDACTS internal_notes from the response
--     when ctx.role is NOT ops — even when the customer is logged
--     in and looking at their OWN request
--   • UI renders the notes panel ONLY when ctx.role is ops
--   • Drift-guard tests pin all three layers
--
-- Idempotent — re-runs are no-ops.

ALTER TABLE import_requests
  ADD COLUMN IF NOT EXISTS internal_notes jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Defensive CHECK — internal_notes must be a jsonb array (NEVER
-- an object or scalar). The data-layer iteration assumes
-- Array.isArray; a malformed scalar would crash the read path.
DO $$
BEGIN
  ALTER TABLE import_requests
    ADD CONSTRAINT import_requests_internal_notes_is_array
    CHECK (jsonb_typeof(internal_notes) = 'array');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
