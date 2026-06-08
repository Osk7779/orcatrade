'use strict';

// Handler-layer Tier-A integration for /api/finance-quote.
//
// Pins the contract that every successful 200 response carries a
// tier_a verdict, regardless of which calculator action ran. Mirrors
// test/handler-customs-tier-a.test.js — same shape, different
// calculator. Each finance action (compare_payment, lc_cost, fx_hedge,
// trade_credit) returns a quote with amountEur in its inputs block,
// so coverage axis amountCents will be present. working_capital is
// the structural-model outlier — it doesn't carry amountEur, so its
// Tier-A verdict is reliably OUTSIDE_COVERAGE.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const handler = require(path.join(ROOT, 'lib', 'handlers', 'finance-quote'));
const tierA = require(path.join(ROOT, 'lib', 'intelligence', 'tier-a'));
const kv = require(path.join(ROOT, 'lib', 'intelligence', 'kv-store'));

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    status(c) { this.statusCode = c; return this; },
    json(o) { this.body = o; return this; },
    end() { return this; },
  };
}

function call(method, body, headers = {}) {
  const res = mockRes();
  return handler({ method, headers, body }, res).then(() => res);
}

// ── Existing handler behaviour preserved ──────────────────────────────

test('GET returns the snapshot + lists shape unchanged (no tier_a on info responses)', async () => {
  kv._resetMemoryStore();
  const res = await call('GET');
  assert.equal(res.statusCode, 200);
  assert.ok(res.body.snapshot && res.body.snapshot.asOf);
  assert.ok(Array.isArray(res.body.instruments) && res.body.instruments.length > 0);
  assert.ok(Array.isArray(res.body.fxPairs) && res.body.fxPairs.length > 0);
  assert.equal(res.body.tier_a, undefined);
});

test('OPTIONS preflight returns 200', async () => {
  kv._resetMemoryStore();
  const res = await call('OPTIONS');
  assert.equal(res.statusCode, 200);
});

test('PUT returns 405', async () => {
  kv._resetMemoryStore();
  const res = await call('PUT', {});
  assert.equal(res.statusCode, 405);
});

test('POST with unknown action returns 400', async () => {
  kv._resetMemoryStore();
  const res = await call('POST', { action: 'invented_action', amountEur: 1000 });
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /Unknown action/);
});

test('POST with invalid body returns 400 with errors list (no tier_a on error response)', async () => {
  kv._resetMemoryStore();
  // Missing required amountEur → validation fails inside the calculator.
  const res = await call('POST', { action: 'compare_payment' });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'Validation failed');
  assert.ok(Array.isArray(res.body.errors));
  assert.equal(res.body.tier_a, undefined, '4xx responses must not carry tier_a');
});

// ── tier_a contract on 200 responses ──────────────────────────────────

const COMPARE_PAYMENT_BODY = Object.freeze({
  action: 'compare_payment',
  amountEur: 50_000,
  supplierCountry: 'CN',
  supplierRelationshipMonths: 18,
  importerRiskAppetite: 'balanced',
});

const LC_BODY = Object.freeze({
  action: 'lc_cost',
  amountEur: 100_000,
  durationMonths: 6,
  confirmed: true,
  expectedDiscrepancies: 0,
});

const FX_HEDGE_BODY = Object.freeze({
  action: 'fx_hedge',
  amountEur: 250_000,
  currencyPair: 'EUR/CNY',
  durationDays: 90,
});

const TRADE_CREDIT_BODY = Object.freeze({
  action: 'trade_credit',
  buyerCountry: 'DE',
  buyerSizeBracket: 'mid',
  exposureEur: 75_000,
});

for (const [name, body] of [
  ['compare_payment', COMPARE_PAYMENT_BODY],
  ['lc_cost', LC_BODY],
  ['fx_hedge', FX_HEDGE_BODY],
]) {
  test(`POST ${name} returns 200 with a tier_a verdict block`, async () => {
    kv._resetMemoryStore();
    const res = await call('POST', body);
    assert.equal(res.statusCode, 200, `expected 200, got ${res.statusCode}: ${JSON.stringify(res.body)}`);
    assert.ok(res.body.tier_a, `${name} response must include tier_a`);
    assert.equal(typeof res.body.tier_a.eligible, 'boolean');
    assert.equal(typeof res.body.tier_a.evaluatedAtIso, 'string');
    assert.equal(res.body.tier_a.schemaVersion, tierA.SCHEMA_VERSION);
  });

  test(`${name} tier_a.failedReason is a canonical REASONS value when eligible:false`, async () => {
    kv._resetMemoryStore();
    const res = await call('POST', body);
    if (res.body.tier_a.eligible === false) {
      const allowed = new Set(Object.values(tierA.REASONS));
      assert.ok(
        allowed.has(res.body.tier_a.failedReason),
        `${name} failedReason "${res.body.tier_a.failedReason}" must be one of REASONS`,
      );
    }
  });
}

test('POST trade_credit (uses exposureEur, not amountEur) still returns 200 with a verdict', async () => {
  // exposureEur isn't projected into amountCents by buildTierAInput
  // (which keys off amountEur). The verdict should therefore be
  // OUTSIDE_COVERAGE with a missing-input-axis reason — that's the
  // honest outcome. The contract: even unusual inputs get a verdict.
  kv._resetMemoryStore();
  const res = await call('POST', TRADE_CREDIT_BODY);
  assert.equal(res.statusCode, 200);
  assert.ok(res.body.tier_a, 'trade_credit must still carry a verdict');
  assert.equal(typeof res.body.tier_a.eligible, 'boolean');
});

test('deterministic path is reliably ineligible — pins one of the expected REASONS', async () => {
  // Without a primary_regulator snapshot (ECB FX live wiring not yet
  // shipped), finance-quote can never satisfy TA-2. Acceptable
  // failure modes: NON_PRIMARY_SOURCE (mirror snapshot only),
  // STALE_SNAPSHOT (PRICING_SNAPSHOT > 30 days), CALCULATOR_NOT_GREEN
  // (CI stamp absent). NEVER eligible:true.
  kv._resetMemoryStore();
  const res = await call('POST', FX_HEDGE_BODY);
  assert.equal(res.body.tier_a.eligible, false);
  const acceptable = new Set([
    tierA.REASONS.NON_PRIMARY_SOURCE,
    tierA.REASONS.STALE_SNAPSHOT,
    tierA.REASONS.CALCULATOR_NOT_GREEN,
  ]);
  assert.ok(
    acceptable.has(res.body.tier_a.failedReason),
    `expected one of ${[...acceptable].join(' / ')}, got "${res.body.tier_a.failedReason}"`,
  );
});

// ── Resilience: a thrown evaluator must not break the quote ───────────

test('a thrown tier-a evaluation does not break the quote (verdict simply absent)', async () => {
  kv._resetMemoryStore();
  const orig = tierA.evaluate;
  tierA.evaluate = async () => { throw new Error('synthetic tier-a failure'); };
  try {
    const res = await call('POST', COMPARE_PAYMENT_BODY);
    assert.equal(res.statusCode, 200, 'thrown evaluator must NOT 500 the quote');
    assert.ok(Array.isArray(res.body.instruments) || res.body.ok === true, 'quote body must still be returned');
    assert.equal(res.body.tier_a, undefined, 'tier_a absent on evaluator failure (best-effort contract)');
  } finally {
    tierA.evaluate = orig;
  }
});

// ── Rate limit still fires ────────────────────────────────────────────

test('POST rate-limit triggers 429 after 30 calls/minute from one IP', async () => {
  kv._resetMemoryStore();
  const headers = { 'x-forwarded-for': '198.51.100.99' };
  let last;
  for (let i = 0; i < 31; i++) {
    last = await call('POST', COMPARE_PAYMENT_BODY, headers);
  }
  assert.equal(last.statusCode, 429, `expected 429 on 31st request, got ${last.statusCode}`);
});
