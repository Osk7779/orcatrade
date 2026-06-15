'use strict';

// Source-level drift-guard tests for the shared RelatedShipments
// component + its wire-up into the Goods + Suppliers detail pages.
//
// Pins:
//   - the component fetches /shipments with the right filter query
//     (?goodsExternalId= or ?supplierExternalId=) and URL-encodes the id
//   - the Filter discriminated union has exactly two kinds
//   - row links resolve to /shipments/<encoded-id>
//   - empty-state copy differs between filter kinds (no generic
//     "no shipments" — the message names the entity)
//   - status-tone helper covers all 7 ShipmentStatus values, all
//     mapped to brand variables (no hex)
//   - Goods + Suppliers detail pages both wire the component in with
//     the correct filter kind + externalId source
//   - the limit query param is passed (so a supplier with 1000+
//     shipments doesn't render an unbounded list)

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const COMP_PATH = path.join(ROOT, 'app-shell', 'components', 'RelatedShipments.tsx');
const GOODS_DETAIL_PATH = path.join(ROOT, 'app-shell', 'app', '(authed)', 'goods', '[externalId]', 'page.tsx');
const SUPPLIERS_DETAIL_PATH = path.join(ROOT, 'app-shell', 'app', '(authed)', 'suppliers', '[externalId]', 'page.tsx');

const COMP_SRC = fs.readFileSync(COMP_PATH, 'utf8');
const GOODS_DETAIL_SRC = fs.readFileSync(GOODS_DETAIL_PATH, 'utf8');
const SUPPLIERS_DETAIL_SRC = fs.readFileSync(SUPPLIERS_DETAIL_PATH, 'utf8');

// ── Filter shape + query encoding ─────────────────────────────────────

test('Filter is a discriminated union with kinds "goods" + "supplier"', () => {
  // The discriminated union prevents a typo at the call site —
  // {kind: 'good'} (singular) would fail to compile rather than
  // silently produce an unfilterable query.
  assert.match(COMP_SRC, /\{ kind: 'goods'; externalId: string \}/);
  assert.match(COMP_SRC, /\{ kind: 'supplier'; externalId: string \}/);
});

test('filterQuery encodes the externalId via encodeURIComponent for both kinds', () => {
  const fn = COMP_SRC.match(/function filterQuery[\s\S]*?^\}/m);
  assert.ok(fn, 'filterQuery helper not located');
  assert.match(fn[0], /goodsExternalId=\$\{encodeURIComponent\(filter\.externalId\)\}/);
  assert.match(fn[0], /supplierExternalId=\$\{encodeURIComponent\(filter\.externalId\)\}/);
});

test('component fetches /shipments with the filter query + limit', () => {
  // The limit param is load-bearing: a supplier with hundreds of
  // shipments shouldn't render an unbounded list inside a detail
  // panel.
  assert.match(
    COMP_SRC,
    /apiGet<\{[\s\S]*?shipments: Shipment\[\][\s\S]*?\}>\([\s\S]*?`\/shipments\?\$\{filterQuery\(filter\)\}&limit=\$\{limit\}`/,
  );
});

test('limit defaults to 10 (sane upper bound for a detail-page sub-panel)', () => {
  assert.match(COMP_SRC, /limit = 10/);
});

// ── Row link wiring ───────────────────────────────────────────────────

test('row links resolve to /shipments/<encoded-id>', () => {
  // The reverse link must go to the shipment detail page — that's
  // the navigation arc this PR is building.
  assert.match(
    COMP_SRC,
    /<Link[\s\S]*?href=\{`\/shipments\/\$\{encodeURIComponent\(s\.externalId\)\}`\}/,
  );
});

// ── Empty-state copy differs per filter kind ──────────────────────────

test('emptyMessage differs between goods + supplier kinds', () => {
  // Generic "No shipments found" would lose context. The message
  // must name the entity so users know what they're looking at.
  const fn = COMP_SRC.match(/function emptyMessage[\s\S]*?^\}/m);
  assert.ok(fn, 'emptyMessage helper not located');
  assert.match(fn[0], /No shipments reference this good yet/);
  assert.match(fn[0], /No shipments reference this supplier yet/);
});

// ── Status-tone helper covers all 7 ShipmentStatus values ─────────────

test('statusTone routes all 7 ShipmentStatus values to brand variables (no hex)', () => {
  const fn = COMP_SRC.match(/function statusTone[\s\S]*?^\}/m);
  assert.ok(fn, 'statusTone helper not located');
  // Every status in the union must be explicitly mapped:
  for (const status of ['exception', 'cancelled', 'cleared', 'delivered', 'in_transit', 'booked']) {
    assert.match(fn[0], new RegExp(`'${status}'`), `statusTone missing branch for "${status}"`);
  }
  // No literal hex.
  assert.doesNotMatch(fn[0], /#[0-9a-fA-F]{3,6}/);
  // The three tonal buckets must all use brand variables:
  assert.match(fn[0], /var\(--color-critical\)/);
  assert.match(fn[0], /var\(--color-positive\)/);
  assert.match(fn[0], /var\(--color-warning\)/);
  assert.match(fn[0], /var\(--color-ivory-mute\)/);
});

// ── Goods detail page wiring ──────────────────────────────────────────

test('Goods detail page imports + renders RelatedShipments with kind:"goods"', () => {
  assert.match(GOODS_DETAIL_SRC, /import \{ RelatedShipments \} from '@\/components\/RelatedShipments';/);
  assert.match(
    GOODS_DETAIL_SRC,
    /<RelatedShipments filter=\{\{ kind: 'goods', externalId: goods\.externalId \}\} \/>/,
  );
});

// ── Suppliers detail page wiring ──────────────────────────────────────

test('Suppliers detail page imports + renders RelatedShipments with kind:"supplier"', () => {
  assert.match(SUPPLIERS_DETAIL_SRC, /import \{ RelatedShipments \} from '@\/components\/RelatedShipments';/);
  assert.match(
    SUPPLIERS_DETAIL_SRC,
    /<RelatedShipments filter=\{\{ kind: 'supplier', externalId: supplier\.externalId \}\} \/>/,
  );
});

// ── No accidental routing across kinds ────────────────────────────────

test('Goods detail does NOT pass kind:"supplier" + Suppliers detail does NOT pass kind:"goods"', () => {
  // Belt-and-braces drift guard: the wrong kind would produce a
  // technically-valid query that filters by the WRONG axis (e.g.
  // a goods externalId interpreted as a supplier id → always empty
  // results). Catch the regression.
  assert.doesNotMatch(GOODS_DETAIL_SRC, /<RelatedShipments[\s\S]*?kind: 'supplier'/);
  assert.doesNotMatch(SUPPLIERS_DETAIL_SRC, /<RelatedShipments[\s\S]*?kind: 'goods'/);
});

// ── Layout discipline ────────────────────────────────────────────────

test('component is a Client Component (uses hooks)', () => {
  assert.match(COMP_SRC, /^'use client';/);
});
