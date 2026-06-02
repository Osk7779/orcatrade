'use strict';

// Phase 1 — apex III2 public audit anchor.
//
// Tests the public /api/audit-anchor endpoint. The chain head is
// already maintained by lib/events.js at CHAIN_HEAD_KEY + CHAIN_SEQ_KEY
// (write-time stamping, Sprint audit-chain-v2). This PR's job is to
// expose it publicly + correctly.
//
// Coverage:
//   - readAnchor returns genesis + length 0 when KV is empty
//   - readAnchor reflects what's in KV after events.record()
//   - GET /api/audit-anchor returns 200 + JSON + correct headers
//     (no-store, CORS, application/json)
//   - GET method-only (POST → 405)
//   - OPTIONS → 200 (CORS preflight)
//   - The anchor advances when more events are written
//   - Response body has the documented shape (ok, asOf, genesis,
//     chainHead, chainLength, verification, docs)
//   - Verification block names the algorithm explicitly so a
//     customer-side verifier knows what to compute
//   - Source-pin: api/[...path].js dispatcher registers
//     'audit-anchor' handler

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.ORCATRADE_AUTH_SECRET = 'test-secret-do-not-use-in-prod';
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

const kv = require('../lib/intelligence/kv-store');
const events = require('../lib/events');
const auditAnchor = require('../lib/handlers/audit-anchor');

const ROOT = path.resolve(__dirname, '..');

function mockRes() {
  return {
    statusCode: 200, headers: {}, body: '',
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(b) { this.body = b || ''; return this; },
  };
}
function getReq() {
  return { method: 'GET', headers: {}, url: '/api/audit-anchor' };
}

// ── readAnchor (the pure surface) ────────────────────────────────────

test('readAnchor returns genesis + length 0 when KV is empty', async () => {
  kv._resetMemoryStore();
  const anchor = await auditAnchor.readAnchor();
  assert.equal(anchor.chainHead, events.CHAIN_GENESIS);
  assert.equal(anchor.chainLength, 0);
  assert.equal(anchor.genesis, events.CHAIN_GENESIS);
  assert.ok(anchor.asOf && !Number.isNaN(Date.parse(anchor.asOf)));
  assert.equal(anchor.kvAvailable, true);
});

test('readAnchor reflects KV state after events.record() writes', async () => {
  kv._resetMemoryStore();
  // events.record stamps _seq + _prevHash + _hash and advances
  // CHAIN_HEAD_KEY + CHAIN_SEQ_KEY.
  await events.record('auth_signin', { email: 'a@example.com' });
  await events.record('auth_signin', { email: 'b@example.com' });

  const anchor = await auditAnchor.readAnchor();
  assert.equal(anchor.chainLength, 2, 'two records → chainLength 2');
  assert.notEqual(anchor.chainHead, events.CHAIN_GENESIS, 'head must advance from genesis');
  assert.match(anchor.chainHead, /^[0-9a-f]{64}$/, 'head is a sha256 hex');
});

test('readAnchor advances chainHead between two reads when more events are written', async () => {
  kv._resetMemoryStore();
  await events.record('auth_signin', { email: 'first@example.com' });
  const before = await auditAnchor.readAnchor();
  await events.record('auth_signin', { email: 'second@example.com' });
  const after = await auditAnchor.readAnchor();

  assert.equal(after.chainLength, before.chainLength + 1, 'length advances by 1');
  assert.notEqual(after.chainHead, before.chainHead, 'head changes');
});

// ── HTTP handler contract ────────────────────────────────────────────

test('GET /api/audit-anchor returns 200 + JSON', async () => {
  kv._resetMemoryStore();
  const req = getReq(); const res = mockRes();
  await auditAnchor(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['content-type'], 'application/json');
  const body = JSON.parse(res.body);
  assert.equal(body.ok, true);
  assert.equal(body.chainHead, events.CHAIN_GENESIS);
  assert.equal(body.chainLength, 0);
  assert.equal(body.genesis, events.CHAIN_GENESIS);
  assert.ok(body.asOf);
});

test('GET /api/audit-anchor sets Cache-Control: no-store', async () => {
  // The anchor MUST NOT be cached — a stale value would defeat the
  // tamper-evidence claim ("here's the head as of yesterday" is
  // not the same as "here's the head as of now").
  kv._resetMemoryStore();
  const req = getReq(); const res = mockRes();
  await auditAnchor(req, res);
  assert.equal(res.headers['cache-control'], 'no-store');
});

test('GET /api/audit-anchor sets CORS headers (public consumer access)', async () => {
  kv._resetMemoryStore();
  const req = getReq(); const res = mockRes();
  await auditAnchor(req, res);
  assert.equal(res.headers['access-control-allow-origin'], '*');
  assert.match(res.headers['access-control-allow-methods'] || '', /GET/);
});

test('OPTIONS /api/audit-anchor → 200 (CORS preflight)', async () => {
  const req = { method: 'OPTIONS', headers: {}, url: '/api/audit-anchor' };
  const res = mockRes();
  await auditAnchor(req, res);
  assert.equal(res.statusCode, 200);
});

test('POST /api/audit-anchor → 405 with Allow: GET', async () => {
  // The anchor is read-only — POST/PUT/DELETE/PATCH must 405.
  const req = { method: 'POST', headers: {}, url: '/api/audit-anchor', body: {} };
  const res = mockRes();
  await auditAnchor(req, res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers['allow'], 'GET');
});

test('response body has the documented verification block', async () => {
  kv._resetMemoryStore();
  const req = getReq(); const res = mockRes();
  await auditAnchor(req, res);
  const body = JSON.parse(res.body);
  assert.ok(body.verification);
  assert.match(
    body.verification.algorithm,
    /sha256/i,
    'verification must name the sha256 algorithm so a third-party verifier knows what to compute',
  );
  assert.ok(Array.isArray(body.verification.howToVerify) && body.verification.howToVerify.length > 0);
  // The "no PII" claim is the load-bearing reason this endpoint is
  // public; pin its presence.
  assert.match(body.verification.canonicalProjection, /PII/i);
});

test('response body links to the audit-trail docs (so customers can read the spec)', async () => {
  kv._resetMemoryStore();
  const req = getReq(); const res = mockRes();
  await auditAnchor(req, res);
  const body = JSON.parse(res.body);
  assert.match(String(body.docs || ''), /docs\/security\/audit-trail\.md/);
});

// ── source-pin: dispatcher registers the handler ────────────────────

test('api/[...path].js dispatcher registers audit-anchor handler', () => {
  const src = fs.readFileSync(path.join(ROOT, 'api/[...path].js'), 'utf8');
  assert.match(
    src,
    /['"]audit-anchor['"]:\s*require\(['"]\.\.\/lib\/handlers\/audit-anchor['"]\)/,
    'dispatcher must register audit-anchor at /api/audit-anchor',
  );
});

// ── source-pin: /trust/ surfaces the live anchor ────────────────────

test('/trust/ page references /api/audit-anchor + has the loader script', () => {
  const src = fs.readFileSync(path.join(ROOT, 'trust/legacy/index.html'), 'utf8');
  // The endpoint must be linked from the trust page so a procurement
  // reviewer who reads the trust page can click through.
  assert.ok(
    src.includes('/api/audit-anchor'),
    '/trust/ must link to /api/audit-anchor',
  );
  // The inline loader fetches the anchor and pastes the response into
  // the pre block. If the loader is dropped, the public anchor stops
  // being demoable from the trust page.
  assert.ok(
    src.includes('data-audit-anchor'),
    '/trust/ must carry the [data-audit-anchor] block + its loader script',
  );
});
