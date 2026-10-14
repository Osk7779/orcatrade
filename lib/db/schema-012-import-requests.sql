-- Import Request — L1.0 of docs/strategic-plan-2026-2031.md §4.1.2.
--
-- The customer-intent primitive that PRECEDES Goods (L1.1), Supplier
-- (L1.2), and Shipment (L1.3). The unit the customer thinks in:
--
--   "I want 3,000 silicone kitchen mats from Asia, food-grade,
--    EU-compliant, delivered to Hamburg in 8 weeks, target landed
--    €13 a unit."
--
-- The Operator wedge (Phase 3 of the billion-dollar direction): the
-- customer expresses intent here; the AI generates a factory shortlist
-- + a calculator-grounded landed-cost quote; the OrcaTrade team reviews
-- the AI output (ADR 0015 human-review gate) before the customer sees
-- it; the customer approves; downstream Shipment + Goods + Supplier
-- rows get materialised. This row is the system-of-record of the
-- customer's intent and the AI's response.
--
-- State machine
-- ─────────────
--   submitted        → processing | cancelled | failed
--   processing       → awaiting_review | failed | cancelled
--   awaiting_review  → quoted | cancelled | failed
--   quoted           → customer_approved | customer_rejected | expired | cancelled
--   customer_approved, customer_rejected, expired, cancelled, failed → ∅  (terminal)
--
-- Transitions enforced at the data-layer (lib/db/import-requests.js),
-- mirroring the shipment_master pattern (drift-guard test pins both).
-- The status field is constrained to the closed taxonomy via SQL CHECK;
-- the legal-edges table lives in JS and is tested for parity with the
-- TypeScript mirror in app-shell/lib/api.ts.
--
-- AI artefacts
-- ────────────
-- factory_shortlist + landed_quote are JSONB blobs populated by the
-- server-side flow in lib/ai/import-request-orchestrator.js. The flow:
--   1. customer POSTs intent (status='submitted')
--   2. handler kicks off the orchestrator (status='processing')
--   3. orchestrator calls sourcing-agent for candidates + the existing
--      landed-cost calculators (customs, CBAM, freight, FX) for the
--      quote, populating both JSONB fields (status='awaiting_review')
--   4. team reviews/edits in the ops console (status='quoted' when sent)
--   5. customer approves/rejects (status='customer_approved' | …)
--
-- The AI never produces a decision number directly (ADR 0002): every
-- monetary value in landed_quote traces to a calculator output with
-- [chunk-id] citations and a Tier-A/B/C confidence flag (ADR 0020).
--
-- Privacy: created_by_email_hash, never raw email (ADR 0008). The
-- customer_decision_state.decidedByEmailHash mirrors this.
--
-- Idempotent, auto-discovered by scripts/db-migrate.js.

CREATE TABLE IF NOT EXISTS import_requests (
  id                              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  external_id                     text NOT NULL UNIQUE,                  -- 'ir_<16hex>' from lib/db/import-requests.js
  org_id                          bigint NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  created_by_email_hash           text NOT NULL,

  -- ── Identity ──
  label                           text NOT NULL,                         -- customer's reference (e.g. "Q3 kitchen mats launch")
  status                          text NOT NULL DEFAULT 'submitted',

  -- ── Customer intent (what they want to import) ──
  product_description             text NOT NULL,                         -- free-text — fed into the sourcing agent
  hs_code_guess                   text,                                  -- optional pre-classification (6-10 digits)
  target_quantity                 integer,                               -- units of target_quantity_unit
  target_quantity_unit            text,                                  -- 'pieces' | 'kg' | 'pallets' | 'units' | 'cartons'
  target_unit_price_cents         bigint,                                -- target LANDED unit price in EUR cents (ADR 0004)
  origin_country                  text,                                  -- ISO-2 (usually CN / VN / IN / BD / TR)
  destination_country             text NOT NULL,                         -- ISO-2 EU member
  target_delivery_date            date,
  certification_requirements      jsonb NOT NULL DEFAULT '[]'::jsonb,    -- ['CE', 'REACH', 'FDA-food-contact', 'EUDR']
  intent_metadata                 jsonb NOT NULL DEFAULT '{}'::jsonb,    -- free-form extras the customer attaches

  -- ── AI-generated artefacts ──
  factory_shortlist               jsonb NOT NULL DEFAULT '[]'::jsonb,    -- [{ supplierName, country, trustScore, fitScore, citations[], … }]
  shortlist_generated_at          timestamptz,
  landed_quote                    jsonb,                                 -- { components, totalCents, orcatradeFeeCents, currency, tier, citations[] }
  quote_generated_at              timestamptz,
  quote_expires_at                timestamptz,                           -- when null, quote_generated_at + 14d is the soft default
  ai_run_ids                      jsonb NOT NULL DEFAULT '[]'::jsonb,    -- telemetry trace ids from the AI orchestrator (eval gate input)

  -- ── Team review (ADR 0015 human gate) ──
  team_review_state               jsonb NOT NULL DEFAULT '{}'::jsonb,    -- { reviewedByEmailHash, reviewedAt, edits[], decision, notes }

  -- ── Customer decision ──
  customer_decision_state         jsonb NOT NULL DEFAULT '{}'::jsonb,    -- { decision, decidedAt, decidedByEmailHash, notes }

  -- ── Failure / cancellation state ──
  failure_state                   jsonb NOT NULL DEFAULT '{}'::jsonb,    -- { reason, code, occurredAt, recoverable? }

  -- ── Downstream materialisation (after customer_approved) ──
  linked_shipment_external_id     text,                                  -- the Shipment master row spawned by approval
  linked_goods_external_id        text,                                  -- optional — set if this request also materialised a Goods row
  linked_supplier_external_id     text,                                  -- the chosen supplier from the shortlist

  -- ── Extension ──
  metadata                        jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- ── Lifecycle ──
  created_at                      timestamptz NOT NULL DEFAULT now(),
  updated_at                      timestamptz NOT NULL DEFAULT now(),
  archived_at                     timestamptz,

  CONSTRAINT import_requests_status_check
    CHECK (status IN (
      'submitted', 'processing', 'awaiting_review', 'quoted',
      'customer_approved', 'customer_rejected', 'expired',
      'cancelled', 'failed'
    )),
  CONSTRAINT import_requests_origin_country_format
    CHECK (origin_country IS NULL OR origin_country ~ '^[A-Z]{2}$'),
  CONSTRAINT import_requests_destination_country_format
    CHECK (destination_country ~ '^[A-Z]{2}$'),
  CONSTRAINT import_requests_hs_code_format
    CHECK (hs_code_guess IS NULL OR hs_code_guess ~ '^[0-9]{6,10}$'),
  CONSTRAINT import_requests_target_quantity_non_negative
    CHECK (target_quantity IS NULL OR target_quantity > 0),
  CONSTRAINT import_requests_target_unit_price_non_negative
    CHECK (target_unit_price_cents IS NULL OR target_unit_price_cents >= 0),
  CONSTRAINT import_requests_target_quantity_unit_check
    CHECK (target_quantity_unit IS NULL OR target_quantity_unit IN (
      'pieces', 'kg', 'pallets', 'units', 'cartons', 'tonnes', 'litres', 'cubic_metres'
    )),
  CONSTRAINT import_requests_certification_requirements_is_array
    CHECK (jsonb_typeof(certification_requirements) = 'array'),
  CONSTRAINT import_requests_factory_shortlist_is_array
    CHECK (jsonb_typeof(factory_shortlist) = 'array'),
  CONSTRAINT import_requests_ai_run_ids_is_array
    CHECK (jsonb_typeof(ai_run_ids) = 'array')
);

CREATE INDEX IF NOT EXISTS import_requests_org_id_idx
  ON import_requests (org_id);

CREATE INDEX IF NOT EXISTS import_requests_status_idx
  ON import_requests (org_id, status)
  WHERE archived_at IS NULL;

-- "My requests" — fed by the customer-side list page.
CREATE INDEX IF NOT EXISTS import_requests_created_by_idx
  ON import_requests (org_id, created_by_email_hash, updated_at DESC)
  WHERE archived_at IS NULL;

-- Ops queue feeder: all requests awaiting team review, oldest first.
CREATE INDEX IF NOT EXISTS import_requests_review_queue_idx
  ON import_requests (org_id, created_at)
  WHERE status = 'awaiting_review' AND archived_at IS NULL;

-- Recency for the global list view.
CREATE INDEX IF NOT EXISTS import_requests_updated_at_idx
  ON import_requests (updated_at DESC);

-- Quote-expiry sweep target: live quotes whose expiry has passed need
-- to transition to 'expired'. A nightly cron job will scan this partial
-- index and call the data-layer transition function.
CREATE INDEX IF NOT EXISTS import_requests_quote_expiry_idx
  ON import_requests (org_id, quote_expires_at)
  WHERE status = 'quoted' AND quote_expires_at IS NOT NULL AND archived_at IS NULL;
