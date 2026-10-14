-- Per-user notification preferences — sprint 24.
--
-- Across 23 sprints we built 7 customer/ops email touchpoints:
--   • quote-ready          customer ← ops approval (sprint 1)
--   • customer-rejected    customer ← ops decline (sprint 16)
--   • customer-approved    ops      ← customer approval (sprint 11)
--   • shipment-status      customer ← shipment state flip (sprint 9)
--   • import-request-message customer/ops ← new message (sprint 18)
--   • new-in-queue         ops      ← new request submitted (sprint 1)
-- Plus the dossier + quote PDFs that customers download (not emails).
--
-- Today there's no way to mute any of these. An enterprise customer
-- with 5 ops + 20 buyers gets BUFFETED — every state change wakes
-- the whole org. This migration adds per-user-per-org notification
-- preferences so each user can opt out of categories that don't
-- matter to them, AND surfaces a clean opt-out / one-click
-- unsubscribe path that any GDPR auditor will ask for.
--
-- Why JSONB on memberships (not a separate prefs table):
--   • Per-(user, org) — the unit the prefs are scoped to. A user
--     who is ops in one org and a customer in another should have
--     SEPARATE preferences for each role-context. JSONB on
--     memberships gives exactly that.
--   • Single source of truth — every prefs lookup is part of the
--     existing membership read; no extra DB round-trip needed in
--     the sender's hot path.
--   • Append-only update pattern (jsonb_set per toggle) fits the
--     "update one preference at a time" UX.
--
-- Default behaviour (NULL or {}): every notification ON. The sender
-- code treats absence-of-preference as "send" — a customer who
-- never touches the preferences page never silently misses
-- notifications.
--
-- Shape of the JSONB blob:
--   {
--     "quote_ready":          true,
--     "decline":              true,
--     "customer_decisions":   true,    (ops only)
--     "shipment_status":      true,
--     "messages":             true,
--     "queue_intake":         true,    (ops only)
--   }
-- Missing keys default to true. Explicit false mutes that category.
--
-- Idempotent — re-runs are no-ops.

ALTER TABLE memberships
  ADD COLUMN IF NOT EXISTS notification_preferences jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Defensive CHECK — preferences must be a JSONB object (never an
-- array or scalar). Sender code iterates with typeof === 'object' &&
-- !Array.isArray; a malformed scalar would crash that path.
DO $$
BEGIN
  ALTER TABLE memberships
    ADD CONSTRAINT memberships_notification_preferences_is_object
    CHECK (jsonb_typeof(notification_preferences) = 'object');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
