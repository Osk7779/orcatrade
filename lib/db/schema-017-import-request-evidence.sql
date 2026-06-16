-- Compliance evidence attachments on import requests — sprint 27.
--
-- Sprint 16 shipped structured decline reasons ('documentation_missing'
-- being one of them) and a "Revise this request" CTA. But the
-- customer had no way to actually attach evidence — they could revise
-- the form fields, but the compliance docs that drive CBAM / EUDR /
-- REACH / origin verification were still trapped outside the platform.
--
-- This migration adds an append-only JSONB array of evidence
-- attachments. v1 stores cloud-share URLs (SharePoint, Google Drive,
-- DropBox, signed S3 URLs) rather than uploaded files — what
-- enterprise customers actually use for compliance docs today,
-- avoiding the storage/AV-scan/PII surface that inline file upload
-- demands. Sprint 28+ can layer Vercel Blob on top of the same
-- shape when there's real customer volume to justify the storage
-- infra.
--
-- Each entry shape:
--   {
--     id           text   — 'ev_<8hex>' for cross-thread linking
--     regime       text   — 'CBAM' | 'EUDR' | 'REACH' | 'origin' | 'other'
--     label        text   — e.g. "EUDR DDS — coffee batch Q3 2026"
--     url          text   — https:// cloud-share link
--     uploadedByEmailHash text — actor; raw email NEVER stored (ADR 0008)
--     uploadedAt   text   — ISO timestamp at append
--     notes        text   — optional free-text context (<= 1000 chars)
--   }
--
-- Append-only at the API surface — once an attachment lands, only
-- the attacher (or ops admin) can append a "this was superseded by
-- attachment ev_xxx" note. This matches how compliance auditors think
-- about evidence chains: every artefact is preserved, supersession
-- is a separate event.
--
-- Defensive CHECK ensures jsonb_typeof = 'array' so the data-layer
-- iteration (Array.isArray()) can't see a malformed scalar.
--
-- Idempotent — re-runs are no-ops.

ALTER TABLE import_requests
  ADD COLUMN IF NOT EXISTS evidence_attachments jsonb NOT NULL DEFAULT '[]'::jsonb;

DO $$
BEGIN
  ALTER TABLE import_requests
    ADD CONSTRAINT import_requests_evidence_attachments_is_array
    CHECK (jsonb_typeof(evidence_attachments) = 'array');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
