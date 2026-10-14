'use strict';

// Sprint 14 — org-scoped activity feed.
//
// Tests cover three layers:
//   1. events.listForOrg — server-side org-scoping + type allowlist
//   2. /api/activity handler — auth gate + response shape (drift-guard
//      against the handler source, since spinning up a Next.js dev
//      server in unit tests is heavy)
//   3. Dashboard widget — source-pinned drift-guard on the TS mirror
//      types + summary helper coverage
//
// The activity feed touches every entity in the operator wedge, so a
// silent regression here (e.g. dropping events for one entity type)
// would surface as "the dashboard widget went quiet for half the
// activity" rather than as a test failure. These guards keep the
// coverage explicit.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const events = require('../lib/events');

const ROOT = path.resolve(__dirname, '..');

// ── events.listForOrg ────────────────────────────────────────────────

test('events.listForOrg filters by orgId AND by ORG_ACTIVITY_TYPES', async () => {
  // Plant a few events with mixed orgs and types. listForOrg should
  // return ONLY events with our orgId AND a type in the activity
  // allowlist — personal-security events (auth_signin etc.) must be
  // filtered out even if they happen to carry an orgId.
  const ORG = 9991;
  const OTHER_ORG = 9992;

  await events.record('goods_master_created', { orgId: ORG, entityType: 'goods_master', entityId: 'gm_a', after: { id: 'a' } });
  await events.record('supplier_master_created', { orgId: ORG, entityType: 'supplier_master', entityId: 'sm_b', after: { id: 'b' } });
  await events.record('shipment_master_created', { orgId: OTHER_ORG, entityType: 'shipment_master', entityId: 'sh_c', after: { id: 'c' } });
  await events.record('auth_signin', { orgId: ORG, email: 'x@x.test' });

  const list = await events.listForOrg({ orgId: ORG, limit: 50 });
  assert.ok(Array.isArray(list), 'listForOrg returns an array');
  // Every returned event must belong to our org.
  for (const e of list) {
    assert.equal(e.orgId, ORG, `event ${e.type} carried wrong orgId`);
  }
  // Every returned event must be in the activity-types allowlist
  // (no auth_signin leakage).
  for (const e of list) {
    assert.ok(events.ORG_ACTIVITY_TYPES.has(e.type), `event ${e.type} should not appear in the activity feed`);
  }
  // The two org-scoped allowlisted events we just planted should be
  // present (modulo the KV log's capacity — at low test volumes both
  // land cleanly).
  const types = new Set(list.map((e) => e.type));
  assert.ok(types.has('goods_master_created'), 'goods_master_created should appear in the org feed');
  assert.ok(types.has('supplier_master_created'), 'supplier_master_created should appear in the org feed');
});

test('events.listForOrg returns newest-first (opposite ordering from listForEntity)', async () => {
  // The dashboard widget renders top-down, with the most recent
  // activity at the top — opposite of the chronological timeline on
  // an entity detail page.
  const ORG = 9993;
  await events.record('goods_master_created', { orgId: ORG, entityType: 'goods_master', entityId: 'gm_first', after: {} });
  await new Promise((r) => setTimeout(r, 5));
  await events.record('goods_master_updated', { orgId: ORG, entityType: 'goods_master', entityId: 'gm_first', after: {} });

  const list = await events.listForOrg({ orgId: ORG, limit: 50 });
  const firstTwo = list.filter((e) => (e.entityId === 'gm_first'));
  assert.ok(firstTwo.length >= 2, 'expected at least two events for the test entity');
  // Newest-first: index 0 is the more recent one.
  const ta = Date.parse(firstTwo[0].at);
  const tb = Date.parse(firstTwo[1].at);
  assert.ok(ta >= tb, 'newest event must be at index 0');
});

test('events.listForOrg empty input → empty array', async () => {
  assert.deepEqual(await events.listForOrg({}), []);
  assert.deepEqual(await events.listForOrg({ orgId: null }), []);
});

test('ORG_ACTIVITY_TYPES does NOT include personal-security event types', () => {
  // The activity feed is shared org-wide; auth + mfa + password events
  // are personal and must never leak into a teammate's dashboard.
  // Hard-pin a small set so a future PR that adds an event type to
  // ORG_ACTIVITY_TYPES with the wrong privacy category fails here.
  const personal = [
    'auth_signin',
    'auth_signin_password',
    'auth_signin_failed_password',
    'auth_signup',
    'auth_signup_requested',
    'auth_signup_confirmed',
    'auth_logout',
    'auth_password_set',
    'auth_password_changed',
    'auth_password_cleared',
    'auth_password_reset_requested',
    'auth_password_reset_confirmed',
    'auth_mfa_enabled',
    'auth_mfa_disabled',
    'auth_mfa_challenge_failed',
    'auth_revoke_all',
    'auth_session_revoked',
    'account_exported',
    'account_deleted',
    'notification_prefs_updated',
  ];
  for (const t of personal) {
    assert.ok(
      !events.ORG_ACTIVITY_TYPES.has(t),
      `${t} is personal — must NOT appear in the org-wide activity feed`,
    );
  }
});

test('ORG_ACTIVITY_TYPES includes every operator-wedge entity lifecycle', () => {
  // The four entity kinds the widget links to (imports, goods,
  // suppliers, shipments) must each have at least one event type in
  // the allowlist. A future refactor that drops one kind would
  // silently make the widget go quiet for that entity.
  const required = [
    'import_request_created',
    'goods_master_created',
    'supplier_master_created',
    'shipment_master_created',
  ];
  for (const t of required) {
    assert.ok(
      events.ORG_ACTIVITY_TYPES.has(t),
      `${t} must be in ORG_ACTIVITY_TYPES so the widget renders this entity's activity`,
    );
  }
});

// ── /api/activity handler — source-pinned drift-guard ────────────────

const HANDLER_SRC = fs.readFileSync(
  path.join(ROOT, 'lib', 'handlers', 'activity.js'),
  'utf8',
);

test('GET-only: any non-GET method (except OPTIONS) returns 405', () => {
  // The activity feed is read-only. Drift-guard pins the gate so a
  // future PR that accidentally adds a POST/PATCH/DELETE handler
  // surfaces at PR time.
  assert.match(HANDLER_SRC, /Method not allowed/);
  assert.match(HANDLER_SRC, /req\.method !== 'GET'/);
});

test('handler requires auth (401 on signed-out)', () => {
  assert.match(HANDLER_SRC, /Sign in required/);
});

test('handler scopes by org via the standard x-orcatrade-org header', () => {
  assert.match(HANDLER_SRC, /x-orcatrade-org/);
  assert.match(HANDLER_SRC, /resolveOrgId/);
});

test('handler delegates filtering to events.listForOrg (no DIY filter)', () => {
  // The activity allowlist + newest-first ordering live in
  // lib/events.js. The handler must NOT re-implement them — a copy
  // would diverge on the next allowlist change.
  assert.match(HANDLER_SRC, /events\.listForOrg/);
});

test('handler clamps limit to [1, 100]', () => {
  // Sanity-cap on a public query parameter so a runaway client can't
  // pull the full 5,000-event KV log over /api/activity.
  assert.match(HANDLER_SRC, /Math\.max\(1,\s*Math\.min\(100,/);
});

test('handler redacts chain stamps + raw email from the response', () => {
  // Tamper-evident chain stamps (_seq / _hash / _prevHash) and raw
  // email are internal — never expose them on a customer endpoint.
  // Pin all four field names so a refactor that renames the redactor
  // body but forgets one field surfaces here.
  for (const field of ['_seq', '_hash', '_prevHash', 'email']) {
    assert.match(
      HANDLER_SRC,
      new RegExp(`\\b${field}\\b`),
      `redactor must strip the ${field} field from outbound events`,
    );
  }
});

// ── Dashboard widget — TS mirror types + summary helpers ─────────────

const API_TS = fs.readFileSync(
  path.join(ROOT, 'app-shell', 'lib', 'api.ts'),
  'utf8',
);
const DASHBOARD_TSX = fs.readFileSync(
  path.join(ROOT, 'app-shell', 'app', '(authed)', 'dashboard', 'page.tsx'),
  'utf8',
);

test('ActivityEvent type + helpers are exported from app-shell/lib/api.ts', () => {
  assert.match(API_TS, /export type ActivityEventType\s*=/);
  assert.match(API_TS, /export interface ActivityEvent\b/);
  assert.match(API_TS, /export function activityEventHref\(/);
  assert.match(API_TS, /export function activityEventSummary\(/);
  assert.match(API_TS, /export function activityKind\(/);
});

test('activityEventHref covers every operator-wedge entity type', () => {
  // The widget makes rows clickable via this helper. A missing case
  // would land a row that silently has no link.
  const block = API_TS.match(/export function activityEventHref\([\s\S]*?\n\}/);
  assert.ok(block, 'activityEventHref not located');
  for (const entityType of ['import_request', 'goods_master', 'supplier_master', 'shipment_master']) {
    assert.match(
      block[0],
      new RegExp(`['"]${entityType}['"]`),
      `activityEventHref must route ${entityType} to its detail page`,
    );
  }
});

test('activityEventSummary covers every type in ORG_ACTIVITY_TYPES', () => {
  // A future allowlist addition that lands without a summary case
  // would render the raw event-type string ("shipment_master_xyz") on
  // the dashboard — ugly. Pin every type in the allowlist.
  const block = API_TS.match(/export function activityEventSummary\([\s\S]*?\n\}/);
  assert.ok(block, 'activityEventSummary not located');
  const body = block[0];
  for (const type of events.ORG_ACTIVITY_TYPES) {
    assert.match(
      body,
      new RegExp(`case ['"]${type}['"]:`),
      `activityEventSummary must have a case for "${type}" (in ORG_ACTIVITY_TYPES)`,
    );
  }
});

test('Dashboard renders an ActivityWidget after ImportsWidget', () => {
  // Layout drift-guard: the widget order is part of the cockpit
  // narrative (imports → activity → deadline). A reorder that moves
  // activity to the bottom of the page would dilute its presence.
  const importsIdx = DASHBOARD_TSX.indexOf('<ImportsWidget />');
  const activityIdx = DASHBOARD_TSX.indexOf('<ActivityWidget />');
  assert.ok(importsIdx > -1, 'ImportsWidget not found on /dashboard');
  assert.ok(activityIdx > -1, 'ActivityWidget not found on /dashboard');
  assert.ok(activityIdx > importsIdx, 'ActivityWidget must render AFTER ImportsWidget');
});

test('ActivityWidget polls every 30s (live-feeling without overwhelming KV)', () => {
  // The "live activity" UX promise is the poll cadence. Pin it so a
  // refactor that drops the polling logic or pushes it to 5s (which
  // would batter KV) surfaces here.
  assert.match(DASHBOARD_TSX, /POLL_MS\s*=\s*30_000/);
  assert.match(DASHBOARD_TSX, /setTimeout\(\(\) => load\(false\)/);
});

test('ActivityWidget transient errors do NOT flip a healthy widget into the error state', () => {
  // A momentary KV blip during polling must NOT wipe a populated
  // feed — we render last-known data + queue another poll. The
  // catch handler only sets error state on the INITIAL load.
  assert.match(DASHBOARD_TSX, /if \(initial\)/);
});

test('ActivityWidget hides silently on auth / error (never breaks the dashboard)', () => {
  // The other widgets must keep working even when /api/activity is
  // degraded. Same fail-soft posture as ImportsWidget. Scope the
  // assertion to the ActivityWidget function body so we don't
  // accidentally satisfy it via the matching guard in another widget.
  const fnBlock = DASHBOARD_TSX.match(/function ActivityWidget\(\)\s*\{[\s\S]*?\n\}/);
  assert.ok(fnBlock, 'ActivityWidget function not found');
  assert.match(
    fnBlock[0],
    /if \(state === 'auth' \|\| state === 'error'\) return null;/,
  );
});
