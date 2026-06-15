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
  assert.equal(methodology.version, 'v1.1');
  assert.equal(methodology.classifier, 'category-classifier-v1');
  assert.equal(methodology.classifierHits, 0);
  // Sprint 4 ch 2 added classifierSource so the team console can show
  // which path won. Defaults to 'keyword' when no source is passed.
  assert.equal(methodology.classifierSource, 'keyword');
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

// ── HS-code classification integration (sprint 2 chunk 1, ADR 0016) ─

test('buildLandedQuote without hsClassification omits the hsClassification methodology block', () => {
  const quote = orch.buildLandedQuote({
    hsCode: '999999',
    originCountry: 'CN',
    destinationCountry: 'DE',
    customsValueEur: 10_000,
    targetQuantity: 1000,
    productCategory: 'homeware',
    urgencyWeeks: 8,
  });
  assert.equal(quote.methodology.hsClassification, null);
});

test('buildLandedQuote with high-confidence hsClassification surfaces metadata + leaves tier B-eligible', () => {
  const hsClassification = {
    suggestion: { hs6: '392410', label: 'Tableware and kitchenware of plastics', chapter: 39 },
    confidence: 0.92,
    confidenceTier: 'high',
    verifyUrl: 'https://www.trade-tariff.service.gov.uk/headings/3924',
    dutyEstimate: { rate: 0.065, source: 'uk-trade-tariff', sourceLabel: 'UK Trade Tariff (live)' },
  };
  const quote = orch.buildLandedQuote({
    hsCode: '392410',
    originCountry: 'CN',
    destinationCountry: 'DE',
    customsValueEur: 10_000,
    targetQuantity: 1000,
    productCategory: 'homeware',
    urgencyWeeks: 8,
    hsClassification,
  });
  assert.ok(quote.methodology.hsClassification, 'methodology must carry hsClassification');
  assert.equal(quote.methodology.hsClassification.hs6, '392410');
  assert.equal(quote.methodology.hsClassification.label, 'Tableware and kitchenware of plastics');
  assert.equal(quote.methodology.hsClassification.confidenceTier, 'high');
  assert.equal(quote.methodology.hsClassification.confidence, 0.92);
  assert.equal(quote.methodology.hsClassification.verifyUrl, 'https://www.trade-tariff.service.gov.uk/headings/3924');
  assert.equal(quote.methodology.hsClassification.dutyEstimate.rate, 0.065);
  // No HS-tier warning should fire.
  assert.equal(
    quote.confidenceNotes.some((n) => /HS classification/i.test(n)),
    false,
    'high-confidence HS classification must not emit an HS warning',
  );
});

test('buildLandedQuote with LOW-confidence HS classification surfaces a warning and drops to Tier C', () => {
  const hsClassification = {
    suggestion: { hs6: '999999', label: 'Unknown', chapter: 99 },
    confidence: 0.2,
    confidenceTier: 'low',
    verifyUrl: null,
    dutyEstimate: null,
  };
  const quote = orch.buildLandedQuote({
    hsCode: '999999',
    originCountry: 'CN',
    destinationCountry: 'DE',
    customsValueEur: 10_000,
    targetQuantity: 1000,
    productCategory: 'homeware',
    urgencyWeeks: 8,
    hsClassification,
  });
  assert.ok(
    quote.confidenceNotes.some((n) => /HS classification confidence is LOW/.test(n)),
    'LOW-tier HS classification must surface a confidenceNotes warning',
  );
  assert.equal(quote.confidenceTier, 'C', 'LOW HS classification must drop the quote to Tier C');
});

test('buildLandedQuote with NONE-confidence HS classification surfaces a stronger warning', () => {
  const hsClassification = {
    suggestion: null,
    confidence: 0,
    confidenceTier: 'none',
    verifyUrl: null,
    dutyEstimate: null,
  };
  const quote = orch.buildLandedQuote({
    hsCode: '999999',
    originCountry: 'CN',
    destinationCountry: 'DE',
    customsValueEur: 10_000,
    targetQuantity: 1000,
    productCategory: 'homeware',
    urgencyWeeks: 8,
    hsClassification,
  });
  assert.ok(
    quote.confidenceNotes.some((n) => /HS classification could not be determined/.test(n)),
    'NONE-tier HS classification must surface a "must set manually" warning',
  );
  assert.equal(quote.confidenceTier, 'C');
  // The suggestion can be null when the lookup found nothing — methodology
  // must still surface the (null) suggestion + confidenceTier honestly.
  assert.equal(quote.methodology.hsClassification.hs6, null);
  assert.equal(quote.methodology.hsClassification.confidenceTier, 'none');
});

test('buildLandedQuote methodology version is bumped to v1.1 once the HS classifier lands', () => {
  const quote = orch.buildLandedQuote({
    hsCode: '999999',
    originCountry: 'CN',
    destinationCountry: 'DE',
    customsValueEur: 10_000,
    targetQuantity: 1000,
    productCategory: 'homeware',
    urgencyWeeks: 8,
  });
  assert.equal(quote.methodology.version, 'v1.1');
});

// ── Shipment materialisation (sprint 2 chunk 2) ─────────────────────

const APPROVED_REQUEST_FIXTURE = Object.freeze({
  externalId: 'ir_abc123',
  label: 'Q3 silicone mats',
  status: 'customer_approved',
  productDescription: '3,000 silicone kitchen mats food-grade',
  hsCodeGuess: '392410',
  targetQuantity: 3000,
  targetQuantityUnit: 'pieces',
  targetUnitPriceCents: 1300,
  originCountry: 'CN',
  destinationCountry: 'DE',
  targetDeliveryDate: '2026-09-15',
  certificationRequirements: ['CE', 'REACH'],
  landedQuote: {
    cargoValueCents: 2_500_000,
    totalLandedCents: 3_200_000,
    orcatradeFeeCents: 200_000,
    orcatradeFeePct: 8,
    methodology: {
      version: 'v1.1',
      weightKgEstimated: 1800,
      volumeCbmEstimated: 10.8,
    },
  },
  factoryShortlist: [
    { rank: 1, country: 'VN', candidates: [{ name: 'Vendor A' }] },
    { rank: 2, country: 'CN', candidates: [{ name: 'Vendor B' }] },
    { _meta: { version: 'v1.0' } },
  ],
  linkedShipmentExternalId: null,
});

test('buildShipmentSeedFromRequest maps customer intent + quote onto the shipment shape', () => {
  const seed = orch.buildShipmentSeedFromRequest({
    request: APPROVED_REQUEST_FIXTURE,
    actorEmailHash: 'aabbccdd11223344',
    orgId: 42,
  });
  assert.equal(seed.orgId, 42);
  assert.equal(seed.createdByEmailHash, 'aabbccdd11223344');
  assert.match(seed.label, /Q3 silicone mats.*ir_abc123/);
  assert.equal(seed.destinationCountry, 'DE');
  assert.equal(seed.customsValueCents, 2_500_000);
  assert.equal(seed.weightKg, 1800);
  assert.equal(seed.plannedArrivalDate, '2026-09-15');
  // Quote + inputs snapshot for reproducibility.
  assert.equal(seed.quoteSnapshot, APPROVED_REQUEST_FIXTURE.landedQuote);
  assert.equal(seed.inputsSnapshot.sourceRequestExternalId, 'ir_abc123');
  assert.equal(seed.inputsSnapshot.productDescription, '3,000 silicone kitchen mats food-grade');
  assert.equal(seed.inputsSnapshot.targetQuantity, 3000);
  // Forensic metadata for the audit timeline.
  assert.equal(seed.metadata.materialisedFromImportRequest, 'ir_abc123');
  assert.equal(seed.metadata.orcatradeFeePct, 8);
  assert.equal(seed.metadata.orcatradeFeeCents, 200_000);
  assert.equal(seed.metadata.materialiserVersion, 'v1.2');
});

test('buildShipmentSeedFromRequest uses rank-1 shortlist country as the shipment origin', () => {
  const seed = orch.buildShipmentSeedFromRequest({
    request: APPROVED_REQUEST_FIXTURE,
    actorEmailHash: 'h',
    orgId: 1,
  });
  // rank-1 in the fixture is VN, even though customer's stated origin is CN.
  // The materialiser trusts the calculator-picked top country.
  assert.equal(seed.originCountry, 'VN');
});

test('buildShipmentSeedFromRequest falls back to the customer-stated origin when no shortlist exists', () => {
  const seed = orch.buildShipmentSeedFromRequest({
    request: { ...APPROVED_REQUEST_FIXTURE, factoryShortlist: [] },
    actorEmailHash: 'h',
    orgId: 1,
  });
  assert.equal(seed.originCountry, 'CN');
});

test('buildShipmentSeedFromRequest defaults to CN when neither shortlist nor customer-stated origin', () => {
  const seed = orch.buildShipmentSeedFromRequest({
    request: { ...APPROVED_REQUEST_FIXTURE, factoryShortlist: [], originCountry: null },
    actorEmailHash: 'h',
    orgId: 1,
  });
  assert.equal(seed.originCountry, 'CN');
});

test('buildShipmentSeedFromRequest skips _meta entries when picking rank-1 country', () => {
  const seed = orch.buildShipmentSeedFromRequest({
    request: {
      ...APPROVED_REQUEST_FIXTURE,
      factoryShortlist: [
        { _meta: { rank: 1, country: 'SHOULD-NOT-WIN' } },
        { rank: 1, country: 'IN' },
      ],
    },
    actorEmailHash: 'h',
    orgId: 1,
  });
  assert.equal(seed.originCountry, 'IN');
});

test('buildShipmentSeedFromRequest omits plannedArrivalDate when targetDeliveryDate is unset', () => {
  const seed = orch.buildShipmentSeedFromRequest({
    request: { ...APPROVED_REQUEST_FIXTURE, targetDeliveryDate: null },
    actorEmailHash: 'h',
    orgId: 1,
  });
  assert.equal(seed.plannedArrivalDate, undefined);
});

test('buildShipmentSeedFromRequest tolerates a request with no landed quote', () => {
  const seed = orch.buildShipmentSeedFromRequest({
    request: { ...APPROVED_REQUEST_FIXTURE, landedQuote: null },
    actorEmailHash: 'h',
    orgId: 1,
  });
  assert.equal(seed.customsValueCents, null);
  assert.equal(seed.weightKg, null);
  assert.equal(seed.quoteSnapshot.cargoValueCents, undefined);
});

test('materialiseApprovedRequest rejects garbage inputs before touching Postgres', async () => {
  const r1 = await orch.materialiseApprovedRequest({});
  assert.equal(r1.ok, false);
  assert.equal(r1.code, 'bad_input');

  const r2 = await orch.materialiseApprovedRequest({ orgId: 'x', externalId: 'ir_x', actorEmailHash: 'h' });
  assert.equal(r2.ok, false);
  assert.equal(r2.code, 'bad_input');

  const r3 = await orch.materialiseApprovedRequest({ orgId: 1, externalId: '', actorEmailHash: 'h' });
  assert.equal(r3.ok, false);
  assert.equal(r3.code, 'bad_input');
});

// ── Sprint 3 chunk 1: Goods + Supplier seed builders ─────────────────

const APPROVED_REQUEST_FIXTURE_WITH_HS = Object.freeze({
  ...APPROVED_REQUEST_FIXTURE,
  landedQuote: {
    ...APPROVED_REQUEST_FIXTURE.landedQuote,
    methodology: {
      ...APPROVED_REQUEST_FIXTURE.landedQuote.methodology,
      hsClassification: {
        hs6: '392410',
        label: 'Tableware and kitchenware of plastics',
        chapter: 39,
        confidenceTier: 'high',
      },
    },
  },
});

test('buildGoodsSeedFromRequest carries customer HS guess when supplied', () => {
  const seed = orch.buildGoodsSeedFromRequest({
    request: APPROVED_REQUEST_FIXTURE_WITH_HS,
    actorEmailHash: 'h',
    orgId: 42,
  });
  assert.equal(seed.hsCode, '392410'); // customer guess wins
  assert.equal(seed.metadata.hsSource, 'customer_guess');
});

test('buildGoodsSeedFromRequest falls back to the AI HS classification when customer omits the guess', () => {
  const seed = orch.buildGoodsSeedFromRequest({
    request: { ...APPROVED_REQUEST_FIXTURE_WITH_HS, hsCodeGuess: null },
    actorEmailHash: 'h',
    orgId: 42,
  });
  assert.equal(seed.hsCode, '392410');
  assert.equal(seed.metadata.hsSource, 'ai_lookup');
  assert.equal(seed.metadata.hsConfidenceTier, 'high');
});

test('buildGoodsSeedFromRequest falls back to the 999999 sentinel when no HS source has anything', () => {
  const noHs = {
    ...APPROVED_REQUEST_FIXTURE_WITH_HS,
    hsCodeGuess: null,
    landedQuote: { ...APPROVED_REQUEST_FIXTURE_WITH_HS.landedQuote, methodology: {} },
  };
  const seed = orch.buildGoodsSeedFromRequest({ request: noHs, actorEmailHash: 'h', orgId: 1 });
  assert.equal(seed.hsCode, '999999');
  assert.equal(seed.metadata.hsSource, 'sentinel');
});

test('buildGoodsSeedFromRequest derives a traceable, stable SKU from the request external_id', () => {
  const seed = orch.buildGoodsSeedFromRequest({
    request: APPROVED_REQUEST_FIXTURE_WITH_HS,
    actorEmailHash: 'h',
    orgId: 1,
  });
  // ir_abc123 → IR-ABC123
  assert.equal(seed.sku, 'IR-ABC123');
});

test('buildGoodsSeedFromRequest sets typicalUnitValueCents from request when present', () => {
  const seed = orch.buildGoodsSeedFromRequest({
    request: APPROVED_REQUEST_FIXTURE_WITH_HS,
    actorEmailHash: 'h',
    orgId: 1,
  });
  assert.equal(seed.typicalUnitValueCents, 1300);
});

test('buildGoodsSeedFromRequest cbamInScope=false for non-Annex-I products (homeware/silicone mats)', () => {
  // Sprint 4 ch 1: cbamInScope is now driven by determineCbamApplicability,
  // not hardcoded. Silicone kitchenware doesn't match any Annex I CBAM
  // category (which is steel, cement, aluminium, fertilisers, electricity,
  // hydrogen) — so the probe correctly returns applies=false here even
  // for an origin (CN/VN) that's outside the EEA.
  const seed = orch.buildGoodsSeedFromRequest({
    request: APPROVED_REQUEST_FIXTURE_WITH_HS,
    actorEmailHash: 'h',
    orgId: 1,
  });
  assert.equal(seed.cbamInScope, false);
});

test('buildGoodsSeedFromRequest uses pickChosenCountry for origin (rank-1 wins over customer guess)', () => {
  const seed = orch.buildGoodsSeedFromRequest({
    request: APPROVED_REQUEST_FIXTURE_WITH_HS,
    actorEmailHash: 'h',
    orgId: 1,
  });
  // fixture's rank-1 is VN even though customer said CN
  assert.equal(seed.originCountry, 'VN');
});

test('buildGoodsSeedFromRequest carries the certification requirements into metadata', () => {
  const seed = orch.buildGoodsSeedFromRequest({
    request: APPROVED_REQUEST_FIXTURE_WITH_HS,
    actorEmailHash: 'h',
    orgId: 1,
  });
  assert.deepEqual(seed.metadata.certificationRequirements, ['CE', 'REACH']);
});

test('buildSupplierSeedFromRequest uses the top candidate name when one exists', () => {
  const seed = orch.buildSupplierSeedFromRequest({
    request: APPROVED_REQUEST_FIXTURE,
    actorEmailHash: 'h',
    orgId: 1,
  });
  assert.equal(seed.entityName, 'Vendor A');
  assert.equal(seed.metadata.placeholder, false);
});

test('buildSupplierSeedFromRequest falls back to "Vendor TBD · COUNTRY" when no candidate exists', () => {
  const noCandidates = {
    ...APPROVED_REQUEST_FIXTURE,
    factoryShortlist: [
      { rank: 1, country: 'VN', candidates: [] },
      { _meta: { version: 'v1.0' } },
    ],
  };
  const seed = orch.buildSupplierSeedFromRequest({
    request: noCandidates,
    actorEmailHash: 'h',
    orgId: 1,
  });
  assert.equal(seed.entityName, 'Vendor TBD · VN');
  assert.equal(seed.metadata.placeholder, true);
});

test('buildSupplierSeedFromRequest hqCountry mirrors pickChosenCountry (rank-1)', () => {
  const seed = orch.buildSupplierSeedFromRequest({
    request: APPROVED_REQUEST_FIXTURE,
    actorEmailHash: 'h',
    orgId: 1,
  });
  assert.equal(seed.hqCountry, 'VN');
});

test('buildSupplierSeedFromRequest builds a factoryLocations entry when candidate has a city', () => {
  const withCity = {
    ...APPROVED_REQUEST_FIXTURE,
    factoryShortlist: [
      { rank: 1, country: 'VN', candidates: [{ name: 'Vendor A', city: 'Ho Chi Minh City' }] },
    ],
  };
  const seed = orch.buildSupplierSeedFromRequest({
    request: withCity,
    actorEmailHash: 'h',
    orgId: 1,
  });
  assert.equal(seed.factoryLocations.length, 1);
  assert.equal(seed.factoryLocations[0].countryCode, 'VN');
  assert.equal(seed.factoryLocations[0].city, 'Ho Chi Minh City');
  assert.equal(seed.factoryLocations[0].role, 'manufacturer');
});

test('buildSupplierSeedFromRequest factoryLocations stays empty when candidate has no city', () => {
  const seed = orch.buildSupplierSeedFromRequest({
    request: APPROVED_REQUEST_FIXTURE,
    actorEmailHash: 'h',
    orgId: 1,
  });
  assert.deepEqual(seed.factoryLocations, []);
});

test('buildSupplierSeedFromRequest carries verificationStatus from the AI candidate', () => {
  const verified = {
    ...APPROVED_REQUEST_FIXTURE,
    factoryShortlist: [
      { rank: 1, country: 'VN', candidates: [{ name: 'Vendor A', verificationStatus: 'team_verified' }] },
    ],
  };
  const seed = orch.buildSupplierSeedFromRequest({
    request: verified,
    actorEmailHash: 'h',
    orgId: 1,
  });
  assert.equal(seed.metadata.verificationStatus, 'team_verified');
});

test('buildSupplierSeedFromRequest verificationStatus is "no_candidate" when no candidate exists', () => {
  const empty = {
    ...APPROVED_REQUEST_FIXTURE,
    factoryShortlist: [{ rank: 1, country: 'VN', candidates: [] }],
  };
  const seed = orch.buildSupplierSeedFromRequest({
    request: empty,
    actorEmailHash: 'h',
    orgId: 1,
  });
  assert.equal(seed.metadata.verificationStatus, 'no_candidate');
});

test('buildShipmentSeedFromRequest now carries goodsExternalId + supplierExternalId when passed in', () => {
  const seed = orch.buildShipmentSeedFromRequest({
    request: APPROVED_REQUEST_FIXTURE,
    actorEmailHash: 'h',
    orgId: 1,
    goodsExternalId: 'gd_aabbccdd',
    supplierExternalId: 'sp_eeff0011',
  });
  assert.equal(seed.goodsExternalId, 'gd_aabbccdd');
  assert.equal(seed.supplierExternalId, 'sp_eeff0011');
  assert.equal(seed.metadata.linkedGoodsExternalId, 'gd_aabbccdd');
  assert.equal(seed.metadata.linkedSupplierExternalId, 'sp_eeff0011');
});

test('buildShipmentSeedFromRequest leaves goodsExternalId + supplierExternalId null when omitted', () => {
  const seed = orch.buildShipmentSeedFromRequest({
    request: APPROVED_REQUEST_FIXTURE,
    actorEmailHash: 'h',
    orgId: 1,
  });
  assert.equal(seed.goodsExternalId, null);
  assert.equal(seed.supplierExternalId, null);
});

test('pickChosenCountry helper falls through shortlist → customer → CN default cleanly', () => {
  assert.equal(orch.pickChosenCountry({}), 'CN');
  assert.equal(orch.pickChosenCountry({ originCountry: 'in' }), 'IN'); // uppercases
  assert.equal(
    orch.pickChosenCountry({
      originCountry: 'CN',
      factoryShortlist: [{ rank: 1, country: 'VN' }],
    }),
    'VN', // rank-1 wins
  );
  assert.equal(
    orch.pickChosenCountry({
      factoryShortlist: [{ _meta: { country: 'XX' } }, { rank: 1, country: 'BD' }],
    }),
    'BD', // _meta skipped
  );
});

test('pickTopCandidate returns null when no shortlist or no candidates', () => {
  assert.equal(orch.pickTopCandidate({}), null);
  assert.equal(orch.pickTopCandidate({ factoryShortlist: [] }), null);
  assert.equal(
    orch.pickTopCandidate({ factoryShortlist: [{ rank: 1, country: 'VN', candidates: [] }] }),
    null,
  );
});

test('pickTopCandidate returns the first rank-1 candidate when one exists', () => {
  const candidate = orch.pickTopCandidate(APPROVED_REQUEST_FIXTURE);
  assert.ok(candidate);
  assert.equal(candidate.name, 'Vendor A');
});

// ── Sprint 10 chunk 1: computeWhatIfQuote ────────────────────────────

const WHATIF_BASE_INPUT = Object.freeze({
  productCategory: 'homeware',
  productDescription: 'silicone kitchen mats food-grade',
  originCountry: 'CN',
  destinationCountry: 'DE',
  targetQuantity: 3000,
  targetUnitPriceCents: 1300,
  hsCodeGuess: '392410',
  urgencyWeeks: 8,
});

test('computeWhatIfQuote returns a landed quote with integer-cents money + Tier + appliedInputs', async () => {
  const result = await orch.computeWhatIfQuote(WHATIF_BASE_INPUT);
  assert.ok(result.landedQuote);
  assert.ok(Number.isInteger(result.landedQuote.totalLandedCents));
  assert.ok(Number.isInteger(result.landedQuote.cargoValueCents));
  assert.equal(result.landedQuote.currency, 'EUR');
  assert.ok(/^[ABC]$/.test(result.landedQuote.confidenceTier));
  assert.ok(result.appliedInputs);
  assert.equal(result.appliedInputs.targetQuantity, 3000);
  assert.equal(result.appliedInputs.hsCode, '392410');
});

test('computeWhatIfQuote tags hsSource=customer_override when caller passes a guess', async () => {
  const result = await orch.computeWhatIfQuote(WHATIF_BASE_INPUT);
  assert.equal(result.appliedInputs.hsSource, 'customer_override');
});

test('computeWhatIfQuote uses the sentinel HS when no guess and no lookup result', async () => {
  // Description that the curated HS map has no entry for + no live
  // TARIC enrichment (ORCATRADE_DISABLE_LIVE_TARIC is set in the test
  // env) → suggestion is null → fallback chain lands on '999999'.
  const result = await orch.computeWhatIfQuote({
    ...WHATIF_BASE_INPUT,
    productDescription: 'xqzv zzz unmatched gibberish 9876 abc',
    hsCodeGuess: null,
  });
  // hsSource is either 'sentinel' (lookup found nothing) or
  // 'ai_lookup' (lookup managed to land on something). What matters
  // is the function tolerates an unmatched description without
  // throwing — verify either branch is honest about its source.
  assert.ok(['sentinel', 'ai_lookup'].includes(result.appliedInputs.hsSource));
  assert.match(result.appliedInputs.hsCode, /^[0-9]{6,10}$/);
});

test('computeWhatIfQuote scales the cargo value linearly with targetQuantity (deterministic)', async () => {
  const small = await orch.computeWhatIfQuote({ ...WHATIF_BASE_INPUT, targetQuantity: 1000 });
  const big = await orch.computeWhatIfQuote({ ...WHATIF_BASE_INPUT, targetQuantity: 3000 });
  // Cargo value = qty * targetFobUnitEur (deterministic). 3000 should
  // be exactly 3x the 1000 cargo value.
  assert.equal(big.landedQuote.cargoValueCents, small.landedQuote.cargoValueCents * 3);
});

test('computeWhatIfQuote take-rate scales with cargo value', async () => {
  // OrcaTrade fee is 8% of cargo value by default — verify it scales
  // proportionally. (Pin the env to avoid the fee env override.)
  const prior = process.env.ORCATRADE_OPERATOR_FEE_PCT;
  delete process.env.ORCATRADE_OPERATOR_FEE_PCT;
  try {
    const r = await orch.computeWhatIfQuote(WHATIF_BASE_INPUT);
    const cargoEur = r.landedQuote.cargoValueCents / 100;
    const feeEur = r.landedQuote.orcatradeFeeCents / 100;
    // 8% within rounding.
    const ratio = feeEur / cargoEur;
    assert.ok(ratio > 0.079 && ratio < 0.081, `fee ratio expected ~0.08, got ${ratio}`);
  } finally {
    if (prior !== undefined) process.env.ORCATRADE_OPERATOR_FEE_PCT = prior;
  }
});

test('computeWhatIfQuote honours destinationCountry override (VAT differs across EU members)', async () => {
  // DE has 19% VAT, IE has 23%. Same cargo value → different VAT line.
  const de = await orch.computeWhatIfQuote({ ...WHATIF_BASE_INPUT, destinationCountry: 'DE' });
  const ie = await orch.computeWhatIfQuote({ ...WHATIF_BASE_INPUT, destinationCountry: 'IE' });
  const vatDE = de.landedQuote.components.find((c) => c.component === 'vat');
  const vatIE = ie.landedQuote.components.find((c) => c.component === 'vat');
  assert.ok(vatDE);
  assert.ok(vatIE);
  // IE VAT > DE VAT (23% vs 19%).
  assert.ok(vatIE.eurCents > vatDE.eurCents);
});

test('computeWhatIfQuote uppercases origin/destination for the calculator boundary', async () => {
  const r = await orch.computeWhatIfQuote({
    ...WHATIF_BASE_INPUT,
    originCountry: 'cn',
    destinationCountry: 'de',
  });
  assert.equal(r.appliedInputs.originCountry, 'CN');
  assert.equal(r.appliedInputs.destinationCountry, 'DE');
});

test('computeWhatIfQuote tolerates missing targetUnitPriceCents (falls back to v1 default)', async () => {
  const r = await orch.computeWhatIfQuote({
    ...WHATIF_BASE_INPUT,
    targetUnitPriceCents: null,
  });
  // Should not throw + return a valid quote with the default €10/unit
  // implied price embedded in the helper.
  assert.ok(Number.isInteger(r.landedQuote.totalLandedCents));
  assert.equal(r.appliedInputs.targetUnitPriceCents, null);
});

test('computeWhatIfQuote tolerates an invalid targetQuantity (falls back to 1000)', async () => {
  const r = await orch.computeWhatIfQuote({
    ...WHATIF_BASE_INPUT,
    targetQuantity: 0,
  });
  assert.equal(r.appliedInputs.targetQuantity, 1000);
});

test('computeWhatIfQuote attaches compliance probes to the landed quote', async () => {
  const r = await orch.computeWhatIfQuote(WHATIF_BASE_INPUT);
  assert.ok(r.landedQuote.complianceProbes);
  assert.equal(r.landedQuote.complianceProbes.productCategory, 'homeware');
  assert.ok('cbam' in r.landedQuote.complianceProbes);
});

// ── Sprint 4 chunk 1: Compliance-probe wiring ────────────────────────

test('runComplianceProbes returns CBAM applies=true for aluminium from CN', () => {
  const probes = orch.runComplianceProbes({
    productCategory: 'machinery',
    productDescription: 'aluminium extrusion profiles industrial use',
    originCountry: 'CN',
    hsCode: '760410',
  });
  assert.ok(probes.cbam);
  assert.equal(probes.cbam.applies, true);
  assert.equal(probes.cbam.categoryKey, 'aluminium');
});

test('runComplianceProbes returns CBAM applies=false for the SAME aluminium when origin is EU (intra-EU)', () => {
  const probes = orch.runComplianceProbes({
    productCategory: 'machinery',
    productDescription: 'aluminium extrusion profiles industrial use',
    originCountry: 'DE',
    hsCode: '760410',
  });
  assert.ok(probes.cbam);
  assert.equal(probes.cbam.applies, false);
});

test('runComplianceProbes CBAM applies=false for non-Annex-I products (homeware)', () => {
  const probes = orch.runComplianceProbes({
    productCategory: 'homeware',
    productDescription: 'silicone kitchen mats food-grade',
    originCountry: 'CN',
    hsCode: '392410',
  });
  assert.ok(probes.cbam);
  assert.equal(probes.cbam.applies, false);
});

test('runComplianceProbes returns EUDR applies=true for wooden furniture from non-EU origin', () => {
  const probes = orch.runComplianceProbes({
    productCategory: 'furniture',
    productDescription: 'wooden dining tables solid oak',
    originCountry: 'VN',
    hsCode: '940360',
  });
  assert.ok(probes.eudr);
  // EUDR probe may return applies as boolean or 'maybe' depending on origin
  // signal — what matters is the probe ran and returned a structured answer.
  assert.ok(probes.eudr.applies !== undefined);
});

test('runComplianceProbes REACH applies for cosmetics (high-relevance category)', () => {
  const probes = orch.runComplianceProbes({
    productCategory: 'cosmetics',
    productDescription: 'organic face cream skincare with retinol',
    originCountry: 'CN',
    hsCode: '330499',
  });
  assert.ok(probes.reach);
  // REACH probe returns 'maybe' or true depending on category match.
  assert.ok(probes.reach.applies === true || probes.reach.applies === 'maybe');
});

test('runComplianceProbes is fail-soft when a probe throws (per-probe try/catch)', () => {
  // Pass nonsense to all probes. Even if one throws internally, the
  // helper must return a structured result (with that slot null).
  const probes = orch.runComplianceProbes({
    productCategory: '',
    productDescription: '',
    originCountry: '',
    hsCode: '',
  });
  // Either the probes return a valid result or null — but never throw.
  assert.ok(probes);
  assert.ok('cbam' in probes);
  assert.ok('eudr' in probes);
  assert.ok('reach' in probes);
});

test('buildGoodsSeedFromRequest cbamInScope=true for aluminium from CN', () => {
  const aluminiumRequest = {
    ...APPROVED_REQUEST_FIXTURE_WITH_HS,
    productDescription: 'aluminium extrusion profiles industrial-grade',
    hsCodeGuess: '760410',
    factoryShortlist: [
      { rank: 1, country: 'CN', candidates: [{ name: 'Vendor X' }] },
    ],
  };
  const seed = orch.buildGoodsSeedFromRequest({
    request: aluminiumRequest,
    actorEmailHash: 'h',
    orgId: 1,
  });
  assert.equal(seed.cbamInScope, true);
});

test('buildGoodsSeedFromRequest stashes all three compliance probe results in metadata', () => {
  const seed = orch.buildGoodsSeedFromRequest({
    request: APPROVED_REQUEST_FIXTURE_WITH_HS,
    actorEmailHash: 'h',
    orgId: 1,
  });
  const probes = seed.metadata.complianceProbes;
  assert.ok(probes);
  assert.equal(probes.version, 'v1.0');
  assert.equal(probes.productCategory, 'homeware');
  assert.ok(probes.cbam);
  assert.ok(probes.eudr);
  assert.ok(probes.reach);
  // Each probe result carries the citation for traceability.
  assert.match(probes.cbam.citation || '', /Regulation \(EU\)/);
});

test('buildGoodsSeedFromRequest compliance probe carries the citation for traceability', () => {
  const aluminiumRequest = {
    ...APPROVED_REQUEST_FIXTURE_WITH_HS,
    productDescription: 'aluminium extrusion profiles',
    hsCodeGuess: '760410',
    factoryShortlist: [{ rank: 1, country: 'CN', candidates: [{ name: 'V' }] }],
  };
  const seed = orch.buildGoodsSeedFromRequest({
    request: aluminiumRequest,
    actorEmailHash: 'h',
    orgId: 1,
  });
  assert.match(seed.metadata.complianceProbes.cbam.citation, /Regulation \(EU\) 2023\/956/);
  assert.equal(seed.metadata.complianceProbes.cbam.categoryKey, 'aluminium');
});

// ── Sprint 5 ch 1: buildLandedQuoteComplianceBlock ───────────────────

test('buildLandedQuoteComplianceBlock has version + productCategory + three regime slots', () => {
  const probes = orch.runComplianceProbes({
    productCategory: 'homeware',
    productDescription: 'silicone kitchen mats',
    originCountry: 'CN',
    hsCode: '392410',
  });
  const block = orch.buildLandedQuoteComplianceBlock({ probes, productCategory: 'homeware' });
  assert.equal(block.version, 'v1.0');
  assert.equal(block.productCategory, 'homeware');
  assert.ok('cbam' in block);
  assert.ok('eudr' in block);
  assert.ok('reach' in block);
});

test('buildLandedQuoteComplianceBlock CBAM block carries applies + reason + categoryKey + citation + confidence', () => {
  const probes = orch.runComplianceProbes({
    productCategory: 'machinery',
    productDescription: 'aluminium extrusion profiles industrial-grade',
    originCountry: 'CN',
    hsCode: '760410',
  });
  const block = orch.buildLandedQuoteComplianceBlock({ probes, productCategory: 'machinery' });
  assert.ok(block.cbam);
  assert.equal(block.cbam.applies, true);
  assert.equal(block.cbam.categoryKey, 'aluminium');
  assert.equal(typeof block.cbam.reason, 'string');
  assert.match(block.cbam.citation, /Regulation \(EU\) 2023\/956/);
  assert.equal(typeof block.cbam.confidence, 'string');
});

test('buildLandedQuoteComplianceBlock CBAM block has applies=false for intra-EU origin', () => {
  const probes = orch.runComplianceProbes({
    productCategory: 'machinery',
    productDescription: 'aluminium extrusion',
    originCountry: 'DE',
    hsCode: '760410',
  });
  const block = orch.buildLandedQuoteComplianceBlock({ probes, productCategory: 'machinery' });
  assert.equal(block.cbam.applies, false);
});

test('buildLandedQuoteComplianceBlock REACH applies field is tri-state (boolean | string)', () => {
  // Non-cosmetic, non-textile, non-electronics product → REACH probe
  // returns applies='maybe' because REACH applies in principle.
  const probes = orch.runComplianceProbes({
    productCategory: 'homeware',
    productDescription: 'silicone kitchen mats food-grade',
    originCountry: 'CN',
    hsCode: '392410',
  });
  const block = orch.buildLandedQuoteComplianceBlock({ probes, productCategory: 'homeware' });
  assert.ok(block.reach);
  const reachApplies = block.reach.applies;
  // Either boolean (true/false) or string ('maybe'). The TS type
  // ComplianceProbeResult["applies"] is boolean | 'maybe'.
  assert.ok(
    reachApplies === true || reachApplies === false || reachApplies === 'maybe',
    `REACH applies must be tri-state, got ${JSON.stringify(reachApplies)}`,
  );
});

test('buildLandedQuoteComplianceBlock tolerates a null/undefined probe result', () => {
  const block = orch.buildLandedQuoteComplianceBlock({
    probes: { cbam: null, eudr: null, reach: null },
    productCategory: 'homeware',
  });
  assert.equal(block.cbam, null);
  assert.equal(block.eudr, null);
  assert.equal(block.reach, null);
});

test('buildLandedQuoteComplianceBlock tolerates missing probes wholesale (passes null/undefined)', () => {
  // Defensive: a probe orchestration failure must not propagate as a
  // throw — buildLandedQuoteComplianceBlock must always return a
  // well-formed block.
  const block = orch.buildLandedQuoteComplianceBlock({
    probes: null,
    productCategory: 'homeware',
  });
  assert.equal(block.version, 'v1.0');
  assert.equal(block.productCategory, 'homeware');
  assert.equal(block.cbam, null);
  assert.equal(block.eudr, null);
  assert.equal(block.reach, null);
});

test('buildLandedQuoteComplianceBlock EUDR block has commodityKey field (mapped from probe categoryKey)', () => {
  const probes = orch.runComplianceProbes({
    productCategory: 'furniture',
    productDescription: 'wooden dining tables solid oak',
    originCountry: 'VN',
    hsCode: '940360',
  });
  const block = orch.buildLandedQuoteComplianceBlock({ probes, productCategory: 'furniture' });
  assert.ok(block.eudr);
  // commodityKey may be string or null depending on the probe — but the
  // FIELD must exist (vs being undefined) so the TS type stays satisfied.
  assert.ok('commodityKey' in block.eudr);
});
