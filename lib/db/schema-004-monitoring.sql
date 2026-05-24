-- Proactive monitoring alerts (Sprint monitoring-v1 / apex-plan Pillar I3).
--
-- The durable corpus for the alert inbox. KV is the synchronous primary that
-- the /account/alerts/ UI reads (lib/alert-store.js); this table is the
-- best-effort dual-write that survives KV's TTL and lets us query alert
-- history across users for ops/analytics. Written by the `monitoring-scan`
-- cron via the same store.
--
-- Privacy discipline matches saved_plans / events: raw email NEVER lands here.
-- email_hash carries the SHA-256-first-16-hex identity; data_json is the
-- calculator-grounded payload (drift figures, FX risk, obligation) — never PII.
--
-- Idempotent (CREATE … IF NOT EXISTS), auto-discovered by scripts/db-migrate.js.

CREATE TABLE IF NOT EXISTS monitoring_alerts (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  external_id  text NOT NULL UNIQUE,          -- 'al_<…>' (the KV id)
  email_hash   text NOT NULL,                 -- SHA-256 first-16-hex; NEVER raw email
  alert_type   text NOT NULL,                 -- plan_cost_drift | portfolio_cost_drift | fx_exposure | compliance_deadline | sanctions_list_update
  severity     text NOT NULL,                 -- critical | high | medium | low | info
  title        text NOT NULL,
  body         text,
  entity_type  text,                          -- plan | portfolio | global
  entity_id    text,                          -- pl_… / pf_… / null
  dedupe_key   text NOT NULL,                 -- stable per (user, signal) so re-scans upsert
  data_json    jsonb NOT NULL DEFAULT '{}'::jsonb,
  status       text NOT NULL DEFAULT 'open',  -- open | read | dismissed
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- One open alert per (user, signal): re-detecting the same drift upserts the
-- existing row rather than spamming the inbox.
CREATE UNIQUE INDEX IF NOT EXISTS monitoring_alerts_dedupe_idx
  ON monitoring_alerts (email_hash, dedupe_key);

CREATE INDEX IF NOT EXISTS monitoring_alerts_email_status_idx
  ON monitoring_alerts (email_hash, status, created_at DESC);

CREATE INDEX IF NOT EXISTS monitoring_alerts_type_created_idx
  ON monitoring_alerts (alert_type, created_at DESC);
