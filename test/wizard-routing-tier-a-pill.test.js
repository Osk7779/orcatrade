'use strict';

// Source-level drift-guard tests for the wizard routing Tier-A pill.
// Parallel to test/wizard-sourcing-tier-a-pill (PR #112).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const WIZARD_PATH = path.join(ROOT, 'marketing-shell', 'components', 'marketing', 'wizard.tsx');
const SRC = fs.readFileSync(WIZARD_PATH, 'utf8');

// ── Conditional rendering ─────────────────────────────────────────────

test('routing pill is guarded by routingTierA?.eligible === true', () => {
  assert.match(SRC, /routingTierA\?\.eligible === true && \(/);
});

test('outer wrapper now renders when ANY of the four signals is present', () => {
  // customs eligible OR sourcing eligible OR routing eligible OR
  // inheritance matched.
  assert.match(
    SRC,
    /\(tierA\?\.eligible === true \|\| sourcingTierA\?\.eligible === true \|\| routingTierA\?\.eligible === true \|\| inheritance\)/,
  );
});

// ── Wording discipline (mirrors PR #92/#98/#111/#112) ────────────────

test('routing pill tooltip calls out the accuracy guarantee as FORTHCOMING (Q1 2027)', () => {
  const match = SRC.match(/title="This routing recommendation[^"]+"/);
  assert.ok(match, 'Routing pill must carry an explanatory title attribute');
  const tooltip = match[0];
  assert.match(tooltip, /Q1 2027/);
  assert.match(tooltip, /subject to binding|launches/i);
  assert.match(tooltip, /transparency signal|not a financial guarantee/i);
});

test('no prohibited active-guarantee phrasing in the routing pill tooltip', () => {
  const match = SRC.match(/title="This routing recommendation[^"]+"/);
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

test('routing pill tooltip names the calculator-specific subject (not duty/sourcing)', () => {
  const match = SRC.match(/title="This routing recommendation[^"]+"/);
  assert.ok(match);
  const tooltip = match[0];
  assert.match(tooltip, /routing recommendation/i);
  assert.match(tooltip, /routing calculator/i);
  assert.match(tooltip, /carrier-published rate indices/i);
});

// ── Accessibility ────────────────────────────────────────────────────

test('routing pill carries role="status" and a calculator-specific aria-label', () => {
  const pillMatch = SRC.match(/routingTierA\?\.eligible === true && \([\s\S]*?<\/span>\s*\)/);
  assert.ok(pillMatch, 'Routing pill block not located');
  assert.match(pillMatch[0], /role="status"/);
  assert.match(pillMatch[0], /aria-label="Tier-A · underwriter-grade freight quote"/);
});

// ── Label discipline ────────────────────────────────────────────────

test('routing pill label is "Tier-A · routing" (mirrors customs and sourcing label discipline)', () => {
  assert.match(SRC, /Tier-A · routing\s*</);
});

// ── Data flow ─────────────────────────────────────────────────────────

test('routing tier_a is captured in PlanResult and threaded from planResponse', () => {
  assert.match(SRC, /routingTierA = planResponse\?\.plan\?\.routing\?\.tier_a \?\? null/);
});

test('StartResponse type extended to include routing tier_a (but stays narrow)', () => {
  const typeMatch = SRC.match(/type StartResponse = \{[\s\S]*?\n\};/);
  assert.ok(typeMatch);
  const block = typeMatch[0];
  assert.match(block, /routing\?: \{ tier_a\?: TierAVerdict \| null \}/);
  // Existing customs + sourcing entries preserved.
  assert.match(block, /customs\?: \{ tier_a\?: TierAVerdict \| null \}/);
  assert.match(block, /sourcing\?: \{ tier_a\?: TierAVerdict \| null \}/);
});

// ── Render-order parity (customs → sourcing → routing) ───────────────

test('pill render order in the source: customs → sourcing → routing', () => {
  const customsBlock = SRC.indexOf("tierA?.eligible === true && (");
  const sourcingBlock = SRC.indexOf("sourcingTierA?.eligible === true && (");
  const routingBlock = SRC.indexOf("routingTierA?.eligible === true && (");
  assert.ok(customsBlock >= 0 && sourcingBlock >= 0 && routingBlock >= 0, 'all three pill blocks must exist');
  assert.ok(
    customsBlock < sourcingBlock && sourcingBlock < routingBlock,
    `expected customs < sourcing < routing in document order, got: customs=${customsBlock} sourcing=${sourcingBlock} routing=${routingBlock}`,
  );
});

// ── Regression guards ───────────────────────────────────────────────

test('customs pill still guarded by tierA?.eligible === true (no regression on PR #98)', () => {
  assert.match(SRC, /tierA\?\.eligible === true && \(/);
});

test('sourcing pill still guarded by sourcingTierA?.eligible === true (no regression on PR #112)', () => {
  assert.match(SRC, /sourcingTierA\?\.eligible === true && \(/);
});

test('inheritance pill still renders alongside the three Tier-A pills (no regression on PR #98)', () => {
  assert.match(SRC, /inheritance && inheritance\.matched && \(/);
});
