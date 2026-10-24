-- SLA breach recording — sprint 97.
--
-- A blown turnaround commitment was visible (cohort #13, the
-- daily alert, the per-request banner) but never RECORDED: no
-- audit-chain entry, no webhook, no timeline moment. This column
-- is the dedupe stamp for the hourly breach sweep: a request gets
-- exactly one import_request_sla_breached event, recorded at the
-- first sweep after it crossed its org's (possibly negotiated)
-- turnaround target while still unquoted.
--
-- Semantics:
--   NULL      — never recorded as breached (either never breached,
--               or quoted in time)
--   timestamp — the sweep recorded the breach at this moment; the
--               event carries the age at detection
-- The stamp is REVERTED if the audit event fails to write, so the
-- next sweep retries — at-least-once event semantics, and the
-- stamp can never claim a breach the chain doesn't hold.

ALTER TABLE import_requests
  ADD COLUMN IF NOT EXISTS sla_breach_recorded_at timestamptz;

-- Partial index for the sweep's cut (unstamped rows only).
CREATE INDEX IF NOT EXISTS import_requests_sla_breach_sweep_idx
  ON import_requests (org_id, created_at)
  WHERE sla_breach_recorded_at IS NULL AND quoted_at IS NULL;
