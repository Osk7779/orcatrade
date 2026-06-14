'use strict';

// Source-level drift-guard tests for the audit-timeline event-type
// filter (PR #134) on TransitionHistory.tsx. Pattern mirrors PR #125's
// status-filter tests on the shipments dashboard list.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const COMP_PATH = path.join(ROOT, 'app-shell', 'components', 'TransitionHistory.tsx');
const SRC = fs.readFileSync(COMP_PATH, 'utf8');

// ── Filter state + reset wiring ──────────────────────────────────────

test('TransitionHistory carries a filterType state (empty string = "all")', () => {
  assert.match(SRC, /const \[filterType, setFilterType\] = useState<string>\(''\)/);
});

test('Filter resets to "" when externalId or entityKind changes', () => {
  // Stale-filter guard: navigating between entities must not carry
  // a filter that doesn't match the new entity's event types.
  assert.match(
    SRC,
    /useEffect\(\(\) => \{\s*setFilterType\(''\);\s*\}, \[externalId, entityKind\]\)/,
  );
});

// ── typeLabel helper enforced on every entity kind ───────────────────

test('LOOKUP_BY_KIND requires a typeLabel function for every entity kind', () => {
  // Drift guard against adding a new entity kind without the new
  // PR #134 typeLabel field — the closed taxonomy in the type
  // signature would catch this at compile time, but the regex pins
  // the runtime shape too.
  assert.match(SRC, /typeLabel: \(t: AuditTimelineEventType\) => string;/);
  // Each kind in the lookup table has its own typeLabel.
  for (const kind of ['shipment', 'goods', 'supplier']) {
    const kindBlock = SRC.match(new RegExp(`${kind}:\\s*\\{[\\s\\S]*?\\},\\s*(?:goods|supplier|\\};)`));
    assert.ok(kindBlock, `${kind} block not located in LOOKUP_BY_KIND`);
    assert.match(kindBlock[0], /typeLabel: \(t\) => \{/,
      `${kind} entry must define a typeLabel function`);
  }
});

test('typeLabel returns human-friendly names (not the raw type strings)', () => {
  // Drift guard against accidentally exposing raw type strings like
  // "shipment_master_status_transition" in the dropdown — a UX
  // failure that would make the filter unusable.
  //
  // For each kind, pick one representative type that has been seen
  // in production and assert the label is humanized.
  const expectations = [
    { kind: 'shipment', type: 'shipment_master_status_transition', label: "'State transition'" },
    { kind: 'shipment', type: 'shipment_master_exception_acknowledged', label: "'Exception acknowledged'" },
    { kind: 'goods', type: 'goods_master_created', label: "'Created'" },
    { kind: 'supplier', type: 'supplier_master_rescreened', label: "'Re-screened'" },
  ];
  for (const { type, label } of expectations) {
    assert.match(
      SRC,
      new RegExp(`case '${type}': return ${label};`),
      `expected ${type} → ${label} mapping in some typeLabel`,
    );
  }
});

// ── typeCounts + visible memos ──────────────────────────────────────

test('typeCounts is computed off the FULL list (stable dropdown labels)', () => {
  // Same invariant as PR #125: per-type counts must NOT shrink as
  // the user filters, else dropdown labels oscillate confusingly.
  const memoBlock = SRC.match(/const typeCounts = useMemo\([\s\S]*?\}, \[([^\]]+)\]\)/);
  assert.ok(memoBlock, 'typeCounts useMemo not located');
  const deps = memoBlock[1];
  assert.match(deps, /\blist\b/);
  assert.doesNotMatch(deps, /visible/);
});

test('visible memo filters the loaded list by filterType', () => {
  assert.match(SRC, /const visible = useMemo\(\(\) => \{/);
  assert.match(SRC, /return list\.filter\(\(e\) => e\.type === filterType\)/);
});

// ── Dropdown rendering ──────────────────────────────────────────────

test('Filter dropdown only renders when ≥2 distinct types are present', () => {
  // A single-type timeline has nothing to filter. Hiding the
  // dropdown keeps the section header tidy in the common case.
  assert.match(SRC, /const showFilter = state === 'ready' && typeCounts\.size >= 2/);
  assert.match(SRC, /\{showFilter && \(\s*<label/);
});

test('Dropdown has an "All types (N)" option that clears the filter', () => {
  assert.match(SRC, /<option value="">All types \(\{list\.length\}\)<\/option>/);
});

test('Dropdown options are sorted by typeLabel (alphabetical, locale-aware)', () => {
  // Predictable ordering in the dropdown: same standard the goods
  // CBAM filter dropdown uses. Sort-by-label rather than sort-by-
  // raw-type keeps the order intuitive.
  assert.match(SRC, /\.sort\(\(a, b\) => cfg\.typeLabel\(a\[0\]\)\.localeCompare\(cfg\.typeLabel\(b\[0\]\)\)\)/);
});

test('Dropdown option labels include the per-type count (operator-glance triage)', () => {
  // Same pattern as PR #125's status dropdown: each option shows
  // "Created (12)" so operators see the bucket size without
  // applying the filter.
  assert.match(SRC, /\{cfg\.typeLabel\(t\)\} \(\{count\}\)/);
});

test('Dropdown carries aria-label for screen readers', () => {
  assert.match(SRC, /aria-label="Filter audit events by type"/);
});

// ── Header counter shape ────────────────────────────────────────────

test('Header counter reads "X of Y" when filtered, "X events" when not', () => {
  assert.match(
    SRC,
    /filterType\s*\?\s*`\$\{visible\.length\} of \$\{list\.length\}`\s*:\s*`\$\{list\.length\} event\$\{list\.length === 1 \? '' : 's'\}`/,
  );
});

// ── Filtered-empty state ────────────────────────────────────────────

test('Filtered-empty shows a Clear-filter button (not just dead air)', () => {
  // Operators recover with one click instead of needing to find the
  // dropdown again or guess what value clears the state.
  assert.match(SRC, /No events of type &ldquo;\{cfg\.typeLabel\(filterType as AuditTimelineEventType\)\}&rdquo;/);
  assert.match(SRC, /onClick=\{\(\) => setFilterType\(''\)\}/);
  assert.match(SRC, />\s*Clear filter\s*</);
});

test('Filtered-empty branch is distinct from the data-empty state (no regression on PR #108)', () => {
  // The data-empty "No audit events yet. New transitions will appear
  // here." paragraph belongs to the 'empty' load state, NOT the
  // ready-but-filter-matches-nothing path. Drift guard ensures the
  // two states stay independently styled.
  assert.match(SRC, /state === 'empty'[\s\S]*?No audit events yet/);
  // The filtered-empty paragraph lives inside the 'ready' branch.
  assert.match(SRC, /state === 'ready'[\s\S]*?visible\.length === 0[\s\S]*?No events of type/);
});

// ── Regression guards (no PR #108/#121 behaviour lost) ───────────────

test('Status-transition headline still reads from before.status / after.status (PR #108 invariant)', () => {
  // PR #108 pinned the "Status from → to" headline shape; PR #134
  // mustn't have collapsed it during the refactor.
  assert.match(SRC, /Status \$\{from\} → \$\{to\}/);
});

test('Exception-ack note still surfaces in the headline (PR #126 invariant)', () => {
  // PR #126's "Exception acknowledged · 'note'" headline pattern
  // must survive the typeLabel refactor.
  assert.match(SRC, /Exception acknowledged · "\$\{note\}"/);
});

test('Re-screen headline still reads from after.sanctionsLastStatus (PR #124 invariant)', () => {
  assert.match(SRC, /Re-screened → \$\{to\.replace/);
});

test('Component is a Client Component (no SSR regression)', () => {
  // Filter state requires client interactivity; the existing
  // 'use client' directive must stay.
  assert.match(SRC, /^'use client';/);
});

test('apiGet path still uses cfg.urlPath + encoded externalId (no fetch regression)', () => {
  assert.match(SRC, /apiGet<\{[\s\S]*?events: AuditTimelineEvent\[\][\s\S]*?\}>\(\s*`\/\$\{cfg\.urlPath\}\/\$\{encodeURIComponent\(externalId\)\}\/history`/);
});

// ── Cross-stack drift: typeLabel covers every event type ─────────────

test('Shipment typeLabel covers every shipment_master_* type from PR #126 enumeration', () => {
  // PR #126 pinned the 5-type set in test/shipment-history-handler.
  // Each must have a typeLabel. The default branch + raw-string
  // fallback would mask a regression at runtime, so a source-pin
  // assertion is the only place this catches.
  for (const t of [
    'shipment_master_created',
    'shipment_master_updated',
    'shipment_master_status_transition',
    'shipment_master_exception_acknowledged',
    'shipment_master_archived',
  ]) {
    assert.match(SRC, new RegExp(`case '${t}': return '[^']+';`),
      `shipment typeLabel missing case for "${t}"`);
  }
});

test('Goods typeLabel covers every goods_master_* type from PR #121 enumeration', () => {
  for (const t of [
    'goods_master_created',
    'goods_master_updated',
    'goods_master_archived',
  ]) {
    assert.match(SRC, new RegExp(`case '${t}': return '[^']+';`),
      `goods typeLabel missing case for "${t}"`);
  }
});

test('Supplier typeLabel covers every supplier_master_* type from PR #124 enumeration', () => {
  // PR #124 extended SUPPLIER_TIMELINE_EVENT_TYPES to 4 types
  // (added rescreened). Each must have a typeLabel.
  for (const t of [
    'supplier_master_created',
    'supplier_master_updated',
    'supplier_master_rescreened',
    'supplier_master_archived',
  ]) {
    assert.match(SRC, new RegExp(`case '${t}': return '[^']+';`),
      `supplier typeLabel missing case for "${t}"`);
  }
});
