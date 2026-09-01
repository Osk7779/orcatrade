-- Per-user read state on the import-request messaging thread — sprint 21.
--
-- Sprint 18 shipped the thread but no way to tell "has my counterpart
-- seen this yet?" That meant ops scrolling /imports couldn't spot
-- threads with fresh customer messages, and customers had no signal
-- the team had replied to their question.
--
-- This migration adds:
--   • message_read_state — jsonb keyed by actor's email_hash; value
--     is { lastReadAt: ISO-string, lastReadMessageId: text|null }.
--     We store BY HASH (ADR 0008: raw emails never land in PG).
--
-- Why a JSONB column not a join table:
--   • Read state is per-(user, request) — the read row is always
--     fetched together with the request's other fields, so
--     denormalising into the same row removes a join on every
--     detail-page load
--   • The thread is capped at 200 messages (sprint 18); the read-
--     state map is correspondingly bounded by team size (~5 entries
--     per request at v1 volumes)
--   • Append-only update pattern (jsonb_set on each markRead) fits
--     poorly with relational normal form but cleanly with JSONB
--
-- Defensive CHECK ensures jsonb_typeof = 'object' so the data-layer
-- iteration code (which assumes typeof === 'object' && !Array.isArray)
-- can never see a malformed scalar or array.
--
-- Idempotent — re-runs are no-ops.

ALTER TABLE import_requests
  ADD COLUMN IF NOT EXISTS message_read_state jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  ALTER TABLE import_requests
    ADD CONSTRAINT import_requests_message_read_state_is_object
    CHECK (jsonb_typeof(message_read_state) = 'object');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
