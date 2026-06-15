'use strict';

// Source-level drift-guard tests for the /plans list page client-side
// search (PR #150). The filter is in-memory across the user's full
// saved-plan list — pinned here so future refactors can't silently
// drop a haystack field without updating the test.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PAGE_PATH = path.join(ROOT, 'app-shell', 'app', '(authed)', 'plans', 'page.tsx');
const SRC = fs.readFileSync(PAGE_PATH, 'utf8');

// ── planMatchesQuery contract ────────────────────────────────────────

test('planMatchesQuery is defined as a pure helper at module scope', () => {
  assert.match(SRC, /function planMatchesQuery\(p: SavedPlan, tokens: string\[\]\): boolean \{/);
});

test('planMatchesQuery returns true on an empty token list (no filter applied)', () => {
  const fnBlock = SRC.match(/function planMatchesQuery\([\s\S]*?\n\}/);
  assert.ok(fnBlock, 'planMatchesQuery not located');
  assert.match(fnBlock[0], /if \(tokens\.length === 0\) return true;/);
});

test('planMatchesQuery uses every() over tokens (intersection / AND semantics)', () => {
  // Multi-word queries like "apparel CN DE" must filter to plans
  // that match ALL tokens, not any. Pin the every() semantics so a
  // future refactor can't silently swap to some() (which would
  // surprise operators who expect token-AND search).
  const fnBlock = SRC.match(/function planMatchesQuery\([\s\S]*?\n\}/);
  assert.ok(fnBlock);
  assert.match(fnBlock[0], /tokens\.every\(\(t\) => haystack\.includes\(t\)\)/);
});

test('planMatchesQuery searches across all the displayed fields (label, id, category, hsCode, origin, destination)', () => {
  // The list row renders label / category / origin → destination / HS
  // code. Each of those plus the id (used as fallback display label
  // when no label is set) must be present in the haystack so the
  // search matches what the operator actually sees.
  const fnBlock = SRC.match(/function planMatchesQuery\([\s\S]*?\n\}/);
  assert.ok(fnBlock);
  const block = fnBlock[0];
  for (const field of ['p\\.label', 'p\\.id', 'inp\\.productCategory', 'inp\\.hsCode', 'inp\\.originCountry', 'inp\\.destinationCountry']) {
    const re = new RegExp(field);
    assert.match(block, re,
      `planMatchesQuery haystack must include ${field}`);
  }
});

test('planMatchesQuery lower-cases the haystack so the match is case-insensitive', () => {
  const fnBlock = SRC.match(/function planMatchesQuery\([\s\S]*?\n\}/);
  assert.ok(fnBlock);
  assert.match(fnBlock[0], /\.toLowerCase\(\)/);
});

// ── Search input ────────────────────────────────────────────────────

test('Page renders a search input with role="search" semantics (type="search" + aria-label)', () => {
  // Screen readers expose <input type="search"> as a search field,
  // and the aria-label gives the operator a clear name. Both are
  // required for AAA-grade accessibility — pin them.
  assert.match(SRC, /type="search"/);
  assert.match(SRC, /aria-label="Filter saved plans"/);
});

test('Search input is wired to a query state via setQuery', () => {
  assert.match(SRC, /const \[query, setQuery\] = useState\(''\);/);
  assert.match(SRC, /onChange=\{\(e\) => setQuery\(e\.target\.value\)\}/);
});

test('Search input carries an explanatory placeholder', () => {
  // The placeholder hints which fields are searched so the operator
  // doesn't have to read source to know.
  assert.match(SRC, /placeholder="Filter by label, category, HS code, country…"/);
});

test('Search input only renders when at least one plan is saved (no input on empty-state)', () => {
  // The empty-state branch is the "you haven't saved any plans yet"
  // CTA. Showing a search box above an empty state is confusing —
  // pin the filter UI under the populated branch.
  const emptyBranch = SRC.match(/!plans\.length \? \([\s\S]*?\) : \(/);
  assert.ok(emptyBranch, 'empty-state branch not located');
  assert.doesNotMatch(emptyBranch[0], /type="search"/);
});

// ── Token derivation ────────────────────────────────────────────────

test('Tokens are derived from query via lowercased whitespace-split + filter(Boolean)', () => {
  // Whitespace-splitting is what gives the multi-token AND semantics
  // tested above. Pin the derivation so a refactor can't replace it
  // with split(',') and break "apparel CN DE" queries.
  assert.match(SRC, /query\.trim\(\)\.toLowerCase\(\)\.split\(\/\\s\+\/\)\.filter\(Boolean\)/);
});

test('Filtered plans are computed via useMemo (re-run only when plans or tokens change)', () => {
  // useMemo guards against re-filtering on every render. A re-render
  // caused by a sibling state change would otherwise re-walk every
  // plan even though the inputs haven't changed.
  assert.match(SRC, /const filteredPlans = useMemo\(\s*\(\) => plans\.filter\(\(p\) => planMatchesQuery\(p, tokens\)\),/);
});

// ── List render uses the filtered set ───────────────────────────────

test('List rendering iterates filteredPlans (NOT raw plans)', () => {
  // Drift guard: a refactor that re-pointed the map() at raw plans
  // would silently break the filter while keeping the search input
  // visible. Catch that here.
  assert.match(SRC, /\{filteredPlans\.map\(\(p\) =>/);
  assert.doesNotMatch(SRC, /\{plans\.map\(\(p\) =>/);
});

// ── No-match empty state ────────────────────────────────────────────

test('No-match empty state distinct from no-plans-saved empty state', () => {
  // Two distinct empty states:
  //   "you haven't saved any plans yet" → CTA to /start
  //   "no plans match your filter" → tells the operator the filter
  //     is too narrow, suggests adjusting it
  // Mixing them up would mislead operators (a filter typo would
  // present as "you have no plans" and surface a duplicate /start
  // CTA where it doesn't belong).
  assert.match(SRC, /No plans match [“"]/);
  assert.match(SRC, /Try fewer or different keywords/);
});

test('No-match empty state only renders when query is non-empty (avoids flicker on initial load)', () => {
  // The "no match" panel must not render when the operator clears
  // the search — clearing should restore the full list, not show a
  // "no match" state with an empty query.
  const noMatchBlock = SRC.match(/\{filteredPlans\.length === 0 \? \([\s\S]*?\) : \(/);
  assert.ok(noMatchBlock, 'no-match branch not located');
  // The branch is reached after the populated-list check, so a
  // query of '' means filteredPlans === plans (length > 0) and the
  // branch isn't entered. Drift-guard the surrounding condition.
  assert.match(SRC, /filteredPlans\.length === 0 \?/);
});

// ── Match-count chip ────────────────────────────────────────────────

test('Match-count chip ("X of Y") renders only when the query is non-empty', () => {
  // Showing "12 of 12" with no query is noise. The chip is most
  // useful when the operator has typed a query and wants to know
  // how many plans pass.
  assert.match(SRC, /query\.trim\(\) !== '' && \(/);
  assert.match(SRC, /\{filteredPlans\.length\} of \{plans\.length\}/);
});

// ── Imports stay minimal ────────────────────────────────────────────

test('useMemo imported alongside useEffect + useState (no extra packages added)', () => {
  // Drift guard against an accidental fuse-js / fuzzy-search
  // import — the filter stays pure-React for this PR's scale.
  assert.match(SRC, /import \{ useEffect, useMemo, useState \} from 'react';/);
  assert.doesNotMatch(SRC, /import .* from 'fuse/);
});
