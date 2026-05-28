-- Drafted-document persistence + approval-audit (Sprint document-approval-v1,
-- apex Pillar I5 "act, with approval").
--
-- KV (lib/draft-store.js) is the synchronous primary; this is the durable
-- record that outlives KV's TTL and is queryable across users for an audit
-- review of who approved what.
--
-- Privacy: raw email NEVER lands here — email_hash only (saved-plans /
-- alert-store pattern). data_json holds the post-merge document data the user
-- rendered + approved (or rejected); the renderer is deterministic so the
-- HTML can be reproduced from the data at any time. No PII by construction.
--
-- Idempotent, auto-discovered by scripts/db-migrate.js.

CREATE TABLE IF NOT EXISTS drafts (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  external_id     text NOT NULL UNIQUE,                        -- 'dr_<16hex>' from lib/draft-store.js
  email_hash      text NOT NULL,                                -- SHA-256 first-16-hex
  doc_type        text NOT NULL,                                -- 'commercial_invoice' | 'cbam_report' | ...
  label           text,
  data_json       jsonb NOT NULL DEFAULT '{}'::jsonb,
  status          text NOT NULL DEFAULT 'pending_approval',
  decision_notes  text,
  decided_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT drafts_status_check
    CHECK (status IN ('pending_approval', 'approved', 'rejected'))
);

CREATE INDEX IF NOT EXISTS drafts_email_status_idx
  ON drafts (email_hash, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS drafts_doc_type_idx
  ON drafts (doc_type, updated_at DESC);
