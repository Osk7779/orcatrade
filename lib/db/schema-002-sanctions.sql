-- Sanctions / denied-party consolidated-list entries (Sprint sanctions-lists-v1).
--
-- Populated by the `sanctions-refresh` cron from official public lists
-- (OFAC SDN today; EU CFSP / UK OFSI / UN to follow). The screening engine
-- (lib/intelligence/sanctions-screening.js) reads the active set via
-- lib/intelligence/sanctions-list-store.js, falling back to the bundled
-- illustrative sample when this table is empty or Postgres is unavailable —
-- so a "no match" is only ever authoritative when real data is loaded.
--
-- Idempotent (CREATE … IF NOT EXISTS), like schema.sql.

CREATE TABLE IF NOT EXISTS sanctions_entries (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source       text NOT NULL,                 -- 'OFAC-SDN' | 'EU-CFSP' | 'UK-OFSI' | 'UN'
  external_id  text,                          -- the list's own id (e.g. OFAC ent_num)
  entry_type   text,                          -- individual | entity | vessel | aircraft | other
  name         text NOT NULL,
  aliases      jsonb NOT NULL DEFAULT '[]'::jsonb,
  programme    text,
  imported_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sanctions_entries_source_idx ON sanctions_entries (source);

-- One row per source: how many entries + when last refreshed. Lets /status
-- and the cron dashboard answer "is the OFAC list fresh?".
CREATE TABLE IF NOT EXISTS sanctions_refresh (
  source       text PRIMARY KEY,
  entry_count  integer NOT NULL DEFAULT 0,
  refreshed_at timestamptz NOT NULL DEFAULT now()
);
