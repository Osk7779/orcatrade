'use strict';

// Phase 1 — apex III3 slice 3c (app-shell verdict surface).
//
// Pins the contract between the existing `/api/plans/<id>/reproduce`
// endpoint and the app-shell plan view that consumes it. The endpoint
// shipped in apex III3 slices 1-3b (already on main); until this PR
// nothing surfaced its verdict in the UI — the "built-but-inert"
// failure mode the enterprise-ready re-sequencing exists to fix.
//
// What this asserts:
//   - account/plans/app.js calls GET /api/plans/<id>/reproduce
//   - The render path covers every endpoint verdict status the
//     handler returns (data-unchanged, data-drifted, no-snapshot-bound,
//     drift-snapshot-unavailable) — drift between the endpoint
//     contract and the UI's headline copy is the silent-regression
//     mode this test exists to catch
//   - The render path uses every block the endpoint can populate
//     (drift list, landedReproduction, fxReproduction, snapshot ids)
//   - account/plans/index.html declares the matching CSS hooks so
//     the verdict actually shows up on the page

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

const APP_JS = read('account/plans/app.js');
const INDEX_HTML = read('account/plans/index.html');
const PLANS_HANDLER = read('lib/handlers/plans.js');

// ── endpoint wiring ─────────────────────────────────────────────────

test('app.js calls GET /api/plans/<id>/reproduce', () => {
  assert.match(
    APP_JS,
    /fetch\(\s*['"]\/api\/plans\/['"][\s\S]*?\+\s*['"]\/reproduce['"]/,
    'app.js must call /api/plans/<encoded-id>/reproduce',
  );
});

test('app.js encodes the planId before composing the reproduce URL', () => {
  // Plan ids are user-derived strings; an unencoded value would let
  // a "/" in the id collide with the route hierarchy. encodeURIComponent
  // is the same pattern the other plan-mutating fetches already use.
  assert.match(
    APP_JS,
    /encodeURIComponent\([^)]+\)\s*\+\s*['"]\/reproduce['"]/,
    'planId must be encoded with encodeURIComponent before the /reproduce URL',
  );
});

test('app.js wires the reproduce action through the delegated card handler', () => {
  // Same dispatch pattern as actual-open / share-toggle — keeps the
  // listener fan-out flat.
  assert.match(APP_JS, /data-action="reproduce-open"/);
  assert.match(APP_JS, /action === 'reproduce-open'/);
  assert.match(APP_JS, /loadReproduceVerdict\(card, planId\)/);
});

// ── verdict-status coverage ─────────────────────────────────────────
//
// The handler in lib/handlers/plans.js returns one of four `status`
// strings on a 200. The UI must render each one with a sensible
// headline. Drift between this list and the handler is the silent-
// regression mode this block exists to catch.

const ENDPOINT_STATUSES = [
  'data-unchanged',
  'data-drifted',
  'no-snapshot-bound',
  'drift-snapshot-unavailable',
];

test('every verdict status the endpoint can return is named in plans.js', () => {
  for (const status of ENDPOINT_STATUSES) {
    assert.match(
      PLANS_HANDLER,
      new RegExp(`status:\\s*['"]${status}['"]`),
      `lib/handlers/plans.js must emit status: '${status}' (this test pins the endpoint contract)`,
    );
  }
});

test('app.js handles every verdict status the endpoint can return', () => {
  for (const status of ENDPOINT_STATUSES) {
    assert.match(
      APP_JS,
      new RegExp(`['"]${status}['"]`),
      `app.js must mention the '${status}' verdict somewhere in the render path`,
    );
  }
});

// ── block coverage ──────────────────────────────────────────────────
//
// The endpoint can populate four optional blocks. Each one the UI
// renders MUST be reachable through the render path; otherwise we ship
// a contract that promises richness the user never sees.

test('app.js renders landedReproduction when present (the headline "original euros recovered" block)', () => {
  assert.match(APP_JS, /landedReproduction/);
  assert.match(APP_JS, /perShipmentLandedTotal/);
});

test('app.js renders fxReproduction when present (saved vs current FX rates)', () => {
  assert.match(APP_JS, /fxReproduction/);
  assert.match(APP_JS, /spotRateForeignPerEur/);
});

test('app.js renders the drift list when status is data-drifted', () => {
  assert.match(APP_JS, /verdict\.drift/);
  assert.match(APP_JS, /renderDriftRow/);
});

test('app.js renders snapshot ids (storedSnapshotId + currentSnapshotId) for traceability', () => {
  assert.match(APP_JS, /storedSnapshotId/);
  assert.match(APP_JS, /currentSnapshotId/);
});

// ── CSS hook coverage ──────────────────────────────────────────────
//
// The render path uses these class names; if they're not declared in
// the page CSS, the verdict shows up unstyled (a worse UX than not
// showing it at all). Pin the hooks so a stylesheet refactor that
// drops a class fails CI.

const REQUIRED_CSS_CLASSES = [
  '.plan-reproduce',
  '.reproduce-toggle',
  '.repro-verdict',
  '.repro-ok',
  '.repro-drift',
  '.repro-unknown',
  '.repro-error',
  '.repro-headline',
  '.repro-drift-list',
  '.repro-drift-row',
  '.repro-recovered',
  '.repro-recovered-orig',
  '.repro-fx',
  '.repro-snapshot',
];

for (const cls of REQUIRED_CSS_CLASSES) {
  test(`account/plans/index.html declares ${cls} styles`, () => {
    assert.ok(
      INDEX_HTML.includes(cls),
      `account/plans/index.html must declare ${cls} — the render path uses it`,
    );
  });
}
