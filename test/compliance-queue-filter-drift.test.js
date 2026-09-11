'use strict';

// Drift-guard for the compliance queue filter — sprint 8 ch 2.
//
// The filter helpers live in app-shell/lib/api.ts (TS-only, can't be
// imported directly by node:test). We pin the taxonomy + the filter
// branches via regex reads on the source so a future PR that adds a
// new filter value MUST also extend matchesComplianceFilter and the
// pretty-label switch.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const API_TS_SRC = fs.readFileSync(
  path.join(ROOT, 'app-shell', 'lib', 'api.ts'),
  'utf8',
);

// ── COMPLIANCE_QUEUE_FILTERS taxonomy ────────────────────────────────

test('COMPLIANCE_QUEUE_FILTERS exposes the v1 filter values', () => {
  const block = API_TS_SRC.match(
    /COMPLIANCE_QUEUE_FILTERS:\s*ReadonlyArray<ComplianceQueueFilter>\s*=\s*Object\.freeze\(\[([\s\S]*?)\]\)/,
  );
  assert.ok(block, 'COMPLIANCE_QUEUE_FILTERS array not located in TS source');
  const found = new Set(
    [...block[1].matchAll(/'([a-z-]+)'/g)].map((m) => m[1]),
  );
  // Pin the v1 set. Removing one of these is a breaking change that
  // breaks the queue UI's filter chips; adding new ones is fine
  // (extend the test to include them and the matches/label functions
  // below will gate the rest).
  for (const expected of ['all', 'cbam-in-scope', 'eudr-in-scope', 'reach-in-scope', 'verify', 'no-probes']) {
    assert.ok(found.has(expected), `COMPLIANCE_QUEUE_FILTERS must include '${expected}'`);
  }
});

test('ComplianceQueueFilter type-union contents match the COMPLIANCE_QUEUE_FILTERS array', () => {
  // The union is what gates the prop type; the array is what gets
  // rendered as chips. If a future PR adds a value to one but not
  // the other, the chip won't typecheck or won't render.
  const unionBlock = API_TS_SRC.match(
    /export type ComplianceQueueFilter =([\s\S]*?);\n/,
  );
  assert.ok(unionBlock, 'ComplianceQueueFilter union not located');
  const unionValues = new Set(
    [...unionBlock[1].matchAll(/'([a-z-]+)'/g)].map((m) => m[1]),
  );

  const arrayBlock = API_TS_SRC.match(
    /COMPLIANCE_QUEUE_FILTERS:\s*ReadonlyArray<ComplianceQueueFilter>\s*=\s*Object\.freeze\(\[([\s\S]*?)\]\)/,
  );
  const arrayValues = new Set(
    [...arrayBlock[1].matchAll(/'([a-z-]+)'/g)].map((m) => m[1]),
  );

  assert.deepEqual([...unionValues].sort(), [...arrayValues].sort());
});

// ── matchesComplianceFilter — every filter value has a branch ────────

test('matchesComplianceFilter has a case branch for every filter value', () => {
  // The function is a chain of `if (filter === '<value>')` statements.
  // A new filter value in the union without a matching branch falls
  // through to `return false` — so the chip would render but match
  // nothing. Catch that drift here.
  const fnBlock = API_TS_SRC.match(
    /export function matchesComplianceFilter\([\s\S]*?\): boolean \{([\s\S]*?)\n\}/,
  );
  assert.ok(fnBlock, 'matchesComplianceFilter not located');

  const arrayBlock = API_TS_SRC.match(
    /COMPLIANCE_QUEUE_FILTERS:\s*ReadonlyArray<ComplianceQueueFilter>\s*=\s*Object\.freeze\(\[([\s\S]*?)\]\)/,
  );
  const filterValues = [...arrayBlock[1].matchAll(/'([a-z-]+)'/g)].map((m) => m[1]);

  for (const v of filterValues) {
    const escaped = v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`filter === '${escaped}'`);
    assert.ok(
      re.test(fnBlock[1]),
      `matchesComplianceFilter is missing a branch for '${v}'`,
    );
  }
});

test('matchesComplianceFilter never silently returns true for an unknown filter', () => {
  // The function ends with `return false` so unknown filters are
  // suppressed (no items match). If a future refactor removes the
  // `return false` default we'd silently show all items for an
  // unknown filter — pin the safe-default DENY.
  const fnBlock = API_TS_SRC.match(
    /export function matchesComplianceFilter\([\s\S]*?\): boolean \{([\s\S]*?)\n\}/,
  );
  assert.ok(/return false;\n\}/.test(fnBlock[1] + '\n}'), 'matchesComplianceFilter must end with `return false`');
});

// ── complianceFilterLabel — pretty labels for every filter value ────

test('complianceFilterLabel has a case branch for every filter value', () => {
  const fnBlock = API_TS_SRC.match(
    /export function complianceFilterLabel\([\s\S]*?\): string \{([\s\S]*?)\n\}/,
  );
  assert.ok(fnBlock, 'complianceFilterLabel not located');

  const arrayBlock = API_TS_SRC.match(
    /COMPLIANCE_QUEUE_FILTERS:\s*ReadonlyArray<ComplianceQueueFilter>\s*=\s*Object\.freeze\(\[([\s\S]*?)\]\)/,
  );
  const filterValues = [...arrayBlock[1].matchAll(/'([a-z-]+)'/g)].map((m) => m[1]);

  for (const v of filterValues) {
    const escaped = v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`case '${escaped}'`);
    assert.ok(
      re.test(fnBlock[1]),
      `complianceFilterLabel is missing a case branch for '${v}' — it'd fall back to the raw enum string`,
    );
  }
});

test('matchesComplianceFilter and complianceFilterLabel pin the same filter set', () => {
  const matchFnBlock = API_TS_SRC.match(
    /export function matchesComplianceFilter\([\s\S]*?\): boolean \{([\s\S]*?)\n\}/,
  );
  const labelFnBlock = API_TS_SRC.match(
    /export function complianceFilterLabel\([\s\S]*?\): string \{([\s\S]*?)\n\}/,
  );
  assert.ok(matchFnBlock && labelFnBlock);

  const matchedFilters = new Set(
    [...matchFnBlock[1].matchAll(/filter === '([a-z-]+)'/g)].map((m) => m[1]),
  );
  const labeledFilters = new Set(
    [...labelFnBlock[1].matchAll(/case '([a-z-]+)'/g)].map((m) => m[1]),
  );
  // 'all' is special-cased on the match side via the early-return,
  // not via `filter === 'all'`. Inject it for the comparison.
  matchedFilters.add('all');
  assert.deepEqual([...matchedFilters].sort(), [...labeledFilters].sort());
});
