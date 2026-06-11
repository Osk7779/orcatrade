'use strict';

// Source-level drift-guard tests for the shipments dashboard
// status-filter dropdown. Mirrors the goods-edit-form / suppliers-
// rescreen-ui pattern: pin URL state shape, dropdown options, filter
// application, empty-state UX, and cross-stack taxonomy drift guards.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PAGE_PATH = path.join(ROOT, 'app-shell', 'app', '(authed)', 'shipments', 'page.tsx');
const API_PATH = path.join(ROOT, 'app-shell', 'lib', 'api.ts');
const DB_PATH = path.join(ROOT, 'lib', 'db', 'shipments.js');
const PAGE_SRC = fs.readFileSync(PAGE_PATH, 'utf8');
const API_SRC = fs.readFileSync(API_PATH, 'utf8');
const DB_SRC = fs.readFileSync(DB_PATH, 'utf8');

// ── SHIPMENT_STATUSES iterable — exported + drift-guarded ─────────

test('SHIPMENT_STATUSES is exported as a frozen ReadonlyArray<ShipmentStatus>', () => {
  assert.match(API_SRC, /export const SHIPMENT_STATUSES: ReadonlyArray<ShipmentStatus> = Object\.freeze\(\[/);
});

test('SHIPMENT_STATUSES contents match the ShipmentStatus union exactly', () => {
  // Drift guard: a future PR adding a status to the union but
  // forgetting the array (or vice versa) silently breaks the filter
  // dropdown — either by omitting an option OR rendering a
  // non-existent status. Pin both sides.
  const unionBlock = API_SRC.match(/export type ShipmentStatus =([^;]+);/);
  assert.ok(unionBlock, 'ShipmentStatus union not located');
  const unionValues = (unionBlock[1].match(/'([a-z_]+)'/g) || []).map((s) => s.replace(/'/g, '')).sort();

  const arrayBlock = API_SRC.match(/SHIPMENT_STATUSES: ReadonlyArray<ShipmentStatus> = Object\.freeze\(\[([\s\S]*?)\]\)/);
  assert.ok(arrayBlock, 'SHIPMENT_STATUSES not located');
  const arrayValues = (arrayBlock[1].match(/'([a-z_]+)'/g) || []).map((s) => s.replace(/'/g, '')).sort();

  assert.deepEqual(arrayValues, unionValues,
    `Drift: union=${JSON.stringify(unionValues)} array=${JSON.stringify(arrayValues)}`);
});

test('SHIPMENT_STATUSES contents match SHIPMENT_VALID_TRANSITIONS keys (no orphan statuses)', () => {
  // Cross-check against the transition table — every status must
  // appear as a from-key (even cancelled, which has empty allowed-
  // transitions). An orphan would mean a state machine bug AND an
  // unreachable filter option.
  const arrayBlock = API_SRC.match(/SHIPMENT_STATUSES: ReadonlyArray<ShipmentStatus> = Object\.freeze\(\[([\s\S]*?)\]\)/);
  assert.ok(arrayBlock);
  const arrayValues = (arrayBlock[1].match(/'([a-z_]+)'/g) || []).map((s) => s.replace(/'/g, '')).sort();

  const transBlock = API_SRC.match(/SHIPMENT_VALID_TRANSITIONS[\s\S]*?Object\.freeze\(\{([\s\S]*?)\}\)/);
  assert.ok(transBlock, 'SHIPMENT_VALID_TRANSITIONS not located');
  const keys = (transBlock[1].match(/^\s*(\w+):/gm) || []).map((s) => s.replace(/[:\s]/g, '')).sort();

  assert.deepEqual(arrayValues, keys,
    `SHIPMENT_STATUSES vs SHIPMENT_VALID_TRANSITIONS keys mismatch`);
});

test('SHIPMENT_STATUSES matches the backend SHIPMENT_STATUSES in lib/db/shipments.js', () => {
  // Cross-stack drift guard — backend uses these values for CHECK
  // constraints and audit-event filtering. A mismatch lets the UI
  // filter to a status the backend would never write.
  const arrayBlock = API_SRC.match(/SHIPMENT_STATUSES: ReadonlyArray<ShipmentStatus> = Object\.freeze\(\[([\s\S]*?)\]\)/);
  assert.ok(arrayBlock);
  const tsValues = (arrayBlock[1].match(/'([a-z_]+)'/g) || []).map((s) => s.replace(/'/g, '')).sort();

  // The backend may use either SHIPMENT_STATUSES or an inline list.
  // Probe for SHIPMENT_STATUSES first, else read from
  // SHIPMENT_VALID_TRANSITIONS keys (mirror logic the backend uses).
  let dbValues;
  const dbStatusesBlock = DB_SRC.match(/SHIPMENT_STATUSES\s*=\s*\[([\s\S]*?)\]/);
  if (dbStatusesBlock) {
    dbValues = (dbStatusesBlock[1].match(/'([a-z_]+)'/g) || []).map((s) => s.replace(/'/g, '')).sort();
  } else {
    const dbTransBlock = DB_SRC.match(/SHIPMENT_VALID_TRANSITIONS\s*=\s*\{([\s\S]*?)\};/) ||
                        DB_SRC.match(/VALID_TRANSITIONS\s*=\s*Object\.freeze\(\{([\s\S]*?)\}\)/);
    assert.ok(dbTransBlock, 'Neither SHIPMENT_STATUSES nor VALID_TRANSITIONS located in lib/db/shipments.js');
    dbValues = (dbTransBlock[1].match(/^\s*(\w+):/gm) || []).map((s) => s.replace(/[:\s]/g, '')).sort();
  }

  assert.deepEqual(tsValues, dbValues,
    `Cross-stack drift: api.ts=${JSON.stringify(tsValues)} vs lib/db=${JSON.stringify(dbValues)}`);
});

// ── Page structure: Suspense wrapper + URL state ──────────────────

test('ShipmentsPage wraps the view in Suspense (Next.js 15 useSearchParams requirement)', () => {
  // useSearchParams in a client component breaks static prerendering
  // unless the consumer is under <Suspense>. The fallback matches
  // the existing loading state to avoid a hydration flash.
  assert.match(PAGE_SRC, /export default function ShipmentsPage\(\) \{[\s\S]*?<Suspense\b[\s\S]*?<ShipmentsView \/>/);
});

test('readStatusFilter silently ignores values outside SHIPMENT_STATUSES (forward-compat)', () => {
  // Stale URLs and typos shouldn't render an empty list — they
  // should fall back to "all statuses". Drift guard reads the
  // helper source.
  const fnBlock = PAGE_SRC.match(/function readStatusFilter[\s\S]*?\n\}/);
  assert.ok(fnBlock, 'readStatusFilter not located');
  const block = fnBlock[0];
  assert.match(block, /SHIPMENT_STATUSES as ReadonlyArray<string>/);
  assert.match(block, /\.includes\(raw\)/);
  // Returns null on unknown values.
  assert.match(block, /\? \(raw as ShipmentStatus\)\s*:\s*null/);
});

test('ShipmentList reads the active filter from useSearchParams (URL state)', () => {
  assert.match(PAGE_SRC, /const searchParams = useSearchParams\(\)/);
  assert.match(PAGE_SRC, /const activeFilter = readStatusFilter\(searchParams\.get\('status'\)\)/);
});

test('ShipmentList uses router.replace (not push) to update the filter URL', () => {
  // Filter changes shouldn't pollute browser history — a triage
  // session typing through 5 filters shouldn't require 5 back
  // clicks to escape.
  assert.match(PAGE_SRC, /router\.replace\(qs \? `\$\{pathname\}\?\$\{qs\}` : pathname\)/);
});

test('ShipmentList clears the filter when "" is selected (no orphan status= in URL)', () => {
  // When the user picks "All statuses" (empty value), the param
  // is REMOVED from the URL rather than left as "status=". Keeps
  // shareable URLs clean.
  const fnBlock = PAGE_SRC.match(/function setFilter[\s\S]*?\n  \}/);
  assert.ok(fnBlock);
  const block = fnBlock[0];
  assert.match(block, /if \(!next\) \{\s*params\.delete\('status'\)/);
});

// ── Dropdown enumeration ──────────────────────────────────────────

test('Dropdown renders one option per SHIPMENT_STATUSES entry (closed taxonomy)', () => {
  // Iterates over SHIPMENT_STATUSES rather than hard-coding —
  // adding a status to the union+array automatically extends the
  // dropdown.
  assert.match(PAGE_SRC, /\{SHIPMENT_STATUSES\.map\(\(s\) => \(/);
  assert.match(PAGE_SRC, /<option key=\{s\} value=\{s\}>/);
});

test('Dropdown has an "All statuses" option that clears the filter', () => {
  assert.match(PAGE_SRC, /<option value="">All statuses/);
});

test('Dropdown option labels include the per-status count (operator-glance triage)', () => {
  // Each option reads "Planned (12)" so operators can see queue
  // sizes without applying the filter.
  assert.match(PAGE_SRC, /\(\{countByStatus\[s\] \|\| 0\}\)/);
});

test('Dropdown carries aria-label for screen readers', () => {
  assert.match(PAGE_SRC, /aria-label="Filter shipments by status"/);
});

// ── Filter application ───────────────────────────────────────────

test('visibleShipments is filtered against activeFilter (when set)', () => {
  assert.match(PAGE_SRC, /const visibleShipments = useMemo\(\(\) => \{/);
  assert.match(PAGE_SRC, /shipments\.filter\(\(s\) => s\.status === activeFilter\)/);
});

test('countByStatus is computed off the FULL list (not the filtered view)', () => {
  // If counts changed as the user filtered, the dropdown labels
  // would oscillate — confusing. Drift guard reads the dep array.
  const fnBlock = PAGE_SRC.match(/const countByStatus = useMemo\([\s\S]*?\}, \[([^\]]+)\]\);/);
  assert.ok(fnBlock, 'countByStatus useMemo not located');
  const deps = fnBlock[1];
  // Must depend on `shipments` only (not visibleShipments).
  assert.match(deps, /\bshipments\b/);
  assert.doesNotMatch(deps, /visibleShipments/);
});

test('Header counter reads "X of Y" when filtered, "X total" when not', () => {
  assert.match(PAGE_SRC, /activeFilter\s*\?\s*`\$\{visibleShipments\.length\} of \$\{shipments\.length\}`\s*:\s*`\$\{shipments\.length\} total`/);
});

// ── Empty-state UX ───────────────────────────────────────────────

test('Filtered empty state shows the filtered status name + a Clear-filter link', () => {
  // Different message from the "no shipments yet" top-level empty —
  // a filtered-empty offers a recovery affordance, not a CTA.
  assert.match(PAGE_SRC, /No shipments with status &ldquo;\{statusLabel\(activeFilter as ShipmentStatus\)\}&rdquo;/);
  assert.match(PAGE_SRC, /onClick=\{\(\) => setFilter\(''\)\}/);
  // JSX wraps the button text across lines; allow whitespace around it.
  assert.match(PAGE_SRC, />\s*Clear filter\s*</);
});

test('Top-level empty state (no shipments at all) is preserved (no regression)', () => {
  // The "promote a saved plan" CTA only renders pre-data. Drift
  // guard against an accidental merge with the filtered-empty
  // state.
  assert.match(PAGE_SRC, /shipments\.length === 0/);
  assert.match(PAGE_SRC, /No shipments yet\. Promote a saved plan/);
});

// ── Page-level regression guards ─────────────────────────────────

test('Exception queue card still renders before the list (PR #98 / dashboard order)', () => {
  // The exception queue must read first — it's the daily-driver
  // surface. Drift guard ensures the filter wiring didn't shuffle
  // the dashboard layout.
  const queueIdx = PAGE_SRC.indexOf('<ExceptionQueueCard');
  const listIdx = PAGE_SRC.indexOf('<ShipmentList');
  assert.ok(queueIdx > 0 && listIdx > queueIdx,
    `Exception queue must render before ShipmentList — queue=${queueIdx} list=${listIdx}`);
});

test('ShipmentList table still renders Label / Status / Route / Customs value / Updated columns', () => {
  // The five-column shape is the operator's mental model; rebrand-
  // ing it would surprise users. Drift guard reads the headers.
  for (const header of ['Label', 'Status', 'Route', 'Customs value', 'Updated']) {
    assert.match(PAGE_SRC, new RegExp(`>${header}<`),
      `column header "${header}" missing`);
  }
});
