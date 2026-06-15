'use strict';

// Drift guard for the Implementation summary table in
// docs/adr/0020-tier-a-confidence-definition.md.
//
// The table is the customer-facing record of which calculators
// have shipped which Tier-A layers. A future PR that ships another
// calculator's surface without updating the ADR table — or that
// silently removes a shipped surface — must fail CI.
//
// Mirrors the philosophy of test/tier-a-adr-reasons-drift.test.js:
// the ADR is treated as code, not documentation. Big-corp standard:
// promise = enforcement.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const ADR_PATH = path.join(ROOT, 'docs', 'adr', '0020-tier-a-confidence-definition.md');
const STAMP_PATH = path.join(ROOT, 'scripts', 'tier-a-stamp.js');

const ADR_SRC = fs.readFileSync(ADR_PATH, 'utf8');

// The five calculators that ship Tier-A surface. Source of truth is
// scripts/tier-a-stamp.js's CALCULATORS list (which the TA-3
// last-green stamp job iterates).
const stampScript = require(path.join(ROOT, 'scripts', 'tier-a-stamp'));

// The four layers the ADR's Implementation summary table enumerates.
const LAYERS = Object.freeze([
  'Foundation',
  'Composer',
  'Email badge',
  'Wizard pill',
]);

// ── Section + table presence ─────────────────────────────────────────

test('ADR 0020 has an Implementation summary section', () => {
  assert.match(ADR_SRC, /## Implementation summary\n/);
});

test('Implementation summary states the wedge is complete (5/5/5/5)', () => {
  // The narrative line above the table — read by a customer or
  // auditor scanning the ADR without parsing markdown tables.
  assert.match(
    ADR_SRC,
    /5 calculators × 4 layers = 20 surfaces, all shipped/,
  );
});

// ── Calculator columns ───────────────────────────────────────────────

test('Implementation summary table enumerates every calculator from scripts/tier-a-stamp.js CALCULATORS', () => {
  // Source-of-truth check: if a future PR adds a sixth calculator
  // to the stamp script's list but forgets the ADR, this fails.
  for (const calc of stampScript.CALCULATORS) {
    assert.ok(
      ADR_SRC.includes(calc),
      `Implementation summary missing calculator "${calc}" (present in scripts/tier-a-stamp.js CALCULATORS but not in the ADR table)`,
    );
  }
});

test('Implementation summary table contains exactly the five known calculators in its header row', () => {
  // Tightly pin the header row so a future PR adding a sixth
  // calculator can't just slip it into a footnote — it must
  // update the table proper.
  //
  // The table-header line is the markdown row that immediately
  // follows the section heading and the intro paragraph; locate
  // it by the | Layer | …  | pattern.
  const headerLine = ADR_SRC.match(/\| Layer \| ([^\n]+) \|/);
  assert.ok(headerLine, 'Implementation summary table header row not located');
  const cells = headerLine[1].split('|').map((s) => s.trim()).filter(Boolean);
  // Each cell is either a calculator name (possibly bolded) or
  // empty separator residue.
  const calcNames = cells
    .map((c) => c.replace(/\*\*/g, '').trim())
    .filter((c) => c.length > 0);
  assert.deepEqual(
    calcNames.sort(),
    [...stampScript.CALCULATORS].sort(),
    `Header-row calculators mismatch CALCULATORS list`,
  );
});

// ── Layer rows ───────────────────────────────────────────────────────

test('Implementation summary table has one row per layer (4 total)', () => {
  for (const layer of LAYERS) {
    // Each row begins with | **<layer>** ...
    const rowRe = new RegExp(`\\| \\*\\*${layer}\\*\\*[^\\n]+`);
    assert.match(
      ADR_SRC,
      rowRe,
      `Implementation summary missing row for layer "${layer}"`,
    );
  }
});

test('Every (calculator × layer) cell carries at least one PR-reference link', () => {
  // For each layer's row, every calculator column must reference a
  // PR shortlink ([prNNN][prNNN] form). A cell with em-dash or
  // "pending" is a drift signal — the ADR claimed the wedge was
  // 5/5/5/5 complete in its intro line.
  for (const layer of LAYERS) {
    const rowRe = new RegExp(`\\| \\*\\*${layer}\\*\\*[^\\n]*([^\\n]+)`);
    const row = ADR_SRC.match(rowRe);
    assert.ok(row, `Row for layer "${layer}" not located`);
    const cells = row[0].split('|').slice(2).map((c) => c.trim());
    // The first cell is the layer label (we already matched it);
    // the remaining cells are the per-calculator entries.
    const calcCells = cells.filter((c) => c.length > 0);
    // Five calculators → five cells in each row.
    assert.equal(
      calcCells.length,
      stampScript.CALCULATORS.length,
      `Row "${layer}" has ${calcCells.length} cells, expected ${stampScript.CALCULATORS.length}`,
    );
    for (const cell of calcCells) {
      assert.match(
        cell,
        /\[PR #\d+\]\[pr\d+\]/,
        `Row "${layer}" has a cell without a PR reference: "${cell}"`,
      );
    }
  }
});

// ── PR-link reference definitions exist ──────────────────────────────

test('Every PR shortlink reference [prN] used in the table has a definition at the bottom', () => {
  // Parse all [prNNN] references used in tables, then assert each
  // has a matching [prNNN]: https://… reference link at the bottom.
  // A missing definition would render as bare text in production.
  const inlineRefs = new Set(
    (ADR_SRC.match(/\]\[pr\d+\]/g) || []).map((s) => s.replace(/[\]\[]/g, '').trim()),
  );
  assert.ok(inlineRefs.size > 0, 'No inline [prN] references found');

  for (const ref of inlineRefs) {
    const defRe = new RegExp(`^\\[${ref}\\]: https://github\\.com/Osk7779/orcatrade/pull/`, 'm');
    assert.match(
      ADR_SRC,
      defRe,
      `Reference [${ref}] used but not defined at the bottom of the ADR`,
    );
  }
});

// ── Forthcoming-guarantee wording preserved ──────────────────────────

test('ADR 0020 still describes Tier-A as a transparency signal — accuracy guarantee is forthcoming', () => {
  // Critical pin: customer surfaces echo this language verbatim
  // (drift-guarded against ~10 places). The ADR is the upstream
  // source of truth for the wording — if the ADR drops the
  // forthcoming framing, the downstream guards lose their anchor.
  assert.match(ADR_SRC, /forthcoming/);
  assert.match(ADR_SRC, /Q1 2027/);
  // No "active guarantee" claim should sneak into the ADR itself.
  // (The downstream wording-discipline tests catch surfaces; this
  // catches the ADR.)
  assert.doesNotMatch(ADR_SRC, /\bguaranteed\b accuracy/i);
  assert.doesNotMatch(ADR_SRC, /money[- ]back guarantee/i);
});

// ── Operational-note table for primary-regulator gates ───────────────

test('ADR 0020 documents the per-calculator primary-regulator gate (what flips eligible:false → true)', () => {
  // Auditor due-diligence question: "Why does every Tier-A verdict
  // currently return eligible:false?" The ADR must answer with
  // the per-calculator gate that, when satisfied, lights up
  // Tier-A in production.
  for (const calc of stampScript.CALCULATORS) {
    assert.ok(
      ADR_SRC.includes(`| ${calc} |`),
      `Operational-note table missing primary-regulator gate row for "${calc}"`,
    );
  }
  // Each gate row carries a status keyword. Pre-PR #132 every row
  // said "Pending integration"; PR #132 shipped the customs gate
  // so its row now reads "✅ [PR #132]". Either form is acceptable
  // here as long as one of the recognised status tokens is present.
  // Anchor the search on the operational-note heading and the next
  // top-level paragraph after the table.
  const gateBlock = ADR_SRC.match(/### Operational note[\s\S]*?(?=\n## |\n### |\n\[pr\d+\]:)/);
  assert.ok(gateBlock, 'Operational note section not located');
  assert.match(gateBlock[0], /Pending integration|✅/i,
    'expected at least one gate-status keyword (Pending integration or ✅) in the operational note');
});

test('Operational note marks customs-quote as the first gate that shipped (PR #132)', () => {
  // PR #132 was the first calculator-scoped primary-regulator gate to
  // land. The operational note's customs-quote row must reference
  // PR #132 so an auditor reading the ADR can verify which calculator
  // emits eligible:true verdicts in production today.
  //
  // Anchor inside the operational note section so we don't false-
  // match against the Implementation summary header row (which also
  // contains "customs-quote" as a column heading).
  const noteSection = ADR_SRC.match(/### Operational note[\s\S]*?(?=\n## |\n### |\n\[pr\d+\]:)/);
  assert.ok(noteSection, 'Operational note section not located');
  const customsRow = noteSection[0].match(/\| customs-quote \|[^\n]+/);
  assert.ok(customsRow, 'customs-quote row not located within operational note');
  assert.match(customsRow[0], /PR #132|pr132/i,
    `expected customs-quote row to reference PR #132; got: "${customsRow[0]}"`);
});

test('Operational note marks sourcing-quote as the second gate that shipped (PR #139)', () => {
  const noteSection = ADR_SRC.match(/### Operational note[\s\S]*?(?=\n## |\n### |\n\[pr\d+\]:)/);
  assert.ok(noteSection, 'Operational note section not located');
  const sourcingRow = noteSection[0].match(/\| sourcing-quote \|[^\n]+/);
  assert.ok(sourcingRow, 'sourcing-quote row not located within operational note');
  assert.match(sourcingRow[0], /PR #139|pr139/i);
});

test('Operational note marks finance-quote as the third gate that shipped (PR #141)', () => {
  // PR #141 shipped the third calculator-scoped primary-regulator
  // gate. ECB Statistical Data Warehouse FX reference rates back
  // the finance recommendation.
  const noteSection = ADR_SRC.match(/### Operational note[\s\S]*?(?=\n## |\n### |\n\[pr\d+\]:)/);
  assert.ok(noteSection, 'Operational note section not located');
  const financeRow = noteSection[0].match(/\| finance-quote \|[^\n]+/);
  assert.ok(financeRow, 'finance-quote row not located within operational note');
  assert.match(financeRow[0], /PR #141|pr141/i);
});

test('Operational note marks warehouse-quote as the fourth gate that shipped (PR #143)', () => {
  // PR #143 shipped the fourth calculator-scoped primary-regulator
  // gate. Eurostat warehousing-services PPI (NACE H52) backs the
  // warehouse hub-comparison.
  const noteSection = ADR_SRC.match(/### Operational note[\s\S]*?(?=\n## |\n### |\n\[pr\d+\]:)/);
  assert.ok(noteSection, 'Operational note section not located');
  const warehouseRow = noteSection[0].match(/\| warehouse-quote \|[^\n]+/);
  assert.ok(warehouseRow, 'warehouse-quote row not located within operational note');
  assert.match(warehouseRow[0], /PR #143|pr143/i);
});

test('Operational note marks routing-quote as the fifth (final) gate that shipped (PR #145)', () => {
  // PR #145 shipped the fifth and final calculator-scoped primary-
  // regulator gate. Eurostat water-transport-services PPI (NACE H50)
  // backs the routing/mode recommendation.
  const noteSection = ADR_SRC.match(/### Operational note[\s\S]*?(?=\n## |\n### |\n\[pr\d+\]:)/);
  assert.ok(noteSection, 'Operational note section not located');
  const routingRow = noteSection[0].match(/\| routing-quote \|[^\n]+/);
  assert.ok(routingRow, 'routing-quote row not located within operational note');
  assert.match(routingRow[0], /PR #145|pr145/i);
});

test('Operational note records that all five calculator-scoped primary-regulator gates ship', () => {
  // Post-PR #145, the wedge is structurally complete at the
  // calculator layer. The narrative must reflect that — "Pending
  // integration" rows are gone and the closing paragraph announces
  // the closure.
  const noteSection = ADR_SRC.match(/### Operational note[\s\S]*?(?=\n## |\n### |\n\[pr\d+\]:)/);
  assert.ok(noteSection, 'Operational note section not located');
  assert.doesNotMatch(noteSection[0], /Pending integration/i,
    'no row in the operational-note table should still read "Pending integration"');
  assert.match(ADR_SRC, /All five calculator-scoped primary-regulator gates/i,
    'closing paragraph must announce that all five gates ship at the calculator layer');
});

// ── Status line reflects the closure ─────────────────────────────────

test('ADR 0020 Status line references the shipped wedge (not "to be implemented")', () => {
  // Source-pin the header status update. A reader scanning only
  // the header should see "Implementation shipped" without diving
  // into the body.
  assert.match(ADR_SRC, /\*\*Status:\*\* Accepted · Implementation shipped/);
});

test('test exists for the script-level CALCULATORS source of truth used by this floor-test', () => {
  // The drift guards above use stampScript.CALCULATORS as the
  // source of truth. If that list ever moves to a different
  // module, this floor-test must move with it — flag here so a
  // future refactor catches the dependency.
  assert.ok(
    fs.existsSync(STAMP_PATH),
    'scripts/tier-a-stamp.js no longer exists — update this floor-test to point at the new CALCULATORS source',
  );
  assert.ok(
    Array.isArray(stampScript.CALCULATORS),
    'stampScript.CALCULATORS is no longer an array — update this floor-test',
  );
  assert.ok(
    stampScript.CALCULATORS.length >= 5,
    'CALCULATORS is shorter than the five known calculators — investigate before relaxing this test',
  );
});
