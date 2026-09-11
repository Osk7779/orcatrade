'use strict';

// Sprint 96 — the SLA commitment on the individual request.
//
// The attainment blocks aggregate; this puts the promise ON the
// request the customer is looking at: due time before quoting,
// verdict after — INCLUDING honest misses shown to the customer
// ("quoted in 52.0h — outside the 48h commitment. That miss is on
// us"). Publishing our own misses at the request level is the
// whole brand: the same truthfulness discipline as the ledger,
// applied where it stings.
//
// Load-bearing rules:
//   - ONE derivation, server-side (computeSlaCommitment in the
//     LLM-free calculator); the banner branches on state and
//     shows the sign — Date.now absence pinned on the component.
//   - Measured against the org's NEGOTIATED target (knob 6),
//     fail-open to the platform default.
//   - Terminal-without-quote → null (no commitment applies);
//     clock skew → null (never counted as instant — the
//     attainment rule).
//   - The augmentation NEVER fails the detail read.

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

const CREATED = '2026-07-01T00:00:00Z';
const CREATED_MS = Date.parse(CREATED);

// ── Calculator runtime ────────────────────────────────────────────

test('pending: unquoted inside the budget — remaining hours + due time', () => {
  const c = sla.computeSlaCommitment({
    createdAt: CREATED, quotedAt: null, status: 'processing',
    targetHours: 48, nowMs: CREATED_MS + 10 * 3_600_000,
  });
  assert.equal(c.state, 'pending');
  assert.equal(c.hoursRemaining, 38);
  assert.equal(c.targetHours, 48);
  assert.equal(c.dueAt, '2026-07-03T00:00:00.000Z');
});

test('overdue: unquoted past the budget — negative remaining', () => {
  const c = sla.computeSlaCommitment({
    createdAt: CREATED, status: 'awaiting_review',
    targetHours: 48, nowMs: CREATED_MS + 50 * 3_600_000,
  });
  assert.equal(c.state, 'overdue');
  assert.equal(c.hoursRemaining, -2);
});

test('met: quoted inside the target — boundary EXACTLY at target counts as met', () => {
  const met = sla.computeSlaCommitment({
    createdAt: CREATED, quotedAt: '2026-07-02T07:00:00Z', status: 'quoted', targetHours: 48,
  });
  assert.equal(met.state, 'met');
  assert.equal(met.quotedInHours, 31);
  const boundary = sla.computeSlaCommitment({
    createdAt: CREATED, quotedAt: '2026-07-03T00:00:00Z', status: 'quoted', targetHours: 48,
  });
  assert.equal(boundary.state, 'met', 'exactly 48.0h is inside the commitment');
});

test('missed: quoted past the target — the honest verdict', () => {
  const c = sla.computeSlaCommitment({
    createdAt: CREATED, quotedAt: '2026-07-03T04:00:00Z', status: 'quoted', targetHours: 48,
  });
  assert.equal(c.state, 'missed');
  assert.equal(c.quotedInHours, 52);
});

test('null when no commitment applies: terminal-without-quote, garbage stamps, clock skew', () => {
  for (const args of [
    { createdAt: CREATED, status: 'cancelled' },                       // terminal, never quoted
    { createdAt: CREATED, status: 'expired' },
    { createdAt: 'garbage', status: 'processing' },
    { createdAt: CREATED, quotedAt: '2026-06-30T00:00:00Z', status: 'quoted' },  // skew: quoted before created
  ]) {
    assert.equal(sla.computeSlaCommitment(args), null, JSON.stringify(args));
  }
});

test('the negotiated target flows through; garbage targets fall back to the platform default', () => {
  const negotiated = sla.computeSlaCommitment({
    createdAt: CREATED, quotedAt: '2026-07-02T07:00:00Z', status: 'quoted', targetHours: 24,
  });
  assert.equal(negotiated.state, 'missed', '31h against a negotiated 24h target is a miss');
  const fallback = sla.computeSlaCommitment({
    createdAt: CREATED, quotedAt: '2026-07-02T07:00:00Z', status: 'quoted', targetHours: 0,
  });
  assert.equal(fallback.targetHours, sla.SLA_QUOTE_TURNAROUND_TARGET_HOURS);
});

// ── Handler attachment ────────────────────────────────────────────

test('handleGet attaches slaCommitment against the org NEGOTIATED target, and never fails the read', () => {
  const block = HANDLER_SRC.match(/async function handleGet\([\s\S]*?\n\}/);
  assert.ok(block, 'handleGet not found');
  const body = block[0];
  assert.match(body, /slaCalc\.computeSlaCommitment\(\{/);
  assert.match(body, /targetHours: orgConfig\.slaQuoteTurnaroundTargetHours,/);
  assert.match(body, /quotedAt: r\.quotedAt,/);
  // Display augmentation only — a failure returns null, not a 500.
  assert.match(body, /catch \(_\) \{[\s\S]*?return null;/);
});

// ── TS + banner ───────────────────────────────────────────────────

test('TS mirror: ImportRequestSlaCommitment union of the four states + optional field', () => {
  assert.match(
    API_TS,
    /export interface ImportRequestSlaCommitment \{[\s\S]*?state: 'pending' \| 'overdue' \| 'met' \| 'missed';[\s\S]*?\}/,
  );
  assert.match(API_TS, /slaCommitment\?: ImportRequestSlaCommitment \| null;/);
});

test('the banner renders all four states from server numbers only — including the honest miss', () => {
  const banner = DETAIL_TSX.match(/function SlaCommitmentBanner\([\s\S]*?\n\}\n/)[0];
  assert.match(banner, /Quote due by/);
  assert.match(banner, /Quote overdue by/);
  assert.match(banner, /inside the \\?\$\{c\.targetHours\}h commitment/);
  // The miss is shown to the customer, owned in plain language.
  assert.match(banner, /That miss is on us, and it counts against our published attainment\./);
  // Sign-only rendering — the banner never recomputes time.
  assert.ok(!/Date\.now|new Date\(/.test(banner), 'the banner must not recompute time math');
  assert.match(banner, /data-testid="sla-commitment-banner"/);
  // Rendered near the top of the detail page, gated on presence.
  assert.match(DETAIL_TSX, /\{request\.slaCommitment && \(\s*\n\s*<SlaCommitmentBanner c=\{request\.slaCommitment\} \/>/);
});
