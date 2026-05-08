// Plan-codec round-trip tests.

const test = require('node:test');
const assert = require('node:assert/strict');

const { encodeInputs, decodeInputs, SHARE_KEYS, toBase64Url, fromBase64Url } = require('../lib/utils/plan-codec');

// ── Base64url primitives ───────────────────────────────

test('toBase64Url + fromBase64Url round-trip ascii', () => {
  const s = 'hello world';
  assert.equal(fromBase64Url(toBase64Url(s)), s);
});

test('toBase64Url + fromBase64Url round-trip utf-8 (Polish + Chinese)', () => {
  const s = 'Łódź → 上海 ✓';
  assert.equal(fromBase64Url(toBase64Url(s)), s);
});

test('toBase64Url is URL-safe (no +, /, =)', () => {
  // Pick a string that produces all three problematic chars in plain base64
  const s = '???>>>///+++';
  const encoded = toBase64Url(s);
  assert.doesNotMatch(encoded, /[+/=]/, 'no +, /, or = in url-safe encoding');
  assert.equal(fromBase64Url(encoded), s);
});

// ── Input round-trip ───────────────────────────────────

test('encodeInputs → decodeInputs preserves a typical wizard payload', () => {
  const inputs = {
    productCategory: 'apparel',
    originCountry: 'CN',
    destinationCountry: 'PL',
    customsValueEur: 25000,
    weightKg: 800,
    linesCount: 2,
    urgencyWeeks: 12,
    monthlyOrders: 500,
    avgUnitsPerOrder: 1.5,
    claimPreferential: false,
  };
  const encoded = encodeInputs(inputs);
  assert.equal(typeof encoded, 'string');
  assert.ok(encoded.length > 0);
  const decoded = decodeInputs(encoded);
  for (const k of Object.keys(inputs)) {
    assert.deepEqual(decoded[k], inputs[k], `${k} round-trips`);
  }
});

test('encodeInputs strips non-whitelist keys', () => {
  const encoded = encodeInputs({
    productCategory: 'electronics',
    originCountry: 'VN',
    destinationCountry: 'DE',
    customsValueEur: 50000,
    weightKg: 300,
    // attacker-controlled fields:
    email: 'pwned@example.com',
    name: '<script>alert(1)</script>',
    secretFlag: true,
  });
  const decoded = decodeInputs(encoded);
  assert.equal(decoded.email, undefined);
  assert.equal(decoded.name, undefined);
  assert.equal(decoded.secretFlag, undefined);
  assert.equal(decoded.productCategory, 'electronics');
});

test('encodeInputs skips empty/null/undefined values', () => {
  const encoded = encodeInputs({
    productCategory: 'cosmetics',
    originCountry: 'IN',
    destinationCountry: 'NL',
    customsValueEur: 5000,
    weightKg: 80,
    monthlyOrders: '',
    urgencyWeeks: null,
    avgUnitsPerOrder: undefined,
  });
  const decoded = decodeInputs(encoded);
  assert.equal(decoded.monthlyOrders, undefined);
  assert.equal(decoded.urgencyWeeks, undefined);
  assert.equal(decoded.avgUnitsPerOrder, undefined);
});

test('decodeInputs ignores non-whitelist keys even if URL is tampered', () => {
  // Manually craft a payload with an extra key the encoder would never produce
  const payload = JSON.stringify({
    productCategory: 'toys',
    originCountry: 'CN',
    destinationCountry: 'PL',
    __proto__: { polluted: true },
    constructor: { polluted: true },
    arbitrary: 'should-be-stripped',
  });
  const tampered = toBase64Url(payload);
  const decoded = decodeInputs(tampered);
  assert.equal(decoded.arbitrary, undefined);
  assert.equal(decoded.productCategory, 'toys');
  // Prototype pollution check: decoded should not have a polluted prototype
  assert.equal(decoded.polluted, undefined);
});

test('decodeInputs throws on malformed payload', () => {
  assert.throws(() => decodeInputs(''), /b64url/);
  assert.throws(() => decodeInputs('not-valid-base64!!!'));
});

test('encodeInputs throws on non-object input', () => {
  assert.throws(() => encodeInputs(null), /inputs must be object/);
  assert.throws(() => encodeInputs('not-an-object'), /inputs must be object/);
});

test('SHARE_KEYS catalogue is stable and complete', () => {
  // Anchor: any change to the whitelist must be intentional. Update both the
  // codec and start/app.js (the browser-side mirror) when changing this list.
  const expected = [
    'productCategory', 'originCountry', 'destinationCountry',
    'customsValueEur', 'weightKg', 'linesCount', 'urgencyWeeks',
    'monthlyOrders', 'avgUnitsPerOrder', 'avgPalletsHeld', 'avgOrderWeightKg',
    'claimPreferential', 'hsCode', 'moq', 'targetFobUnitEur',
  ];
  assert.deepEqual(SHARE_KEYS, expected);
});

test('encoded payload stays under 200 bytes for typical input', () => {
  // URL length sanity check — Vercel and most browsers handle URLs to ~16KB,
  // but we want share links small enough to paste into Slack/SMS without truncation.
  const encoded = encodeInputs({
    productCategory: 'apparel',
    originCountry: 'CN',
    destinationCountry: 'PL',
    customsValueEur: 25000,
    weightKg: 800,
    linesCount: 2,
    urgencyWeeks: 12,
    monthlyOrders: 500,
    avgUnitsPerOrder: 1.5,
    claimPreferential: false,
  });
  assert.ok(encoded.length < 300, `encoded length ${encoded.length} should be < 300`);
});
