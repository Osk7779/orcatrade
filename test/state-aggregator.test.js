const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ACTIVITY_KEYS,
  readJson,
  summariseDocument,
  summariseInsuranceQuote,
  summariseSampleRequest,
  summariseReturnsQuote,
  buildActivityFeed,
  aggregateState,
  loadSession,
  saveSession,
  clearSession,
  buildSession,
} = require('../lib/dashboard/state-aggregator');

// Simple in-memory storage adapter that mimics localStorage.
function makeStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem(key) { return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null; },
    setItem(key, value) { data[key] = String(value); },
    removeItem(key) { delete data[key]; },
    _data: data,
  };
}

// ── ACTIVITY_KEYS registry ───────────────────────────────

test('ACTIVITY_KEYS exposes all 7 platform tools', () => {
  const expected = ['commercialInvoice', 'packingList', 'proformaInvoice', 'certificateOfOrigin', 'insuranceQuote', 'sampleRequest', 'returnsQuote'];
  for (const name of expected) {
    assert.ok(ACTIVITY_KEYS[name], `missing ${name}`);
    assert.ok(ACTIVITY_KEYS[name].key.startsWith('orcatrade.'));
    assert.ok(['document', 'quote'].includes(ACTIVITY_KEYS[name].kind));
    assert.ok(ACTIVITY_KEYS[name].label);
    assert.ok(ACTIVITY_KEYS[name].route);
  }
});

// ── readJson ─────────────────────────────────────────────

test('readJson returns null for missing keys', () => {
  const storage = makeStorage();
  assert.equal(readJson(storage, 'missing'), null);
});

test('readJson parses valid JSON', () => {
  const storage = makeStorage({ 'k': JSON.stringify({ x: 1 }) });
  assert.deepEqual(readJson(storage, 'k'), { x: 1 });
});

test('readJson returns null on malformed JSON', () => {
  const storage = makeStorage({ 'k': 'not-json' });
  assert.equal(readJson(storage, 'k'), null);
});

test('readJson handles missing storage adapter', () => {
  assert.equal(readJson(null, 'k'), null);
});

// ── summariseDocument ────────────────────────────────────

test('summariseDocument extracts core fields', () => {
  const result = summariseDocument('document', {
    invoiceNumber: 'INV-001',
    invoiceDate: '2026-05-07',
    exporter: { companyName: 'Shenzhen' },
    consignee: { companyName: 'Berlin' },
    lineItems: [{ description: 'A' }, { description: 'B' }],
    currency: 'EUR',
    countryOfOrigin: 'CN',
    countryOfDestination: 'DE',
  });
  assert.equal(result.invoiceNumber, 'INV-001');
  assert.equal(result.exporter, 'Shenzhen');
  assert.equal(result.consignee, 'Berlin');
  assert.equal(result.lineItems, 2);
  assert.equal(result.currency, 'EUR');
});

test('summariseDocument tolerates partial data', () => {
  const result = summariseDocument('document', { invoiceNumber: 'INV-001' });
  assert.equal(result.exporter, null);
  assert.equal(result.consignee, null);
  assert.equal(result.lineItems, 0);
});

test('summariseDocument returns null for non-object input', () => {
  assert.equal(summariseDocument('document', null), null);
  assert.equal(summariseDocument('document', 'string'), null);
});

// ── summariseInsuranceQuote ──────────────────────────────

test('summariseInsuranceQuote returns shape matching the form fields', () => {
  const result = summariseInsuranceQuote({
    cargoValueEur: 250000,
    transportMode: 'sea_fcl',
    goodsType: 'electronics',
    originCountry: 'CN',
    destinationCountry: 'DE',
    coverage: 'icc_a',
  });
  assert.equal(result.cargoValueEur, 250000);
  assert.equal(result.transportMode, 'sea_fcl');
  assert.equal(result.goodsType, 'electronics');
});

// ── summariseSampleRequest ───────────────────────────────

test('summariseSampleRequest captures express + rush flags', () => {
  const result = summariseSampleRequest({
    supplierCount: 5,
    totalWeightKg: 8,
    destinationCountry: 'DE',
    express: true,
    rushTurnaround: true,
  });
  assert.equal(result.supplierCount, 5);
  assert.equal(result.express, true);
  assert.equal(result.rushTurnaround, true);
});

// ── summariseReturnsQuote ────────────────────────────────

test('summariseReturnsQuote captures pieces / weight / value / category', () => {
  const result = summariseReturnsQuote({
    piecesCount: 50,
    totalWeightKg: 80,
    declaredValueEur: 15000,
    category: 'electronics',
    originCountry: 'CN',
  });
  assert.equal(result.piecesCount, 50);
  assert.equal(result.declaredValueEur, 15000);
  assert.equal(result.category, 'electronics');
});

// ── buildActivityFeed ────────────────────────────────────

test('buildActivityFeed returns empty array for empty storage', () => {
  const storage = makeStorage();
  const feed = buildActivityFeed(storage);
  assert.deepEqual(feed, []);
});

test('buildActivityFeed picks up commercial invoice draft', () => {
  const storage = makeStorage({
    [ACTIVITY_KEYS.commercialInvoice.key]: JSON.stringify({
      invoiceNumber: 'INV-001',
      exporter: { companyName: 'Shenzhen' },
      consignee: { companyName: 'Berlin' },
      lineItems: [{}, {}, {}],
    }),
  });
  const feed = buildActivityFeed(storage);
  assert.equal(feed.length, 1);
  assert.equal(feed[0].name, 'commercialInvoice');
  assert.equal(feed[0].kind, 'document');
  assert.equal(feed[0].summary.lineItems, 3);
});

test('buildActivityFeed surfaces all kinds when populated', () => {
  const storage = makeStorage({
    [ACTIVITY_KEYS.commercialInvoice.key]: JSON.stringify({ invoiceNumber: 'INV-001' }),
    [ACTIVITY_KEYS.insuranceQuote.key]: JSON.stringify({ cargoValueEur: 100000, transportMode: 'sea_fcl' }),
    [ACTIVITY_KEYS.returnsQuote.key]: JSON.stringify({ piecesCount: 10, totalWeightKg: 5, declaredValueEur: 1000 }),
  });
  const feed = buildActivityFeed(storage);
  assert.equal(feed.length, 3);
  const kinds = feed.map(f => f.kind).sort();
  assert.deepEqual(kinds, ['document', 'quote', 'quote']);
});

// ── aggregateState ───────────────────────────────────────

test('aggregateState groups activity into documents and quotes', () => {
  const storage = makeStorage({
    [ACTIVITY_KEYS.commercialInvoice.key]: JSON.stringify({ invoiceNumber: 'INV-001' }),
    [ACTIVITY_KEYS.packingList.key]: JSON.stringify({ invoiceNumber: 'INV-001' }),
    [ACTIVITY_KEYS.insuranceQuote.key]: JSON.stringify({ cargoValueEur: 100000, transportMode: 'sea_fcl' }),
  });
  const state = aggregateState(storage);
  assert.equal(state.activity.length, 3);
  assert.equal(state.grouped.documents.length, 2);
  assert.equal(state.grouped.quotes.length, 1);
  assert.equal(state.counts.totalDrafts, 3);
  assert.equal(state.counts.documents, 2);
  assert.equal(state.counts.quotes, 1);
});

test('aggregateState returns zero counts for empty storage', () => {
  const storage = makeStorage();
  const state = aggregateState(storage);
  assert.equal(state.counts.totalDrafts, 0);
});

// ── Session helpers ──────────────────────────────────────

test('buildSession returns an error for invalid email', () => {
  const result = buildSession({ email: 'not-an-email', name: 'Oskar' });
  assert.equal(result.ok, false);
  assert.match(result.error, /email/i);
});

test('buildSession defaults name and workspaceName when missing', () => {
  const result = buildSession({ email: 'oskar@orcatrade.pl' });
  assert.equal(result.ok, true);
  assert.equal(result.session.name, 'oskar');
  assert.match(result.session.workspaceName, /workspace/i);
});

test('buildSession honours valid role + falls back to owner', () => {
  const a = buildSession({ email: 'a@b.com', name: 'A', role: 'admin' });
  const b = buildSession({ email: 'a@b.com', name: 'A', role: 'invalid' });
  assert.equal(a.session.role, 'admin');
  assert.equal(b.session.role, 'owner');
});

test('buildSession includes auth-mode metadata flagging the stub', () => {
  const result = buildSession({ email: 'oskar@orcatrade.pl', name: 'Oskar' });
  assert.equal(result.session.authMode, 'stub-localstorage');
  assert.match(result.session.authNote, /stub|demo|next sprint/i);
});

test('buildSession truncates absurdly long input', () => {
  const longName = 'A'.repeat(500);
  const result = buildSession({ email: 'oskar@orcatrade.pl', name: longName });
  assert.ok(result.session.name.length <= 80);
});

// ── saveSession / loadSession / clearSession ─────────────

test('save → load roundtrip persists session', () => {
  const storage = makeStorage();
  saveSession(storage, { email: 'oskar@orcatrade.pl', name: 'Oskar' });
  const loaded = loadSession(storage);
  assert.equal(loaded.email, 'oskar@orcatrade.pl');
});

test('clearSession removes the session', () => {
  const storage = makeStorage();
  saveSession(storage, { email: 'a@b.com', name: 'A' });
  clearSession(storage);
  assert.equal(loadSession(storage), null);
});
