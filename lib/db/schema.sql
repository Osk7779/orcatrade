-- OrcaTrade Postgres schema v1 — Sprint BG-2.1.
--
-- Designed as IDEMPOTENT (CREATE TABLE IF NOT EXISTS / CREATE INDEX
-- IF NOT EXISTS / ON CONFLICT DO NOTHING) so the migration runner can
-- re-apply this file safely. Future schema changes ship as numbered
-- migration files (schema-002-…sql) in this directory; the migration
-- runner tracks applied versions in the schema_versions table below.
--
-- All identifiers in snake_case; all FK columns named `<entity>_id`;
-- all timestamps `timestamptz NOT NULL DEFAULT now()`; all
-- free-text "payload" columns are `jsonb` not `json` (binary form,
-- faster + indexable).
--
-- Schema goals
-- ────────────
-- 1. Become the source of truth for relational data the KV abstraction
--    can't query well (audit log filtered by org+date, event aggregates
--    beyond the 5000-row cap).
-- 2. Stay forward-compatible with the BG-3.1 org/seat model already
--    shipped to KV — `email_hash` is the join key so we never store
--    raw email in Postgres (one less PII surface, one less GDPR carve-out).
-- 3. Track AI eval + cost telemetry over time so trends survive cold
--    starts and the KV 5000-event cap.
--
-- KV remains primary for: sessions, magic tokens, rate-limit counters,
-- TARIC rate cache, circuit-breaker state. Those are inherently
-- ephemeral or high-frequency; Postgres would be overkill.

-- ── Migration bookkeeping ───────────────────────────────────────
-- One row per applied migration file. The runner checks this before
-- executing a file so re-runs are no-ops.

CREATE TABLE IF NOT EXISTS schema_versions (
  filename   text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now(),
  sha256     text NOT NULL                          -- content hash; mismatch on re-apply = warning, not error
);

-- ── Identity ────────────────────────────────────────────────────
-- users: one row per unique signed-in email. email_hash is the
-- SHA-256 first-16-hex of the lowercase-trimmed email (matches
-- lib/handlers/account.js emailHash() and lib/handlers/audit.js
-- redactRow()). The raw email is NOT stored in Postgres — it lives
-- only in the magic-token KV row + the session cookie + Resend.

CREATE TABLE IF NOT EXISTS users (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email_hash    text NOT NULL UNIQUE,                -- 16 hex chars
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS users_last_seen_at_idx
  ON users (last_seen_at DESC);

-- ── Organisations + memberships (BG-3.1 long-term home) ────────
-- Today the org data lives in KV (see lib/orgs.js). When tier
-- migration ships, this becomes the source of truth and KV becomes
-- the cache. The slug is generated server-side from the name; tier
-- defaults to 'free' until a Stripe webhook flips it.

CREATE TABLE IF NOT EXISTS organisations (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  external_id       text NOT NULL UNIQUE,            -- 'org_<16hex>' from lib/orgs.js
  name              text NOT NULL,
  slug              text UNIQUE,
  plan_tier         text NOT NULL DEFAULT 'free',    -- free | starter | growth | scale | enterprise
  owner_email_hash  text NOT NULL,                   -- denormalised for fast lookup; FK enforced via users(email_hash)
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS organisations_owner_email_hash_idx
  ON organisations (owner_email_hash);

CREATE INDEX IF NOT EXISTS organisations_plan_tier_idx
  ON organisations (plan_tier);

CREATE TABLE IF NOT EXISTS memberships (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id       bigint NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  email_hash   text NOT NULL,                        -- joins to users(email_hash)
  role         text NOT NULL DEFAULT 'member',       -- owner | admin | member (CHECK below)
  invited_at   timestamptz NOT NULL DEFAULT now(),
  joined_at    timestamptz,                          -- null = invite pending
  CONSTRAINT memberships_role_check CHECK (role IN ('owner', 'admin', 'member')),
  UNIQUE (org_id, email_hash)                        -- one membership per (org,user)
);

CREATE INDEX IF NOT EXISTS memberships_email_hash_idx
  ON memberships (email_hash);

CREATE INDEX IF NOT EXISTS memberships_org_role_idx
  ON memberships (org_id, role);

-- ── Saved plans (BG-0c long-term home) ──────────────────────────
-- Mirrors lib/saved-plans.js KV shape. share_code is the URL-safe
-- short id used in /start/p/<code>; inputs_json holds the wizard
-- inputs verbatim; snapshot_json holds the plan-diff snapshot.

CREATE TABLE IF NOT EXISTS saved_plans (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  external_id   text NOT NULL UNIQUE,                -- 'plan_<…>' from lib/saved-plans.js
  org_id        bigint REFERENCES organisations(id) ON DELETE SET NULL,
  email_hash    text NOT NULL,
  share_code    text UNIQUE,
  label         text,
  inputs_json   jsonb NOT NULL,
  snapshot_json jsonb,                                -- BG-0c snapshot for plan-diff
  created_at    timestamptz NOT NULL DEFAULT now(),
  archived_at   timestamptz
);

CREATE INDEX IF NOT EXISTS saved_plans_email_hash_idx
  ON saved_plans (email_hash);

CREATE INDEX IF NOT EXISTS saved_plans_org_id_idx
  ON saved_plans (org_id)
  WHERE org_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS saved_plans_created_at_idx
  ON saved_plans (created_at DESC);

-- ── Saved portfolios ────────────────────────────────────────────
-- Multi-SKU portfolio (a labelled set of plan-input lines + an aggregate
-- snapshot). KV is the hot-path primary; this is the durable corpus that
-- survives KV's 1-year TTL (Sprint portfolio-pg-dual-write-v1). Same
-- privacy discipline as saved_plans: email_hash only, never a raw email.
CREATE TABLE IF NOT EXISTS saved_portfolios (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  external_id   text NOT NULL UNIQUE,                -- 'pf_<…>' from lib/saved-portfolios.js
  org_id        bigint REFERENCES organisations(id) ON DELETE SET NULL,
  email_hash    text NOT NULL,
  share_code    text UNIQUE,
  label         text,
  lines_json    jsonb NOT NULL,                       -- the per-SKU input lines
  snapshot_json jsonb,                                -- aggregate (blended duty, totals)
  created_at    timestamptz NOT NULL DEFAULT now(),
  archived_at   timestamptz
);

CREATE INDEX IF NOT EXISTS saved_portfolios_email_hash_idx
  ON saved_portfolios (email_hash);

CREATE INDEX IF NOT EXISTS saved_portfolios_created_at_idx
  ON saved_portfolios (created_at DESC);

-- ── Audit log ───────────────────────────────────────────────────
-- Every state change goes here. Today only Article 17 deletions emit
-- structured logs with the hash; this table will absorb the firehose
-- once handlers are wired up. before/after are jsonb so we can record
-- the row diff for any mutation.

CREATE TABLE IF NOT EXISTS audit_log (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_email_hash text,                              -- null = system action (cron, GDPR cascade)
  org_id          bigint REFERENCES organisations(id) ON DELETE SET NULL,
  entity_type     text NOT NULL,                      -- 'org', 'membership', 'saved_plan', 'subscription', …
  entity_id       text,                               -- external_id of the touched entity
  action          text NOT NULL,                      -- 'create', 'update', 'delete', 'transfer-ownership', …
  before          jsonb,
  after           jsonb,
  request_id      text,                               -- correlate with x-request-id from the router
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_log_org_created_idx
  ON audit_log (org_id, created_at DESC);

CREATE INDEX IF NOT EXISTS audit_log_actor_idx
  ON audit_log (actor_email_hash, created_at DESC)
  WHERE actor_email_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS audit_log_entity_idx
  ON audit_log (entity_type, entity_id);

CREATE INDEX IF NOT EXISTS audit_log_created_at_idx
  ON audit_log (created_at DESC);

-- ── Events (BG-5.3 + BG-6.5 long-term home) ─────────────────────
-- Today the event log is a KV array capped at 5000. Once dual-write
-- is enabled, this table gets every record durably. The dashboards
-- will query views built off this table instead of scanning the KV
-- array. payload is jsonb so we can index specific fields per type.

CREATE TABLE IF NOT EXISTS events (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  type        text NOT NULL,                          -- import_plan_generated | plan_saved | founding_applied | ai_call | …
  org_id      bigint REFERENCES organisations(id) ON DELETE SET NULL,
  email_hash  text,                                   -- nullable: ai_call has no user identifier
  payload     jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS events_type_created_idx
  ON events (type, created_at DESC);

CREATE INDEX IF NOT EXISTS events_email_hash_idx
  ON events (email_hash, created_at DESC)
  WHERE email_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS events_org_created_idx
  ON events (org_id, created_at DESC)
  WHERE org_id IS NOT NULL;

-- ── Actuals (Track 1 reality-check loop) ────────────────────────
-- A customer's reported actual landed cost vs the calculator's estimate.
-- Feeds the quarterly calibration script in Track 1.3.

CREATE TABLE IF NOT EXISTS actuals (
  id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  saved_plan_id         bigint NOT NULL REFERENCES saved_plans(id) ON DELETE CASCADE,
  reported_landed_cents bigint NOT NULL,              -- integer cents (matches lib/intelligence/money.js)
  reported_duty_cents   bigint,
  reported_freight_cents bigint,
  reported_at           timestamptz NOT NULL DEFAULT now(),
  reported_by_email_hash text NOT NULL,
  notes                 text
);

CREATE INDEX IF NOT EXISTS actuals_plan_idx
  ON actuals (saved_plan_id);

-- ── Subscriptions ───────────────────────────────────────────────
-- Today the tier→email mapping lives in KV (lib/user-tier.js +
-- lib/stripe.js). On tier-migration sprint this becomes the source
-- of truth + KV becomes the cache.

CREATE TABLE IF NOT EXISTS subscriptions (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id             bigint REFERENCES organisations(id) ON DELETE SET NULL,
  email_hash         text,                            -- pre-org-migration users
  stripe_customer_id text UNIQUE,
  stripe_sub_id      text UNIQUE,
  tier               text NOT NULL DEFAULT 'free',    -- free | starter | growth | scale | enterprise
  status             text NOT NULL DEFAULT 'active',  -- active | past_due | canceled | trialing | incomplete
  current_period_end timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (org_id IS NOT NULL OR email_hash IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS subscriptions_org_idx
  ON subscriptions (org_id) WHERE org_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS subscriptions_email_idx
  ON subscriptions (email_hash) WHERE email_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS subscriptions_status_idx
  ON subscriptions (status, current_period_end);

-- ── Prompt runs (BG-6.4 long-term home) ─────────────────────────
-- One row per Anthropic call. Same shape as the ai_call structured
-- log line (lib/ai/cost-telemetry.js withCostTelemetry).
-- The lib/events.js dual-write will land ai_call records here in
-- a follow-up sprint; for now the schema exists so the dashboard can
-- query historical cost data.

CREATE TABLE IF NOT EXISTS prompt_runs (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  agent             text NOT NULL,                    -- orchestrator | compliance | sourcing | logistics | finance
  prompt_version    text,                             -- 'v1' | 'v2' | …
  prompt_hash       text,                             -- SHA-256 first-12-hex from prompts.hashPrompt
  model             text NOT NULL,                    -- 'claude-sonnet-4-7' | …
  input_tokens      integer NOT NULL DEFAULT 0,
  output_tokens     integer NOT NULL DEFAULT 0,
  cache_read_tokens integer NOT NULL DEFAULT 0,
  cost_cents        integer NOT NULL DEFAULT 0,
  latency_ms        integer NOT NULL DEFAULT 0,
  stop_reason       text,
  request_id        text,
  email_hash        text,                             -- which user triggered the call (nullable for cron)
  org_id            bigint REFERENCES organisations(id) ON DELETE SET NULL,
  tier              text,                             -- the user's tier at call time
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS prompt_runs_agent_version_created_idx
  ON prompt_runs (agent, prompt_version, created_at DESC);

CREATE INDEX IF NOT EXISTS prompt_runs_created_idx
  ON prompt_runs (created_at DESC);

CREATE INDEX IF NOT EXISTS prompt_runs_org_idx
  ON prompt_runs (org_id, created_at DESC)
  WHERE org_id IS NOT NULL;

-- ── End of schema v1 ────────────────────────────────────────────
-- Future migrations:
--   schema-002-…sql  add this when you ship a schema change
--   schema-003-…sql  …and so on.
-- The runner is alphabetical, so name them with leading zeros for ordering.
