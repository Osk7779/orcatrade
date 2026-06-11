'use strict';

// Source-level drift-guard tests for the wizard warehouse Tier-A pill.
// Parallel to test/wizard-routing-tier-a-pill (PR #115) and
// test/wizard-finance-tier-a-pill (PR #117). Closes the pill-layer
// wedge at 5/5.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const WIZARD_PATH = path.join(ROOT, 'marketing-shell', 'components', 'marketing', 'wizard.tsx');
const SRC = fs.readFileSync(WIZARD_PATH, 'utf8');

// ── Conditional rendering ─────────────────────────────────────────────

test('warehouse pill is guarded by warehouseTierA?.eligible === true', () => {
  assert.match(SRC, /warehouseTierA\?\.eligible === true && \(/);
});

test('outer wrapper now renders when ANY of the six signals is present', () => {
  // customs + sourcing + routing + finance + warehouse + inheritance
  assert.match(
    SRC,
    /\(tierA\?\.eligible === true \|\| sourcingTierA\?\.eligible === true \|\| routingTierA\?\.eligible === true \|\| financeTierA\?\.eligible === true \|\| warehouseTierA\?\.eligible === true \|\| inheritance\)/,
  );
});

// ── Wording discipline (mirrors PR #92/#98/#111/#112/#115/#117) ──────

test('warehouse pill tooltip calls out the accuracy guarantee as FORTHCOMING (Q1 2027)', () => {
  const match = SRC.match(/title="This warehouse recommendation[^"]+"/);
  assert.ok(match, 'Warehouse pill must carry an explanatory title attribute');
  const tooltip = match[0];
  assert.match(tooltip, /Q1 2027/);
  assert.match(tooltip, /subject to binding|launches/i);
  assert.match(tooltip, /transparency signal|not a financial guarantee/i);
});

test('no prohibited active-guarantee phrasing in the warehouse pill tooltip', () => {
  const match = SRC.match(/title="This warehouse recommendation[^"]+"/);
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

test('warehouse pill tooltip names the calculator-specific subject (not duty/sourcing/routing/finance)', () => {
  const match = SRC.match(/title="This warehouse recommendation[^"]+"/);
  assert.ok(match);
  const tooltip = match[0];
  assert.match(tooltip, /warehouse recommendation/i);
  assert.match(tooltip, /warehouse calculator/i);
  assert.match(tooltip, /Eurostat warehousing producer-price indices/i);
  // Must not borrow the other calculators' subjects.
  assert.doesNotMatch(tooltip, /carrier-published rate indices/i);
  assert.doesNotMatch(tooltip, /EU TARIC live rates/i);
  assert.doesNotMatch(tooltip, /central-bank rate tables/i);
});

// ── Accessibility ────────────────────────────────────────────────────

test('warehouse pill carries role="status" and a calculator-specific aria-label', () => {
  const pillMatch = SRC.match(/warehouseTierA\?\.eligible === true && \([\s\S]*?<\/span>\s*\)/);
  assert.ok(pillMatch, 'Warehouse pill block not located');
  assert.match(pillMatch[0], /role="status"/);
  assert.match(pillMatch[0], /aria-label="Tier-A · underwriter-grade warehouse quote"/);
});

// ── Label discipline ────────────────────────────────────────────────

test('warehouse pill label is "Tier-A · warehouse" (mirrors customs/sourcing/routing/finance label discipline)', () => {
  assert.match(SRC, /Tier-A · warehouse\s*</);
});

// ── Data flow ─────────────────────────────────────────────────────────

test('warehouse tier_a is captured in PlanResult and threaded from planResponse', () => {
  // The optional chain handles BOTH plan.warehouse branches at
  // runtime (skipped → undefined; populated → verdict-or-null).
  assert.match(SRC, /warehouseTierA = planResponse\?\.plan\?\.warehouse\?\.tier_a \?\? null/);
});

test('StartResponse type extended to include warehouse tier_a (but stays narrow)', () => {
  const typeMatch = SRC.match(/type StartResponse = \{[\s\S]*?\n\};/);
  assert.ok(typeMatch);
  const block = typeMatch[0];
  assert.match(block, /warehouse\?: \{ tier_a\?: TierAVerdict \| null \}/);
  // Existing customs + sourcing + routing + finance entries preserved.
  assert.match(block, /customs\?: \{ tier_a\?: TierAVerdict \| null \}/);
  assert.match(block, /sourcing\?: \{ tier_a\?: TierAVerdict \| null \}/);
  assert.match(block, /routing\?: \{ tier_a\?: TierAVerdict \| null \}/);
  assert.match(block, /finance\?: \{ tier_a\?: TierAVerdict \| null \}/);
});

// ── Render-order parity (customs → sourcing → routing → finance →
//                         warehouse) ─────────────────────────────────

test('pill render order in the source: customs → sourcing → routing → finance → warehouse', () => {
  const customsBlock = SRC.indexOf("tierA?.eligible === true && (");
  const sourcingBlock = SRC.indexOf("sourcingTierA?.eligible === true && (");
  const routingBlock = SRC.indexOf("routingTierA?.eligible === true && (");
  const financeBlock = SRC.indexOf("financeTierA?.eligible === true && (");
  const warehouseBlock = SRC.indexOf("warehouseTierA?.eligible === true && (");
  assert.ok(
    customsBlock >= 0 && sourcingBlock >= 0 && routingBlock >= 0 && financeBlock >= 0 && warehouseBlock >= 0,
    'all five pill blocks must exist',
  );
  assert.ok(
    customsBlock < sourcingBlock &&
      sourcingBlock < routingBlock &&
      routingBlock < financeBlock &&
      financeBlock < warehouseBlock,
    `expected customs < sourcing < routing < finance < warehouse in document order, got: customs=${customsBlock} sourcing=${sourcingBlock} routing=${routingBlock} finance=${financeBlock} warehouse=${warehouseBlock}`,
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

test('finance pill still guarded by financeTierA?.eligible === true (no regression on PR #117)', () => {
  assert.match(SRC, /financeTierA\?\.eligible === true && \(/);
});

test('inheritance pill still renders alongside the five Tier-A pills (no regression on PR #98)', () => {
  assert.match(SRC, /inheritance && inheritance\.matched && \(/);
});
