'use strict';

// Source-level drift-guard tests for the shipments dashboard page +
// the sidebar entry that links to it. Same pattern as
// test/wizard-tier-a-pills.test.js — app-shell doesn't have a React
// test runner today, so we read the source as text and assert
// structural invariants.
//
// What we pin:
//   - the page fetches /shipments AND /shipments/exceptions
//   - the acknowledge action POSTs to the correct sub-path with the
//     external-id URL-encoded
//   - the sidebar has a Shipments entry under Trade
//   - the page imports the new Shipment + ExceptionQueueItem types
//     from @/lib/api (catches the regression where the types are
//     accidentally redefined inline)
//   - the auth gate fires when /shipments returns 401 (AuthError)
//   - the empty-state cross-links to /plans for promotion

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PAGE_PATH = path.join(ROOT, 'app-shell', 'app', '(authed)', 'shipments', 'page.tsx');
const SIDEBAR_PATH = path.join(ROOT, 'app-shell', 'components', 'Sidebar.tsx');
const API_PATH = path.join(ROOT, 'app-shell', 'lib', 'api.ts');

const PAGE_SRC = fs.readFileSync(PAGE_PATH, 'utf8');
const SIDEBAR_SRC = fs.readFileSync(SIDEBAR_PATH, 'utf8');
const API_SRC = fs.readFileSync(API_PATH, 'utf8');

// ── Endpoint wiring ───────────────────────────────────────────────────

test('page fetches GET /shipments + GET /shipments/exceptions in parallel', () => {
  assert.match(PAGE_SRC, /apiGet<[^>]+>\(['"]\/shipments['"]\)/);
  assert.match(PAGE_SRC, /apiGet<[^>]+>\(['"]\/shipments\/exceptions['"]\)/);
  // Parallel via Promise.allSettled — preserves the queue/list
  // independently when one endpoint returns an error.
  assert.match(PAGE_SRC, /Promise\.allSettled\(/);
});

test('acknowledge action POSTs to the encoded item-action sub-path', () => {
  // The generic on apiPost can be arbitrarily nested (Record<string,
  // unknown> etc), so just confirm the literal target path appears.
  // URL-encoding the externalId guards against any future externalId
  // generator change that emits non-ASCII or path-reserved chars.
  assert.match(
    PAGE_SRC,
    /`\/shipments\/\$\{encodeURIComponent\(item\.externalId\)\}\/exception\/acknowledge`/,
  );
});

// ── Auth gate ─────────────────────────────────────────────────────────

test('a 401 on /shipments flips the whole page to the auth gate (no partial render)', () => {
  // The shipmentsResult-rejected-with-AuthError branch must short-
  // circuit before the page tries to render either panel.
  assert.match(
    PAGE_SRC,
    /shipmentsResult\.status === 'rejected'[\s\S]*?shipmentsResult\.reason instanceof AuthError[\s\S]*?setState\('auth'\)[\s\S]*?return;/,
  );
});

// ── Empty-state UX ────────────────────────────────────────────────────

test('empty shipment list cross-links to /plans for promotion (closes the journey loop)', () => {
  // Discoverability: a user who lands here with no shipments needs
  // to know where to go next. Link them to /plans (where they
  // promote a saved plan into a shipment via PR #97).
  assert.match(PAGE_SRC, /No shipments yet/);
  assert.match(PAGE_SRC, /<Link href="\/plans"/);
});

test('empty exception queue shows the clean-state message (no scary empty card)', () => {
  assert.match(PAGE_SRC, /No open exceptions\. Clean operational state\./);
});

// ── SLA breach indicator ──────────────────────────────────────────────

test('SLA breach badge surfaces on rows where _queue.slaBreached === true', () => {
  // The row component must check the precomputed slaBreached flag.
  // Computing it client-side would risk clock-skew false-positives;
  // the server computed it against the same Date.now() the API
  // call read.
  assert.match(PAGE_SRC, /item\._queue\.slaBreached/);
  assert.match(PAGE_SRC, /SLA breach/);
});

test('queue header surfaces open-count + SLA-breach-count', () => {
  // JSX expressions use {expr} (no leading $). The header shows the
  // open total and the breach subset so ops sees the priority at a glance.
  assert.match(PAGE_SRC, /\{openCount\} open · \{breachedCount\} SLA breach/);
});

// ── Acknowledged-state idempotency ────────────────────────────────────

test('the acknowledge button is disabled once item._queue.acknowledged is true', () => {
  // Idempotency at the UI layer mirrors the data-layer contract
  // (acknowledgeException returns { unchanged: true } on re-ack).
  // A user who clicks twice doesn't fire two POSTs.
  assert.match(PAGE_SRC, /disabled=\{busy \|\| item\._queue\.acknowledged\}/);
});

// ── Types live in the shared lib (no inline duplication) ──────────────

test('Shipment + ExceptionQueueItem types are exported from @/lib/api (not inlined in the page)', () => {
  assert.match(API_SRC, /export interface Shipment \{/);
  assert.match(API_SRC, /export interface ExceptionQueueItem extends Shipment \{/);
  // Page imports both from @/lib/api — catches the regression where
  // a duplicate inline type drifts from the shared shape. The TS
  // `type` keyword guards against accidental runtime import too.
  const importBlock = PAGE_SRC.match(/import \{[\s\S]*?\} from '@\/lib\/api';/);
  assert.ok(importBlock, 'page must import from @/lib/api');
  assert.match(importBlock[0], /type Shipment\b/);
  assert.match(importBlock[0], /type ExceptionQueueItem\b/);
});

test('ShipmentStatus union matches lib/db/shipments.js STATUSES exactly (drift guard across stacks)', () => {
  // app-shell/lib/api.ts defines the type as the union of 7 strings.
  // lib/db/shipments.js exposes STATUSES as the runtime array. If a
  // new status lands in the data layer without updating the type,
  // a Shipment from the API silently widens to `string` in TS — but
  // the dashboard's statusTone() switch silently falls through to the
  // neutral fallback. Catch the drift here.
  const dbShipments = require(path.join(ROOT, 'lib', 'db', 'shipments'));
  const tsUnion = API_SRC.match(/export type ShipmentStatus =([^;]+);/);
  assert.ok(tsUnion, 'ShipmentStatus type union not located in app-shell/lib/api.ts');
  const tsValues = (tsUnion[1].match(/'([a-z_]+)'/g) || []).map((s) => s.replace(/'/g, '')).sort();
  const dbValues = [...dbShipments.STATUSES].sort();
  assert.deepEqual(tsValues, dbValues, 'ShipmentStatus type drifted from STATUSES in lib/db/shipments.js');
});

// ── Sidebar nav entry ─────────────────────────────────────────────────

test('Sidebar.tsx has a Shipments entry under the Trade group', () => {
  // Trade group's items array must contain the Shipments entry.
  // Use a regex anchored on the Trade heading + the Shipments item.
  assert.match(
    SIDEBAR_SRC,
    /heading: 'Trade',[\s\S]*?\{ label: 'Shipments', href: '\/shipments', inApp: true \}/,
  );
});

test('Sidebar.tsx places Shipments between Plans and Portfolios (signals the promotion flow)', () => {
  // Plans → Shipments (via promotion) → Portfolios (aggregate views).
  // Sidebar order should mirror the natural funnel.
  const tradeBlock = SIDEBAR_SRC.match(/heading: 'Trade',[\s\S]*?items: \[([\s\S]*?)\]/);
  assert.ok(tradeBlock, 'Trade group not located');
  const itemNames = (tradeBlock[1].match(/label: '([^']+)'/g) || []).map((s) => s.match(/'([^']+)'/)[1]);
  const plansIdx = itemNames.indexOf('Plans');
  const shipmentsIdx = itemNames.indexOf('Shipments');
  const portfoliosIdx = itemNames.indexOf('Portfolios');
  assert.ok(plansIdx >= 0 && shipmentsIdx > plansIdx && portfoliosIdx > shipmentsIdx,
    `expected Plans < Shipments < Portfolios in Sidebar Trade group, got: ${itemNames.join(' / ')}`);
});

// ── Layout discipline ────────────────────────────────────────────────

test('page is a Client Component (uses hooks + apiGet/apiPost)', () => {
  assert.match(PAGE_SRC, /^'use client';/);
});

test('page uses brand CSS variables (no hard-coded colours that bypass the theme)', () => {
  // Brand discipline: every colour reference goes through a CSS
  // variable so the theme can swap without code churn.
  assert.match(PAGE_SRC, /var\(--color-critical\)/);
  assert.match(PAGE_SRC, /var\(--color-positive\)/);
  assert.match(PAGE_SRC, /var\(--color-warning\)/);
  assert.match(PAGE_SRC, /var\(--color-navy-line\)/);
});
