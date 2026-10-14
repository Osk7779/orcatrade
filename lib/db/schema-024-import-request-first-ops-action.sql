-- first_ops_action_at stamp — sprint 84 (Track C phase 2).
--
-- The second measured commitment: FIRST HUMAN RESPONSE. Defined as
-- the first ops-authored, customer-visible action on a request —
-- a team review decision (approve / send back / reject) or an ops
-- message on the thread. Deliberately NOT the automated
-- orchestrator status transition: an instant machine transition
-- would make a first-response SLA trivially 100%, which is
-- marketing, not measurement.
--
-- First-write-only (COALESCE at the writers) — the clock stops at
-- the FIRST human touch and later activity never moves it.
-- Historical rows stay NULL; attainment accrues from deploy (same
-- posture as quoted_at / the accuracy ledger).

ALTER TABLE import_requests
  ADD COLUMN IF NOT EXISTS first_ops_action_at timestamptz;

CREATE INDEX IF NOT EXISTS import_requests_first_ops_action_idx
  ON import_requests (org_id, first_ops_action_at)
  WHERE first_ops_action_at IS NOT NULL;
