'use strict';

// Source-level drift-guard tests for the goods + suppliers list-page
// filters. Mirrors the shipments-status-filter pattern from PR #125:
//   - Closed-taxonomy iterable with cross-stack drift guards
//   - Suspense wrapper (Next.js 15 useSearchParams requirement)
//   - URL state via useSearchParams + router.replace
//   - Per-bucket counts in dropdown labels (off the full list,
//     stable as the user filters)
//   - Distinct empty-states (data-empty vs filtered-empty)
//   - aria-label on the dropdown
//
// Same regex/source-pin approach used since PR #98.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const GOODS_PAGE = path.join(ROOT, 'app-shell', 'app', '(authed)', 'goods', 'page.tsx');
const SUPPLIERS_PAGE = path.join(ROOT, 'app-shell', 'app', '(authed)', 'suppliers', 'page.tsx');
const API_PATH = path.join(ROOT, 'app-shell', 'lib', 'api.ts');
const DB_SUPPLIERS = path.join(ROOT, 'lib', 'db', 'suppliers.js');

const GOODS_SRC = fs.readFileSync(GOODS_PAGE, 'utf8');
const SUP_SRC = fs.readFileSync(SUPPLIERS_PAGE, 'utf8');
const API_SRC = fs.readFileSync(API_PATH, 'utf8');
const DB_SUP_SRC = fs.readFileSync(DB_SUPPLIERS, 'utf8');

// ── Goods CBAM filter ────────────────────────────────────────────────

test('Goods page wraps the view in Suspense (Next.js 15 useSearchParams requirement)', () => {
  assert.match(GOODS_SRC, /export default function GoodsListPage\(\) \{[\s\S]*?<Suspense\b[\s\S]*?<GoodsListView \/>/);
});

test('Goods readCbamFilter is a closed-taxonomy guard (only "in_scope" or "out_of_scope")', () => {
  // Stale URLs and typos must fall back to "no filter" rather than
  // showing an empty list. Drift guard reads the helper.
  const fnBlock = GOODS_SRC.match(/function readCbamFilter\(raw: string \| null\): CbamFilter \| null \{[\s\S]*?\n\}/);
  assert.ok(fnBlock, 'readCbamFilter not located');
  const block = fnBlock[0];
  assert.match(block, /raw === 'in_scope' \|\| raw === 'out_of_scope'/);
  assert.match(block, /return null;/);
});

test('Goods list reads ?cbam= from useSearchParams', () => {
  assert.match(GOODS_SRC, /const searchParams = useSearchParams\(\)/);
  assert.match(GOODS_SRC, /const activeFilter = readCbamFilter\(searchParams\.get\('cbam'\)\)/);
});

test('Goods setFilter removes ?cbam= when "" is selected (clean URLs)', () => {
  assert.match(GOODS_SRC, /if \(!next\) \{\s*params\.delete\('cbam'\)/);
});

test('Goods setFilter uses router.replace (not push) so filter changes do not pollute history', () => {
  assert.match(GOODS_SRC, /router\.replace\(qs \? `\$\{pathname\}\?\$\{qs\}` : pathname\)/);
});

test('Goods dropdown has three options (All / In scope / Out of scope) with counts', () => {
  assert.match(GOODS_SRC, /<option value="">All \(\{goods\.length\}\)<\/option>/);
  assert.match(GOODS_SRC, /<option value="in_scope">CBAM in scope \(\{cbamInCount\}\)<\/option>/);
  assert.match(GOODS_SRC, /<option value="out_of_scope">CBAM out of scope \(\{cbamOutCount\}\)<\/option>/);
});

test('Goods dropdown carries aria-label', () => {
  assert.match(GOODS_SRC, /aria-label="Filter goods by CBAM scope"/);
});

test('Goods filter applies to visibleGoods via useMemo', () => {
  assert.match(GOODS_SRC, /const visibleGoods = useMemo\(\(\) => \{/);
  assert.match(GOODS_SRC, /activeFilter === 'in_scope' \? g\.cbamInScope : !g\.cbamInScope/);
});

test('Goods cbamInCount is computed off the FULL list (stable dropdown labels)', () => {
  const memoBlock = GOODS_SRC.match(/const cbamInCount = useMemo\([\s\S]*?\}, \[([^\]]+)\]\)/);
  assert.ok(memoBlock, 'cbamInCount memo not located');
  const deps = memoBlock[1];
  assert.match(deps, /\bgoods\b/);
  assert.doesNotMatch(deps, /visibleGoods/);
});

test('Goods header counter reads "X of Y" filtered, "X total · N CBAM-in-scope" unfiltered', () => {
  assert.match(GOODS_SRC, /activeFilter\s*\?\s*`\$\{visibleGoods\.length\} of \$\{goods\.length\}`\s*:\s*`\$\{goods\.length\} total · \$\{cbamInCount\} CBAM-in-scope`/);
});

test('Goods filtered-empty state shows a Clear-filter button', () => {
  assert.match(GOODS_SRC, /No goods matching this filter/);
  assert.match(GOODS_SRC, /onClick=\{\(\) => setFilter\(''\)\}/);
  assert.match(GOODS_SRC, />\s*Clear filter\s*</);
});

test('Goods data-empty state (no records at all) preserved (no regression)', () => {
  assert.match(GOODS_SRC, /goods\.length === 0/);
  assert.match(GOODS_SRC, /No goods saved yet/);
});

// ── Suppliers sanctions filter ───────────────────────────────────────

test('SUPPLIER_SANCTIONS_STATUSES is exported as a frozen ReadonlyArray', () => {
  assert.match(API_SRC, /export const SUPPLIER_SANCTIONS_STATUSES: ReadonlyArray<SupplierSanctionsStatus> = Object\.freeze\(\[/);
});

test('SUPPLIER_SANCTIONS_STATUSES contents match the SupplierSanctionsStatus union exactly', () => {
  const unionBlock = API_SRC.match(/export type SupplierSanctionsStatus = ([^;]+);/);
  assert.ok(unionBlock, 'SupplierSanctionsStatus union not located');
  const unionValues = (unionBlock[1].match(/'([a-z_]+)'/g) || []).map((s) => s.replace(/'/g, '')).sort();

  const arrayBlock = API_SRC.match(/SUPPLIER_SANCTIONS_STATUSES: ReadonlyArray<SupplierSanctionsStatus> = Object\.freeze\(\[([\s\S]*?)\]\)/);
  assert.ok(arrayBlock, 'SUPPLIER_SANCTIONS_STATUSES not located');
  const arrayValues = (arrayBlock[1].match(/'([a-z_]+)'/g) || []).map((s) => s.replace(/'/g, '')).sort();

  assert.deepEqual(arrayValues, unionValues,
    `Drift: union=${JSON.stringify(unionValues)} array=${JSON.stringify(arrayValues)}`);
});

test('SUPPLIER_SANCTIONS_STATUSES matches the backend SANCTIONS_STATUSES in lib/db/suppliers.js', () => {
  // Cross-stack drift guard — backend uses these values for CHECK
  // constraints + validateForUpdate. A mismatch would let the UI
  // filter to a status the backend would never write.
  const arrayBlock = API_SRC.match(/SUPPLIER_SANCTIONS_STATUSES: ReadonlyArray<SupplierSanctionsStatus> = Object\.freeze\(\[([\s\S]*?)\]\)/);
  assert.ok(arrayBlock);
  const tsValues = (arrayBlock[1].match(/'([a-z_]+)'/g) || []).map((s) => s.replace(/'/g, '')).sort();

  const dbBlock = DB_SUP_SRC.match(/SANCTIONS_STATUSES = Object\.freeze\(\[([\s\S]*?)\]\)/);
  assert.ok(dbBlock, 'SANCTIONS_STATUSES not located in lib/db/suppliers.js');
  const dbValues = (dbBlock[1].match(/'([a-z_]+)'/g) || []).map((s) => s.replace(/'/g, '')).sort();

  assert.deepEqual(tsValues, dbValues,
    `Cross-stack drift: api.ts=${JSON.stringify(tsValues)} vs lib/db/suppliers.js=${JSON.stringify(dbValues)}`);
});

test('Suppliers page wraps the view in Suspense', () => {
  assert.match(SUP_SRC, /export default function SuppliersListPage\(\) \{[\s\S]*?<Suspense\b[\s\S]*?<SuppliersListView \/>/);
});

test('Suppliers readSanctionsFilter handles the not_screened pseudo-value + closed taxonomy', () => {
  const fnBlock = SUP_SRC.match(/function readSanctionsFilter\(raw: string \| null\): SanctionsFilter \| null \{[\s\S]*?\n\}/);
  assert.ok(fnBlock, 'readSanctionsFilter not located');
  const block = fnBlock[0];
  // not_screened is a UI-only pseudo-status — accepted explicitly.
  assert.match(block, /if \(raw === 'not_screened'\) return raw;/);
  // Real statuses validated against the closed taxonomy.
  assert.match(block, /SUPPLIER_SANCTIONS_STATUSES as ReadonlyArray<string>/);
  assert.match(block, /\.includes\(raw\)/);
  assert.match(block, /\? \(raw as SupplierSanctionsStatus\)\s*:\s*null/);
});

test('Suppliers matchesFilter routes not_screened to null sanctionsLastStatus', () => {
  // The pseudo-value 'not_screened' selects suppliers where the
  // sanctions field is null — distinct from any real status.
  assert.match(SUP_SRC, /if \(filter === 'not_screened'\) return s\.sanctionsLastStatus == null;/);
});

test('Suppliers list reads ?sanctions= from useSearchParams', () => {
  assert.match(SUP_SRC, /const activeFilter = readSanctionsFilter\(searchParams\.get\('sanctions'\)\)/);
});

test('Suppliers setFilter removes ?sanctions= when "" is selected', () => {
  assert.match(SUP_SRC, /if \(!next\) \{\s*params\.delete\('sanctions'\)/);
});

test('Suppliers dropdown iterates SUPPLIER_SANCTIONS_STATUSES + adds the not_screened option', () => {
  // Iterates the closed taxonomy (adding a status to the union+
  // array automatically extends the dropdown).
  assert.match(SUP_SRC, /\{SUPPLIER_SANCTIONS_STATUSES\.map\(\(s\) => \(/);
  assert.match(SUP_SRC, /<option key=\{s\} value=\{s\}>/);
  // not_screened option is appended after the closed-taxonomy
  // options.
  assert.match(SUP_SRC, /<option value="not_screened">/);
});

test('Suppliers dropdown carries aria-label', () => {
  assert.match(SUP_SRC, /aria-label="Filter suppliers by sanctions status"/);
});

test('Suppliers countByStatus is computed off the FULL list (stable dropdown labels)', () => {
  const memoBlock = SUP_SRC.match(/const countByStatus = useMemo\([\s\S]*?\}, \[([^\]]+)\]\);/);
  assert.ok(memoBlock, 'countByStatus useMemo not located');
  const deps = memoBlock[1];
  assert.match(deps, /\bsuppliers\b/);
  assert.doesNotMatch(deps, /visibleSuppliers/);
});

test('Suppliers visibleSuppliers filtered via useMemo + matchesFilter', () => {
  assert.match(SUP_SRC, /const visibleSuppliers = useMemo\(\(\) => \{/);
  assert.match(SUP_SRC, /suppliers\.filter\(\(s\) => matchesFilter\(s, activeFilter\)\)/);
});

test('Suppliers header counter reads "X of Y" filtered, "X total · …" unfiltered (preserves sanctions concern surface)', () => {
  // When unfiltered, the existing matchCount surface is preserved:
  // "12 total · 2 sanctions concern".
  // Filtered case is a template literal; unfiltered case is a JSX
  // Fragment so the curly-brace syntax differs.
  assert.match(SUP_SRC, /activeFilter\s*\?\s*`\$\{visibleSuppliers\.length\} of \$\{suppliers\.length\}`/);
  // JSX Fragment shape: {suppliers.length} total\n{matchCount > 0 ? …}
  assert.match(SUP_SRC, /\{suppliers\.length\} total\s*\n\s*\{matchCount > 0/);
});

test('Suppliers filtered-empty state shows a Clear-filter button', () => {
  assert.match(SUP_SRC, /No suppliers matching this filter/);
  assert.match(SUP_SRC, /onClick=\{\(\) => setFilter\(''\)\}/);
  assert.match(SUP_SRC, />\s*Clear filter\s*</);
});

test('Suppliers data-empty state preserved (no regression)', () => {
  assert.match(SUP_SRC, /suppliers\.length === 0/);
  assert.match(SUP_SRC, /No suppliers saved yet/);
});

// ── Regression guards on existing dashboard surface ──────────────────

test('Goods table columns unchanged (SKU / Display name / HS code / Origin / CBAM / Typical value)', () => {
  for (const header of ['SKU', 'Display name', 'HS code', 'Origin', 'CBAM', 'Typical value']) {
    assert.match(GOODS_SRC, new RegExp(`>${header}<`),
      `column header "${header}" missing in goods list`);
  }
});

test('Suppliers table columns unchanged (Entity / HQ / Form / Sanctions / Trust score)', () => {
  for (const header of ['Entity', 'HQ', 'Form', 'Sanctions', 'Trust score']) {
    assert.match(SUP_SRC, new RegExp(`>${header}<`),
      `column header "${header}" missing in suppliers list`);
  }
});
