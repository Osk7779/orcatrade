-- First-response breach recording — sprint 100.
--
-- Sprint 97 recorded TURNAROUND breaches; the published
-- methodology ("every commitment breach is recorded as exactly
-- one audit-chained event") therefore overclaimed — first-
-- response breaches (past the 24h human-touch commitment) went
-- unrecorded. Sprint 100 makes the claim true: a second dedupe
-- stamp, same at-least-once + revert-on-event-failure semantics
-- as sla_breach_recorded_at (schema-025).
--
-- Both commitments share ONE event type
-- (import_request_sla_breached) distinguished by
-- detail.commitment ('quoteTurnaround' | 'firstResponse'; legacy
-- events without the field are turnaround) — so the published
-- breach count keeps meaning what the page says it means.

ALTER TABLE import_requests
  ADD COLUMN IF NOT EXISTS fr_breach_recorded_at timestamptz;

CREATE INDEX IF NOT EXISTS import_requests_fr_breach_sweep_idx
  ON import_requests (org_id, created_at)
  WHERE fr_breach_recorded_at IS NULL AND first_ops_action_at IS NULL;
