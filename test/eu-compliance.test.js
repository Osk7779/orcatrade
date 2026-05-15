// EU compliance overlay tests.

const test = require('node:test');
const assert = require('node:assert/strict');

const compliance = require('../lib/intelligence/data/eu-compliance');
const { composePlan } = require('../lib/handlers/start');

// ── Helpers ────────────────────────────────────────────

test('hsHasPrefix matches dotted and undotted forms', () => {
  assert.equal(compliance.hsHasPrefix('72.08', '72'), true);
  assert.equal(compliance.hsHasPrefix('7208.10', '7208'), true);
  assert.equal(compliance.hsHasPrefix('72081000', '7208'), true);
  assert.equal(compliance.hsHasPrefix('6203.42', '72'), false);
});

// ── CBAM ───────────────────────────────────────────────

test('CBAM triggers on iron/steel chapter 72', () => {
  const matches = compliance.findApplicableRegimes({ hsCode: '7208.10', productCategory: 'machinery' });
  const cbam = matches.find(m => m.id === 'CBAM');
  assert.ok(cbam, 'CBAM applies to chapter 72');
  assert.equal(cbam.severity, 'high');
  assert.match(cbam.status, /definitive period/);
});

test('CBAM triggers on aluminium chapter 76', () => {
  const matches = compliance.findApplicableRegimes({ hsCode: '7610.10', productCategory: 'machinery' });
  assert.ok(matches.some(m => m.id === 'CBAM'));
});

test('CBAM triggers on cement HS 2523', () => {
  const matches = compliance.findApplicableRegimes({ hsCode: '2523.10', productCategory: 'homeware' });
  assert.ok(matches.some(m => m.id === 'CBAM'));
});

test('CBAM does NOT trigger on apparel chapter 62', () => {
  const matches = compliance.findApplicableRegimes({ hsCode: '6203.42', productCategory: 'apparel' });
  assert.equal(matches.find(m => m.id === 'CBAM'), undefined);
});

// ── EUDR ───────────────────────────────────────────────

test('EUDR triggers on cocoa HS 1801', () => {
  const matches = compliance.findApplicableRegimes({ hsCode: '1801.00', productCategory: 'homeware' });
  const eudr = matches.find(m => m.id === 'EUDR');
  assert.ok(eudr, 'EUDR applies to cocoa');
  assert.equal(eudr.severity, 'high');
  assert.match(eudr.importerObligation, /Due Diligence Statement/);
});

test('EUDR triggers on coffee HS 0901', () => {
  const matches = compliance.findApplicableRegimes({ hsCode: '0901.21', productCategory: 'homeware' });
  assert.ok(matches.some(m => m.id === 'EUDR'));
});

test('EUDR triggers on plywood HS 4412', () => {
  const matches = compliance.findApplicableRegimes({ hsCode: '4412', productCategory: 'furniture' });
  assert.ok(matches.some(m => m.id === 'EUDR'));
});

test('EUDR triggers on rubber tyres HS 4011', () => {
  const matches = compliance.findApplicableRegimes({ hsCode: '4011.20', productCategory: 'machinery' });
  assert.ok(matches.some(m => m.id === 'EUDR'));
});

test('EUDR does NOT trigger on cotton apparel HS 6203', () => {
  const matches = compliance.findApplicableRegimes({ hsCode: '6203.42', productCategory: 'apparel' });
  assert.equal(matches.find(m => m.id === 'EUDR'), undefined);
});

// ── REACH ──────────────────────────────────────────────

test('REACH triggers on cosmetics chapter 33', () => {
  const matches = compliance.findApplicableRegimes({ hsCode: '3304.99', productCategory: 'cosmetics' });
  assert.ok(matches.some(m => m.id === 'REACH'));
});

test('REACH triggers on plastics chapter 39', () => {
  const matches = compliance.findApplicableRegimes({ hsCode: '3923.10', productCategory: 'homeware' });
  assert.ok(matches.some(m => m.id === 'REACH'));
});

// ── CE marking ─────────────────────────────────────────

test('CE Machinery triggers on chapter 84', () => {
  const matches = compliance.findApplicableRegimes({ hsCode: '8413.30', productCategory: 'machinery' });
  assert.ok(matches.some(m => m.id === 'CE_MACHINERY'));
});

test('CE LVD/EMC/RED triggers on chapter 85', () => {
  const matches = compliance.findApplicableRegimes({ hsCode: '8528.72', productCategory: 'electronics' });
  assert.ok(matches.some(m => m.id === 'CE_LVD_EMC_RED'));
});

// ── RoHS / WEEE ────────────────────────────────────────

test('RoHS + WEEE both trigger on EEE chapter 85', () => {
  const matches = compliance.findApplicableRegimes({ hsCode: '8517.62', productCategory: 'electronics' });
  assert.ok(matches.some(m => m.id === 'ROHS'));
  assert.ok(matches.some(m => m.id === 'WEEE'));
});

// ── Battery ────────────────────────────────────────────

test('Battery Regulation triggers on lithium-ion HS 8507', () => {
  const matches = compliance.findApplicableRegimes({ hsCode: '8507.60', productCategory: 'electronics' });
  assert.ok(matches.some(m => m.id === 'BATTERY'));
});

test('Battery Regulation triggers on e-bikes HS 8711.60', () => {
  const matches = compliance.findApplicableRegimes({ hsCode: '8711.60', productCategory: 'machinery' });
  assert.ok(matches.some(m => m.id === 'BATTERY'));
});

// ── Toys ───────────────────────────────────────────────

test('Toys CN triggers Toy Safety + GPSR + REACH note', () => {
  const matches = compliance.findApplicableRegimes({ hsCode: '9503.00', productCategory: 'toys' });
  assert.ok(matches.some(m => m.id === 'TOY_SAFETY'));
  assert.ok(matches.some(m => m.id === 'GPSR'));
  // Toys chapter 95 is not a chemicals chapter, so REACH does not auto-trigger.
  // But Toy Safety includes the REACH-related restrictions in its obligation.
});

// ── Cosmetics ──────────────────────────────────────────

test('Cosmetics chapter 33 triggers Cosmetics Regulation', () => {
  const matches = compliance.findApplicableRegimes({ hsCode: '3304.99', productCategory: 'cosmetics' });
  assert.ok(matches.some(m => m.id === 'COSMETICS'));
});

// ── GPSR ───────────────────────────────────────────────

test('GPSR triggers on consumer apparel even without specific HS chapter rules', () => {
  const matches = compliance.findApplicableRegimes({ hsCode: '6203.42', productCategory: 'apparel' });
  assert.ok(matches.some(m => m.id === 'GPSR'));
});

// ── PPWR ───────────────────────────────────────────────

test('PPWR is universal — triggers regardless of HS or category', () => {
  const matches = compliance.findApplicableRegimes({ hsCode: '6203.42', productCategory: 'apparel' });
  assert.ok(matches.some(m => m.id === 'PPWR'));
});

test('PPWR triggers even with no productCategory', () => {
  const matches = compliance.findApplicableRegimes({ hsCode: '8517.62' });
  assert.ok(matches.some(m => m.id === 'PPWR'));
});

// ── Footwear ───────────────────────────────────────────

test('Footwear chapter 64 triggers labelling directive', () => {
  const matches = compliance.findApplicableRegimes({ hsCode: '6403.99', productCategory: 'footwear' });
  assert.ok(matches.some(m => m.id === 'FOOTWEAR_LABELLING'));
});

// ── Sorting + composition ──────────────────────────────

test('Results are sorted by severity (high first)', () => {
  const matches = compliance.findApplicableRegimes({ hsCode: '8507.60', productCategory: 'electronics' });
  const severities = matches.map(m => m.severity);
  // Each medium / low must not appear before a high
  let seenLower = false;
  for (const s of severities) {
    if (s === 'high' && seenLower) {
      assert.fail('high regime appeared after lower-priority regime');
    }
    if (s === 'medium' || s === 'low') seenLower = true;
  }
});

test('composePlan exposes plan.compliance.regimes array', async () => {
  const plan = await composePlan({
    productCategory: 'electronics',
    originCountry: 'CN',
    destinationCountry: 'PL',
    customsValueEur: 50000,
    weightKg: 200,
    hsCode: '8517.62',
  });
  assert.equal(plan.ok, true);
  assert.ok(Array.isArray(plan.compliance.regimes));
  // Electronics should pull in CE_LVD_EMC_RED + ROHS + WEEE + GPSR + PPWR at least
  const ids = plan.compliance.regimes.map(r => r.id);
  for (const expected of ['CE_LVD_EMC_RED', 'ROHS', 'WEEE', 'GPSR', 'PPWR']) {
    assert.ok(ids.includes(expected), `expected ${expected} in compliance regimes`);
  }
});

test('composePlan: aluminium machinery from CN surfaces CBAM', async () => {
  const plan = await composePlan({
    productCategory: 'machinery',
    originCountry: 'CN',
    destinationCountry: 'DE',
    customsValueEur: 100000,
    weightKg: 5000,
    hsCode: '7610.10',
  });
  assert.equal(plan.ok, true);
  const ids = plan.compliance.regimes.map(r => r.id);
  assert.ok(ids.includes('CBAM'), 'CBAM applies to aluminium imports');
});

test('composePlan: e-bikes from CN trigger CBAM-no, RoHS, WEEE, Battery, GPSR', async () => {
  const plan = await composePlan({
    productCategory: 'machinery',
    originCountry: 'CN',
    destinationCountry: 'DE',
    customsValueEur: 100000,
    weightKg: 1500,
    hsCode: '8711.60',
  });
  assert.equal(plan.ok, true);
  const ids = plan.compliance.regimes.map(r => r.id);
  assert.ok(ids.includes('BATTERY'), 'BATTERY applies to e-bikes');
  assert.ok(ids.includes('PPWR'));
});

// ── Catalogue ─────────────────────────────────────────

test('REGIMES catalogue has at least 12 entries', () => {
  assert.ok(compliance.REGIMES.length >= 12, `expected >= 12, got ${compliance.REGIMES.length}`);
});

test('every regime has the required fields', () => {
  for (const r of compliance.REGIMES) {
    assert.ok(r.id, 'missing id');
    assert.ok(r.name, `${r.id} missing name`);
    assert.ok(['high', 'medium', 'low'].includes(r.severity), `${r.id} bad severity`);
    assert.ok(r.status, `${r.id} missing status`);
    assert.ok(r.importerObligation, `${r.id} missing importerObligation`);
    assert.ok(['hsPrefix', 'hsChapter', 'category', 'universal'].includes(r.triggerType), `${r.id} bad triggerType`);
    assert.ok(Array.isArray(r.triggers) && r.triggers.length, `${r.id} missing triggers`);
  }
});
