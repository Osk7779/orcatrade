-- Shipment master — L1.3 of docs/strategic-plan-2026-2031.md §4.1.2.
--
-- The central operational entity of the Phase 3 "advisor → system of
-- record" leap. The unit the customer thinks in:
--
--   "I'm shipping 50 pallets of WIDGET-001 from Shenzhen Lighting
--    Co. to Gdańsk, departing 2026-09-15, due 2026-10-20."
--
-- Once the Shipment object exists, the customer stops keeping
-- shipments in spreadsheets and broker emails. They live HERE. Every
-- downstream Phase 3 deliverable — document filing (L1.4), exception
-- queue (L1.5), persistent dashboard (L1.6) — pivots around this
-- table.
--
-- State machine
-- ─────────────
--   planned    → booked      (carrier selected, container booked)
--   booked     → in_transit  (departure confirmed)
--   in_transit → cleared     (customs entry filed + accepted)
--   cleared    → delivered   (last-mile complete)
--   any non-cancelled → exception (with reason); exception → previous
--   any non-cancelled, non-delivered → cancelled (terminal)
--
-- Transitions are enforced at the data-layer (lib/db/shipments.js),
-- not by SQL CHECK constraints — the legal-transitions table needs
-- the WHERE clause to access the row's CURRENT status, which a row-
-- scoped CHECK can't see. The status field itself is constrained to
-- the closed taxonomy; the legal-transitions enforcement lives in code
-- with drift-guard tests.
--
-- FK posture
-- ──────────
-- goods_external_id + supplier_external_id are STRINGS referencing
-- goods_master(external_id) + supplier_master(external_id). We avoid
-- numeric FKs so the references stay stable if a row is ever
-- migrated (the bigint id is volatile across regions; the external_id
-- is permanent). Org-scoping is enforced at the query layer — a
-- shipment row's (goods_external_id, supplier_external_id) MUST
-- resolve within the same org_id. The data layer rejects mismatches
-- at write time; a future PR adds a server-side trigger.
--
-- Privacy: created_by_email_hash, never raw email (ADR 0008).
--
-- Idempotent, auto-discovered by scripts/db-migrate.js.

CREATE TABLE IF NOT EXISTS shipment_master (
  id                        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  external_id               text NOT NULL UNIQUE,                  -- 'sh_<16hex>' from lib/db/shipments.js
  org_id                    bigint NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  created_by_email_hash     text NOT NULL,

  -- ── Identity ──
  label                     text NOT NULL,                         -- customer's reference (e.g. "Q3 widget restock")
  status                    text NOT NULL DEFAULT 'planned',

  -- ── References to master entities (external_id, not numeric FK) ──
  goods_external_id         text,                                  -- joins goods_master.external_id (same org)
  supplier_external_id      text,                                  -- joins supplier_master.external_id (same org)

  -- ── Planned-state fields ──
  planned_departure_date    date,
  planned_arrival_date      date,
  customs_value_cents       bigint,                                -- integer cents (ADR 0004); null if unknown
  origin_country            text,                                  -- ISO-2; can be inherited from supplier
  destination_country       text,                                  -- ISO-2

  -- ── Booked-state fields ──
  carrier                   text,                                  -- 'Maersk' | 'CMA CGM' | etc.
  booking_ref               text,
  container_count           smallint,
  weight_kg                 integer,
  volume_cbm                numeric(8, 2),

  -- ── In-transit-state fields ──
  bl_number                 text,                                  -- bill of lading / AWB number
  actual_departure_date     date,
  eta                       date,
  last_known_location       text,

  -- ── Cleared-state fields ──
  cleared_at                timestamptz,
  declaration_ref           text,                                  -- customs declaration reference (CDS / IDEX MRN)
  duty_paid_cents           bigint,                                -- ADR 0004 integer cents
  vat_paid_cents            bigint,
  brokerage_paid_cents      bigint,

  -- ── Delivered-state fields ──
  delivered_at              timestamptz,

  -- ── Exception state ──
  exception_state           jsonb NOT NULL DEFAULT '{}'::jsonb,    -- { reason, openedAt, previousStatus, evidence? }

  -- ── Document vault ──
  document_vault            jsonb NOT NULL DEFAULT '[]'::jsonb,    -- [{ docType, name, externalId?, url?, attachedAt, draftRef? }]

  -- ── Reproducibility snapshots ──
  inputs_snapshot           jsonb,                                 -- the wizard inputs that produced this shipment
  quote_snapshot            jsonb,                                 -- the calculator output (totals, tier_a, etc.)

  -- ── Extension point ──
  metadata                  jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- ── Lifecycle ──
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  archived_at               timestamptz,

  CONSTRAINT shipment_master_status_check
    CHECK (status IN ('planned', 'booked', 'in_transit', 'cleared', 'delivered', 'exception', 'cancelled')),
  CONSTRAINT shipment_master_origin_country_format
    CHECK (origin_country IS NULL OR origin_country ~ '^[A-Z]{2}$'),
  CONSTRAINT shipment_master_destination_country_format
    CHECK (destination_country IS NULL OR destination_country ~ '^[A-Z]{2}$'),
  CONSTRAINT shipment_master_customs_value_non_negative
    CHECK (customs_value_cents IS NULL OR customs_value_cents >= 0),
  CONSTRAINT shipment_master_money_non_negative
    CHECK (
      (duty_paid_cents IS NULL OR duty_paid_cents >= 0)
      AND (vat_paid_cents IS NULL OR vat_paid_cents >= 0)
      AND (brokerage_paid_cents IS NULL OR brokerage_paid_cents >= 0)
    )
);

CREATE INDEX IF NOT EXISTS shipment_master_org_id_idx
  ON shipment_master (org_id);

CREATE INDEX IF NOT EXISTS shipment_master_status_idx
  ON shipment_master (org_id, status)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS shipment_master_goods_idx
  ON shipment_master (org_id, goods_external_id)
  WHERE goods_external_id IS NOT NULL AND archived_at IS NULL;

CREATE INDEX IF NOT EXISTS shipment_master_supplier_idx
  ON shipment_master (org_id, supplier_external_id)
  WHERE supplier_external_id IS NOT NULL AND archived_at IS NULL;

CREATE INDEX IF NOT EXISTS shipment_master_updated_at_idx
  ON shipment_master (updated_at DESC);

-- Exception queue feeder query: "all active shipments in exception
-- state, ordered by when the exception opened". The exception_state
-- jsonb's `openedAt` field is what we sort by — a functional index
-- would be ideal but requires immutability we don't guarantee here.
-- A partial index on status='exception' is good enough for v1.
CREATE INDEX IF NOT EXISTS shipment_master_exception_queue_idx
  ON shipment_master (org_id, updated_at DESC)
  WHERE status = 'exception' AND archived_at IS NULL;

-- ETA dashboard query: "active in-transit shipments due in the next
-- N days". The dashboard reads (status, eta) — partial index speeds
-- it.
CREATE INDEX IF NOT EXISTS shipment_master_eta_idx
  ON shipment_master (org_id, eta)
  WHERE status = 'in_transit' AND eta IS NOT NULL AND archived_at IS NULL;
