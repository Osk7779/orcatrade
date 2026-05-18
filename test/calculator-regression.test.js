// Sprint BG-9 — Calculator regression harness.
//
// Loads every scenario from lib/intelligence/regression/corpus.js, runs
// composePlan(), extracts the deterministic snapshot, and compares it
// against the frozen __snapshots__/<slug>.json. Drift fails the suite
// loud — every customer-visible headline number is part of the contract.
//
// Intentional updates: run `node scripts/regression-snapshot.js` and
// commit the resulting JSON change alongside the calculator change.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const startHandler = require('../lib/handlers/start');
const { CORPUS, SLUGS, findBySlug } = require('../lib/intelligence/regression/corpus');
const snap = require('../lib/intelligence/regression/snapshot');

// ── Corpus surface ────────────────────────────────────

test('corpus exposes at least the 8 worked-example sentinels + has unique slugs', () => {
  assert.ok(CORPUS.length >= 8, 'corpus must include the 8 /examples/* sentinel scenarios');
  const seen = new Set();
  for (const scenario of CORPUS) {
    assert.equal(typeof scenario.slug, 'string');
    assert.match(scenario.slug, /^[a-z0-9][a-z0-9-]{0,80}$/);
    assert.ok(!seen.has(scenario.slug), 'duplicate slug: ' + scenario.slug);
    seen.add(scenario.slug);
    assert.equal(typeof scenario.description, 'string');
    assert.ok(scenario.description.length > 0);
    assert.equal(typeof scenario.inputs, 'object');
    assert.equal(typeof scenario.inputs.productCategory, 'string');
    assert.equal(typeof scenario.inputs.originCountry, 'string');
    assert.equal(typeof scenario.inputs.destinationCountry, 'string');
    assert.equal(typeof scenario.inputs.customsValueEur, 'number');
  }
});

test('SLUGS matches CORPUS one-for-one', () => {
  assert.deepEqual(SLUGS.slice().sort(), CORPUS.map((s) => s.slug).sort());
});

test('every corpus entry has a frozen snapshot file (no orphans)', () => {
  for (const scenario of CORPUS) {
    const file = snap.snapshotPath(scenario.slug);
    assert.ok(fs.existsSync(file), 'missing frozen snapshot: ' + scenario.slug + ' (run: node scripts/regression-snapshot.js --scenario ' + scenario.slug + ')');
  }
});

test('every snapshot file has a matching corpus entry (no stale snapshots)', () => {
  for (const slug of snap.listSnapshotFiles()) {
    assert.ok(findBySlug(slug), 'stale snapshot file with no corpus entry: ' + slug + '.json');
  }
});

// ── Extractor unit tests ──────────────────────────────

test('extractSnapshot: returns ok:false when composePlan returned errors', () => {
  const s = snap.extractSnapshot({ ok: false, errors: ['bad customsValueEur'] });
  assert.equal(s.ok, false);
  assert.deepEqual(s.errors, ['bad customsValueEur']);
});

test('extractSnapshot: stamps the SNAPSHOT_VERSION constant', () => {
  // Build a minimal ok plan
  const plan = {
    ok: true,
    totals: { transportEur: 1, customsValueEur: 2, dutyEur: 3, vatEur: 4, brokerageEur: 5, perShipmentLandedTotal: 15, effectiveLandedTotal: 11, vatRecoverableEur: 4, warehouseMonthlyEur: null },
    routing: { recommendation: { primary: 'sea' } },
    customs: { ok: true, standard: { dutyEur: 3, dutyRate: 0.05, vatEur: 4, vatRate: 0.23, brokerageEur: 5, totalEur: 12, landedCostEur: 13, effectiveLandedCostEur: 11, vatRecoverableEur: 4, entrySummaryDeclarationEur: 25 }, tradeDefenceMeasures: [] },
    compliance: { regimes: [] },
    tco: { ok: true, main: { annualCustomsValueEur: 24 } },
    workingCapital: { ok: true, dio: 60, dso: 0, dpo: 60, ccc: 0, workingCapitalEur: 0, annualCapitalCostEur: 0, verdict: 'tight' },
    fx: null,
    originSensitivity: null,
  };
  const s = snap.extractSnapshot(plan);
  assert.equal(s.snapshotVersion, snap.SNAPSHOT_VERSION);
  assert.equal(s.ok, true);
  assert.equal(s.routing.primaryMode, 'sea');
  assert.equal(s.customs.standard.dutyRate, 5);
});

test('extractSnapshot: rounds EUR fields to integers + percent fields to 0.1pp', () => {
  assert.equal(snap.roundEur(1234.6), 1235);
  assert.equal(snap.roundEur(0), 0);
  assert.equal(snap.roundEur(null), null);
  assert.equal(snap.roundEur('not a number'), null);
  assert.equal(snap.roundPct(12.349), 12.3);
  assert.equal(snap.roundPct(null), null);
});

test('extractSnapshot: trade defence is sorted deterministically by type then ratePct desc', () => {
  const plan = {
    ok: true,
    totals: {}, routing: null, compliance: {regimes:[]}, tco: null, workingCapital: null, fx: null, originSensitivity: null,
    customs: {
      ok: true,
      standard: { dutyEur: 0, dutyRate: 0, vatEur: 0, vatRate: 0, brokerageEur: 0, totalEur: 0, landedCostEur: 0, effectiveLandedCostEur: 0, vatRecoverableEur: 0, entrySummaryDeclarationEur: 0 },
      tradeDefenceMeasures: [
        { type: 'CVD', rateTypicalPct: 17.2, citation: 'Reg. B' },
        { type: 'AD', rateTypicalPct: 70.1, citation: 'Reg. A' },
        { type: 'AD', rateTypicalPct: 22.5, citation: 'Reg. C' },
      ],
    },
  };
  const s = snap.extractSnapshot(plan);
  assert.deepEqual(
    s.customs.tradeDefence.map((m) => m.type + ':' + m.ratePct),
    ['AD:70.1', 'AD:22.5', 'CVD:17.2']
  );
});

test('extractSnapshot: compliance.ids derive from regime.id (canonical) and sort alphabetically', () => {
  const plan = {
    ok: true,
    totals: {}, routing: null, customs: {ok:false}, tco: null, workingCapital: null, fx: null, originSensitivity: null,
    compliance: { regimes: [
      { id: 'REACH' },
      { id: 'CE_LVD_EMC_RED' },
      { id: 'WEEE' },
      { id: 'GPSR' },
    ]},
  };
  const s = snap.extractSnapshot(plan);
  assert.deepEqual(s.compliance.ids, ['CE_LVD_EMC_RED', 'GPSR', 'REACH', 'WEEE']);
  assert.equal(s.compliance.count, 4);
});

test('extractSnapshot: fx null when fx.ok is false', () => {
  const plan = {
    ok: true,
    totals: {}, routing: null, customs: {ok:false}, compliance: {regimes:[]}, tco: null, workingCapital: null, originSensitivity: null,
    fx: { ok: false, currency: 'EUR' },
  };
  const s = snap.extractSnapshot(plan);
  assert.equal(s.fx, null);
});

// ── sortedStringify ───────────────────────────────────

test('sortedStringify: emits keys in alphabetical order with trailing newline', () => {
  const s = snap.sortedStringify({ z: 1, a: { y: 2, b: 3 } });
  // First key after the opening brace must be `a`
  assert.match(s, /^{\n  "a": /);
  // Trailing newline so POSIX text-file tools play nicely.
  assert.ok(s.endsWith('\n'));
  // Nested object also sorted
  assert.match(s, /"a": \{\n    "b": 3,\n    "y": 2\n  \}/);
});

// ── snapshotPath safety ───────────────────────────────

test('snapshotPath: rejects path traversal + bad slugs', () => {
  assert.throws(() => snap.snapshotPath('../oops'));
  assert.throws(() => snap.snapshotPath('with space'));
  assert.throws(() => snap.snapshotPath(''));
  // Valid slugs pass.
  assert.ok(snap.snapshotPath('polish-apparel-importer-from-china').endsWith('.json'));
});

// ── Per-scenario regression — the actual contract ────

for (const scenario of CORPUS) {
  test('regression: ' + scenario.slug, async () => {
    const plan = await startHandler.composePlan(scenario.inputs);
    const actual = snap.extractSnapshot(plan);
    const frozen = snap.loadSnapshot(scenario.slug);
    assert.ok(frozen, 'frozen snapshot not found for ' + scenario.slug);
    // Stringified-equal first — gives a clean unified message on drift.
    const actualStr = snap.sortedStringify(actual);
    const frozenStr = snap.sortedStringify(frozen);
    if (actualStr !== frozenStr) {
      const hint = '\nRun: node scripts/regression-snapshot.js --scenario ' + scenario.slug
        + '\nthen review + commit the JSON change alongside the calculator change.';
      assert.deepEqual(actual, frozen, 'snapshot drift on ' + scenario.slug + hint);
    }
  });
}

// ── CLI argument parser ───────────────────────────────

test('regression-snapshot CLI parser: --scenario / --diff / --help', () => {
  const { parseArgs } = require('../scripts/regression-snapshot');
  assert.deepEqual(parseArgs([]), { scenario: null, diff: false, help: false });
  assert.deepEqual(parseArgs(['--diff']), { scenario: null, diff: true, help: false });
  assert.deepEqual(parseArgs(['--scenario', 'foo-bar']), { scenario: 'foo-bar', diff: false, help: false });
  assert.deepEqual(parseArgs(['-s', 'baz']), { scenario: 'baz', diff: false, help: false });
  assert.deepEqual(parseArgs(['-h']), { scenario: null, diff: false, help: true });
});

// ── Sentinel: /examples/* page slugs must all be in the corpus ─

test('sentinel: every /examples/<slug>/ directory has a matching corpus entry', () => {
  const examplesDir = path.join(__dirname, '..', 'examples');
  if (!fs.existsSync(examplesDir)) return; // dev tree without examples — skip
  const dirSlugs = fs.readdirSync(examplesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((s) => s !== 'index.html'); // defensive
  const corpusSet = new Set(SLUGS);
  const missing = dirSlugs.filter((s) => !corpusSet.has(s));
  assert.deepEqual(missing, [], 'these /examples/* pages have no regression coverage: ' + missing.join(', '));
});
