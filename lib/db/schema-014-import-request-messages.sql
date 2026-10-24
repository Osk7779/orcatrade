-- Customer ↔ ops messaging thread on import requests — sprint 18.
--
-- Each import request gets an inline thread the customer and the ops
-- team can use to clarify intent, share spec references, ask the
-- "what's your MOQ flexibility?" follow-up that today would either
-- become a structured decline + revision (sprint 16) or sit in a
-- back-channel email outside the platform.
--
-- Storage: a JSONB array on import_requests rather than a new table.
-- Why:
--   • At v1 volumes (<= a few dozen messages per request, usually
--     0-5) reading the whole array on the detail page is fine —
--     it's the same query that hydrates everything else
--   • Append-only access pattern fits poorly with relational normal
--     form but fits perfectly with JSONB || jsonb_build_object
--   • Same shape lets the audit log capture each append AS an event
--     without an additional join
--   • A future migration to a proper messages table is straightforward
--     (the JSONB blob carries every field the future table would
--     need, including the message id)
--
-- Each entry in the array is:
--   {
--     id            text   — 'msg_<8hex>' for cross-thread linking
--     role          text   — 'customer' | 'ops' | 'system'
--     body          text   — <= 4000 chars (enforced at the data layer)
--     byEmailHash   text   — actor; raw email NEVER stored (ADR 0008)
--     at            text   — ISO timestamp at append
--   }
--
-- The 'system' role is reserved for platform-emitted entries (e.g.
-- "Quote regenerated after intent edit") so the thread reads as a
-- complete story; for v1 only customer + ops are used.
--
-- Idempotent — re-runs are no-ops.

ALTER TABLE import_requests
  ADD COLUMN IF NOT EXISTS messages jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Defensive CHECK — messages must always be a jsonb array, never an
-- object or scalar. A null/object value would crash the data-layer
-- iteration code that assumes Array.isArray()-shape. Postgres applies
-- this on every UPDATE; idempotent (DO $$ ... EXCEPTION block makes
-- this safe to re-run even when the constraint already exists).
DO $$
BEGIN
  ALTER TABLE import_requests
    ADD CONSTRAINT import_requests_messages_is_array
    CHECK (jsonb_typeof(messages) = 'array');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
