'use strict';

// Quote-prose generator — composition + fail-soft tests.
// The Anthropic API call itself is not exercised in unit tests
// (live-network + cost). Integration testing comes via the eval gate
// in CI.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const prose = require(path.join(ROOT, 'lib', 'ai', 'quote-prose'));

const REQUEST_FIXTURE = Object.freeze({
  externalId: 'ir_abc123',
  label: 'Q3 silicone mats',
  productDescription: '3,000 silicone kitchen mats food-grade',
  originCountry: 'CN',
  destinationCountry: 'DE',
  targetQuantity: 3000,
  targetQuantityUnit: 'pieces',
  targetUnitPriceCents: 1300,
  targetDeliveryDate: '2026-09-15',
  certificationRequirements: ['CE', 'REACH'],
});

const QUOTE_FIXTURE = Object.freeze({
  cargoValueCents: 2_500_000,
  totalLandedCents: 3_200_000,
  orcatradeFeeCents: 200_000,
  orcatradeFeePct: 8,
  currency: 'EUR',
  confidenceTier: 'B',
  confidenceNotes: [],
  components: [
    { component: 'duty', label: 'EU import duty', eurCents: 162_500, source: 'customs-quote', note: 'HS 392410, origin CN' },
    { component: 'vat', label: 'DE import VAT', eurCents: 500_000, source: 'customs-quote', note: null },
    { component: 'freight', label: 'Freight (sea_lcl, CN→DE)', eurCents: 47_500, source: 'routing-quote', note: '~1800 kg' },
    { component: 'orcatrade_managed_import_fee', label: 'OrcaTrade managed-import service (8%)', eurCents: 200_000, source: 'orcatrade-take-rate-v1', note: null },
  ],
  methodology: {
    version: 'v1.1',
    hsClassification: {
      hs6: '392410',
      label: 'Tableware and kitchenware of plastics',
      confidenceTier: 'high',
    },
  },
});

const TOP_COUNTRY_BLOCK = Object.freeze({
  rank: 1,
  country: 'CN',
  countryRationale: 'baseline',
  leadTimeWeeks: 8,
});

// ── System prompt + identity ────────────────────────────────────────

test('SYSTEM_PROMPT_STABLE enforces the calculator-grounded discipline (ADR 0002)', () => {
  // The non-negotiable rule must appear verbatim in the system prompt
  // so it survives any future prompt edit by accident.
  assert.match(prose.SYSTEM_PROMPT_STABLE, /NON-NEGOTIABLE RULE/);
  assert.match(prose.SYSTEM_PROMPT_STABLE, /VERBATIM from the JSON/);
  assert.match(prose.SYSTEM_PROMPT_STABLE, /Do NOT\s+invent/);
});

test('PROSE_MODEL is the Opus tier (customer-facing reasoning per the registry)', () => {
  assert.match(prose.PROSE_MODEL, /^claude-opus-/);
});

test('PROSE_PROMPT_VERSION is set for cost-telemetry attribution', () => {
  assert.equal(typeof prose.PROSE_PROMPT_VERSION, 'string');
  assert.ok(prose.PROSE_PROMPT_VERSION.length > 0);
});

test('PROSE_MAX_TOKENS leaves enough budget for the 200-word target plus headroom', () => {
  assert.ok(prose.PROSE_MAX_TOKENS >= 400);
  assert.ok(prose.PROSE_MAX_TOKENS <= 1500);
});

// ── composeUserMessage — calculator-grounded payload ────────────────

test('composeUserMessage embeds pre-computed EUR amounts (model never has to do arithmetic)', () => {
  const msg = prose.composeUserMessage({
    request: REQUEST_FIXTURE,
    landedQuote: QUOTE_FIXTURE,
    topCountryBlock: TOP_COUNTRY_BLOCK,
  });
  // Cargo value: 2,500,000 cents → "25000.00"
  assert.match(msg, /"cargoValueEur":\s*"25000\.00"/);
  // Total landed: 3,200,000 cents → "32000.00"
  assert.match(msg, /"totalLandedEur":\s*"32000\.00"/);
  // OrcaTrade fee: 200,000 cents → "2000.00"
  assert.match(msg, /"orcatradeFeeEur":\s*"2000\.00"/);
  // Component EUR amounts also pre-computed
  assert.match(msg, /"eur":\s*"1625\.00"/); // duty
  assert.match(msg, /"eur":\s*"5000\.00"/); // VAT
});

test('composeUserMessage carries the customer-stated product description into the payload', () => {
  const msg = prose.composeUserMessage({
    request: REQUEST_FIXTURE,
    landedQuote: QUOTE_FIXTURE,
    topCountryBlock: TOP_COUNTRY_BLOCK,
  });
  assert.match(msg, /silicone kitchen mats food-grade/);
});

test('composeUserMessage carries the HS classification so the model can flag low/none confidence', () => {
  const msg = prose.composeUserMessage({
    request: REQUEST_FIXTURE,
    landedQuote: QUOTE_FIXTURE,
    topCountryBlock: TOP_COUNTRY_BLOCK,
  });
  assert.match(msg, /"hs6":\s*"392410"/);
  assert.match(msg, /"confidenceTier":\s*"high"/);
});

test('composeUserMessage carries confidenceNotes when present (so the model can echo warnings)', () => {
  const withWarnings = {
    ...QUOTE_FIXTURE,
    confidenceNotes: ['HS classification confidence is LOW — team review must verify.'],
  };
  const msg = prose.composeUserMessage({
    request: REQUEST_FIXTURE,
    landedQuote: withWarnings,
    topCountryBlock: TOP_COUNTRY_BLOCK,
  });
  assert.match(msg, /HS classification confidence is LOW/);
});

test('composeUserMessage tolerates a missing topCountryBlock (no shortlist)', () => {
  const msg = prose.composeUserMessage({
    request: REQUEST_FIXTURE,
    landedQuote: QUOTE_FIXTURE,
    topCountryBlock: null,
  });
  assert.match(msg, /"topCountry":\s*null/);
});

test('composeUserMessage targetUnitPriceEur is pre-computed from cents', () => {
  const msg = prose.composeUserMessage({
    request: REQUEST_FIXTURE,
    landedQuote: QUOTE_FIXTURE,
    topCountryBlock: TOP_COUNTRY_BLOCK,
  });
  // 1300 cents → "13.00"
  assert.match(msg, /"targetUnitPriceEur":\s*"13\.00"/);
});

// ── extractAssistantText ────────────────────────────────────────────

test('extractAssistantText returns the trimmed text from a normal Anthropic response', () => {
  const response = {
    content: [{ type: 'text', text: '  Your import quote covers 3,000 silicone mats…  ' }],
  };
  assert.equal(prose.extractAssistantText(response), 'Your import quote covers 3,000 silicone mats…');
});

test('extractAssistantText returns null when there is no text block', () => {
  assert.equal(prose.extractAssistantText({ content: [{ type: 'tool_use' }] }), null);
});

test('extractAssistantText returns null when the response is malformed', () => {
  assert.equal(prose.extractAssistantText(null), null);
  assert.equal(prose.extractAssistantText({}), null);
  assert.equal(prose.extractAssistantText({ content: 'not-an-array' }), null);
});

test('extractAssistantText returns null on an empty text block', () => {
  assert.equal(prose.extractAssistantText({ content: [{ type: 'text', text: '   ' }] }), null);
});

// ── Fail-soft entry-point guards ─────────────────────────────────────

test('generateQuoteProse returns { ok:false, reason:"disabled" } when env kill-switch is set', async () => {
  const prior = process.env.ORCATRADE_DISABLE_QUOTE_PROSE;
  process.env.ORCATRADE_DISABLE_QUOTE_PROSE = '1';
  try {
    const result = await prose.generateQuoteProse({
      request: REQUEST_FIXTURE,
      landedQuote: QUOTE_FIXTURE,
      factoryShortlist: [],
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'disabled');
  } finally {
    if (prior !== undefined) process.env.ORCATRADE_DISABLE_QUOTE_PROSE = prior;
    else delete process.env.ORCATRADE_DISABLE_QUOTE_PROSE;
  }
});

test('generateQuoteProse returns { ok:false, reason:"unconfigured" } when ANTHROPIC_API_KEY is missing', async () => {
  const priorKey = process.env.ANTHROPIC_API_KEY;
  const priorOs = process.env.ORCATRADE_OS_API;
  const priorKill = process.env.ORCATRADE_DISABLE_QUOTE_PROSE;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ORCATRADE_OS_API;
  delete process.env.ORCATRADE_DISABLE_QUOTE_PROSE;
  try {
    const result = await prose.generateQuoteProse({
      request: REQUEST_FIXTURE,
      landedQuote: QUOTE_FIXTURE,
      factoryShortlist: [],
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'unconfigured');
  } finally {
    if (priorKey !== undefined) process.env.ANTHROPIC_API_KEY = priorKey;
    if (priorOs !== undefined) process.env.ORCATRADE_OS_API = priorOs;
    if (priorKill !== undefined) process.env.ORCATRADE_DISABLE_QUOTE_PROSE = priorKill;
  }
});

test('generateQuoteProse returns { ok:false, reason:"no-quote" } when landedQuote is malformed', async () => {
  const prior = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'test-key';
  try {
    const r1 = await prose.generateQuoteProse({
      request: REQUEST_FIXTURE,
      landedQuote: null,
      factoryShortlist: [],
    });
    assert.equal(r1.reason, 'no-quote');
    const r2 = await prose.generateQuoteProse({
      request: REQUEST_FIXTURE,
      landedQuote: { components: 'not-an-array' },
      factoryShortlist: [],
    });
    assert.equal(r2.reason, 'no-quote');
  } finally {
    if (prior !== undefined) process.env.ANTHROPIC_API_KEY = prior;
    else delete process.env.ANTHROPIC_API_KEY;
  }
});

test('generateQuoteProse never throws regardless of bad inputs (fail-soft)', async () => {
  // Each call should return an object, never reject.
  const calls = [
    prose.generateQuoteProse({}),
    prose.generateQuoteProse({ request: REQUEST_FIXTURE }),
    prose.generateQuoteProse({ request: REQUEST_FIXTURE, landedQuote: {} }),
  ];
  for (const p of calls) {
    const r = await p;
    assert.equal(typeof r, 'object');
    assert.equal(r.ok, false);
    assert.equal(typeof r.reason, 'string');
  }
});
