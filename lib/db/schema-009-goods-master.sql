-- Goods master — L1.1 of docs/strategic-plan-2026-2031.md §4.1.2.
--
-- The first concrete step of the Phase 3 "advisor → system of record"
-- leap: customer imports stop being one-off quotes against a free-text
-- HS code. Each SKU the importer ships becomes a goods_master row
-- carrying its classification, origin, REACH SVHC flags, CBAM scope,
-- and customer-specific overrides. Every subsequent shipment of this
-- SKU inherits the classification — no re-derivation, no inconsistency
-- between quotes for the same product, full audit trail of changes.
--
-- Why PG-primary (not KV-primary like saved_plans / saved_portfolios):
-- Goods are *configuration*, not hot-path. They are read at quote-emit
-- time (medium frequency) and changed rarely (low frequency). The
-- relational query patterns we need — "list every active good with HS
-- chapter 85 that's CBAM-in-scope", "all goods sourced from CN sorted
-- by declared value" — fit SQL, not KV scans. The KV cache layer can
-- be added later if read latency demands it.
--
-- Multi-tenant from day one: every row is org-scoped. CASCADE on org
-- delete ensures goods don't outlive their org. Soft delete via
-- archived_at preserves audit history when a SKU is retired — and
-- frees the SKU code for reuse without losing the historical record.
--
-- Privacy posture: created_by_email_hash, never raw email (ADR 0008).
--
-- Idempotent, auto-discovered by scripts/db-migrate.js.

CREATE TABLE IF NOT EXISTS goods_master (
  id                       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  external_id              text NOT NULL UNIQUE,                  -- 'gd_<16hex>' from lib/db/goods.js
  org_id                   bigint NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  created_by_email_hash    text NOT NULL,                         -- actor at creation; joins to users(email_hash)
  sku                      text NOT NULL,                         -- customer's internal SKU (unique within org while active)
  display_name             text NOT NULL,                         -- human-readable label
  hs_code                  text NOT NULL,                         -- 6-10 digit string; CHECKed below
  origin_country           text,                                  -- ISO-2 code; null if not yet known
  typical_unit_value_cents bigint,                                -- integer cents (ADR 0004); null if unknown
  cbam_in_scope            boolean NOT NULL DEFAULT false,
  reach_svhc_flags         jsonb NOT NULL DEFAULT '[]'::jsonb,    -- array of {cas, name, threshold_pct}
  restricted_substances    jsonb NOT NULL DEFAULT '{}'::jsonb,    -- per-jurisdiction notes
  metadata                 jsonb NOT NULL DEFAULT '{}'::jsonb,    -- extension point; never load-bearing
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  archived_at              timestamptz,                           -- null = active; non-null = soft-deleted
  CONSTRAINT goods_master_hs_code_format
    CHECK (hs_code ~ '^[0-9]{6,10}$'),
  CONSTRAINT goods_master_origin_country_format
    CHECK (origin_country IS NULL OR origin_country ~ '^[A-Z]{2}$'),
  CONSTRAINT goods_master_typical_unit_value_non_negative
    CHECK (typical_unit_value_cents IS NULL OR typical_unit_value_cents >= 0)
);

-- A SKU is unique within an org while ACTIVE. Two archived SKUs with
-- the same code can coexist (historical preservation). This is the
-- partial-unique-index pattern: rename or retire a SKU and reuse the
-- code without ever losing the historical record.
CREATE UNIQUE INDEX IF NOT EXISTS goods_master_org_sku_active_uidx
  ON goods_master (org_id, sku)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS goods_master_org_id_idx
  ON goods_master (org_id);

CREATE INDEX IF NOT EXISTS goods_master_hs_code_idx
  ON goods_master (hs_code);

CREATE INDEX IF NOT EXISTS goods_master_updated_at_idx
  ON goods_master (updated_at DESC);

CREATE INDEX IF NOT EXISTS goods_master_org_cbam_idx
  ON goods_master (org_id)
  WHERE cbam_in_scope = true AND archived_at IS NULL;
