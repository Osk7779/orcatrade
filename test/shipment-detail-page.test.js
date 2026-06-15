'use strict';

// Source-level drift-guard tests for the shipment detail page.
// Mirrors test/shipments-dashboard-page.test.js in shape.
//
// Key invariants pinned:
//   - the URL parameter shape matches Next 15 Promise-of-params API
//   - the page fetches GET /shipments/<encoded-id>
//   - the transition action POSTs the toStatus body to the /transition
//     sub-route
//   - the exception panel renders ONLY when status === 'exception'
//     (not when exceptionState happens to be populated from a
//     historical exception that was already recovered from)
//   - SHIPMENT_VALID_TRANSITIONS in app-shell/lib/api.ts matches
//     VALID_TRANSITIONS in lib/db/shipments.js exactly — adding a
//     legal edge to the data layer without updating the frontend
//     reference fails CI
//   - the list page rows link to the detail page
//   - 404 from the GET maps to a friendly notFound state (not a
//     generic error message)

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DETAIL_PATH = path.join(ROOT, 'app-shell', 'app', '(authed)', 'shipments', '[externalId]', 'page.tsx');
const LIST_PATH = path.join(ROOT, 'app-shell', 'app', '(authed)', 'shipments', 'page.tsx');
const API_PATH = path.join(ROOT, 'app-shell', 'lib', 'api.ts');

const DETAIL_SRC = fs.readFileSync(DETAIL_PATH, 'utf8');
const LIST_SRC = fs.readFileSync(LIST_PATH, 'utf8');
const API_SRC = fs.readFileSync(API_PATH, 'utf8');

// ── Routing ───────────────────────────────────────────────────────────

test('detail page params follow the Next 15 Promise-of-params shape', () => {
  // Next 15 changed dynamic-segment params from a plain object to a
  // Promise. The page must `use(params)` not destructure directly.
  assert.match(DETAIL_SRC, /params: Promise<\{ externalId: string \}>/);
  assert.match(DETAIL_SRC, /const \{ externalId \} = use\(params\);/);
});

test('detail page fetches GET /shipments/<encoded-id>', () => {
  assert.match(
    DETAIL_SRC,
    /apiGet<\{[\s\S]*?shipment: Shipment[\s\S]*?\}>\(`\/shipments\/\$\{encodeURIComponent\(externalId\)\}`\)/,
  );
});

// ── Transition controls ───────────────────────────────────────────────

test('transition buttons render ONLY legal next-states (read from SHIPMENT_VALID_TRANSITIONS)', () => {
  // Pulling the legal-set from the shared reference avoids the bug
  // where the page hard-codes a stale subset and ships a button
  // that always returns 409.
  assert.match(DETAIL_SRC, /SHIPMENT_VALID_TRANSITIONS\[shipment\.status\]/);
  assert.match(DETAIL_SRC, /legalNext\.map\(\(to\) =>/);
});

test('transition action POSTs toStatus to the /transition sub-route', () => {
  assert.match(
    DETAIL_SRC,
    /`\/shipments\/\$\{encodeURIComponent\(shipment\.externalId\)\}\/transition`/,
  );
  assert.match(DETAIL_SRC, /\{ toStatus: to \}/);
});

test('terminal status (no legal transitions) shows a "no further transitions" message', () => {
  // Cancelled is the only terminal state today; the page must not
  // render an empty controls section (looks broken to ops).
  assert.match(DETAIL_SRC, /is terminal\. No further transitions available\./);
});

// ── Exception panel render guard ──────────────────────────────────────

test('exception panel renders only when shipment.status === "exception"', () => {
  // Catching the regression where someone surfaces stale exception
  // metadata after a recovery — the user just resolved this, they
  // don't need a red "Exception" panel still on the page.
  assert.match(DETAIL_SRC, /shipment\.status === 'exception' && \(/);
});

test('exception panel surfaces reason + openedAt + acknowledgedAt fields', () => {
  // Three load-bearing fields ops needs to triage. Note: aria-/role-
  // attributes can be added in a follow-up — the floor here is that
  // the fields ARE rendered.
  assert.match(DETAIL_SRC, /label="Reason"/);
  assert.match(DETAIL_SRC, /label="Opened at"/);
  assert.match(DETAIL_SRC, /label="Acknowledged at"/);
});

// ── Reproducibility snapshots ─────────────────────────────────────────

test('snapshots panel renders only when the snapshot has at least one key', () => {
  // Catching the regression where an empty {} object renders an
  // expandable "snapshot" that's just empty braces.
  assert.match(DETAIL_SRC, /shipment\.inputsSnapshot && Object\.keys\(shipment\.inputsSnapshot\)\.length > 0/);
  assert.match(DETAIL_SRC, /shipment\.quoteSnapshot && Object\.keys\(shipment\.quoteSnapshot\)\.length > 0/);
});

test('snapshots use a <details> element (collapsible, no JS state needed)', () => {
  // <details> is the smallest correct primitive for collapsible
  // content. Catching the regression where it gets reimplemented
  // in JS state (less accessible, fails without JS).
  assert.match(DETAIL_SRC, /<details/);
  assert.match(DETAIL_SRC, /<summary/);
});

// ── 404 path ──────────────────────────────────────────────────────────

test('a 404 from the GET maps to a notFound state, not a generic error', () => {
  // Better UX: tell the user the shipment doesn't exist (or was
  // archived) rather than a scary "could not load" message.
  assert.match(DETAIL_SRC, /\/404\|not found\/i\.test\(msg\)[\s\S]*?setState\('notFound'\)/);
  assert.match(DETAIL_SRC, /This shipment doesn't exist in your organisation, or it has been archived\./);
});

// ── List → detail wiring ──────────────────────────────────────────────

test('list page rows link to the detail page with URL-encoded externalId', () => {
  assert.match(
    LIST_SRC,
    /<Link href=\{`\/shipments\/\$\{encodeURIComponent\(s\.externalId\)\}`\}/,
  );
});

// ── Cross-stack SHIPMENT_VALID_TRANSITIONS drift guard ────────────────

test('SHIPMENT_VALID_TRANSITIONS in app-shell/lib/api.ts matches VALID_TRANSITIONS in lib/db/shipments.js exactly', () => {
  // The dangerous regression: a new legal edge lands in the data
  // layer but the frontend's shared reference doesn't know about it,
  // so the legal transition just never appears as a button. The
  // shipment gets stuck. Pin BOTH directions: every edge in code
  // is in the data layer, every data-layer edge is in code.
  const dbShipments = require(path.join(ROOT, 'lib', 'db', 'shipments'));
  const tsBlockMatch = API_SRC.match(/SHIPMENT_VALID_TRANSITIONS[\s\S]*?\}\) as Readonly/);
  assert.ok(tsBlockMatch, 'SHIPMENT_VALID_TRANSITIONS block not located in app-shell/lib/api.ts');
  const tsBlock = tsBlockMatch[0];

  for (const fromStatus of dbShipments.STATUSES) {
    const allowedFromDb = [...(dbShipments.VALID_TRANSITIONS[fromStatus] || [])].sort();
    // Pull the from-side line, e.g. "planned: Object.freeze(['booked', 'exception', 'cancelled']),"
    const fromLine = tsBlock.match(new RegExp(`${fromStatus}: Object\\.freeze\\(\\[([^\\]]*)\\]\\)`));
    assert.ok(fromLine, `SHIPMENT_VALID_TRANSITIONS missing entry for from-status "${fromStatus}"`);
    const allowedFromTs = (fromLine[1].match(/'([a-z_]+)'/g) || []).map((s) => s.replace(/'/g, '')).sort();
    assert.deepEqual(
      allowedFromTs,
      allowedFromDb,
      `Drift on ${fromStatus} → next-states: TS=${JSON.stringify(allowedFromTs)} vs DB=${JSON.stringify(allowedFromDb)}`,
    );
  }
});

// ── Layout discipline ─────────────────────────────────────────────────

test('detail page is a Client Component', () => {
  assert.match(DETAIL_SRC, /^'use client';/);
});

test('detail page uses brand CSS variables for the critical/positive/warning tones', () => {
  assert.match(DETAIL_SRC, /var\(--color-critical\)/);
  assert.match(DETAIL_SRC, /var\(--color-positive\)/);
  assert.match(DETAIL_SRC, /var\(--color-warning\)/);
});

// ── Vault stub points at L1.4 ────────────────────────────────────────

test('empty document vault message points at L1.4 (sets expectation honestly)', () => {
  // Honesty: the vault is a list view; upload + filing depends on
  // L1.4 partner integration. The empty-state message tells the user
  // when to expect the missing piece instead of leaving them guessing.
  assert.match(DETAIL_SRC, /Document upload \+ filing ships with L1\.4\./);
});
