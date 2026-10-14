'use strict';

// Sprint 33 — immediate low-rating alert email.
//
// Tests cover four layers:
//   1. PREF_KEYS: importLowRatingAlertEmails added (PREF_KEYS shape
//      now 12 entries — 4 legacy + 6 sprint-24 + 1 sprint-26 + 1
//      sprint-33)
//   2. composeLowRatingAlert: subject + body shape varies on
//      isSupersession; star glyphs encode the score; comment is
//      HTML-escaped (XSS guard) when present + a coaching line
//      otherwise
//   3. sendLowRatingAlert: short-circuits on score > 2 (so the
//      caller can fire unconditionally); pref-gated per-recipient;
//      fail-soft on Resend partial failure
//   4. Handler integration: handlePostRating fires the alert
//      async with .catch wrapper after a successful rating record
//      AND only when score ≤ 2; passes isSupersession through to
//      the alert
//
// The fail-soft async fire is load-bearing — a Resend hiccup MUST
// NOT block the rating write. Drift-guard pins the .catch() wrapper
// at source.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const importsEmails = require('../lib/imports-emails');
const notificationPrefs = require('../lib/notification-prefs');

const ROOT = path.resolve(__dirname, '..');
const EMAILS_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'imports-emails.js'), 'utf8');
const HANDLER_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'handlers', 'imports.js'), 'utf8');
const DB_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'db', 'import-requests.js'), 'utf8');
const API_TS = fs.readFileSync(path.join(ROOT, 'app-shell', 'lib', 'api.ts'), 'utf8');
const PREFS_TSX = fs.readFileSync(
  path.join(ROOT, 'app-shell', 'app', '(authed)', 'preferences', 'page.tsx'),
  'utf8',
);

// ── PREF_KEYS surface ──────────────────────────────────────────────

test('PREF_KEYS includes importLowRatingAlertEmails', () => {
  assert.ok(
    notificationPrefs.PREF_KEYS.includes('importLowRatingAlertEmails'),
    'new pref key not added to PREF_KEYS',
  );
});

test('PREF_KEYS grew to at least 12 by sprint 33 (4 legacy + 6 sprint-24 + 1 sprint-26 + 1 sprint-33)', () => {
  // Lower-bound shape pin — sprint 39 added a 13th key
  // (importStalledQueueAlertEmails) and future sprints may add more.
  // The original-purpose check (presence of importLowRatingAlertEmails)
  // is covered by the test above; this one just asserts the cumulative
  // size hasn't shrunk silently.
  assert.ok(
    notificationPrefs.PREF_KEYS.length >= 12,
    `expected PREF_KEYS.length >= 12, found ${notificationPrefs.PREF_KEYS.length}`,
  );
});

// ── composeLowRatingAlert ──────────────────────────────────────────

test('composeLowRatingAlert renders { subject, text, html } for a 1-star rating', () => {
  const out = importsEmails.composeLowRatingAlert({
    request: { externalId: 'ir_low', label: 'My order', productDescription: 'LED grow lights' },
    rating: { score: 1, comment: 'Wrong product arrived', ratedAt: new Date().toISOString() },
  });
  assert.ok(typeof out.subject === 'string' && out.subject.length > 0);
  assert.ok(typeof out.text === 'string' && out.text.length > 0);
  assert.ok(typeof out.html === 'string' && out.html.length > 0);
  // Subject must surface the score so the inbox preview tells the story.
  assert.match(out.subject, /1★/);
  assert.match(out.subject, /My order/);
});

test('composeLowRatingAlert subject changes on supersession ("REVISED DOWN")', () => {
  const sup = importsEmails.composeLowRatingAlert({
    request: { externalId: 'ir_sup', label: 'Test' },
    rating: { score: 2, comment: '', ratedAt: new Date().toISOString() },
    isSupersession: true,
  });
  const first = importsEmails.composeLowRatingAlert({
    request: { externalId: 'ir_first', label: 'Test' },
    rating: { score: 2, comment: '', ratedAt: new Date().toISOString() },
    isSupersession: false,
  });
  assert.match(sup.subject, /REVISED DOWN/);
  assert.doesNotMatch(first.subject, /REVISED DOWN/);
});

test('composeLowRatingAlert star glyph encodes the score (★ × n + ☆ × (5-n))', () => {
  for (const score of [1, 2]) {
    const out = importsEmails.composeLowRatingAlert({
      request: { externalId: 'ir_x', label: 't' },
      rating: { score, ratedAt: '2026-06-17T10:00:00Z' },
    });
    const expected = '★'.repeat(score) + '☆'.repeat(5 - score);
    assert.ok(out.text.includes(expected), `score=${score}: expected glyph "${expected}" in body`);
  }
});

test('composeLowRatingAlert HTML-escapes the customer comment (XSS guard)', () => {
  const out = importsEmails.composeLowRatingAlert({
    request: { externalId: 'ir_xss', label: 'Test' },
    rating: { score: 1, comment: '<script>alert(1)</script>', ratedAt: '2026-06-17T10:00:00Z' },
  });
  assert.doesNotMatch(out.html, /<script>alert\(1\)<\/script>/);
  assert.match(out.html, /&lt;script&gt;/);
});

test('composeLowRatingAlert surfaces a coaching line when no comment was left', () => {
  // The "reach out anyway — the score is enough signal" copy is the
  // actionable nudge for the no-comment case. Pin it.
  const out = importsEmails.composeLowRatingAlert({
    request: { externalId: 'ir_nc', label: 'Test' },
    rating: { score: 2, ratedAt: '2026-06-17T10:00:00Z' },
  });
  assert.match(out.html, /Reach out anyway/);
});

// ── sendLowRatingAlert short-circuit ───────────────────────────────

test('sendLowRatingAlert short-circuits on score > 2 (returns reason="not-low-rating")', async () => {
  // The caller can fire unconditionally on every rating; the sender
  // is the chokepoint that gates on score ≤ 2. Pin the early return.
  const r = await importsEmails.sendLowRatingAlert({
    request: { externalId: 'ir_high', label: 't' },
    rating: { score: 4 },
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'not-low-rating');
});

test('sendLowRatingAlert rejects missing request or rating with the expected reason', async () => {
  const noReq = await importsEmails.sendLowRatingAlert({ rating: { score: 1 } });
  assert.equal(noReq.ok, false);
  assert.equal(noReq.reason, 'request required');
  const noRating = await importsEmails.sendLowRatingAlert({ request: { externalId: 'ir_x' } });
  assert.equal(noRating.ok, false);
  assert.equal(noRating.reason, 'rating required');
});

test('sendLowRatingAlert pref-gates per-recipient via importLowRatingAlertEmails', () => {
  // filterMutedRecipients is the shared sprint-24 chokepoint; pin
  // the call AND the pref-key argument.
  const block = EMAILS_SRC.match(/async function sendLowRatingAlert\([\s\S]*?\n\}/);
  assert.ok(block, 'sendLowRatingAlert body not located');
  assert.match(block[0], /filterMutedRecipients\(resolution\.recipients, ['"]importLowRatingAlertEmails['"]\)/);
});

test('sendLowRatingAlert is fail-soft on partial Resend failure (logs warn, does NOT throw)', () => {
  // log.warn on partial failure → match sprint-26 digest posture.
  const block = EMAILS_SRC.match(/async function sendLowRatingAlert\([\s\S]*?\n\}/);
  assert.ok(block);
  assert.match(block[0], /log\.warn\(['"]sendLowRatingAlert partial failure['"]/);
});

// ── recordCustomerRating exposes isSupersession ────────────────────

test('recordCustomerRating success path returns isSupersession (so the handler can branch the email)', () => {
  // The data-layer captures isSupersession BEFORE the UPDATE (sprint
  // 30); sprint 33 exposes it on the return so the handler can pass
  // it to the alert composer for the "REVISED DOWN" subject copy.
  const block = DB_SRC.match(/async function recordCustomerRating\([\s\S]*?\n\}/);
  assert.ok(block, 'recordCustomerRating body not located');
  assert.match(block[0], /return \{ ok: true, importRequest, rating, isSupersession \}/);
});

// ── Handler integration ───────────────────────────────────────────

test('handlePostRating fires sendLowRatingAlert ONLY when result.rating.score ≤ 2', () => {
  // The gate is BOTH in the handler (avoids the .catch wrapper
  // firing for happy ratings) AND in the sender (defense-in-depth).
  // Pin the handler-side score guard.
  const block = HANDLER_SRC.match(/async function handlePostRating\([\s\S]*?\n\}/);
  assert.ok(block, 'handlePostRating body not located');
  assert.match(block[0], /result\.rating && result\.rating\.score <= 2/);
});

test('handlePostRating fires sendLowRatingAlert async with .catch wrapper (fail-soft)', () => {
  // Resend hiccup MUST NOT block the rating write. The async-fire
  // .catch pattern matches every other operator-wedge sender.
  const block = HANDLER_SRC.match(/async function handlePostRating\([\s\S]*?\n\}/);
  assert.ok(block);
  const body = block[0];
  // sendLowRatingAlert called WITHOUT await
  assert.match(body, /importsEmails\.sendLowRatingAlert\(\{[\s\S]*?\}\)\.catch\(/);
});

test('handlePostRating passes isSupersession from the data-layer result to the alert', () => {
  // Without this, every alert would say "first rating" — losing
  // the load-bearing "REVISED DOWN" subject copy.
  const block = HANDLER_SRC.match(/async function handlePostRating\([\s\S]*?\n\}/);
  assert.ok(block);
  assert.match(block[0], /isSupersession: result\.isSupersession === true/);
});

test('handlePostRating still returns the 201 success response immediately (alert is fire-and-forget)', () => {
  // The 201 response with { ok, importRequest, rating } must not
  // wait on the alert. Pin the order.
  const block = HANDLER_SRC.match(/async function handlePostRating\([\s\S]*?\n\}/);
  assert.ok(block);
  const body = block[0];
  const alertIdx = body.search(/sendLowRatingAlert/);
  const responseIdx = body.search(/return jsonResponse\(res, 201/);
  assert.ok(alertIdx > -1 && responseIdx > alertIdx,
    'sendLowRatingAlert must fire BEFORE the 201 response (so the .catch is registered) but must not block it');
});

// ── TS mirror + UI ────────────────────────────────────────────────

test('Prefs TS interface carries importLowRatingAlertEmails', () => {
  assert.match(API_TS, /importLowRatingAlertEmails\?:\s*boolean/);
});

test('/preferences page surfaces the low-rating-alert toggle in the Ops inbox group', () => {
  // The toggle must live in the Ops group (only admins/owners get
  // the alert). Pin placement before the Saved-plan group.
  const toggleIdx = PREFS_TSX.indexOf("'importLowRatingAlertEmails'");
  const opsIdx = PREFS_TSX.indexOf("'Ops inbox'");
  const legacyIdx = PREFS_TSX.indexOf("'Saved-plan emails'");
  assert.ok(toggleIdx > -1 && opsIdx > -1 && legacyIdx > -1);
  assert.ok(opsIdx < toggleIdx && toggleIdx < legacyIdx,
    'importLowRatingAlertEmails toggle must live in the Ops inbox group');
});

test('/preferences low-rating-alert label + description name the 24-hour outreach window', () => {
  // The pref copy makes the actionable signal explicit: a 1-2★
  // rating left unanswered for 24h is the strongest churn signal
  // we track. Pin that framing so a copy edit doesn't soften it
  // into a generic "low rating" toggle.
  assert.match(PREFS_TSX, /Low-rating alert \(1-2★\)/);
  assert.match(PREFS_TSX, /within 24 hours/);
  assert.match(PREFS_TSX, /strongest churn signal/);
});
