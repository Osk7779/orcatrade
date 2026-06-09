'use strict';

// Source-level drift-guard tests for the TransitionHistory component
// + its wire-up into the shipment detail page. Mirrors the pattern of
// test/related-shipments-component.test.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const COMP_PATH = path.join(ROOT, 'app-shell', 'components', 'TransitionHistory.tsx');
const DETAIL_PATH = path.join(ROOT, 'app-shell', 'app', '(authed)', 'shipments', '[externalId]', 'page.tsx');
const API_PATH = path.join(ROOT, 'app-shell', 'lib', 'api.ts');

const COMP_SRC = fs.readFileSync(COMP_PATH, 'utf8');
const DETAIL_SRC = fs.readFileSync(DETAIL_PATH, 'utf8');
const API_SRC = fs.readFileSync(API_PATH, 'utf8');

// ── Fetch wiring ──────────────────────────────────────────────────────

test('component fetches GET /shipments/<encoded-id>/history', () => {
  assert.match(
    COMP_SRC,
    /apiGet<\{[\s\S]*?events: ShipmentTimelineEvent\[\][\s\S]*?\}>\(\s*`\/shipments\/\$\{encodeURIComponent\(externalId\)\}\/history`/,
  );
});

// ── Headline derivation ───────────────────────────────────────────────

test('status_transition headline reads from before.status / after.status', () => {
  // The headline must show both ends ("Status planned → booked") not
  // just the after — losing the from-side loses provenance value.
  assert.match(COMP_SRC, /Status \$\{from\} → \$\{to\}/);
});

test('every timeline event type has a dedicated headline branch (no generic fallback for known types)', () => {
  // The 5 types in the SHIPMENT_TIMELINE_EVENT_TYPES backend set
  // must each have a switch case here. Adding a new type backend-
  // side without updating the headline switch silently falls through
  // to String(e.type) — a poor UX.
  const fn = COMP_SRC.match(/function eventHeadline[\s\S]*?^\}/m);
  assert.ok(fn);
  for (const t of [
    'shipment_master_created',
    'shipment_master_status_transition',
    'shipment_master_exception_acknowledged',
    'shipment_master_updated',
    'shipment_master_archived',
  ]) {
    assert.match(fn[0], new RegExp(`case '${t}'`), `eventHeadline missing case for "${t}"`);
  }
});

// ── Tone discipline ──────────────────────────────────────────────────

test('eventTone uses brand variables only (no hex)', () => {
  const fn = COMP_SRC.match(/function eventTone[\s\S]*?^\}/m);
  assert.ok(fn);
  assert.match(fn[0], /var\(--color-warning\)/);
  assert.match(fn[0], /var\(--color-ivory-mute\)/);
  assert.match(fn[0], /var\(--color-positive\)/);
  assert.match(fn[0], /var\(--color-ivory\)/);
  assert.doesNotMatch(fn[0], /#[0-9a-fA-F]{3,6}/);
});

// ── Detail row composition ───────────────────────────────────────────

test('actor email-hash is rendered redacted (first 8 chars only, prefixed with "actor")', () => {
  // A full email-hash leak is benign cryptographically but noisy in
  // the UI. The display convention is "actor <8 hex>" — short enough
  // to differentiate two actors without dominating the row. The
  // value is rendered as a JSX expression, not a template literal —
  // so the regex matches the literal text plus the JSX `{…slice(0, 8)}`.
  assert.match(COMP_SRC, /event\.actorEmailHash\.slice\(0, 8\)/);
  assert.match(COMP_SRC, /· actor \{event\.actorEmailHash\.slice\(0, 8\)\}/);
});

test('detail jsonb is rendered in a collapsible <details> only when non-empty', () => {
  assert.match(
    COMP_SRC,
    /event\.detail && Object\.keys\(event\.detail\)\.length > 0/,
  );
  assert.match(COMP_SRC, /<details/);
  assert.match(COMP_SRC, /<summary/);
});

// ── Load states ──────────────────────────────────────────────────────

test('component handles 5 load states (loading / auth / error / empty / ready)', () => {
  // Surface-area discipline: every async UI must handle each
  // outcome explicitly. Drift-guard against a regression where the
  // empty state is collapsed into ready (an empty timeline silently
  // looks like a broken page).
  assert.match(COMP_SRC, /'loading'/);
  assert.match(COMP_SRC, /'auth'/);
  assert.match(COMP_SRC, /'error'/);
  assert.match(COMP_SRC, /'empty'/);
  assert.match(COMP_SRC, /'ready'/);
});

test('empty-state copy explains transitions will appear here (not just "no events")', () => {
  // Honest UX: a new shipment with no transitions yet should look
  // like a fresh timeline, not a broken page.
  assert.match(COMP_SRC, /No audit events yet\. New transitions will appear here\./);
});

// ── Cross-stack drift guard: types match backend whitelist ───────────

test('ShipmentTimelineEventType union matches SHIPMENT_TIMELINE_EVENT_TYPES in the handler exactly', () => {
  // The TS union and the runtime backend whitelist must agree.
  // Adding a type to one without the other silently breaks the
  // timeline (handler filters it out, or UI ignores it). Pin both
  // directions.
  const handlerSrc = fs.readFileSync(
    path.join(ROOT, 'lib', 'handlers', 'shipments.js'),
    'utf8',
  );
  const handlerBlock = handlerSrc.match(/SHIPMENT_TIMELINE_EVENT_TYPES = new Set\(\[([\s\S]*?)\]\)/);
  assert.ok(handlerBlock, 'backend set not located');
  const backendValues = (handlerBlock[1].match(/'([a-z_]+)'/g) || []).map((s) => s.replace(/'/g, '')).sort();

  const tsUnion = API_SRC.match(/export type ShipmentTimelineEventType =([^;]+);/);
  assert.ok(tsUnion, 'TS union not located');
  const tsValues = (tsUnion[1].match(/'([a-z_]+)'/g) || []).map((s) => s.replace(/'/g, '')).sort();

  assert.deepEqual(
    tsValues,
    backendValues,
    `Cross-stack drift: TS=${JSON.stringify(tsValues)} vs backend=${JSON.stringify(backendValues)}`,
  );
});

// ── Detail page wiring ───────────────────────────────────────────────

test('shipment detail page imports + renders <TransitionHistory externalId={shipment.externalId} />', () => {
  assert.match(DETAIL_SRC, /import \{ TransitionHistory \} from '@\/components\/TransitionHistory';/);
  assert.match(DETAIL_SRC, /<TransitionHistory externalId=\{shipment\.externalId\} \/>/);
});

test('component is a Client Component', () => {
  assert.match(COMP_SRC, /^'use client';/);
});
