-- Content-addressed data-snapshot store (Sprint reproducibility-v2 / apex-plan
-- III3). The durable, forever-home for the volatile-data snapshots captured by
-- lib/intelligence/data-snapshot.js — FX rates, the CBAM ETS price, and the
-- EU AD/CVD measure rates in effect when a plan was computed.
--
-- IMMUTABLE + GLOBAL: a row holds market data, never user data. The id is a
-- sha256 content address, so writes are idempotent (ON CONFLICT DO NOTHING).
-- No email_hash column — there is no PII here and no GDPR delete path.
--
-- KV (lib/snapshot-store.js) is the synchronous cache primary; this table is
-- the long-lived record that makes "reproduce this euro forever" true.
--
-- Idempotent, auto-discovered by scripts/db-migrate.js.

CREATE TABLE IF NOT EXISTS data_snapshots (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  snapshot_id    text NOT NULL UNIQUE,           -- 'ds_<16hex>' content address
  schema_version int  NOT NULL,                  -- data-snapshot.js SNAPSHOT_SCHEMA_VERSION
  captured_at    timestamptz NOT NULL DEFAULT now(),
  snapshot_json  jsonb NOT NULL                  -- the captured volatile-data values
);

-- Bind every saved plan to the snapshot behind its numbers, so the reproduce
-- endpoint can drift-check a plan against the exact data it was computed under.
ALTER TABLE saved_plans
  ADD COLUMN IF NOT EXISTS data_snapshot_id text;

CREATE INDEX IF NOT EXISTS saved_plans_data_snapshot_idx
  ON saved_plans (data_snapshot_id);
