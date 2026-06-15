'use strict';

// Source-level drift-guard tests for the wizard Tier-A + goods-master-
// inheritance pills (marketing-shell/components/marketing/wizard.tsx).
//
// The marketing-shell doesn't have a React test runner today. These
// tests read the source as text and assert structural invariants:
//   - the conditional render only fires when tier_a.eligible === true
//     (no false-positive pill on ineligible verdicts)
//   - the wording mirrors the email-template discipline from PR #92:
//     describes what eligibility MEANS and calls out the accuracy
//     guarantee as FORTHCOMING (Q1 2027, subject to binding) — never
//     claiming an active financial guarantee
//   - goods-master pill only fires when inheritance.matched === true
//   - both pills have aria-label + role=status (a11y floor)
//
// This is the same drift-guard shape test/start-i18n-tier-a.test.js
// uses on the email template.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const WIZARD_PATH = path.join(ROOT, 'marketing-shell', 'components', 'marketing', 'wizard.tsx');
const SRC = fs.readFileSync(WIZARD_PATH, 'utf8');

// ── Conditional rendering ─────────────────────────────────────────────

test('Tier-A pill is guarded by tierA?.eligible === true', () => {
  // The pill JSX must be wrapped in {tierA?.eligible === true && ...}
  // — never just {tierA && ...} (which would render on eligible:false).
  assert.match(
    SRC,
    /tierA\?\.eligible === true && \(/,
    'Tier-A pill render must check eligible === true explicitly',
  );
});

test('Goods-master pill is guarded by inheritance.matched === true', () => {
  assert.match(
    SRC,
    /inheritance && inheritance\.matched && \(/,
    'Inheritance pill must check matched explicitly, not just inheritance presence',
  );
});

// ── Wording discipline (mirrors PR #92's email-template rules) ────────

test('Tier-A pill tooltip calls out the accuracy guarantee as FORTHCOMING (Q1 2027)', () => {
  // Lifted from PR #92's email-template drift guard. The customer-
  // facing wording MUST mark the liability-bearing guarantee as
  // not-yet-bound. A bare "backed by our guarantee" claim is
  // false marketing until E&O insurance binds (target Q1 2027).
  const match = SRC.match(/title="This duty calculation[^"]+"/);
  assert.ok(match, 'Tier-A pill must carry an explanatory title attribute');
  const tooltip = match[0];
  assert.match(tooltip, /Q1 2027/, 'tooltip must name Q1 2027 as the guarantee launch date');
  assert.match(tooltip, /subject to binding|forthcoming|launches/i, 'tooltip must call out the guarantee as forthcoming');
  assert.match(tooltip, /transparency signal|not a financial guarantee/i, 'tooltip must clarify Tier-A is a transparency signal, not a guarantee');
});

test('no prohibited active-guarantee phrasing in the Tier-A pill tooltip', () => {
  const match = SRC.match(/title="This duty calculation[^"]+"/);
  assert.ok(match);
  const tooltip = match[0];
  const prohibited = [
    /\bguaranteed\b accuracy/i,
    /backed by .* guarantee\b(?! launches| subject to binding| starting Q1 2027)/i,
    /money[- ]back/i,
    /we will refund/i,
  ];
  for (const re of prohibited) {
    assert.doesNotMatch(tooltip, re, `tooltip contains a prohibited active-guarantee phrase matching ${re}`);
  }
});

// ── Accessibility floor ───────────────────────────────────────────────

test('Tier-A pill carries role="status" and an aria-label', () => {
  // Screen-reader floor: pills must announce themselves as status
  // updates with a meaningful label.
  // Pull the Tier-A pill block — between the eligible-check and its
  // closing </span> — and assert both attrs are present.
  const pillMatch = SRC.match(/tierA\?\.eligible === true && \([\s\S]*?<\/span>\s*\)/);
  assert.ok(pillMatch, 'Tier-A pill block not located');
  assert.match(pillMatch[0], /role="status"/);
  // Aria-label updated from "Tier-A · underwriter-grade calculation"
  // when the sourcing pill landed (PR #112) — both pills now name their
  // calculator domain so screen readers can tell them apart.
  assert.match(pillMatch[0], /aria-label="Tier-A · underwriter-grade duty calculation"/);
});

test('Goods-master pill carries role="status" and an aria-label', () => {
  const pillMatch = SRC.match(/inheritance && inheritance\.matched && \([\s\S]*?<\/span>\s*\)/);
  assert.ok(pillMatch, 'Goods-master pill block not located');
  assert.match(pillMatch[0], /role="status"/);
  assert.match(pillMatch[0], /aria-label=\{`Inherited from your goods master/);
});

// ── Data flow ─────────────────────────────────────────────────────────

test('the /api/start response is captured and threaded through to PlanResult', () => {
  // submit() must call setPlanResponse(json) before setStatus('success'),
  // and PlanResult's signature must accept the planResponse prop.
  assert.match(SRC, /setPlanResponse\(json\);[\s\S]*?setStatus\('success'\)/);
  assert.match(SRC, /function PlanResult\(\{ data, planResponse \}/);
  assert.match(SRC, /<PlanResult data=\{data\} planResponse=\{planResponse\} \/>/);
});

test('TypeScript type StartResponse only types fields the component reads (no over-typing)', () => {
  // Catches the regression where someone adds the full plan shape to
  // the wizard type. The wizard reads tier_a + goodsMasterInheritance
  // only — the rest of the plan response is bagged as opaque.
  const typeMatch = SRC.match(/type StartResponse = \{[\s\S]*?\n\};/);
  assert.ok(typeMatch, 'StartResponse type not located');
  const block = typeMatch[0];
  assert.match(block, /tier_a\?: TierAVerdict/);
  assert.match(block, /goodsMasterInheritance\?: GoodsMasterInheritance/);
});

// ── No regression on the success state base case ──────────────────────

test('PlanResult still renders "The plan is on its way to {data.email}" when no signals are set', () => {
  assert.match(SRC, /The plan is on its way to \{data\.email\}\./);
  // And the Summary grid (Origin / Destination / Customs value) is
  // still present after the pills block.
  assert.match(SRC, /<Summary[\s\S]*kicker="Origin"/);
});
