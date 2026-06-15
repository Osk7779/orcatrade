'use strict';

// Tier-A primary-regulator path tests for finance-quote (PR #141).
// Mirrors test/sourcing-tier-a-primary.test.js (PR #139) — third
// per-calculator gate.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const finance = require(path.join(ROOT, 'lib', 'intelligence', 'finance-quote'));
const tierA = require(path.join(ROOT, 'lib', 'intelligence', 'tier-a'));
const greenState = require(path.join(ROOT, 'lib', 'intelligence', 'tier-a', 'green-state'));
const kv = require(path.join(ROOT, 'lib', 'intelligence', 'kv-store'));

function sampleSyncQuote() {
  return finance.comparePaymentInstruments({
    amountEur: 50000,
    supplierCountry: 'CN',
    supplierRelationshipMonths: 12,
  });
}

// ── comparePaymentInstrumentsAsync surface ────────────────────────────

test('comparePaymentInstrumentsAsync is exported and async', () => {
  assert.equal(typeof finance.comparePaymentInstrumentsAsync, 'function');
});

test('Async falls back to sync when no fxCurrency or fxDate supplied', async () => {
  const out = await finance.comparePaymentInstrumentsAsync({
    amountEur: 50000,
    supplierCountry: 'CN',
    supplierRelationshipMonths: 12,
  });
  assert.equal(out.ok, true);
  assert.equal(out.liveFxMeta, undefined);
});

test('Async falls back when opts.useEcb is false', async () => {
  kv._resetMemoryStore();
  const out = await finance.comparePaymentInstrumentsAsync(
    { amountEur: 50000, supplierCountry: 'CN', supplierRelationshipMonths: 12 },
    { fxCurrency: 'CNY', fxDate: '2026-06-15', useEcb: false },
  );
  assert.equal(out.ok, true);
  assert.equal(out.liveFxMeta, undefined);
});

test('Async falls back when ECB returns no data', async () => {
  kv._resetMemoryStore();
  const out = await finance.comparePaymentInstrumentsAsync(
    { amountEur: 50000, supplierCountry: 'CN', supplierRelationshipMonths: 12 },
    { fxCurrency: 'CNY', fxDate: '2026-06-15' },
  );
  assert.equal(out.ok, true);
  assert.equal(out.liveFxMeta, undefined);
});

test('Async attaches liveFxMeta when ECB returned data', async () => {
  kv._resetMemoryStore();
  await kv.set('ecb-fx:CNY:2026-06-15', {
    currency: 'CNY',
    asOfDate: '2026-06-15',
    asOf: '2026-06-15T00:00:00.000Z',
    source: 'ecb-fx',
    unitsPerEur: 7.60,
    eurPerUnit: 1 / 7.60,
  });
  const out = await finance.comparePaymentInstrumentsAsync(
    { amountEur: 50000, supplierCountry: 'CN', supplierRelationshipMonths: 12 },
    { fxCurrency: 'CNY', fxDate: '2026-06-15' },
  );
  assert.equal(out.ok, true);
  assert.ok(out.liveFxMeta);
  assert.equal(out.liveFxMeta.source, 'ecb-fx');
  assert.equal(out.liveFxMeta.currency, 'CNY');
  assert.equal(out.liveFxMeta.asOfDate, '2026-06-15');
  assert.equal(out.liveFxMeta.unitsPerEur, 7.60);
  assert.match(out.liveFxMeta.verifyUrl, /data\.ecb\.europa\.eu/);
});

// ── buildTierAInput primary-source path ──────────────────────────────

test('buildTierAInput on a sync quote emits the mirror snapshot honestly', () => {
  const quote = sampleSyncQuote();
  const ta = finance.buildTierAInput(quote);
  assert.equal(ta.snapshots.length, 1);
  assert.equal(ta.snapshots[0].source_kind, 'mirror');
});

test('buildTierAInput on a quote with liveFxMeta OMITS the rate-card mirror (PR #132 pattern)', () => {
  const quote = sampleSyncQuote();
  quote.liveFxMeta = {
    currency: 'CNY',
    asOfDate: '2026-06-15',
    asOf: '2026-06-15T00:00:00.000Z',
    source: 'ecb-fx',
    fromCache: false,
    stale: false,
    unitsPerEur: 7.60,
  };
  const ta = finance.buildTierAInput(quote);
  assert.equal(ta.snapshots.length, 1);
  assert.equal(ta.snapshots[0].source_kind, 'primary_regulator');
  assert.equal(ta.snapshots[0].id, 'ecb-fx:CNY@2026-06-15');
});

test('buildTierAInput preserves amountCents in coverageInput (no regression)', () => {
  const quote = sampleSyncQuote();
  const ta = finance.buildTierAInput(quote);
  assert.equal(ta.coverageInput.amountCents, 50000 * 100);
});

// ── End-to-end ──────────────────────────────────────────────────────

test('end-to-end sync: TA-2 fails with NON_PRIMARY_SOURCE', async () => {
  kv._resetMemoryStore();
  const nowMs = Date.parse('2026-04-25T12:00:00.000Z'); // within 30 days of PRICING_SNAPSHOT.asOf
  await greenState.stampLastGreenAt('finance-quote', { nowMs });
  const quote = sampleSyncQuote();
  const ta = finance.buildTierAInput(quote);
  const verdict = await tierA.evaluate(ta, { nowMs });
  assert.equal(verdict.eligible, false);
  assert.equal(verdict.failedReason, tierA.REASONS.NON_PRIMARY_SOURCE);
});

test('end-to-end primary: quote with liveFxMeta → eligible:true', async () => {
  kv._resetMemoryStore();
  const nowMs = Date.parse('2026-06-20T12:00:00.000Z');
  await greenState.stampLastGreenAt('finance-quote', { nowMs });
  const quote = sampleSyncQuote();
  quote.liveFxMeta = {
    currency: 'CNY',
    asOfDate: '2026-06-15',
    asOf: '2026-06-15T00:00:00.000Z',
    source: 'ecb-fx',
    fromCache: true,
    stale: false,
    unitsPerEur: 7.60,
  };
  const ta = finance.buildTierAInput(quote);
  const verdict = await tierA.evaluate(ta, { nowMs });
  assert.equal(verdict.eligible, true,
    `expected eligible:true; got: ${JSON.stringify(verdict)}`);
});
