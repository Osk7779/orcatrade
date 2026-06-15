'use strict';

// AI import-request orchestrator — deterministic-piece tests.
//
// The orchestrator is calculator-grounded by design (ADR 0002): no LLM
// in v1 produces the numbers. So the deterministic pieces — keyword
// classifier, factory shortlist assembly, landed-quote stacking — get
// real test coverage here. The end-to-end runOrchestrator() call needs
// Postgres + the calculators wired so it gets light integration testing
// in a separate file when DATABASE_URL is set.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const orch = require(path.join(ROOT, 'lib', 'ai', 'import-request-orchestrator'));

// ── Closed taxonomy ──────────────────────────────────────────────────

test('CATEGORIES matches the 8 closed taxonomy values the sourcing/customs calculators expect', () => {
  assert.deepEqual(
    [...orch.CATEGORIES].sort(),
    ['apparel', 'cosmetics', 'electronics', 'footwear', 'furniture', 'homeware', 'machinery', 'toys'],
  );
});

test('every CATEGORY_KEYWORDS bucket has at least one entry', () => {
  for (const cat of orch.CATEGORIES) {
    const kws = orch.CATEGORY_KEYWORDS[cat];
    assert.ok(Array.isArray(kws) && kws.length > 0, `${cat} must have keywords`);
  }
});

// ── Classifier behaviour ─────────────────────────────────────────────

test('classifier maps obvious descriptions to the right category', () => {
  const expectations = [
    { desc: '3000 silicone kitchen mats food-grade', expected: 'homeware' },
    { desc: '500 pairs of sneakers EU sizes 38-46', expected: 'footwear' },
    { desc: 'USB-C cable 100W charger 2m', expected: 'electronics' },
    { desc: 'cotton t-shirts XL black', expected: 'apparel' },
    { desc: 'wooden dining table 6-seater', expected: 'furniture' },
    { desc: 'plush teddy bear for kids', expected: 'toys' },
    { desc: 'organic face cream skincare serum', expected: 'cosmetics' },
    { desc: 'industrial CNC milling machine', expected: 'machinery' },
  ];
  for (const { desc, expected } of expectations) {
    const result = orch.classifyProductCategory(desc);
    assert.equal(result.category, expected, `"${desc}" should map to ${expected}, got ${result.category} (hits=${result.hits})`);
    assert.ok(result.hits > 0, `"${desc}" should have ≥1 keyword hit`);
  }
});

test('classifier falls back to homeware with zero hits when nothing matches', () => {
  const result = orch.classifyProductCategory('the quick brown fox jumps');
  assert.equal(result.category, 'homeware');
  assert.equal(result.hits, 0);
});

test('classifier handles missing / non-string input without throwing', () => {
  // @ts-ignore — explicit test of bad input
  const r1 = orch.classifyProductCategory(undefined);
  // @ts-ignore
  const r2 = orch.classifyProductCategory(null);
  // @ts-ignore
  const r3 = orch.classifyProductCategory(12345);
  for (const r of [r1, r2, r3]) {
    assert.equal(r.category, 'homeware');
    assert.equal(r.hits, 0);
  }
});

test('classifier is case-insensitive', () => {
  const lower = orch.classifyProductCategory('cotton t-shirts');
  const upper = orch.classifyProductCategory('COTTON T-SHIRTS');
  const mixed = orch.classifyProductCategory('Cotton T-Shirts');
  assert.equal(lower.category, upper.category);
  assert.equal(upper.category, mixed.category);
});

// ── Constants exposed for v2 (Haiku) integration tests ──────────────

test('FOB_TO_LANDED_RATIO is in (0,1) — a percentage', () => {
  assert.ok(orch.FOB_TO_LANDED_RATIO > 0 && orch.FOB_TO_LANDED_RATIO < 1);
});

test('DEFAULT_URGENCY_WEEKS is a sensible sea-freight default', () => {
  assert.ok(orch.DEFAULT_URGENCY_WEEKS >= 4 && orch.DEFAULT_URGENCY_WEEKS <= 16);
});

// ── buildFactoryShortlist shape ─────────────────────────────────────

test('buildFactoryShortlist with empty comparison returns empty shortlist', () => {
  const { shortlist, methodology } = orch.buildFactoryShortlist({
    recommendation: { comparison: [] },
    productCategory: 'homeware',
    classifierHits: 0,
  });
  assert.deepEqual(shortlist, []);
  assert.equal(methodology.version, 'v1.0');
  assert.equal(methodology.classifier, 'keyword-classifier-v1');
  assert.equal(methodology.classifierHits, 0);
});

test('buildFactoryShortlist with comparison takes top 3 and attaches candidate samples', () => {
  const { shortlist } = orch.buildFactoryShortlist({
    recommendation: {
      comparison: [
        { country: 'CN', rationale: 'baseline', fobIndex: 1, leadTimeWeeks: 8, qualityRisk: 'low', ipRisk: 'high' },
        { country: 'VN', rationale: 'cheaper, slower', fobIndex: 0.92, leadTimeWeeks: 10, qualityRisk: 'medium', ipRisk: 'medium' },
        { country: 'BD', rationale: 'lowest cost', fobIndex: 0.85, leadTimeWeeks: 12, qualityRisk: 'medium', ipRisk: 'low' },
        { country: 'IN', rationale: 'should not appear (rank 4)', fobIndex: 0.96, leadTimeWeeks: 9, qualityRisk: 'medium', ipRisk: 'medium' },
      ],
    },
    productCategory: 'homeware',
    classifierHits: 2,
  });
  assert.equal(shortlist.length, 3, 'top 3 only');
  assert.deepEqual(shortlist.map((b) => b.country), ['CN', 'VN', 'BD']);
  assert.equal(shortlist[0].rank, 1);
  assert.equal(shortlist[0].countryRationale, 'baseline');
  // Each candidate must be flagged as unverified — v1 honesty contract.
  for (const block of shortlist) {
    for (const c of block.candidates) {
      assert.equal(c.verificationStatus, 'unverified_ai_sample');
    }
  }
  // First block's candidates are flagged top_pick; rest are alternative.
  if (shortlist[0].candidates.length > 0) assert.equal(shortlist[0].candidates[0].recommendation, 'top_pick');
  for (let i = 1; i < shortlist.length; i++) {
    for (const c of shortlist[i].candidates) {
      assert.equal(c.recommendation, 'alternative');
    }
  }
});

// ── buildLandedQuote shape — calculator-grounding contract ──────────

test('buildLandedQuote returns integer-cents money (ADR 0004) and an OrcaTrade fee line', () => {
  const quote = orch.buildLandedQuote({
    hsCode: '39241000',
    originCountry: 'CN',
    destinationCountry: 'DE',
    customsValueEur: 25_000,
    targetQuantity: 3000,
    productCategory: 'homeware',
    urgencyWeeks: 8,
  });
  assert.ok(Array.isArray(quote.components));
  assert.equal(typeof quote.cargoValueCents, 'number');
  assert.ok(Number.isInteger(quote.cargoValueCents));
  assert.equal(quote.cargoValueCents, 2_500_000); // €25,000 → 2,500,000 cents
  assert.ok(Number.isInteger(quote.totalLandedCents));
  assert.equal(quote.currency, 'EUR');
  // Every component value is integer cents.
  for (const c of quote.components) {
    assert.ok(Number.isInteger(c.eurCents), `${c.component} must be integer cents`);
    assert.ok(c.eurCents >= 0);
    assert.equal(typeof c.source, 'string');
  }
  // OrcaTrade fee line is always present, regardless of which calculators succeeded.
  const fee = quote.components.find((c) => c.component === 'orcatrade_managed_import_fee');
  assert.ok(fee, 'orcatrade managed-import fee line must always be present');
  assert.equal(fee.source, 'orcatrade-take-rate-v1');
});

test('buildLandedQuote total = cargo + sum(components)', () => {
  const quote = orch.buildLandedQuote({
    hsCode: '39241000',
    originCountry: 'CN',
    destinationCountry: 'DE',
    customsValueEur: 10_000,
    targetQuantity: 1000,
    productCategory: 'homeware',
    urgencyWeeks: 8,
  });
  const sumComponents = quote.components.reduce((acc, c) => acc + c.eurCents, 0);
  assert.equal(quote.totalLandedCents, quote.cargoValueCents + sumComponents);
});

test('buildLandedQuote confidence tier is "B" when all calculators succeed, "C" when any fail', () => {
  // Happy path — all calculators wired and configured. Should be B.
  const happy = orch.buildLandedQuote({
    hsCode: '39241000',
    originCountry: 'CN',
    destinationCountry: 'DE',
    customsValueEur: 10_000,
    targetQuantity: 1000,
    productCategory: 'homeware',
    urgencyWeeks: 8,
  });
  // The test environment may or may not have full calculator paths green;
  // we assert the contract holds either way.
  if (happy.confidenceNotes.length === 0) {
    assert.equal(happy.confidenceTier, 'B');
  } else {
    assert.equal(happy.confidenceTier, 'C');
  }
});

test('buildLandedQuote OrcaTrade fee defaults to 8% of cargo value', () => {
  const prior = process.env.ORCATRADE_OPERATOR_FEE_PCT;
  delete process.env.ORCATRADE_OPERATOR_FEE_PCT;
  try {
    const quote = orch.buildLandedQuote({
      hsCode: '39241000',
      originCountry: 'CN',
      destinationCountry: 'DE',
      customsValueEur: 10_000,
      targetQuantity: 1000,
      productCategory: 'homeware',
      urgencyWeeks: 8,
    });
    assert.equal(quote.orcatradeFeePct, 8);
    // 8% of €10,000 = €800 = 80,000 cents.
    assert.equal(quote.orcatradeFeeCents, 80_000);
  } finally {
    if (prior !== undefined) process.env.ORCATRADE_OPERATOR_FEE_PCT = prior;
  }
});

test('buildLandedQuote honours ORCATRADE_OPERATOR_FEE_PCT env override', () => {
  const prior = process.env.ORCATRADE_OPERATOR_FEE_PCT;
  process.env.ORCATRADE_OPERATOR_FEE_PCT = '12';
  try {
    const quote = orch.buildLandedQuote({
      hsCode: '39241000',
      originCountry: 'CN',
      destinationCountry: 'DE',
      customsValueEur: 10_000,
      targetQuantity: 1000,
      productCategory: 'homeware',
      urgencyWeeks: 8,
    });
    assert.equal(quote.orcatradeFeePct, 12);
    assert.equal(quote.orcatradeFeeCents, 120_000);
  } finally {
    if (prior !== undefined) process.env.ORCATRADE_OPERATOR_FEE_PCT = prior;
    else delete process.env.ORCATRADE_OPERATOR_FEE_PCT;
  }
});

test('buildLandedQuote rejects nonsense fee env values and falls back to 8%', () => {
  const prior = process.env.ORCATRADE_OPERATOR_FEE_PCT;
  for (const bad of ['banana', '-5', '1000', '']) {
    process.env.ORCATRADE_OPERATOR_FEE_PCT = bad;
    const quote = orch.buildLandedQuote({
      hsCode: '39241000', originCountry: 'CN', destinationCountry: 'DE',
      customsValueEur: 10_000, targetQuantity: 1000, productCategory: 'homeware', urgencyWeeks: 8,
    });
    assert.equal(quote.orcatradeFeePct, 8, `bad env "${bad}" should fall back to 8%`);
  }
  if (prior !== undefined) process.env.ORCATRADE_OPERATOR_FEE_PCT = prior;
  else delete process.env.ORCATRADE_OPERATOR_FEE_PCT;
});

// ── Public entry point shape ────────────────────────────────────────

test('runOrchestrator rejects garbage inputs before touching Postgres', async () => {
  const r1 = await orch.runOrchestrator({});
  assert.equal(r1.ok, false);
  assert.equal(r1.code, 'bad_input');

  const r2 = await orch.runOrchestrator({ orgId: 'x', externalId: 'ir_x', actorEmailHash: 'h' });
  assert.equal(r2.ok, false);
  assert.equal(r2.code, 'bad_input');
});
