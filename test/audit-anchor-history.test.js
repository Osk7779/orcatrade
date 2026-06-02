'use strict';

// Phase 1 — apex III2 anchor-history (follow-on to PR #35).
//
// Tests the snapshot store + the public /history sub-action of
// /api/audit-anchor. A single live anchor proves "today is fine";
// a rolling history of anchors proves "the chain head has been
// continuously consistent" — the procurement-facing continuity
// claim.
//
// Coverage:
//   * recordAnchorSnapshot persists a snapshot keyed off the live
//     readAnchor result
//   * Two records back-to-back: dedupe window suppresses the
//     duplicate (chain hasn't moved → no new information)
//   * After a real chain advance (events.record), the next
//     snapshot persists
//   * listAnchorSnapshots returns newest-first with a default limit;
//     respects an explicit limit; caps at MAX_SNAPSHOTS
//   * The KV array is hard-capped at MAX_SNAPSHOTS (oldest pruned
//     on write)
//   * KV outage on read → returns [] (degraded-to-empty, never throws)
//   * GET /api/audit-anchor/history responds with the documented shape

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.ORCATRADE_AUTH_SECRET = 'test-secret-do-not-use-in-prod';
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

const kv = require('../lib/intelligence/kv-store');
const events = require('../lib/events');
const history = require('../lib/audit-anchor-history');
const auditAnchor = require('../lib/handlers/audit-anchor');

function mockRes() {
  return {
    statusCode: 200, headers: {}, body: '',
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(b) { this.body = b || ''; return this; },
  };
}

// ── recordAnchorSnapshot ──────────────────────────────────────────────

test('recordAnchorSnapshot persists a snapshot from the live anchor', async () => {
  kv._resetMemoryStore();
  await events.record('auth_signin', { email: 'a@example.com' });

  const result = await history.recordAnchorSnapshot();
  assert.equal(result.written, true);
  assert.ok(result.snapshot);
  assert.match(result.snapshot.chainHead, /^[0-9a-f]{64}$/);
  assert.equal(result.snapshot.chainLength, 1);
  assert.equal(result.snapshot.genesis, events.CHAIN_GENESIS);
  assert.ok(result.snapshot.savedAt && !Number.isNaN(Date.parse(result.snapshot.savedAt)));
});

test('recordAnchorSnapshot dedupes back-to-back identical snapshots within the 1-hour window', async () => {
  kv._resetMemoryStore();
  await events.record('auth_signin', { email: 'a@example.com' });
  const a = await history.recordAnchorSnapshot();
  const b = await history.recordAnchorSnapshot();
  assert.equal(a.written, true);
  assert.equal(b.written, false);
  assert.match(b.reason || '', /duplicate within dedupe window/);
  // The KV array has exactly one entry.
  const list = await history.listAnchorSnapshots();
  assert.equal(list.length, 1);
});

test('recordAnchorSnapshot persists a NEW snapshot when the chain advances', async () => {
  kv._resetMemoryStore();
  await events.record('auth_signin', { email: 'a@example.com' });
  await history.recordAnchorSnapshot();

  // Advance the chain — a new event makes the anchor non-duplicate
  // regardless of the dedupe window.
  await events.record('auth_signin', { email: 'b@example.com' });
  const result = await history.recordAnchorSnapshot();
  assert.equal(result.written, true);

  const list = await history.listAnchorSnapshots();
  assert.equal(list.length, 2);
  // Newest first — the most recent has chainLength 2.
  assert.equal(list[0].chainLength, 2);
  assert.equal(list[1].chainLength, 1);
});

// ── listAnchorSnapshots ───────────────────────────────────────────────

test('listAnchorSnapshots respects the explicit limit', async () => {
  kv._resetMemoryStore();
  // Force three distinct snapshots by advancing the chain between writes.
  await events.record('auth_signin', { email: 'a@example.com' });
  await history.recordAnchorSnapshot();
  await events.record('auth_signin', { email: 'b@example.com' });
  await history.recordAnchorSnapshot();
  await events.record('auth_signin', { email: 'c@example.com' });
  await history.recordAnchorSnapshot();

  const all = await history.listAnchorSnapshots();
  assert.equal(all.length, 3);

  const top1 = await history.listAnchorSnapshots({ limit: 1 });
  assert.equal(top1.length, 1);
  assert.equal(top1[0].chainLength, 3);

  // Out-of-range limit (negative / NaN / huge) → safe fallback to
  // default (30) or hard cap (MAX_SNAPSHOTS).
  const negativeLimit = await history.listAnchorSnapshots({ limit: -5 });
  assert.equal(negativeLimit.length, 3, 'negative limit falls back to default 30, then capped by available rows');
  const hugeLimit = await history.listAnchorSnapshots({ limit: 10000 });
  assert.equal(hugeLimit.length, 3, 'huge limit is capped at MAX_SNAPSHOTS (90) — only 3 rows available');
});

test('listAnchorSnapshots returns [] when KV has no history yet', async () => {
  kv._resetMemoryStore();
  const list = await history.listAnchorSnapshots();
  assert.deepEqual(list, []);
});

test('the KV array is hard-capped at MAX_SNAPSHOTS on write (oldest pruned)', async () => {
  kv._resetMemoryStore();
  // Pre-load the KV history array with MAX_SNAPSHOTS + 2 entries
  // (simulating a long-running history that's about to overflow),
  // then call _writeHistory to verify the cap kicks in.
  const oversize = [];
  for (let i = 0; i < history.MAX_SNAPSHOTS + 2; i++) {
    oversize.push({
      savedAt: new Date(Date.now() - i * 60_000).toISOString(),
      asOf: new Date(Date.now() - i * 60_000).toISOString(),
      chainHead: 'h' + i.toString().padStart(63, '0'),
      chainLength: i,
      genesis: events.CHAIN_GENESIS,
    });
  }
  const writtenCount = await history._writeHistory(oversize);
  assert.equal(writtenCount, history.MAX_SNAPSHOTS);

  const list = await history.listAnchorSnapshots({ limit: 1000 });
  assert.equal(list.length, history.MAX_SNAPSHOTS, 'list never exceeds MAX_SNAPSHOTS');
});

// ── HTTP handler: /api/audit-anchor/history ──────────────────────────

test('GET /api/audit-anchor/history → 200 + documented shape', async () => {
  kv._resetMemoryStore();
  await events.record('auth_signin', { email: 'a@example.com' });
  await history.recordAnchorSnapshot();

  const req = {
    method: 'GET', headers: {}, url: '/api/audit-anchor/history',
    query: { path: ['audit-anchor', 'history'] },
  };
  const res = mockRes();
  await auditAnchor(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['content-type'], 'application/json');
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.equal(res.headers['access-control-allow-origin'], '*');
  const body = JSON.parse(res.body);
  assert.equal(body.ok, true);
  assert.equal(body.maxSnapshots, history.MAX_SNAPSHOTS);
  assert.equal(body.count, 1);
  assert.equal(body.snapshots.length, 1);
  assert.match(body.snapshots[0].chainHead, /^[0-9a-f]{64}$/);
});

test('GET /api/audit-anchor/history respects ?limit', async () => {
  kv._resetMemoryStore();
  await events.record('auth_signin', { email: 'a@example.com' });
  await history.recordAnchorSnapshot();
  await events.record('auth_signin', { email: 'b@example.com' });
  await history.recordAnchorSnapshot();

  const req = {
    method: 'GET', headers: {}, url: '/api/audit-anchor/history?limit=1',
    query: { path: ['audit-anchor', 'history'], limit: '1' },
  };
  const res = mockRes();
  await auditAnchor(req, res);
  const body = JSON.parse(res.body);
  assert.equal(body.count, 1);
  assert.equal(body.snapshots[0].chainLength, 2, 'newest first');
});

test('GET /api/audit-anchor (no sub-action) still returns the live anchor + a reference to history in howToVerify', async () => {
  // The history endpoint is a sibling; the live endpoint must
  // continue to work AND should mention the history surface so a
  // consumer can discover it without reading docs.
  kv._resetMemoryStore();
  const req = {
    method: 'GET', headers: {}, url: '/api/audit-anchor',
    query: { path: ['audit-anchor'] },
  };
  const res = mockRes();
  await auditAnchor(req, res);
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.ok(body.chainHead);
  assert.ok(body.verification);
  const howToVerify = body.verification.howToVerify.join(' ');
  assert.match(
    howToVerify,
    /audit-anchor\/history/,
    'the live endpoint must point consumers at the new /history sub-action',
  );
});

test('GET /api/audit-anchor/history returns count:0 + snapshots:[] when no history exists yet', async () => {
  kv._resetMemoryStore();
  const req = {
    method: 'GET', headers: {}, url: '/api/audit-anchor/history',
    query: { path: ['audit-anchor', 'history'] },
  };
  const res = mockRes();
  await auditAnchor(req, res);
  const body = JSON.parse(res.body);
  assert.equal(body.count, 0);
  assert.deepEqual(body.snapshots, []);
});
