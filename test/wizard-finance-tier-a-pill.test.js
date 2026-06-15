'use strict';

// Source-level drift-guard tests for the wizard finance Tier-A pill.
// Parallel to test/wizard-routing-tier-a-pill (PR #115).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const WIZARD_PATH = path.join(ROOT, 'marketing-shell', 'components', 'marketing', 'wizard.tsx');
const SRC = fs.readFileSync(WIZARD_PATH, 'utf8');

// ── Conditional rendering ─────────────────────────────────────────────

test('finance pill is guarded by financeTierA?.eligible === true', () => {
  assert.match(SRC, /financeTierA\?\.eligible === true && \(/);
});

test('outer wrapper renders when ANY of the eligible signals is present', () => {
  // customs OR sourcing OR routing OR finance OR (later: warehouse)
  // OR inheritance. Match the customs+sourcing+routing+finance
  // portion; later PRs may extend the OR-chain (PR #120 added
  // warehouse) without invalidating this regression guard.
  assert.match(
    SRC,
    /\(tierA\?\.eligible === true \|\| sourcingTierA\?\.eligible === true \|\| routingTierA\?\.eligible === true \|\| financeTierA\?\.eligible === true \|\|[^)]*inheritance\)/,
  );
});

// ── Wording discipline (mirrors PR #92/#98/#111/#112/#115) ──────────

test('finance pill tooltip calls out the accuracy guarantee as FORTHCOMING (Q1 2027)', () => {
  const match = SRC.match(/title="This financing recommendation[^"]+"/);
  assert.ok(match, 'Finance pill must carry an explanatory title attribute');
  const tooltip = match[0];
  assert.match(tooltip, /Q1 2027/);
  assert.match(tooltip, /subject to binding|launches/i);
  assert.match(tooltip, /transparency signal|not a financial guarantee/i);
});

test('no prohibited active-guarantee phrasing in the finance pill tooltip', () => {
  const match = SRC.match(/title="This financing recommendation[^"]+"/);
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

test('finance pill tooltip names the calculator-specific subject (not duty/sourcing/routing)', () => {
  const match = SRC.match(/title="This financing recommendation[^"]+"/);
  assert.ok(match);
  const tooltip = match[0];
  assert.match(tooltip, /financing recommendation/i);
  assert.match(tooltip, /finance calculator/i);
  assert.match(tooltip, /central-bank rate tables/i);
  // Must not borrow the other calculators' subjects.
  assert.doesNotMatch(tooltip, /carrier-published rate indices/i);
  assert.doesNotMatch(tooltip, /EU TARIC live rates/i);
});

// ── Accessibility ────────────────────────────────────────────────────

test('finance pill carries role="status" and a calculator-specific aria-label', () => {
  const pillMatch = SRC.match(/financeTierA\?\.eligible === true && \([\s\S]*?<\/span>\s*\)/);
  assert.ok(pillMatch, 'Finance pill block not located');
  assert.match(pillMatch[0], /role="status"/);
  assert.match(pillMatch[0], /aria-label="Tier-A · underwriter-grade financing recommendation"/);
});

// ── Label discipline ────────────────────────────────────────────────

test('finance pill label is "Tier-A · finance" (mirrors customs/sourcing/routing label discipline)', () => {
  assert.match(SRC, /Tier-A · finance\s*</);
});

// ── Data flow ─────────────────────────────────────────────────────────

test('finance tier_a is captured in PlanResult and threaded from planResponse', () => {
  assert.match(SRC, /financeTierA = planResponse\?\.plan\?\.finance\?\.tier_a \?\? null/);
});

test('StartResponse type extended to include finance tier_a (but stays narrow)', () => {
  const typeMatch = SRC.match(/type StartResponse = \{[\s\S]*?\n\};/);
  assert.ok(typeMatch);
  const block = typeMatch[0];
  assert.match(block, /finance\?: \{ tier_a\?: TierAVerdict \| null \}/);
  // Existing customs + sourcing + routing entries preserved.
  assert.match(block, /customs\?: \{ tier_a\?: TierAVerdict \| null \}/);
  assert.match(block, /sourcing\?: \{ tier_a\?: TierAVerdict \| null \}/);
  assert.match(block, /routing\?: \{ tier_a\?: TierAVerdict \| null \}/);
});

// ── Render-order parity (customs → sourcing → routing → finance) ────

test('pill render order in the source: customs → sourcing → routing → finance', () => {
  const customsBlock = SRC.indexOf("tierA?.eligible === true && (");
  const sourcingBlock = SRC.indexOf("sourcingTierA?.eligible === true && (");
  const routingBlock = SRC.indexOf("routingTierA?.eligible === true && (");
  const financeBlock = SRC.indexOf("financeTierA?.eligible === true && (");
  assert.ok(
    customsBlock >= 0 && sourcingBlock >= 0 && routingBlock >= 0 && financeBlock >= 0,
    'all four pill blocks must exist',
  );
  assert.ok(
    customsBlock < sourcingBlock && sourcingBlock < routingBlock && routingBlock < financeBlock,
    `expected customs < sourcing < routing < finance in document order, got: customs=${customsBlock} sourcing=${sourcingBlock} routing=${routingBlock} finance=${financeBlock}`,
  );
});

// ── Regression guards ───────────────────────────────────────────────

test('customs pill still guarded by tierA?.eligible === true (no regression on PR #98)', () => {
  assert.match(SRC, /tierA\?\.eligible === true && \(/);
});

test('sourcing pill still guarded by sourcingTierA?.eligible === true (no regression on PR #112)', () => {
  assert.match(SRC, /sourcingTierA\?\.eligible === true && \(/);
});

test('routing pill still guarded by routingTierA?.eligible === true (no regression on PR #115)', () => {
  assert.match(SRC, /routingTierA\?\.eligible === true && \(/);
});

test('inheritance pill still renders alongside the four Tier-A pills (no regression on PR #98)', () => {
  assert.match(SRC, /inheritance && inheritance\.matched && \(/);
});
