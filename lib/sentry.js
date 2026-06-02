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

// ── Exception capture (Phase 0 P0.7) ───────────────────────────────────
//
// captureException preserves the Error's stack trace as Sentry "exception"
// frames so the event appears in the Issues view with a usable backtrace.
// captureMessage flattens errors into a plain text message; for actual
// thrown errors that loses the most useful debug data.
//
// Parses a V8-style stack trace (the format Node + browsers emit) into
// Sentry's frame format:
//     "    at foo (/path/file.js:42:10)"   →  { function: 'foo', filename: '/path/file.js', lineno: 42, colno: 10 }
//     "    at /path/file.js:5:1"           →  { function: '<anonymous>', filename: '/path/file.js', lineno: 5, colno: 1 }
function parseStackFrames(err) {
  if (!err || typeof err.stack !== 'string') return [];
  const lines = err.stack.split('\n').slice(1); // skip the "Error: msg" header
  const frames = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line.startsWith('at ')) continue;
    const body = line.slice(3);
    // Two shapes: "fn (path:line:col)" or "path:line:col"
    let fn = '<anonymous>';
    let loc = body;
    const parenMatch = body.match(/^(.+?)\s+\((.+)\)$/);
    if (parenMatch) {
      fn = parenMatch[1];
      loc = parenMatch[2];
    }
    const locMatch = loc.match(/^(.+?):(\d+):(\d+)$/);
    if (!locMatch) {
      frames.push({ function: fn, filename: loc, in_app: !loc.includes('/node_modules/') });
      continue;
    }
    frames.push({
      function: fn,
      filename: locMatch[1],
      lineno: Number(locMatch[2]),
      colno: Number(locMatch[3]),
      in_app: !locMatch[1].includes('/node_modules/'),
    });
  }
  // Sentry expects oldest-first; V8 emits newest-first.
  return frames.reverse();
}

function buildExceptionEvent({ err, extras, tags: extraTags, level = 'error' }) {
  const eventId = generateEventId();
  const timestamp = Date.now() / 1000;
  const { tags, extra } = splitTagsAndExtra(extras);
  for (const [k, v] of Object.entries(extraTags || {})) {
    if (v != null && (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')) {
      const s = String(v);
      tags[k] = s.length > 200 ? s.slice(0, 200) : s;
    }
  }
  return {
    eventId,
    timestamp,
    payload: {
      event_id: eventId,
      timestamp,
      level,
      platform: 'node',
      logger: 'orcatrade',
      exception: {
        values: [
          {
            type: (err && err.name) || 'Error',
            value: (err && err.message) || String(err),
            stacktrace: { frames: parseStackFrames(err) },
          },
        ],
      },
      tags,
      extra,
      environment: environment(),
      release: release(),
      server_name: 'vercel-fn',
    },
  };
}

// Fire-and-forget. Returns { sent, status?, eventId?, err? } resolved (not
// rejected) on network failures so callers don't need try/catch around
// the telemetry call.
async function captureException(err, { extras, tags, level } = {}) {
  const parsed = parseDsn(dsnFromEnv());
  if (!parsed) return { sent: false, reason: 'no-dsn' };

  const event = buildExceptionEvent({ err, extras, tags, level });
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
  } catch (networkErr) {
    return { sent: false, err: networkErr.message };
  }
}

// ── Process-level handlers (Phase 0 P0.7) ──────────────────────────────
//
// Vercel functions cold-start fresh per invocation. installProcessHandlers
// idempotently wires uncaughtException + unhandledRejection → Sentry so
// errors that escape the dispatcher's try/catch (e.g. errors at module
// load, async errors from setTimeout callbacks, post-response throws)
// still leave a trace in the Issues view.
//
// We deliberately do NOT exit() on uncaught — that's Vercel's job; we
// just need the error captured. The native crash log goes to stdout per
// Node defaults; this adds Sentry as a side channel.
let processHandlersInstalled = false;
function installProcessHandlers() {
  if (processHandlersInstalled) return false;
  processHandlersInstalled = true;

  process.on('uncaughtException', (err) => {
    captureException(err, { tags: { source: 'process.uncaughtException' } }).catch(() => {});
  });
  process.on('unhandledRejection', (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    captureException(err, { tags: { source: 'process.unhandledRejection' } }).catch(() => {});
  });
  return true;
}

function _resetProcessHandlersForTesting() {
  processHandlersInstalled = false;
}

module.exports = {
  isConfigured,
  parseDsn,
  envelopeUrl,
  authHeader,
  buildEvent,
  buildEnvelopeBody,
  buildExceptionEvent,
  captureMessage,
  captureException,
  installProcessHandlers,
  parseStackFrames,
  splitTagsAndExtra,
  generateEventId,
  TAG_FIELDS,
  _resetProcessHandlersForTesting,
};
