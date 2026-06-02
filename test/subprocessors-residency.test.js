'use strict';

// Phase 1 — apex III6 EU data residency.
//
// Pins the procurement-facing subprocessor + data-flow docs against
// the actual code. The original drift (caught in this PR):
//
//   * docs/security/subprocessors.md listed Neon + Sentry under
//     "Future / planned (not yet live)" months after they shipped.
//   * docs/security/data-flow.md listed Postgres as "*Planned in
//     Phase α*" with provider "(planned)".
//
// Both docs go to procurement reviewers. A reviewer who copies the
// "future" line into their internal questionnaire sees a different
// reality than what the platform actually does. This test makes the
// drift fail CI rather than fail a procurement conversation.
//
// Coverage:
//   - Neon must be in the Active table (because lib/db/client.js
//     requires DATABASE_URL and the dual-write code paths use it)
//   - Sentry must be in the Active table (because lib/log.js routes
//     errors to Sentry per the existing forwardToSentry path)
//   - Neither may appear in the Future/planned table
//   - The "EU data residency at a glance" summary section must exist
//     and name Anthropic + Resend as the documented non-EU outbound
//     flows (the load-bearing procurement claim)
//   - data-flow.md's storage-backends table must list Postgres as
//     "Live" (not "Planned")

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

// Extract the two named tables from subprocessors.md so we can assert
// against table membership precisely (a regex over the whole file
// could match "Neon" in either the Active or the Future table).

function extractSection(src, headerRegex, endHeaderRegex) {
  const start = src.search(headerRegex);
  assert.ok(start >= 0, `Section matching ${headerRegex} not found`);
  const tail = src.slice(start);
  const endIdx = tail.slice(1).search(endHeaderRegex);
  if (endIdx < 0) return tail;
  return tail.slice(0, endIdx + 1);
}

// ── subprocessors.md ────────────────────────────────────────────────

test('subprocessors.md Active table includes Neon (Postgres dual-write is live)', () => {
  const src = read('docs/security/subprocessors.md');
  const active = extractSection(src, /^## Active subprocessors/m, /^## /m);
  assert.match(
    active,
    /\bNeon\b/,
    'Neon must appear in the Active table — lib/db/client.js uses DATABASE_URL and the dual-write code paths are wired',
  );
});

test('subprocessors.md Active table includes Sentry (lib/log.js routes errors there)', () => {
  const src = read('docs/security/subprocessors.md');
  const active = extractSection(src, /^## Active subprocessors/m, /^## /m);
  assert.match(
    active,
    /\bSentry\b/,
    'Sentry must appear in the Active table — lib/log.js forwardToSentry is wired',
  );
});

test('subprocessors.md Future/planned table does NOT list Neon or Sentry', () => {
  const src = read('docs/security/subprocessors.md');
  const future = extractSection(src, /^## Future \/ planned/m, /^## /m);
  assert.doesNotMatch(
    future,
    /\bNeon\b/,
    'Neon is live; listing it as Future drifts the procurement-facing claim',
  );
  assert.doesNotMatch(
    future,
    /\bSentry\b/,
    'Sentry is live; listing it as Future drifts the procurement-facing claim',
  );
});

test('subprocessors.md has the "EU data residency at a glance" summary section', () => {
  const src = read('docs/security/subprocessors.md');
  assert.match(
    src,
    /^## EU data residency at a glance/m,
    'Procurement reviewers expect a one-paragraph residency claim; the absence of this section is the original procurement-blocker',
  );
});

test('the residency summary names every documented non-EU outbound flow', () => {
  // The load-bearing claim is "no persisted customer-data category
  // leaves the EU silently." For that to be true, every actual non-EU
  // flow must be in the table — and the table must be in the doc.
  // Pin the providers the procurement claim depends on.
  const src = read('docs/security/subprocessors.md');
  const summary = extractSection(src, /^## EU data residency at a glance/m, /^## /m);
  for (const provider of ['Anthropic', 'Resend', 'Stripe', 'GitHub']) {
    assert.ok(
      summary.includes(provider),
      `Outbound-flow table must name ${provider} as a documented data flow`,
    );
  }
  // The two cryptographic transfer-mechanism words customers look for.
  for (const mechanism of ['DPF', 'SCC']) {
    assert.ok(
      summary.includes(mechanism),
      `Outbound-flow table must name ${mechanism} as a transfer mechanism — auditors look for it explicitly`,
    );
  }
});

test('subprocessors.md cites ADR 0008 (email pseudonymisation) for the Neon row', () => {
  // The Neon row promises "email_hash, never raw email" — the
  // procurement-facing assertion that PG storage doesn't carry
  // raw PII. The binding rule is ADR 0008. Cross-reference it so
  // a future refactor of email handling can find the constraint.
  const src = read('docs/security/subprocessors.md');
  const active = extractSection(src, /^## Active subprocessors/m, /^## /m);
  // The Neon row mentions email_hash + cites ADR 0008.
  assert.match(active, /email_hash/);
  assert.match(active, /0008-email-pseudonymisation/);
});

// ── data-flow.md ────────────────────────────────────────────────────

test('data-flow.md storage-backends table lists Postgres as Live (not Planned)', () => {
  const src = read('docs/security/data-flow.md');
  // The "Planned" claim was the original drift. Assert the corrected
  // row mentions Live + names Neon as the provider.
  assert.doesNotMatch(
    src,
    /\*Planned in Phase α\*/,
    'Postgres is live; the "Planned in Phase α" claim is the drift this PR fixes',
  );
  assert.match(
    src,
    /Postgres[\s\S]{0,500}Live/,
    'The Postgres row must explicitly say "Live"',
  );
});

test('data-flow.md Postgres row names Neon as the provider (not "(planned)")', () => {
  const src = read('docs/security/data-flow.md');
  assert.doesNotMatch(
    src,
    /Neon \(planned\)/,
    'The "Neon (planned)" claim is the drift this PR fixes',
  );
});

// ── freshness: both docs should be reviewed within 365 days (P0.14
//     contract has its own version of this — duplicated here for the
//     two specific files this PR touches so the drift check is local)

test('subprocessors.md + data-flow.md Last-reviewed dates were touched in this PR', () => {
  // Sanity: a doc that drifts because no one reviewed it shouldn't
  // also have a stale review date. Both files explicitly bumped in
  // this PR.
  for (const f of ['docs/security/subprocessors.md', 'docs/security/data-flow.md']) {
    const src = read(f);
    const m = src.match(/Last reviewed[:\s\*]+(\d{4}-\d{2}-\d{2})/);
    assert.ok(m, `${f} must carry a Last reviewed date`);
    const ageDays = (Date.now() - Date.parse(m[1])) / (1000 * 60 * 60 * 24);
    assert.ok(
      ageDays < 365,
      `${f} Last reviewed ${m[1]} is too stale (${Math.floor(ageDays)} days)`,
    );
  }
});
