'use strict';

// ADR 0016 follow-up — corpus-floor pin.
//
// The HS6 suggestion corpus is the load-bearing primitive behind
// (a) the wizard's "didn't enter an HS code" autocomplete, and
// (b) the agent's lookupHsCode tool (post PR #27 — see ADR 0016).
//
// The 2026-06-01 expansion grew the corpus 103 → 161 entries.
// This test floor-pins it so a future refactor can't accidentally
// shrink coverage below the new minimum. Same posture as
// test/docs-staleness.test.js's test-count floor — claims can
// grow upward but can't silently regress.
//
// Floors picked conservatively at 95% of current to leave room
// for any single-entry hygiene cleanup without test churn.

const test = require('node:test');
const assert = require('node:assert/strict');

const { HS_ENTRIES, suggest } = require('../lib/intelligence/data/hs-suggest');

const ENTRY_FLOOR = 150;
const CHAPTER_FLOOR = 35;

test(`HS_ENTRIES has at least ${ENTRY_FLOOR} entries (ADR 0016 corpus-floor pin)`, () => {
  assert.ok(
    HS_ENTRIES.length >= ENTRY_FLOOR,
    `HS_ENTRIES dropped to ${HS_ENTRIES.length} — below floor ${ENTRY_FLOOR}. Removing entries is allowed only when explicitly raising the floor in this test.`,
  );
});

test(`HS_ENTRIES covers at least ${CHAPTER_FLOOR} HS chapters`, () => {
  const chapters = new Set(HS_ENTRIES.map((e) => e.chapter));
  assert.ok(
    chapters.size >= CHAPTER_FLOOR,
    `Chapter coverage dropped to ${chapters.size} — below floor ${CHAPTER_FLOOR}. Reduction allowed only with floor adjustment.`,
  );
});

// ── known-good probes for the new entries ─────────────────────────
//
// Each new entry has a "you SHOULD have suggested me" plain-language
// query. The probe asserts the top suggestion includes the expected
// HS6. If a future refactor accidentally drops one of these from
// the corpus, the test names the missing entry.

const KNOWN_QUERIES = [
  // Food & beverage breadth
  ['oranges', '080510'],
  ['raisins', '080620'],
  ['cashew nuts', '080132'],
  ['tinned tuna', '160414'],
  ['tinned fish sardines', '160413'],
  ['pasta ready meal', '190230'],
  ['tomato ketchup', '210320'],
  ['ice cream', '210500'],
  ['instant coffee', '210112'],
  ['energy drink', '220290'],
  ['liqueur', '220870'],
  // Cosmetics fillout
  ['lipstick', '330410'],
  ['mascara', '330420'],
  ['deodorant', '330720'],
  ['toothpaste', '330610'],
  ['toothbrush', '960321'],
  // Pharma
  ['plasters bandages', '300510'],
  // PPE
  ['fabric face mask', '630790'],
  // Stationery
  ['marker highlighter', '960820'],
  ['binder folder', '482030'],
  // Books
  ['books novels', '490199'],
  // Tools
  ['spanner wrench', '820411'],
  ['socket ratchet', '820420'],
  ['electric saw', '846722'],
  // Sports + outdoor
  ['skis snow', '950611'],
  ['camping tent', '950699'],
  ['bicycle saddle', '871495'],
  // Beauty appliances
  ['hair dryer', '851631'],
  ['hair straightener', '851632'],
  ['coffee maker espresso', '851671'],
  ['toaster', '851672'],
];

for (const [query, expectedHs6] of KNOWN_QUERIES) {
  test(`suggest("${query}") returns ${expectedHs6} as the top match`, () => {
    const result = suggest(query, { limit: 3 });
    assert.ok(result.length > 0, `suggest("${query}") returned no candidates`);
    assert.equal(
      result[0].hs6,
      expectedHs6,
      `suggest("${query}") top candidate is ${result[0].hs6}, expected ${expectedHs6}`,
    );
  });
}
