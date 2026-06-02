'use strict';

// /trust/anchors/ visual timeline — apex III2 follow-on to PRs
// #35 (live anchor) + #37 (history endpoint) + #38 (daily cron).
// Markup-contract test only: the page consumes the existing
// /api/audit-anchor/history endpoint; no server runtime to
// exercise. The test pins the load-bearing surface so a future
// refactor can't silently break the procurement-facing demo.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

const HTML = read('trust/anchors/index.html');
const JS = read('trust/anchors/app.js');
const TRUST_INDEX = read('trust/legacy/index.html');

// ── page surface ───────────────────────────────────────────────

test('trust/anchors/index.html exists with the documented title', () => {
  assert.match(HTML, /<title>Audit-chain anchors \| OrcaTrade trust<\/title>/);
});

test('the page is canonical at orcatrade.pl/trust/anchors/ and crawlable', () => {
  // The audit anchors page IS procurement-discoverable content —
  // it's NOT noindex like the auth surfaces. Confirm canonical
  // is correct + no noindex meta.
  assert.match(HTML, /<link rel="canonical" href="https:\/\/orcatrade\.pl\/trust\/anchors\/"/);
  assert.doesNotMatch(HTML, /<meta name="robots" content="noindex/);
});

test('the page has a breadcrumb back to /trust/', () => {
  assert.match(HTML, /breadcrumbs[\s\S]{0,200}href="\/trust\/"/);
});

test('the page renders an empty + error state when the history is empty / unavailable', () => {
  // Three states must exist so the page never shows a misleading
  // "no anchors" message when the endpoint itself failed.
  assert.match(HTML, /id="anchors-loading"/);
  assert.match(HTML, /id="anchors-empty"/);
  assert.match(HTML, /id="anchors-error"/);
  assert.match(HTML, /id="anchors-timeline"/);
});

test('the page documents the verification protocol (sha256 + canonical projection)', () => {
  // The whole point of this page is procurement verifiability.
  // The protocol description must be inline — readers shouldn't
  // have to click out to docs to know what they're verifying.
  assert.match(HTML, /sha256\(prevHash \+ canonical\(event\)\)/);
  assert.match(HTML, /docs\/security\/audit-trail\.md/);
});

test('the page provides a 4-step verification flow that a customer can run independently', () => {
  // Procurement reviewers want a recipe, not prose. The four
  // steps mirror the howToVerify list in /api/audit-anchor's
  // response — pin both for consistency.
  const steps = HTML.match(/<li>/g) || [];
  assert.ok(steps.length >= 4, `expected ≥4 verification steps; got ${steps.length}`);
  assert.match(HTML, /chainHead/);
  assert.match(HTML, /chainLength/);
});

// ── app.js: history consumption ────────────────────────────────

test('app.js fetches /api/audit-anchor/history without credentials (public read)', () => {
  // The endpoint is public — sending credentials would unnecessarily
  // attach a session cookie + defeat CDN caching. Pin credentials:omit.
  assert.match(
    JS,
    /fetch\(['"]\/api\/audit-anchor\/history['"][\s\S]{0,200}credentials:\s*['"]omit['"]/,
  );
});

test('app.js handles all four documented states (loading / empty / error / timeline)', () => {
  for (const state of ['loading', 'empty', 'error', 'timeline']) {
    assert.ok(
      JS.includes("'" + state + "'"),
      `app.js must handle the '${state}' state`,
    );
  }
});

test('app.js renders the newest anchor with an is-newest visual emphasis', () => {
  // The procurement reader's eye should land on "this is the
  // CURRENT state" before scanning older rows. Pin the class
  // (CSS uses it) + the "current" pill.
  assert.match(JS, /is-newest/);
  assert.match(JS, /newest-pill/);
});

test('app.js renders the full sha256 hex (never truncated)', () => {
  // A customer who pinned the full head externally can't compare
  // against a truncated render. Pin via the verification spec:
  // the head is what they verify against, so it MUST be the
  // complete hash. The JS uses `headFull` to make the intent
  // explicit + a comment explains why.
  assert.match(JS, /headFull/);
  // Negative pin: no truncation operations in the head-rendering
  // path. (slice() etc. could exist for timestamps; we only
  // check the head doesn't get sliced.)
  const headRender = JS.match(/headFull[\s\S]{0,500}/);
  assert.ok(headRender, 'headFull must be used to render the head');
  assert.doesNotMatch(
    headRender[0].match(/<div class="head">[\s\S]{0,200}<\/div>/)?.[0] || '',
    /\.slice\(/,
    'the head must NOT be sliced when rendered',
  );
});

test('app.js renders timestamps in UTC (consistent across viewer timezones)', () => {
  // The chain head is a global fact. Two procurement reviewers
  // in different timezones must see the same row labels for the
  // same pin. JS doesn't apply toLocaleString — pin that.
  assert.match(JS, /UTC/);
  assert.doesNotMatch(JS, /toLocaleString|toLocaleDateString/);
});

// ── /trust/ links to the new page ───────────────────────────────

test('/trust/ links to /trust/anchors/ in the audit section', () => {
  // Discoverability — the new page lives or dies by being linked.
  assert.match(TRUST_INDEX, /href="\/trust\/anchors\/"[\s\S]{0,200}rolling history|history of past anchors[\s\S]{0,200}href="\/trust\/anchors\/"/);
});
