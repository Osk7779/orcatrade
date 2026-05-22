const test = require('node:test');
const assert = require('node:assert/strict');

const { CALCULATOR_VERSION, currentProvenance } = require('../lib/intelligence/provenance');
const startHandler = require('../lib/handlers/start');
const snap = require('../lib/intelligence/regression/snapshot');

// ── provenance stamp ────────────────────────────────────

test('currentProvenance carries calc version + data-snapshot dates', () => {
  const p = currentProvenance();
  assert.equal(p.calculatorVersion, CALCULATOR_VERSION);
  assert.match(p.generatedAt, /^\d{4}-\d{2}-\d{2}T/); // ISO-8601 UTC
  assert.ok(p.dataAsOf);
  assert.match(p.dataAsOf.fx, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(p.dataAsOf.cbamEtsPrice, /^\d{4}-\d{2}-\d{2}$/);
  // In the test env live TARIC is disabled → snapshot mode.
  assert.equal(p.taricMode, 'snapshot');
});

test('composePlan stamps provenance on every result', async () => {
  const plan = await startHandler.composePlan({
    productCategory: 'apparel', originCountry: 'CN', destinationCountry: 'PL', customsValueEur: 50000, weightKg: 800,
  });
  assert.equal(plan.ok, true);
  assert.ok(plan.provenance);
  assert.equal(plan.provenance.calculatorVersion, CALCULATOR_VERSION);
  assert.ok(plan.provenance.dataAsOf.fx);
});

// ── the reproducibility GUARANTEE ───────────────────────

test('reproducible: identical inputs → byte-identical numeric snapshot', async () => {
  const inputs = {
    productCategory: 'steel', originCountry: 'CN', destinationCountry: 'DE',
    customsValueEur: 250000, weightKg: 12000, hsCode: '7208',
  };
  const a = snap.extractSnapshot(await startHandler.composePlan(inputs));
  const b = snap.extractSnapshot(await startHandler.composePlan(inputs));
  // The deterministic snapshot must match exactly — same inputs, same euros.
  assert.deepEqual(a, b);
});

test('provenance does NOT leak into the regression snapshot (allowlist holds)', async () => {
  const plan = await startHandler.composePlan({
    productCategory: 'apparel', originCountry: 'CN', destinationCountry: 'PL', customsValueEur: 50000, weightKg: 800,
  });
  const s = snap.extractSnapshot(plan);
  assert.equal(s.provenance, undefined); // extractSnapshot is a strict allowlist
  assert.equal(s.generatedAt, undefined);
});
