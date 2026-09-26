'use strict';

// Loads @neondatabase/serverless and, when NEON_LOCAL_HTTP_PROXY is set,
// points its HTTP fetch at a local-neon-http-proxy instead of Neon cloud.
//
// The driver speaks Neon's SQL-over-HTTP protocol, so it cannot talk to a
// plain Postgres. CI's live-PG job runs vanilla postgres:15 plus the
// ghcr.io/timowilhelm/local-neon-http-proxy sidecar and sets
// NEON_LOCAL_HTTP_PROXY=http://localhost:4444/sql. Unset in every real
// environment (Vercel prod/preview talk to Neon directly).

function loadNeon() {
  const mod = require('@neondatabase/serverless');
  const endpoint = process.env.NEON_LOCAL_HTTP_PROXY;
  if (endpoint && mod.neonConfig) {
    mod.neonConfig.fetchEndpoint = () => endpoint;
  }
  return mod;
}

module.exports = { loadNeon };
