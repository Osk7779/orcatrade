// Origin sensitivity matrix tests.

const test = require('node:test');
const assert = require('node:assert/strict');

const { composePlan } = require('../lib/handlers/start');

// ── Structure ──────────────────────────────────────────

test('composePlan returns originSensitivity with matrix + cheapest + user origin', async () => {
  const p = await composePlan({
    productCategory: 'apparel',
    originCountry: 'CN',
    destinationCountry: 'PL',
    customsValueEur: 25000,
    weightKg: 800,
  });
  assert.equal(p.ok, true);
  assert.ok(p.originSensitivity);
  assert.ok(Array.isArray(p.originSensitivity.matrix));
  assert.ok(p.originSensitivity.matrix.length >= 5, 'covers CN/VN/IN/BD/TR');
  assert.equal(p.originSensitivity.userOrigin, 'CN');
  assert.ok(p.originSensitivity.cheapestOrigin);
});

test('matrix is sorted cheapest first', async () => {
  const p = await composePlan({
    productCategory: 'apparel',
    originCountry: 'CN',
    destinationCountry: 'PL',
    customsValueEur: 25000,
    weightKg: 800,
  });
  const totals = p.originSensitivity.matrix.map(e => e.perShipmentLandedTotal);
  for (let i = 1; i < totals.length; i++) {
    assert.ok(totals[i] >= totals[i - 1], `matrix[${i}] >= matrix[${i - 1}]`);
  }
});

test('user-chosen origin is flagged with isUserChoice', async () => {
  const p = await composePlan({
    productCategory: 'apparel',
    originCountry: 'CN',
    destinationCountry: 'PL',
    customsValueEur: 25000,
    weightKg: 800,
  });
  const userEntries = p.originSensitivity.matrix.filter(e => e.isUserChoice);
  assert.equal(userEntries.length, 1);
  assert.equal(userEntries[0].origin, 'CN');
});

// ── Preferential ranking ──────────────────────────────

test('CN apparel ranks worse than VN/BD/TR (no preferential pathway)', async () => {
  const p = await composePlan({
    productCategory: 'apparel',
    originCountry: 'CN',
    destinationCountry: 'PL',
    customsValueEur: 25000,
    weightKg: 800,
  });
  const cn = p.originSensitivity.matrix.find(e => e.origin === 'CN');
  const vn = p.originSensitivity.matrix.find(e => e.origin === 'VN');
  const bd = p.originSensitivity.matrix.find(e => e.origin === 'BD');
  const tr = p.originSensitivity.matrix.find(e => e.origin === 'TR');

  assert.ok(cn.dutyRatePct > 10, `CN apparel duty ${cn.dutyRatePct} should be ~12%`);
  assert.equal(vn.dutyRatePct, 0, 'VN apparel under EVFTA = 0%');
  assert.equal(bd.dutyRatePct, 0, 'BD apparel under EBA = 0%');
  assert.equal(tr.dutyRatePct, 0, 'TR apparel under ATR = 0%');
});

test('preferentialApplied populated per origin', async () => {
  const p = await composePlan({
    productCategory: 'apparel',
    originCountry: 'CN',
    destinationCountry: 'PL',
    customsValueEur: 25000,
    weightKg: 800,
  });
  const map = Object.fromEntries(p.originSensitivity.matrix.map(e => [e.origin, e.preferentialApplied]));
  assert.equal(map.VN, 'EVFTA');
  assert.equal(map.BD, 'EBA');
  assert.equal(map.TR, 'ATR');
  assert.equal(map.IN, 'GSP_STANDARD');
  assert.equal(map.CN, null);
});

// ── Trade defence still applies per origin ────────────

test('CN bicycles → matrix shows CN with AD measure', async () => {
  const p = await composePlan({
    productCategory: 'machinery',
    originCountry: 'CN',
    destinationCountry: 'PL',
    customsValueEur: 25000,
    weightKg: 800,
    hsCode: '8712.00',
  });
  const cn = p.originSensitivity.matrix.find(e => e.origin === 'CN');
  assert.ok(cn.tradeDefenceMeasures.length >= 1, 'CN bicycles carry AD');
  assert.ok(cn.dutyRatePct > 50, `CN bicycles ~58% duty, got ${cn.dutyRatePct}%`);
});

test('VN bicycles → matrix shows no AD (different origin)', async () => {
  const p = await composePlan({
    productCategory: 'machinery',
    originCountry: 'CN',
    destinationCountry: 'PL',
    customsValueEur: 25000,
    weightKg: 800,
    hsCode: '8712.00',
  });
  const vn = p.originSensitivity.matrix.find(e => e.origin === 'VN');
  assert.equal(vn.tradeDefenceMeasures.length, 0);
});

// ── Annual estimate ───────────────────────────────────

test('annualLandedTotal populated when monthlyOrders provided', async () => {
  const p = await composePlan({
    productCategory: 'apparel',
    originCountry: 'CN',
    destinationCountry: 'PL',
    customsValueEur: 25000,
    weightKg: 800,
    monthlyOrders: 500,
  });
  for (const e of p.originSensitivity.matrix) {
    assert.ok(e.annualLandedTotal > 0);
    assert.ok(Math.abs(e.annualLandedTotal - e.perShipmentLandedTotal * 12) < 0.01,
      'annual = per-shipment × 12');
  }
  assert.equal(p.originSensitivity.shipmentsPerYear, 12);
});

test('annualLandedTotal is null when no monthlyOrders', async () => {
  const p = await composePlan({
    productCategory: 'apparel',
    originCountry: 'CN',
    destinationCountry: 'PL',
    customsValueEur: 25000,
    weightKg: 800,
  });
  assert.equal(p.originSensitivity.shipmentsPerYear, null);
  for (const e of p.originSensitivity.matrix) {
    assert.equal(e.annualLandedTotal, null);
  }
});

// ── Saving headline ───────────────────────────────────

test('CN apparel surfaces a >5% saving via TR/VN/BD alternative', async () => {
  const p = await composePlan({
    productCategory: 'apparel',
    originCountry: 'CN',
    destinationCountry: 'PL',
    customsValueEur: 50000,
    weightKg: 1500,
  });
  assert.ok(p.originSensitivity.savingEurVsUserOrigin > 0);
  assert.ok(p.originSensitivity.savingPctVsUserOrigin >= 5);
  assert.notEqual(p.originSensitivity.cheapestOrigin, 'CN');
});

test('TR cold-rolled steel: TR is user pick AND has AD on top — still useful comparison', async () => {
  const p = await composePlan({
    productCategory: 'machinery',
    originCountry: 'TR',
    destinationCountry: 'DE',
    customsValueEur: 100000,
    weightKg: 5000,
    hsCode: '7209.16',
  });
  const tr = p.originSensitivity.matrix.find(e => e.origin === 'TR');
  assert.ok(tr.tradeDefenceMeasures.length >= 1, 'TR cold-rolled has AD measure');
  assert.equal(tr.preferentialApplied, 'ATR', 'ATR Customs Union still applies');
});

// ── User origin not in default 5 ──────────────────────

test('user origin outside default 5 is included in matrix (e.g. KR)', async () => {
  const p = await composePlan({
    productCategory: 'electronics',
    originCountry: 'KR',
    destinationCountry: 'DE',
    customsValueEur: 50000,
    weightKg: 200,
    hsCode: '8517.62',
  });
  assert.ok(p.originSensitivity.matrix.some(e => e.origin === 'KR'));
  assert.ok(p.originSensitivity.matrix.find(e => e.origin === 'KR').isUserChoice);
});
