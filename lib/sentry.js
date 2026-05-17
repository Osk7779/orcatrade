// Sentry drain — Sprint BG-4.2.
//
// Forwards structured warn + error logs to Sentry via the envelope HTTP API.
// Zero-dep: no @sentry/node, no minified bundle, no source-map dance. Just
// a DSN parser + envelope POST. The pattern mirrors lib/stripe.js (raw fetch
// + manual auth header).
//
// Why not @sentry/node?
// ─────────────────────
// The official SDK is ~500kB minified, pulls in source-maps, tracing, profiling,
// and instrumentation we don't need. We log structured JSON from a single
// catch-all router; what we want from Sentry is an inbox for events. The
// envelope endpoint is the lowest possible surface area + the smallest blast
// radius if Sentry changes their API.
//
// Operational behaviour
// ─────────────────────
// - isConfigured(): true iff SENTRY_DSN env is set and parses correctly
// - captureMessage({ level, message, extras, tags }): fire-and-forget POST
//   to Sentry's envelope endpoint. Returns a Promise that resolves on success
//   (status 2xx) but rejects on transport error. Callers should NOT await
//   this — the structured log is the primary record; Sentry is a side channel.
// - parseDsn(dsn): pure function returning { host, projectId, publicKey }
//   or null if the DSN is malformed. Used by tests + the health probe.
//
// PII discipline
// ──────────────
// The drain assumes its caller already redacted PII (lib/log.js redact() runs
// before emit() → captureMessage). The drain itself doesn't re-redact.
// Any field passed via `extras` lands in the Sentry event's `extra` block;
// any field via `tags` becomes a Sentry tag (searchable, indexed). Tags are
// stricter — no nested objects, max 200 chars per value — so the drain only
// promotes a small whitelist of fields to tags.

'use strict';

const crypto = require('node:crypto');

const TAG_FIELDS = new Set([
  'handler',
  'action',
  'agent',
  'model',
  'promptVersion',
  'requestId',
  'tier',
  'orgId',
]);

function dsnFromEnv() {
  return process.env.SENTRY_DSN || '';
}

function release() {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA;
  return sha ? sha.slice(0, 8) : 'dev';
}

function environment() {
  return process.env.VERCEL_ENV
    || process.env.NODE_ENV
    || 'development';
}

// Parse a Sentry DSN of shape:
//   https://<publicKey>@<orgId>.ingest.sentry.io/<projectId>
//   https://<publicKey>@<orgId>.ingest.us.sentry.io/<projectId>
//   https://<publicKey>@o<n>.ingest.sentry.io/<projectId>
// Returns null if shape doesn't match (no throws — failure path must be silent).
function parseDsn(dsn) {
  if (!dsn || typeof dsn !== 'string') return null;
  try {
    const u = new URL(dsn);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (!u.username) return null;
    const projectId = u.pathname.replace(/^\//, '').split('/')[0];
    if (!projectId || !/^[0-9]+$/.test(projectId)) return null;
    return {
      protocol: u.protocol.replace(':', ''),
      host: u.host,
      projectId,
      publicKey: u.username,
    };
  } catch (_) {
    return null;
  }
}

function isConfigured() {
  return parseDsn(dsnFromEnv()) != null;
}

function envelopeUrl(parsed) {
  return `${parsed.protocol}://${parsed.host}/api/${parsed.projectId}/envelope/`;
}

function authHeader(parsed) {
  // sentry_client must be set so Sentry tags events by client lineage.
  return `Sentry sentry_version=7, sentry_key=${parsed.publicKey}, sentry_client=orcatrade-zero-dep/1.0`;
}

function generateEventId() {
  // 32 hex chars per Sentry's event_id spec — no dashes.
  return crypto.randomBytes(16).toString('hex');
}

// Split extras into { tags, extra } — promote whitelisted fields to tags
// (searchable in Sentry), everything else lands in the freeform extra block.
function splitTagsAndExtra(extras) {
  const tags = {};
  const extra = {};
  if (!extras || typeof extras !== 'object') return { tags, extra };
  for (const [k, v] of Object.entries(extras)) {
    if (v == null) continue;
    if (TAG_FIELDS.has(k) && (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')) {
      const s = String(v);
      tags[k] = s.length > 200 ? s.slice(0, 200) : s;
    } else {
      extra[k] = v;
    }
  }
  return { tags, extra };
}

function buildEvent({ level, message, extras }) {
  const eventId = generateEventId();
  const timestamp = Date.now() / 1000;
  const { tags, extra } = splitTagsAndExtra(extras);
  // Sentry's level vocabulary uses 'warning' not 'warn'.
  const sentryLevel = level === 'warn' ? 'warning' : level;
  return {
    eventId,
    timestamp,
    payload: {
      event_id: eventId,
      timestamp,
      level: sentryLevel,
      platform: 'node',
      logger: 'orcatrade',
      message: { formatted: String(message) },
      tags,
      extra,
      environment: environment(),
      release: release(),
      server_name: 'vercel-fn',
    },
  };
}

// Build the wire envelope — three newline-separated JSON lines:
//   1. envelope header { event_id, sent_at }
//   2. item header     { type, content_type }
//   3. item body       { event payload }
function buildEnvelopeBody(event) {
  const header = JSON.stringify({
    event_id: event.eventId,
    sent_at: new Date(event.timestamp * 1000).toISOString(),
  });
  const itemHeader = JSON.stringify({ type: 'event', content_type: 'application/json' });
  const itemBody = JSON.stringify(event.payload);
  return `${header}\n${itemHeader}\n${itemBody}\n`;
}

// POST the envelope. Returns a Promise — DO NOT await in handlers; this is
// strictly fire-and-forget. The structured log is the primary record.
//
// Resolves to { sent: bool, status?, err? } so a test can assert behaviour
// without hitting the network. Live network failures resolve (not reject)
// so the caller's .catch() is for unexpected exceptions only.
async function captureMessage({ level, message, extras }) {
  const parsed = parseDsn(dsnFromEnv());
  if (!parsed) return { sent: false, reason: 'no-dsn' };

  const event = buildEvent({ level, message, extras });
  const body = buildEnvelopeBody(event);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    let response;
    try {
      response = await fetch(envelopeUrl(parsed), {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/x-sentry-envelope',
          'X-Sentry-Auth': authHeader(parsed),
          'User-Agent': 'orcatrade-zero-dep/1.0',
        },
        body,
      });
    } finally {
      clearTimeout(timeout);
    }
    if (response.ok) return { sent: true, status: response.status, eventId: event.eventId };
    return { sent: false, status: response.status, err: 'non-2xx' };
  } catch (err) {
    return { sent: false, err: err.message };
  }
}

module.exports = {
  isConfigured,
  parseDsn,
  envelopeUrl,
  authHeader,
  buildEvent,
  buildEnvelopeBody,
  captureMessage,
  splitTagsAndExtra,
  generateEventId,
  TAG_FIELDS,
};
