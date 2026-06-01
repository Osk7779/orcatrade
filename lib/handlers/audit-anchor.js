// /api/audit/anchor — public verifiable audit-chain anchor (Pillar III2).
//
// Why this endpoint exists
// ────────────────────────
// lib/events.js stamps every event with { _seq, _prevHash, _hash } at
// write time and maintains a chain head in KV (`events:chainHead`).
// docs/security/audit-trail.md and /trust/ both promise customers
// "tamper-evident by design — any in-place edit, deletion or
// reordering of a stored row breaks the chain and is detectable."
//
// Until this PR that promise was only verifiable INSIDE OrcaTrade.
// The two existing verification endpoints (`/api/audit?format=chain`
// and `?format=verify-stored`) are admin-gated, so a customer cannot
// independently check the chain's integrity. That made the
// tamper-evidence claim self-attesting — exactly what a procurement
// reviewer reads as "trust us."
//
// What this endpoint does
// ───────────────────────
// Returns the CURRENT chain anchor as a public, unauthenticated JSON:
//
//   {
//     ok: true,
//     asOf: '2026-06-01T12:00:00.000Z',
//     genesis: 'orcatrade-events-genesis-v1',
//     chainHead: '<sha256 hex of the last event, or genesis if empty>',
//     chainLength: <seq counter>,
//     verification: { … instructions … }
//   }
//
// The chain head is a sha256 hash. It carries no PII — the chain is
// defined over a non-PII projection per ADR 0008 / docs/security/
// audit-trail.md (email/name/company/role/message excluded). So
// the endpoint is safely public, the way blockchain block hashes
// are public.
//
// What a customer does with it
// ────────────────────────────
// 1. Fetch periodically (e.g. weekly).
// 2. Store each fetched { chainHead, chainLength, asOf } locally.
// 3. The chain is append-only: a newer fetch's chainLength must be
//    ≥ the older's, and the older chainHead must appear in the
//    chain at that earlier _seq (admin-only `?format=verify-stored`
//    confirms — but third-party services like Sigstore Rekor or a
//    trusted-timestamp authority could pin the anchor without
//    asking us). If we ever rewrite the chain, those historical
//    anchors prove the shift.
//
// Cache discipline
// ────────────────
// `Cache-Control: no-store` — the head changes on every write; a
// cached value that lied about the current head would defeat the
// purpose. (CDNs honour no-store; we're not trying to serve this
// from edge cache.)

'use strict';

const kv = require('../intelligence/kv-store');
const events = require('../events');
const log = require('../log').withContext({ handler: 'audit-anchor' });

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  return res.end(JSON.stringify(body));
}

/**
 * Read the current chain anchor from KV. Pure (no side effects) —
 * exported so callers other than this handler (the trust page's
 * inline renderer; the daily snapshot job in Phase 2) can fetch it
 * without spinning up an HTTP loop.
 *
 * Returns { chainHead, chainLength, asOf, genesis, kvAvailable }.
 * A KV outage yields { chainHead: genesis, chainLength: 0,
 * kvAvailable: false } — degraded-but-honest is the right shape.
 */
async function readAnchor() {
  const asOf = new Date().toISOString();
  const genesis = events.CHAIN_GENESIS;
  let chainHead = genesis;
  let chainLength = 0;
  let kvAvailable = true;
  try {
    const head = await kv.get(events.CHAIN_HEAD_KEY);
    if (typeof head === 'string' && head) chainHead = head;
    // CHAIN_SEQ_KEY is set via kv.incr — comes back as a number from
    // Upstash REST; in the in-memory fallback it's also a number.
    const seq = await kv.get(events.CHAIN_SEQ_KEY);
    if (Number.isFinite(Number(seq))) chainLength = Number(seq);
  } catch (err) {
    // KV outage shouldn't return 5xx — the public anchor is a
    // best-effort signal. We surface the unavailable flag so the
    // customer-side verifier can treat "head == genesis, length ==
    // 0, kvAvailable == false" as "couldn't read" rather than
    // "chain is empty."
    log.warn('audit-anchor KV read failed', { err: err && err.message });
    kvAvailable = false;
  }
  return { chainHead, chainLength, asOf, genesis, kvAvailable };
}

// Resolve the optional sub-action from the URL: /api/audit-anchor → ''
// (current anchor); /api/audit-anchor/history → 'history' (recent
// snapshots). The dispatcher splits on '/' before calling us, so the
// sub-action arrives via req.query.path or the trailing URL segment.
function resolveSubAction(req) {
  if (req.query && req.query.path) {
    const arr = Array.isArray(req.query.path) ? req.query.path : String(req.query.path).split('/');
    return (arr[1] || '').toLowerCase();
  }
  const pathname = (req.url || '').split('?')[0];
  const segments = pathname.replace(/^\/api\/audit-anchor\/?/, '').split('/').filter(Boolean);
  return (segments[0] || '').toLowerCase();
}

function readLimit(req) {
  let raw;
  if (req.query && req.query.limit != null) raw = req.query.limit;
  else {
    const qs = (req.url || '').split('?')[1] || '';
    raw = new URLSearchParams(qs).get('limit') || '';
  }
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 200;
    return res.end();
  }
  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET');
    return res.end();
  }

  // GET /api/audit-anchor/history → public read of recent anchor
  // snapshots. Same Cache-Control + CORS posture as the live
  // anchor — a cached stale history would defeat the continuity
  // claim. Lazy-required so a fresh load of audit-anchor (e.g.
  // in tests that don't exercise history) doesn't pay the cost.
  const sub = resolveSubAction(req);
  if (sub === 'history') {
    const history = require('../audit-anchor-history');
    const limit = readLimit(req);
    const snapshots = await history.listAnchorSnapshots({ limit });
    return json(res, 200, {
      ok: true,
      asOf: new Date().toISOString(),
      maxSnapshots: history.MAX_SNAPSHOTS,
      count: snapshots.length,
      snapshots,
      docs: 'https://github.com/Osk7779/orcatrade/blob/main/docs/security/audit-trail.md',
    });
  }

  const anchor = await readAnchor();
  return json(res, 200, {
    ok: true,
    asOf: anchor.asOf,
    genesis: anchor.genesis,
    chainHead: anchor.chainHead,
    chainLength: anchor.chainLength,
    kvAvailable: anchor.kvAvailable,
    verification: {
      algorithm: 'sha256(prevHash + canonical(event))',
      canonicalProjection: 'PII-stripped per docs/security/audit-trail.md (no email/name/company/role/message)',
      howToVerify: [
        'Persist this { chainHead, chainLength, asOf } locally on each fetch.',
        'On the next fetch, the new chainLength must be >= the previous.',
        'The previous chainHead must remain reachable in the chain at the previous _seq.',
        'A divergence (older chainHead no longer in the chain at its _seq) is detectable evidence that the chain was rewritten.',
        'For continuity: GET /api/audit-anchor/history returns a rolling history (capped) of past anchors so this verification can run across days/weeks without you needing to pin every fetch yourself.',
      ],
      adminVerification: 'OrcaTrade ops can re-walk the stored chain via GET /api/audit?format=verify-stored (admin-only); the result must match this anchor.',
    },
    docs: 'https://github.com/Osk7779/orcatrade/blob/main/docs/security/audit-trail.md',
  });
};

// Test surface
module.exports.readAnchor = readAnchor;
