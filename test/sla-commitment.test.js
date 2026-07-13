'use strict';

// Sprint 96 — the SLA commitment on the individual request.
//
// The attainment blocks aggregate; this puts the promise ON the
// request the customer is looking at: due time before quoting,
// verdict after — INCLUDING honest misses shown to the customer
// ("quoted in 52.0h — outside the 48h commitment. That miss is on
// us"). The miss copy is the brand: a platform that publishes its
// own misses per-request is one whose "met" verdicts mean
// something.
//
// Load-bearing invariants:
//   - ONE derivation, server-side (computeSlaCommitment in the
//     SLA calculator — single source per ADR 0021); the banner
//     branches on state and shows the sign, never recomputes.
//   - Measured against the org's NEGOTIATED target (knob 6),
//     fail-open to the platform default.
//   - Boundary: turnaround EXACTLY at target = met (≤, matching
//     the attainment calculator's withinTargetPct rule — the
//     per-request verdict and the aggregate must agree on edges).
//   - Clock skew (quoted < created) → null, never "instant".
//   - Terminal-without-quote → null (no commitment applies).
//   - The augmentation NEVER fails the detail read (display-only
//     try/catch).
//
// Test layers:
//   1. Calculator runtime: all four states + boundary + void +
//      skew + garbage; injectable nowMs (no wall-clock coupling)
//   2. Handler attach pins (negotiated target, fail-open, inside
//      the augmented projection)
//   3. TS + banner pins (states, sign-only, honest-miss copy)

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sla = require('../lib/intelligence/sla');

const ROOT = path.resolve(__dirname, '..');
const HANDLER_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'handlers', 'imports.js'), 'utf8');
const API_TS = fs.readFileSync(path.join(ROOT, 'app-shell', 'lib', 'api.ts'), 'utf8');
const DETAIL_TSX = fs.readFileSync(
  path.join(ROOT, 'app-shell', 'app', '(authed)', 'imports', '[externalId]', 'page.tsx'),
  'utf8',
);

const T0 = Date.parse('2026-07-01T00:00:00Z');
const iso = (h) => new Date(T0 + h * 3_600_000).toISOString();

// ── Layer 1: calculator ──────────────────────────────────────────

test('pending: unquoted inside the budget — hoursRemaining positive, dueAt = created + target', () => {
  const c = sla.computeSlaCommitment({
    createdAt: iso(0), status: 'processing', targetHours: 48, nowMs: T0 + 10 * 3_600_000,
  });
  assert.equal(c.state, 'pending');
  assert.equal(c.hoursRemaining, 38);
  assert.equal(c.dueAt, iso(48));
  assert.equal(c.targetHours, 48);
});

test('overdue: unquoted past the budget — hoursRemaining goes NEGATIVE (the renderer shows the sign)', () => {
  const c = sla.computeSlaCommitment({
    createdAt: iso(0), status: 'awaiting_review', targetHours: 48, nowMs: T0 + 50 * 3_600_000,
  });
  assert.equal(c.state, 'overdue');
  assert.equal(c.hoursRemaining, -2);
});

test('met / missed: the verdict after quoting; EXACTLY at target = met (edge agrees with attainment ≤)', () => {
  const met = sla.computeSlaCommitment({ createdAt: iso(0), quotedAt: iso(31), targetHours: 48 });
  assert.deepEqual(
    { state: met.state, quotedInHours: met.quotedInHours },
    { state: 'met', quotedInHours: 31 },
  );
  const exact = sla.computeSlaCommitment({ createdAt: iso(0), quotedAt: iso(48), targetHours: 48 });
  assert.equal(exact.state, 'met', 'exactly-at-target must agree with the attainment ≤ rule');
  const missed = sla.computeSlaCommitment({ createdAt: iso(0), quotedAt: iso(52), targetHours: 48 });
  assert.equal(missed.state, 'missed');
  assert.equal(missed.quotedInHours, 52);
});

test('null cases: terminal-without-quote, clock skew, garbage stamps, missing createdAt', () => {
  for (const args of [
    { createdAt: iso(0), status: 'cancelled' },                       // commitment void
    { createdAt: iso(0), status: 'expired' },
    { createdAt: iso(10), quotedAt: iso(0) },                         // skew — never "instant"
    { createdAt: 'garbage', status: 'processing' },
    { status: 'processing' },
    {},
  ]) {
    assert.equal(sla.computeSlaCommitment(args), null, JSON.stringify(args));
  }
});

test('negotiated target respected; garbage target falls back to the platform constant', () => {
  const tight = sla.computeSlaCommitment({ createdAt: iso(0), quotedAt: iso(30), targetHours: 24 });
  assert.equal(tight.state, 'missed', 'a 24h contract makes 30h a miss');
  const fallback = sla.computeSlaCommitment({ createdAt: iso(0), quotedAt: iso(30), targetHours: 0 });
  assert.equal(fallback.targetHours, sla.SLA_QUOTE_TURNAROUND_TARGET_HOURS);
  assert.equal(fallback.state, 'met');
});

// ── Layer 2: handler attach ──────────────────────────────────────

test('handleGet derives the commitment against the NEGOTIATED target, display-only fail-open', () => {
  const block = HANDLER_SRC.match(/async function handleGet\([\s\S]*?\n\}/);
  assert.ok(block, 'handleGet not found');
  const body = block[0];
  assert.match(body, /slaCommitment: await \(async \(\) => \{/);
  assert.match(body, /operatorConfig\.getOperatorConfig\(ctx\.orgIdNumeric\)/);
  assert.match(body, /targetHours: orgConfig\.slaQuoteTurnaroundTargetHours,/);
  assert.match(body, /slaCalc\.computeSlaCommitment\(\{/);
  // The augmentation may NEVER fail the detail read.
  assert.match(body, /\/\/ Display augmentation only — never fail the detail read\./);
  assert.match(body, /return null;\s*\n\s*\}\s*\n\s*\}\)\(\),/);
});

// ── Layer 3: TS + banner ─────────────────────────────────────────

test('TS mirror: ImportRequestSlaCommitment union + ImportRequest field', () => {
  assert.match(
    API_TS,
    /export interface ImportRequestSlaCommitment \{[\s\S]*?state: 'pending' \| 'overdue' \| 'met' \| 'missed';[\s\S]*?\}/,
  );
  assert.match(API_TS, /slaCommitment\?: ImportRequestSlaCommitment \| null;/);
});

test('banner renders all four states sign-only and carries the honest-miss copy', () => {
  const card = DETAIL_TSX.match(/function SlaCommitmentBanner\([\s\S]*?\n\}\n/)[0];
  assert.match(card, /Quote due by /);
  assert.match(card, /Quote overdue by /);
  assert.match(card, /inside the /);
  assert.match(card, /outside the /);
  // The brand line: we publish our own misses, per-request.
  assert.match(card, /That miss is on us, and it counts against our published attainment\./);
  // Sign-only: Math.abs on the SERVER number, never time recomputation.
  assert.match(card, /Math\.abs\(Number\(c\.hoursRemaining\)\)/);
  assert.ok(!/Date\.now|new Date\(\)/.test(card), 'the banner must not recompute time');
  assert.match(card, /data-testid="sla-commitment-banner"/);
});

test('the banner mounts on the detail page, gated on the server-derived field', () => {
  assert.match(
    DETAIL_TSX,
    /\{request\.slaCommitment && \(\s*\n\s*<SlaCommitmentBanner c=\{request\.slaCommitment\} \/>\s*\n\s*\)\}/,
  );
});
