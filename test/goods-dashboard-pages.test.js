'use strict';

// Source-level drift-guard tests for the Goods dashboard list + detail
// pages. Same shape as test/shipments-dashboard-page.test.js and
// test/shipment-detail-page.test.js — app-shell has no React test
// runner; we read the source and pin structural invariants.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const LIST_PATH = path.join(ROOT, 'app-shell', 'app', '(authed)', 'goods', 'page.tsx');
const DETAIL_PATH = path.join(ROOT, 'app-shell', 'app', '(authed)', 'goods', '[externalId]', 'page.tsx');
const SIDEBAR_PATH = path.join(ROOT, 'app-shell', 'components', 'Sidebar.tsx');
const API_PATH = path.join(ROOT, 'app-shell', 'lib', 'api.ts');

const LIST_SRC = fs.readFileSync(LIST_PATH, 'utf8');
const DETAIL_SRC = fs.readFileSync(DETAIL_PATH, 'utf8');
const SIDEBAR_SRC = fs.readFileSync(SIDEBAR_PATH, 'utf8');
const API_SRC = fs.readFileSync(API_PATH, 'utf8');

// ── List page wiring ──────────────────────────────────────────────────

test('list page fetches GET /goods', () => {
  assert.match(LIST_SRC, /apiGet<\{[\s\S]*?goods: Goods\[\][\s\S]*?\}>\(['"]\/goods['"]\)/);
});

test('list page rows link to /goods/<encoded-id>', () => {
  assert.match(
    LIST_SRC,
    /<Link href=\{`\/goods\/\$\{encodeURIComponent\(g\.externalId\)\}`\}/,
  );
});

test('list page header surfaces total count + CBAM-in-scope count', () => {
  assert.match(LIST_SRC, /\{goods\.length\} total · \{cbamCount\} CBAM-in-scope/);
});

test('list page CBAM badge uses the warning brand colour (not a hard-coded amber)', () => {
  // The CBAM "In scope" badge must use the brand variable so the
  // theme can swap without code churn. Catches the regression where
  // someone drops in a literal hex.
  const badgeBlock = LIST_SRC.match(/g\.cbamInScope && \([\s\S]*?<\/span>\s*\)/);
  assert.ok(badgeBlock, 'CBAM badge block not located');
  assert.match(badgeBlock[0], /var\(--color-warning\)/);
});

test('list page empty-state cross-links to the /start wizard (the place goods get created)', () => {
  // Discoverability: a user with no goods needs to know where to go
  // to create one. Goods are inherited from the wizard via PR #94.
  assert.match(LIST_SRC, /No goods saved yet/);
  assert.match(LIST_SRC, /<Link href="\/start"/);
});

// ── Detail page wiring ────────────────────────────────────────────────

test('detail page params follow the Next 15 Promise-of-params shape', () => {
  assert.match(DETAIL_SRC, /params: Promise<\{ externalId: string \}>/);
  assert.match(DETAIL_SRC, /const \{ externalId \} = use\(params\);/);
});

test('detail page fetches GET /goods/<encoded-id>', () => {
  assert.match(
    DETAIL_SRC,
    /apiGet<\{[\s\S]*?goods: Goods[\s\S]*?\}>\(`\/goods\/\$\{encodeURIComponent\(externalId\)\}`\)/,
  );
});

test('detail page maps 404 to a friendly notFound state', () => {
  assert.match(DETAIL_SRC, /\/404\|not found\/i\.test\(msg\)[\s\S]*?setState\('notFound'\)/);
  assert.match(DETAIL_SRC, /This good doesn't exist in your organisation, or it has been archived\./);
});

// ── REACH SVHC + restricted substances render guards ──────────────────

test('REACH SVHC panel renders only when reachSvhcFlags has at least one entry', () => {
  // Catching the regression where an empty array shows an empty
  // "0 declared" panel.
  assert.match(
    DETAIL_SRC,
    /goods\.reachSvhcFlags && goods\.reachSvhcFlags\.length > 0/,
  );
});

test('restricted-substances panel renders only when the object has at least one key', () => {
  assert.match(
    DETAIL_SRC,
    /goods\.restrictedSubstances && Object\.keys\(goods\.restrictedSubstances\)\.length > 0/,
  );
});

test('REACH SVHC panel uses the warning brand colour (not a critical red)', () => {
  // REACH SVHC flags are an advisory disclosure, not a stop-ship
  // condition. Critical-red would over-signal.
  const panelMatch = DETAIL_SRC.match(/function ReachSvhcPanel[\s\S]*?^\}/m);
  assert.ok(panelMatch);
  assert.match(panelMatch[0], /var\(--color-warning\)/);
  assert.doesNotMatch(panelMatch[0], /var\(--color-critical\)/);
});

test('restricted-substances panel uses a <details> element (collapsible, no JS state)', () => {
  const panelMatch = DETAIL_SRC.match(/function RestrictedSubstancesPanel[\s\S]*?^\}/m);
  assert.ok(panelMatch);
  assert.match(panelMatch[0], /<details/);
  assert.match(panelMatch[0], /<summary/);
});

// ── Types live in the shared lib (no inline duplication) ──────────────

test('Goods + ReachSvhcFlag types are exported from @/lib/api (not inlined in either page)', () => {
  assert.match(API_SRC, /export interface Goods \{/);
  assert.match(API_SRC, /export interface ReachSvhcFlag \{/);
  // Both pages import Goods from @/lib/api.
  const listImport = LIST_SRC.match(/import \{[\s\S]*?\} from '@\/lib\/api';/);
  assert.ok(listImport);
  assert.match(listImport[0], /type Goods\b/);
  const detailImport = DETAIL_SRC.match(/import \{[\s\S]*?\} from '@\/lib\/api';/);
  assert.ok(detailImport);
  assert.match(detailImport[0], /type Goods\b/);
});

// ── Sidebar nav entry ─────────────────────────────────────────────────

test('Sidebar has a Goods entry under the Trade group', () => {
  assert.match(
    SIDEBAR_SRC,
    /heading: 'Trade',[\s\S]*?\{ label: 'Goods', href: '\/goods', inApp: true \}/,
  );
});

test('Sidebar places Goods between Plans and Shipments', () => {
  // Plans → Goods (the master records that feed plans) → Shipments
  // (the operational entity that consumes them via promotion).
  const tradeBlock = SIDEBAR_SRC.match(/heading: 'Trade',[\s\S]*?items: \[([\s\S]*?)\]/);
  assert.ok(tradeBlock);
  const itemNames = (tradeBlock[1].match(/label: '([^']+)'/g) || []).map((s) => s.match(/'([^']+)'/)[1]);
  const plansIdx = itemNames.indexOf('Plans');
  const goodsIdx = itemNames.indexOf('Goods');
  const shipmentsIdx = itemNames.indexOf('Shipments');
  assert.ok(plansIdx >= 0 && goodsIdx > plansIdx && shipmentsIdx > goodsIdx,
    `expected Plans < Goods < Shipments in Sidebar Trade group, got: ${itemNames.join(' / ')}`);
});

// ── Layout discipline ────────────────────────────────────────────────

test('both pages are Client Components (use hooks + apiGet)', () => {
  assert.match(LIST_SRC, /^'use client';/);
  assert.match(DETAIL_SRC, /^'use client';/);
});
