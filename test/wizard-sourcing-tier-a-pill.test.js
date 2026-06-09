'use strict';

// Source-level drift-guard tests for the wizard sourcing Tier-A pill.
// Mirrors test/wizard-tier-a-pills.test.js (which pinned the customs
// pill from PR #98) — same shape, calculator-specific assertions.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const WIZARD_PATH = path.join(ROOT, 'marketing-shell', 'components', 'marketing', 'wizard.tsx');
const SRC = fs.readFileSync(WIZARD_PATH, 'utf8');

// ── Conditional rendering ─────────────────────────────────────────────

test('sourcing pill is guarded by sourcingTierA?.eligible === true', () => {
  // Must be the EXACT-equality check, not a loose truthy. A loose
  // check would render on `eligible:false` verdicts where
  // sourcingTierA is truthy but eligible is false.
  assert.match(
    SRC,
    /sourcingTierA\?\.eligible === true && \(/,
    'Sourcing pill must check eligible === true explicitly',
  );
});

test('customs pill still guarded by tierA?.eligible === true (no regression on PR #98)', () => {
  assert.match(SRC, /tierA\?\.eligible === true && \(/);
});

test('the outer wrapper renders when ANY of the eligible signals is present', () => {
  // (customs eligible) OR (sourcing eligible) OR (later: routing eligible)
  // OR (inheritance matched) — collapsing to nothing when none are.
  // Match the customs + sourcing portion; later PRs may extend the OR-chain
  // (PR #115 added routing) without invalidating this regression guard.
  assert.match(
    SRC,
    /\(tierA\?\.eligible === true \|\| sourcingTierA\?\.eligible === true \|\|[^)]*inheritance\)/,
  );
});

// ── Wording discipline (mirrors PR #92/#98/#111) ─────────────────────

test('sourcing pill tooltip calls out the accuracy guarantee as FORTHCOMING (Q1 2027)', () => {
  const match = SRC.match(/title="This sourcing recommendation[^"]+"/);
  assert.ok(match, 'Sourcing pill must carry an explanatory title attribute');
  const tooltip = match[0];
  assert.match(tooltip, /Q1 2027/);
  assert.match(tooltip, /subject to binding|launches/i);
  assert.match(tooltip, /transparency signal|not a financial guarantee/i);
});

test('no prohibited active-guarantee phrasing in the sourcing pill tooltip', () => {
  const match = SRC.match(/title="This sourcing recommendation[^"]+"/);
  assert.ok(match);
  const tooltip = match[0];
  const prohibited = [
    /\bguaranteed\b accuracy/i,
    /backed by .* guarantee\b(?! launches| subject to binding| starting Q1 2027)/i,
    /money[- ]back/i,
    /we will refund/i,
  ];
  for (const re of prohibited) {
    assert.doesNotMatch(tooltip, re, `tooltip contains prohibited phrase matching ${re}`);
  }
});

test('sourcing pill tooltip names the calculator-specific subject (not "duty calculation")', () => {
  // Catches the regression where the customs pill is copy-pasted
  // without updating the subject — would silently say "duty
  // calculation" on a sourcing badge.
  const match = SRC.match(/title="This sourcing recommendation[^"]+"/);
  assert.ok(match);
  const tooltip = match[0];
  assert.match(tooltip, /sourcing recommendation/i);
  assert.match(tooltip, /sourcing calculator/i);
});

// ── Accessibility floor ──────────────────────────────────────────────

test('sourcing pill carries role="status" and a calculator-specific aria-label', () => {
  // Reuses the same role/label discipline as the customs pill.
  const pillMatch = SRC.match(/sourcingTierA\?\.eligible === true && \([\s\S]*?<\/span>\s*\)/);
  assert.ok(pillMatch, 'Sourcing pill block not located');
  assert.match(pillMatch[0], /role="status"/);
  assert.match(pillMatch[0], /aria-label="Tier-A · underwriter-grade sourcing comparison"/);
});

// ── Label discipline: pills are distinguishable ──────────────────────

test('customs pill label updated to "Tier-A · duty" (not the generic "underwriter-grade")', () => {
  // When both pills render together, generic-vs-generic labels lose
  // information. Each pill names its calculator domain so the user
  // can tell them apart.
  assert.match(SRC, /Tier-A · duty\s*</);
});

test('sourcing pill label is "Tier-A · sourcing" (matches the customs label discipline)', () => {
  assert.match(SRC, /Tier-A · sourcing\s*</);
});

// ── Data flow ────────────────────────────────────────────────────────

test('sourcing tier_a is captured in PlanResult and threaded from planResponse', () => {
  // The destructuring must use the optional-chain pattern so a missing
  // sourcing sub-block doesn't throw.
  assert.match(SRC, /sourcingTierA = planResponse\?\.plan\?\.sourcing\?\.tier_a \?\? null/);
});

test('StartResponse type extended to include sourcing tier_a (but stays narrow)', () => {
  // Catching the regression where someone widens the type to mirror
  // the full backend plan shape. The wizard only reads tier_a; the
  // type should stay minimal.
  const typeMatch = SRC.match(/type StartResponse = \{[\s\S]*?\n\};/);
  assert.ok(typeMatch);
  const block = typeMatch[0];
  assert.match(block, /sourcing\?: \{ tier_a\?: TierAVerdict \| null \}/);
  // Existing customs entry preserved.
  assert.match(block, /customs\?: \{ tier_a\?: TierAVerdict \| null \}/);
});

// ── Render-order parity: customs before sourcing (mirrors email PR #111) ─

test('customs pill comes before sourcing pill in document order', () => {
  // Same ordering as the email template (PR #111): customs first
  // (load-bearing for landed-cost decisions), then sourcing.
  const customsBlock = SRC.indexOf("tierA?.eligible === true && (");
  const sourcingBlock = SRC.indexOf("sourcingTierA?.eligible === true && (");
  assert.ok(customsBlock >= 0 && sourcingBlock >= 0, 'both pill blocks must exist');
  assert.ok(
    customsBlock < sourcingBlock,
    'customs pill must come before sourcing pill in the source',
  );
});

// ── No regression on the goods-master inheritance pill ───────────────

test('inheritance pill still renders alongside the two Tier-A pills (no regression on PR #98)', () => {
  assert.match(SRC, /inheritance && inheritance\.matched && \(/);
});
