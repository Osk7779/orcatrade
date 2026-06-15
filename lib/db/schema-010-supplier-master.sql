-- Supplier master — L1.2 of docs/strategic-plan-2026-2031.md §4.1.2.
--
-- The second master entity of the Phase 3 "advisor → system of record"
-- leap, following goods_master in schema-009. Each supplier the
-- importer transacts with becomes a supplier_master row carrying its
-- legal identity, sanctions-screening history, audit-certification
-- catalogue, EUDR Due Diligence Statement evidence, and trust
-- score — the foundation the Phase 5 supplier marketplace builds on.
--
-- Why PG-primary (same posture as goods_master):
-- Suppliers are *configuration*, not hot-path. They are read at
-- quote-emit time + sanctions-rescreen time + marketplace search.
-- The relational query patterns we need fit SQL: "every active supplier
-- in CN sanctions-screened in the last 30 days", "expiring audit
-- certs by week", "suppliers ranked by trust_score in HS chapter 85
-- territory".
--
-- Multi-tenant from day one. CASCADE on org delete. Soft delete via
-- archived_at preserves audit history when a supplier relationship
-- ends; partial unique index lets the (org_id, registration_number)
-- pair be reused if a supplier is retired and a new entity registers
-- the same number (rare but possible).
--
-- Sanctions hook: sanctions_last_screened_at + sanctions_last_status
-- + sanctions_last_match_summary jsonb. The rescreen cron updates
-- these in place; a stale screen surfaces as `screened_at < now() -
-- interval '30 days'` in monitoring dashboards. Schema neutral on
-- screening mechanics — the work happens in lib/intelligence/
-- sanctions-screening.js + lib/handlers/screen.js (already shipped
-- per the 2026-06-08 audit).
--
-- Privacy posture: created_by_email_hash, never raw email (ADR 0008).
--
-- Idempotent, auto-discovered by scripts/db-migrate.js.

CREATE TABLE IF NOT EXISTS supplier_master (
  id                            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  external_id                   text NOT NULL UNIQUE,                  -- 'sp_<16hex>' from lib/db/suppliers.js
  org_id                        bigint NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  created_by_email_hash         text NOT NULL,                         -- actor at creation; joins to users(email_hash)

  -- ── Identity ──
  entity_name                   text NOT NULL,                         -- legal entity name
  legal_form                    text,                                  -- 'llc' | 'gmbh' | 'sp_z_o_o' | 'ltd' | 'sa' | 'kft' | 'other'
  hq_country                    text NOT NULL,                         -- HQ country, ISO-2
  registration_number           text,                                  -- business licence / USCC (CN) / HKID (HK) / KRS (PL) / etc.
  registration_authority        text,                                  -- 'SAIC' (CN) / 'KRS' (PL) / 'Companies House' (UK) / etc.
  website                       text,
  primary_contact_email_hash    text,                                  -- contact's email-hash; raw email never stored here

  -- ── Sourcing geography ──
  factory_locations             jsonb NOT NULL DEFAULT '[]'::jsonb,    -- [{ countryCode, city, role: 'manufacturing'|'assembly'|'warehouse', floorAreaSqm? }]

  -- ── Sanctions screening (denormalised for hot reads) ──
  sanctions_last_screened_at    timestamptz,                           -- null = never screened
  sanctions_last_status         text,                                  -- 'clear' | 'potential_match' | 'match' | 'pending'
  sanctions_last_match_summary  jsonb NOT NULL DEFAULT '{}'::jsonb,    -- match payload from sanctions-screening.js

  -- ── Audit certifications ──
  audit_certs                   jsonb NOT NULL DEFAULT '[]'::jsonb,    -- [{ standard: 'iso_9001' | 'bsci' | 'sa8000' | 'sedex_smeta' | ..., issuer, certNumber, issuedAt, expiresAt, evidenceUrl? }]
  last_on_site_audit_date       date,                                  -- date of the most recent direct audit (us or partner)

  -- ── EUDR Due Diligence Statement evidence ──
  eudr_dds_evidence             jsonb NOT NULL DEFAULT '{}'::jsonb,    -- { geolocationProof, deforestationFreeAttestation, riskAssessmentRef, etc. }

  -- ── Trust score (0-100, derived) ──
  -- Maintained by lib/intelligence/supplier-trust.js (future PR) from
  -- sanctions + audit + EUDR + transaction history. Stored here so
  -- marketplace search can rank without re-deriving on every query.
  trust_score                   smallint,                              -- null until first computation; CHECK 0-100 below
  trust_score_computed_at       timestamptz,                           -- when the score was last computed
  trust_score_components        jsonb NOT NULL DEFAULT '{}'::jsonb,    -- per-component breakdown for explainability

  -- ── Extension point ──
  metadata                      jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- ── Lifecycle ──
  created_at                    timestamptz NOT NULL DEFAULT now(),
  updated_at                    timestamptz NOT NULL DEFAULT now(),
  archived_at                   timestamptz,                           -- null = active

  CONSTRAINT supplier_master_hq_country_format
    CHECK (hq_country ~ '^[A-Z]{2}$'),
  CONSTRAINT supplier_master_sanctions_status_check
    CHECK (sanctions_last_status IS NULL OR sanctions_last_status IN ('clear', 'potential_match', 'match', 'pending')),
  CONSTRAINT supplier_master_legal_form_check
    CHECK (legal_form IS NULL OR legal_form IN (
      'llc', 'gmbh', 'sp_z_o_o', 'ltd', 'sa', 'kft', 'sarl', 'srl', 'sas',
      'inc', 'corp', 'oy', 'ab', 'as', 'bv', 'nv', 'plc', 'cooperative', 'other'
    )),
  CONSTRAINT supplier_master_trust_score_bounds
    CHECK (trust_score IS NULL OR (trust_score >= 0 AND trust_score <= 100))
);

-- Registration number is unique within an org while ACTIVE. Mirrors the
-- goods_master (org_id, sku) partial-unique-index pattern: a supplier
-- relationship that's retired and later resumed under the same
-- entity number won't conflict with the archived historical row.
CREATE UNIQUE INDEX IF NOT EXISTS supplier_master_org_regnumber_active_uidx
  ON supplier_master (org_id, registration_number)
  WHERE archived_at IS NULL AND registration_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS supplier_master_org_id_idx
  ON supplier_master (org_id);

CREATE INDEX IF NOT EXISTS supplier_master_hq_country_idx
  ON supplier_master (hq_country);

CREATE INDEX IF NOT EXISTS supplier_master_updated_at_idx
  ON supplier_master (updated_at DESC);

-- Stale-sanctions monitoring query: "active suppliers whose last
-- sanctions screening is older than 30 days". A partial index on the
-- screening timestamp speeds the rescreen cron's nightly sweep.
CREATE INDEX IF NOT EXISTS supplier_master_sanctions_screened_at_idx
  ON supplier_master (sanctions_last_screened_at)
  WHERE archived_at IS NULL;

-- Marketplace ranking query: "active suppliers in country X by trust
-- score". Postgres can use this index for the (hq_country, trust_score
-- DESC) filter+sort pattern.
CREATE INDEX IF NOT EXISTS supplier_master_country_trust_idx
  ON supplier_master (hq_country, trust_score DESC NULLS LAST)
  WHERE archived_at IS NULL;
