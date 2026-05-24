-- Agent memory & continuity (Sprint agent-memory-v1 / apex-plan Pillar I2).
--
-- Durable per-user memory the personal orchestrator reads/writes across
-- sessions ("remember our supplier is in Shenzhen", "my target margin is 35%").
-- KV is the synchronous primary (lib/agent-memory.js); this is the best-effort
-- dual-write that outlives KV's TTL.
--
-- Privacy: raw email NEVER lands here — email_hash only. value_json holds the
-- user-authored fact the agent stored; it is user data, returned only to that
-- same user, and purged by the GDPR delete path (lib/handlers/account.js).
--
-- Idempotent, auto-discovered by scripts/db-migrate.js.

CREATE TABLE IF NOT EXISTS agent_memory (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email_hash  text NOT NULL,                 -- SHA-256 first-16-hex; NEVER raw email
  mem_key     text NOT NULL,                 -- short slug the agent keys the fact by
  kind        text,                          -- optional category: preference | fact | context
  value_json  jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- One row per (user, key): saving the same key overwrites the fact.
CREATE UNIQUE INDEX IF NOT EXISTS agent_memory_key_idx
  ON agent_memory (email_hash, mem_key);

CREATE INDEX IF NOT EXISTS agent_memory_email_updated_idx
  ON agent_memory (email_hash, updated_at DESC);
