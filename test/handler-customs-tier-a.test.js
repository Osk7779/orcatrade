'use strict';

// Handler-layer Tier-A integration for /api/customs.
//
// Pins the contract that the handler emits a `tier_a` block on every
// successful 200 response, with the verdict shape ADR 0020 + the
// lib/intelligence/tier-a module define. Also confirms:
//   - the existing GET response shape is unchanged (snapshot + lists)
//   - 400 / 405 / 429 / OPTIONS paths still behave correctly
//   - failure of the Tier-A evaluation does not break the quote
//   - the async TARIC path is used by default (so live primary_regulator
//     snapshots can flow when TARIC is available)
//
// Test env sets ORCATRADE_DISABLE_LIVE_TARIC=1 so calculateQuoteAsync
// falls back deterministically to the sync chapter-rate path. The
// resulting quote will fail TA-2 (mirror source) and that's the
// expected production behaviour until TARIC live lookups land.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const customsHandler = require(path.join(ROOT, 'lib', 'handlers', 'customs'));
const tierA = require(path.join(ROOT, 'lib', 'intelligence', 'tier-a'));
const kv = require(path.join(ROOT, 'lib', 'intelligence', 'kv-store'));

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(o) { this.body = o; return this; },
    end() { return this; },
  };
}

function call(method, body, headers = {}) {
  const res = mockRes();
  return customsHandler({ method, headers, body }, res).then(() => res);
}

// Tight-scoped, validation-passing body. HS chapter 85 + DE destination
// + CN origin so the quote is computable end-to-end without TARIC.
const VALID_BODY = Object.freeze({
  customsValueEur: 50_000,
  hsCode: '8501',
  destinationCountry: 'DE',
  originCountry: 'CN',
  linesCount: 3,
  bondedDays: 60,
  bondedVolumeCbm: 4,
  releaseStrategy: 'free_circulation',
  claimPreferential: false,
});

// ── Pre-existing handler behaviour preserved ──────────────────────────

test('GET returns the snapshot + lists (response shape unchanged)', async () => {
  kv._resetMemoryStore();
  const res = await call('GET');
  assert.equal(res.statusCode, 200);
  assert.ok(res.body.snapshot && res.body.snapshot.asOf);
  assert.ok(Array.isArray(res.body.countries) && res.body.countries.length > 0);
  assert.ok(Array.isArray(res.body.origins) && res.body.origins.length > 0);
  assert.ok(Array.isArray(res.body.hsChapters) && res.body.hsChapters.length > 0);
  assert.equal(res.body.tier_a, undefined, 'GET responses do not carry a tier_a block — only quote responses do');
});

test('OPTIONS returns 200 (CORS preflight)', async () => {
  kv._resetMemoryStore();
  const res = await call('OPTIONS');
  assert.equal(res.statusCode, 200);
});

test('PUT returns 405', async () => {
  kv._resetMemoryStore();
  const res = await call('PUT', VALID_BODY);
  assert.equal(res.statusCode, 405);
});

test('POST with invalid body returns 400 with errors list (no tier_a on error response)', async () => {
  kv._resetMemoryStore();
  const res = await call('POST', { customsValueEur: -1, hsCode: 'invalid', destinationCountry: 'XX' });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'Validation failed');
  assert.ok(Array.isArray(res.body.errors) && res.body.errors.length > 0);
  assert.equal(res.body.tier_a, undefined, '4xx responses must not include tier_a');
});

// ── New: tier_a contract on 200 responses ─────────────────────────────

test('POST with valid body returns 200 with a tier_a verdict block', async () => {
  kv._resetMemoryStore();
  const res = await call('POST', VALID_BODY);
  assert.equal(res.statusCode, 200, `expected 200, got ${res.statusCode}: ${JSON.stringify(res.body)}`);
  assert.ok(res.body.tier_a, 'response must include a tier_a block');
  // Required verdict fields (ADR 0020 + tierA.evaluate contract):
  assert.equal(typeof res.body.tier_a.eligible, 'boolean');
  assert.equal(typeof res.body.tier_a.evaluatedAtIso, 'string');
  assert.equal(res.body.tier_a.schemaVersion, tierA.SCHEMA_VERSION);
});

test('tier_a.failedReason is a canonical REASONS value when eligible:false', async () => {
  kv._resetMemoryStore();
  const res = await call('POST', VALID_BODY);
  assert.equal(res.statusCode, 200);
  if (res.body.tier_a.eligible === false) {
    const allowed = new Set(Object.values(tierA.REASONS));
    assert.ok(
      allowed.has(res.body.tier_a.failedReason),
      `failedReason "${res.body.tier_a.failedReason}" must be one of REASONS: ${[...allowed].join(', ')}`,
    );
  }
});

test('quote without TARIC live data is reliably ineligible (deterministic path)', async () => {
  // Without ORCATRADE_DISABLE_LIVE_TARIC, calculateQuoteAsync may hit
  // the upstream and produce a primary_regulator snapshot. With the
  // disable flag (set in the npm test script), the async path falls
  // back to the sync chapter-rate calculator → only the mirror
  // snapshot is present → TA-2 fails. This is the expected production
  // behaviour until TARIC live lookups land in the deployed env.
  process.env.ORCATRADE_DISABLE_LIVE_TARIC = '1';
  kv._resetMemoryStore();
  const res = await call('POST', VALID_BODY);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.tier_a.eligible, false, 'mirror-only quote cannot satisfy TA-2');
  // The expected reason is either NON_PRIMARY_SOURCE (if PRICING_SNAPSHOT
  // is within 30d of "now") or STALE_SNAPSHOT (if not) or CALCULATOR_NOT_GREEN
  // (if the green stamp isn't set). All three are valid deterministic
  // outcomes — what we're pinning is that it's NEVER eligible:true on
  // this path.
  const reason = res.body.tier_a.failedReason;
  const acceptableReasons = new Set([
    tierA.REASONS.NON_PRIMARY_SOURCE,
    tierA.REASONS.STALE_SNAPSHOT,
    tierA.REASONS.CALCULATOR_NOT_GREEN,
  ]);
  assert.ok(
    acceptableReasons.has(reason),
    `expected one of ${[...acceptableReasons].join(' / ')}, got "${reason}"`,
  );
});

// ── Resilience: a thrown evaluator must not break the quote ───────────

test('a thrown tier-a evaluation does not break the quote (verdict simply absent)', async () => {
  // Inject a temporary failure by stubbing tierA.evaluate to throw.
  // The handler must still return 200 with the quote body; tier_a
  // is then absent rather than the response being a 500.
  kv._resetMemoryStore();
  const orig = tierA.evaluate;
  tierA.evaluate = async () => { throw new Error('synthetic tier-a failure'); };
  try {
    const res = await call('POST', VALID_BODY);
    assert.equal(res.statusCode, 200);
    assert.ok(res.body.quotes && Array.isArray(res.body.quotes), 'quote body must still be returned');
    assert.equal(res.body.tier_a, undefined, 'tier_a absent on evaluator failure (best-effort contract)');
  } finally {
    tierA.evaluate = orig;
  }
});

// ── Rate limit still fires ────────────────────────────────────────────

test('POST rate-limit triggers 429 after 30 calls/minute from one IP', async () => {
  kv._resetMemoryStore();
  const headers = { 'x-forwarded-for': '198.51.100.42' };
  // First 30 succeed (or 400-on-validation); 31st must 429.
  let last;
  for (let i = 0; i < 31; i++) {
    last = await (function () {
      const res = mockRes();
      return customsHandler({ method: 'POST', headers, body: VALID_BODY }, res).then(() => res);
    }());
  }
  assert.equal(last.statusCode, 429, `expected 429 on 31st request, got ${last.statusCode}`);
});
