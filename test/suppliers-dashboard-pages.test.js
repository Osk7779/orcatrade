'use strict';

// Source-level drift-guard tests for the Suppliers dashboard list +
// detail pages. Same shape as test/goods-dashboard-pages.test.js with
// supplier-specific invariants (sanctions cross-stack drift, cert
// expiry tone, etc.).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const LIST_PATH = path.join(ROOT, 'app-shell', 'app', '(authed)', 'suppliers', 'page.tsx');
const DETAIL_PATH = path.join(ROOT, 'app-shell', 'app', '(authed)', 'suppliers', '[externalId]', 'page.tsx');
const SIDEBAR_PATH = path.join(ROOT, 'app-shell', 'components', 'Sidebar.tsx');
const API_PATH = path.join(ROOT, 'app-shell', 'lib', 'api.ts');

const LIST_SRC = fs.readFileSync(LIST_PATH, 'utf8');
const DETAIL_SRC = fs.readFileSync(DETAIL_PATH, 'utf8');
const SIDEBAR_SRC = fs.readFileSync(SIDEBAR_PATH, 'utf8');
const API_SRC = fs.readFileSync(API_PATH, 'utf8');

// ── List page wiring ──────────────────────────────────────────────────

test('list page fetches GET /suppliers', () => {
  assert.match(LIST_SRC, /apiGet<\{[\s\S]*?suppliers: Supplier\[\][\s\S]*?\}>\(['"]\/suppliers['"]\)/);
});

test('list page rows link to /suppliers/<encoded-id>', () => {
  assert.match(
    LIST_SRC,
    /<Link href=\{`\/suppliers\/\$\{encodeURIComponent\(s\.externalId\)\}`\}/,
  );
});

test('list header counter surfaces total + sanctions-concern count', () => {
  // Total alone isn't enough — ops needs to see the priority number
  // (match + potential_match) at a glance.
  //
  // PR #127 added a sanctions filter dropdown. The header now wraps
  // total + matchCount in a JSX Fragment under the unfiltered branch
  // (so they sit alongside the filter-active "X of Y" template
  // literal). The JSX is split across lines:
  //   {suppliers.length} total
  //   {matchCount > 0 ? ` · ${matchCount} sanctions concern` : ''}
  assert.match(LIST_SRC, /\{suppliers\.length\} total\s*\n\s*\{matchCount > 0 \? ` · \$\{matchCount\} sanctions concern` : ''\}/);
});

test('sanctions badge tones use brand variables (no hard-coded reds/greens)', () => {
  // Drift guard against accidental literal hex. The sanctionsTone
  // helper must route every status to a brand variable.
  const toneFn = LIST_SRC.match(/function sanctionsTone[\s\S]*?^\}/m);
  assert.ok(toneFn, 'sanctionsTone helper not located');
  assert.match(toneFn[0], /var\(--color-critical\)/);
  assert.match(toneFn[0], /var\(--color-positive\)/);
  assert.match(toneFn[0], /var\(--color-warning\)/);
  assert.doesNotMatch(toneFn[0], /#[0-9a-fA-F]{3,6}/);
});

test('trustTone is graded by score band, not a single colour', () => {
  // Trust score is a 0-100 spectrum. A single colour would lose the
  // information density.
  const fn = LIST_SRC.match(/function trustTone[\s\S]*?^\}/m);
  assert.ok(fn, 'trustTone helper not located');
  assert.match(fn[0], /score >= 80/);
  assert.match(fn[0], /score >= 50/);
});

// ── Detail page wiring ────────────────────────────────────────────────

test('detail page params follow the Next 15 Promise-of-params shape', () => {
  assert.match(DETAIL_SRC, /params: Promise<\{ externalId: string \}>/);
  assert.match(DETAIL_SRC, /const \{ externalId \} = use\(params\);/);
});

test('detail page fetches GET /suppliers/<encoded-id>', () => {
  assert.match(
    DETAIL_SRC,
    /apiGet<\{[\s\S]*?supplier: Supplier[\s\S]*?\}>\(`\/suppliers\/\$\{encodeURIComponent\(externalId\)\}`\)/,
  );
});

test('detail page maps 404 to a friendly notFound state', () => {
  assert.match(DETAIL_SRC, /\/404\|not found\/i\.test\(msg\)[\s\S]*?setState\('notFound'\)/);
  assert.match(DETAIL_SRC, /This supplier doesn't exist in your organisation, or it has been archived\./);
});

// ── Sanctions panel ──────────────────────────────────────────────────

test('sanctions panel always renders (status is load-bearing for ops)', () => {
  // Unlike REACH SVHC or audit certs, sanctions is foundational. The
  // panel must render even when status is null ('not screened') so
  // ops sees the gap.
  //
  // PR #124 added onRescreened — the panel can now mutate sanctions
  // state via the re-screen action. Match the panel render but
  // tolerate the additional prop.
  assert.match(DETAIL_SRC, /<SanctionsPanel\s+supplier=\{supplier\}/);
  // And the panel is NOT wrapped in a conditional render — confirm
  // there's no `&& <SanctionsPanel` pattern.
  assert.doesNotMatch(DETAIL_SRC, /&& <SanctionsPanel/);
});

test('sanctions panel uses critical border tone only when flagged', () => {
  // potential_match + match → critical border; everything else stays
  // navy-line. Catches the regression where the panel always renders
  // critical-red even on clear.
  assert.match(DETAIL_SRC, /flagged \? 'var\(--color-critical\)' : 'var\(--color-navy-line\)'/);
});

// ── Audit certs expiry ───────────────────────────────────────────────

test('audit certs panel renders unconditionally so empty suppliers can add the first cert', () => {
  // PR #130 inverted this behaviour to match PR #129's SVHC pattern:
  // the panel ALWAYS renders. Read mode shows "No audit certifications
  // on file yet" + Edit button; edit mode lets the operator add the
  // first cert. The presence-of-data check moved inside the panel.
  //
  // Drift guard against accidentally restoring the conditional,
  // which would make adding certs impossible from the UI.
  assert.match(DETAIL_SRC, /<AuditCertsPanel\s+supplier=\{supplier\}/);
  assert.doesNotMatch(
    DETAIL_SRC,
    /supplier\.auditCerts && supplier\.auditCerts\.length > 0 && \(\s*<AuditCertsPanel/,
  );
});

test('certExpiryTone has three bands: expired (critical), <90d (warning), >=90d (positive)', () => {
  const fn = DETAIL_SRC.match(/function certExpiryTone[\s\S]*?^\}/m);
  assert.ok(fn, 'certExpiryTone helper not located');
  assert.match(fn[0], /days < 0[\s\S]*?var\(--color-critical\)/);
  assert.match(fn[0], /days < 90[\s\S]*?var\(--color-warning\)/);
  assert.match(fn[0], /var\(--color-positive\)/);
});

test('certExpiryLabel formats expired / expiring-soon / valid distinctly', () => {
  const fn = DETAIL_SRC.match(/function certExpiryLabel[\s\S]*?^\}/m);
  assert.ok(fn);
  assert.match(fn[0], /Expired/);
  assert.match(fn[0], /Expires/);
  assert.match(fn[0], /Valid until/);
});

// ── Factory + EUDR + trust-components conditional renders ─────────────

test('factory locations panel renders unconditionally so empty suppliers can add the first site', () => {
  // PR #131 inverted this behaviour to match PR #129's SVHC and PR
  // #130's audit-certs pattern: the panel ALWAYS renders. Read mode
  // shows "No factory locations on file yet" + Edit button; edit
  // mode lets the operator add the first site. The presence-of-data
  // check moved inside the panel.
  //
  // Drift guard against accidentally restoring the conditional,
  // which would block the EUDR Article 9 supply-chain-mapping
  // workflow.
  assert.match(DETAIL_SRC, /<FactoryLocationsPanel\s+supplier=\{supplier\}/);
  assert.doesNotMatch(
    DETAIL_SRC,
    /supplier\.factoryLocations && supplier\.factoryLocations\.length > 0 && \(\s*<FactoryLocationsPanel/,
  );
});

test('EUDR DDS panel renders only when the evidence object has keys', () => {
  assert.match(
    DETAIL_SRC,
    /supplier\.eudrDdsEvidence && Object\.keys\(supplier\.eudrDdsEvidence\)\.length > 0/,
  );
});

test('trust components panel renders only when the object has keys', () => {
  assert.match(
    DETAIL_SRC,
    /supplier\.trustScoreComponents && Object\.keys\(supplier\.trustScoreComponents\)\.length > 0/,
  );
});

// ── Cross-stack sanctions-status drift guard ──────────────────────────

test('SupplierSanctionsStatus union matches SANCTIONS_STATUSES in lib/db/suppliers.js exactly', () => {
  // The classic cross-stack drift: a new status lands in the data
  // layer but the frontend types don't know about it, so the badge
  // falls through to the neutral fallback silently. Pin both
  // directions.
  const dbSuppliers = require(path.join(ROOT, 'lib', 'db', 'suppliers'));
  const tsUnion = API_SRC.match(/export type SupplierSanctionsStatus =([^;]+);/);
  assert.ok(tsUnion, 'SupplierSanctionsStatus union not located');
  const tsValues = (tsUnion[1].match(/'([a-z_]+)'/g) || []).map((s) => s.replace(/'/g, '')).sort();
  const dbValues = [...dbSuppliers.SANCTIONS_STATUSES].sort();
  assert.deepEqual(tsValues, dbValues,
    `SupplierSanctionsStatus drifted from SANCTIONS_STATUSES: TS=${JSON.stringify(tsValues)} vs DB=${JSON.stringify(dbValues)}`);
});

// ── Types live in the shared lib (no inline duplication) ──────────────

test('Supplier + AuditCert + FactoryLocation types are exported from @/lib/api', () => {
  assert.match(API_SRC, /export interface Supplier \{/);
  assert.match(API_SRC, /export interface AuditCert \{/);
  assert.match(API_SRC, /export interface FactoryLocation \{/);
  const listImport = LIST_SRC.match(/import \{[\s\S]*?\} from '@\/lib\/api';/);
  assert.ok(listImport);
  assert.match(listImport[0], /type Supplier\b/);
  const detailImport = DETAIL_SRC.match(/import \{[\s\S]*?\} from '@\/lib\/api';/);
  assert.ok(detailImport);
  assert.match(detailImport[0], /type Supplier\b/);
});

// ── Sidebar nav entry ─────────────────────────────────────────────────

test('Sidebar has a Suppliers entry under the Trade group', () => {
  assert.match(
    SIDEBAR_SRC,
    /heading: 'Trade',[\s\S]*?\{ label: 'Suppliers', href: '\/suppliers', inApp: true \}/,
  );
});

test('Sidebar order: Plans → Goods → Suppliers → Shipments (sourcing funnel)', () => {
  // The semantic chain: Plans (the wizard's saved output) → Goods
  // (what we ship) → Suppliers (who we ship from) → Shipments (the
  // actual movements). Pin the ordering.
  const tradeBlock = SIDEBAR_SRC.match(/heading: 'Trade',[\s\S]*?items: \[([\s\S]*?)\]/);
  assert.ok(tradeBlock);
  const itemNames = (tradeBlock[1].match(/label: '([^']+)'/g) || []).map((s) => s.match(/'([^']+)'/)[1]);
  const plansIdx = itemNames.indexOf('Plans');
  const goodsIdx = itemNames.indexOf('Goods');
  const suppliersIdx = itemNames.indexOf('Suppliers');
  const shipmentsIdx = itemNames.indexOf('Shipments');
  assert.ok(
    plansIdx >= 0 && goodsIdx > plansIdx && suppliersIdx > goodsIdx && shipmentsIdx > suppliersIdx,
    `expected Plans < Goods < Suppliers < Shipments in Sidebar Trade group, got: ${itemNames.join(' / ')}`,
  );
});

// ── Layout discipline ────────────────────────────────────────────────

test('both pages are Client Components (use hooks + apiGet)', () => {
  assert.match(LIST_SRC, /^'use client';/);
  assert.match(DETAIL_SRC, /^'use client';/);
});
