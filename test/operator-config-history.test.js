'use strict';

// Sprint 65 — exposes the operator-config change history as a
// read-only audit surface in the OperatorConfigPanel. Sprint 42
// audit-logged every PATCH per ADR-0005; sprint 65 turns that
// existing signal into a first-class visibility affordance so
// an admin can see who dialed which knob and when.
//
// Tests cover five layers:
//   1. events.listOperatorConfigHistory: exported; filters by
//      orgId + type; newest-first; caps at limit; projects to
//      the safe shape (no raw email, no chain internals, only
//      the changed knobs from that PATCH).
//   2. Handler GET response: includes `history` + `viewerEmailHash`.
//   3. TS: OperatorConfigHistoryEntry + OperatorConfigResponse
//      extended.
//   4. UI: OperatorConfigPanel loads history via useEffect on
//      mount; renders the audit-surface subcomponent with
//      viewerEmailHash for the "You" affordance.
//   5. Renderer discipline: OperatorConfigHistoryList shows
//      "You" when viewer hash matches actor hash; falls back
//      to short user:HASHPREFIX otherwise; renders the empty
//      state on brand-new orgs; renders loading state while
//      history === null.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const events = require('../lib/events');

const ROOT = path.resolve(__dirname, '..');
const HANDLER_SRC = fs.readFileSync(
  path.join(ROOT, 'lib', 'handlers', 'operator-config.js'),
  'utf8',
);
const EVENTS_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'events.js'), 'utf8');
const API_TS = fs.readFileSync(path.join(ROOT, 'app-shell', 'lib', 'api.ts'), 'utf8');
const INSIGHTS_TSX = fs.readFileSync(
  path.join(ROOT, 'app-shell', 'app', '(authed)', 'imports', 'insights', 'page.tsx'),
  'utf8',
);

// ── Layer 1: events.listOperatorConfigHistory export ─────────────

test('events.listOperatorConfigHistory is exported (drift-guard against silent-drop)', () => {
  assert.equal(typeof events.listOperatorConfigHistory, 'function');
});

test('listOperatorConfigHistory returns [] when orgId is missing/null', async () => {
  assert.deepEqual(await events.listOperatorConfigHistory({}), []);
  assert.deepEqual(await events.listOperatorConfigHistory({ orgId: null }), []);
  assert.deepEqual(await events.listOperatorConfigHistory({ orgId: 0 }), []);
});

// ── Layer 1 source pins — the fetch strategy is load-bearing ─────

test('listOperatorConfigHistory filters by orgId + type via list({ type })', () => {
  // Read-side discipline: the helper MUST pass the type filter
  // through to list() so the KV read is bounded. A missing type
  // filter would pull EVERY event and filter in memory, which
  // scales poorly + violates the least-data-fetched principle.
  const block = EVENTS_SRC.match(
    /async function listOperatorConfigHistory\([\s\S]*?\n\}/,
  );
  assert.ok(block, 'listOperatorConfigHistory body not located');
  const body = block[0];
  assert.match(body, /await list\(\{ type: 'operator_config_updated', limit: MAX_EVENTS \}\)/);
  assert.match(body, /e\.orgId === orgId/);
});

test('listOperatorConfigHistory sorts newest-first (matches listForOrg convention)', () => {
  const body = EVENTS_SRC.match(
    /async function listOperatorConfigHistory\([\s\S]*?\n\}/,
  )[0];
  // Same sort shape as listForOrg — tb - ta means DESC by time.
  assert.match(body, /return tb - ta/);
});

test('listOperatorConfigHistory caps limit to [1, 100]', () => {
  const body = EVENTS_SRC.match(
    /async function listOperatorConfigHistory\([\s\S]*?\n\}/,
  )[0];
  assert.match(body, /Math\.max\(1, Math\.min\(100, Number\(limit\) \|\| 10\)\)/);
});

test('listOperatorConfigHistory projects to safe shape — no chain internals, no raw email', () => {
  const body = EVENTS_SRC.match(
    /async function listOperatorConfigHistory\([\s\S]*?\n\}/,
  )[0];
  // The projection maps to exactly these three keys.
  assert.match(body, /at: \(e && typeof e\.at === 'string'\) \? e\.at : null/);
  assert.match(body, /actorEmailHash:/);
  assert.match(body, /patched:/);
  // Chain internals must NOT leak — the projection intentionally
  // omits _seq / _prevHash / _hash. Pin the negative to catch
  // a future refactor that spreads the whole event.
  assert.doesNotMatch(body, /_seq/);
  assert.doesNotMatch(body, /_prevHash/);
  assert.doesNotMatch(body, /\.\.\.e[,\n]/);
});

test('listOperatorConfigHistory defensively normalises malformed patched entries to {}', () => {
  // A historical event with a missing/mistyped detail.patched
  // must resolve to {} so the UI can safely iterate. Pin the
  // guard shape.
  const body = EVENTS_SRC.match(
    /async function listOperatorConfigHistory\([\s\S]*?\n\}/,
  )[0];
  assert.match(
    body,
    /e\.detail && typeof e\.detail === 'object'[\s\S]*?e\.detail\.patched && typeof e\.detail\.patched === 'object'/,
  );
});

// ── Layer 2: handler GET response ────────────────────────────────

test('operator-config GET response now includes history + viewerEmailHash', () => {
  const getBlock = HANDLER_SRC.match(/async function handleGet\([\s\S]*?\n\}/);
  assert.ok(getBlock, 'handleGet body not located');
  const body = getBlock[0];
  assert.match(
    body,
    /await events\.listOperatorConfigHistory\(\{[\s\S]*?orgId: ctx\.orgIdNumeric[\s\S]*?limit: 10[\s\S]*?\}\)/,
  );
  // Response body wires both fields.
  assert.match(body, /\bhistory,/);
  assert.match(body, /viewerEmailHash: ctx\.emailHash/);
});

test('handleGet history read is fail-open — a KV error resolves to []', () => {
  // Same posture as the storedRaw read above: history is a
  // nice-to-have, never a hard-failure gate on the panel. Pin
  // the try/catch that resolves to [] (NOT a 5xx like the PATCH
  // audit write which IS load-bearing per ADR-0005).
  const body = HANDLER_SRC.match(/async function handleGet\([\s\S]*?\n\}/)[0];
  assert.match(
    body,
    /try \{[\s\S]*?history = await events\.listOperatorConfigHistory[\s\S]*?\} catch \(err\)[\s\S]*?history = \[\]/,
  );
});

// ── Layer 3: TS mirror ───────────────────────────────────────────

test('OperatorConfigHistoryEntry TS interface exported with at/actorEmailHash/patched shape', () => {
  assert.match(
    API_TS,
    /export interface OperatorConfigHistoryEntry \{[\s\S]*?at: string \| null;[\s\S]*?actorEmailHash: string \| null;[\s\S]*?patched: Partial<OperatorConfig>;[\s\S]*?\}/,
  );
});

test('OperatorConfigResponse extends with history + viewerEmailHash', () => {
  assert.match(
    API_TS,
    /export interface OperatorConfigResponse \{[\s\S]*?history: OperatorConfigHistoryEntry\[\];[\s\S]*?viewerEmailHash: string \| null;[\s\S]*?\}/,
  );
});

// ── Layer 4: UI wiring ───────────────────────────────────────────

test('OperatorConfigPanel imports OperatorConfigHistoryEntry (drift-guard against silent-drop)', () => {
  assert.match(INSIGHTS_TSX, /type OperatorConfigHistoryEntry,/);
});

test('OperatorConfigPanel fetches history via apiGet inside useEffect on mount', () => {
  const block = INSIGHTS_TSX.match(/function OperatorConfigPanel\([\s\S]*?\n\}\n\n\/\* /);
  assert.ok(block, 'OperatorConfigPanel body not located');
  const body = block[0];
  assert.match(
    body,
    /useEffect\(\(\) => \{[\s\S]*?apiGet<OperatorConfigResponse>\('\/api\/operator-config'\)/,
  );
  assert.match(body, /setHistory\(Array\.isArray\(data\.history\) \? data\.history : \[\]\)/);
  assert.match(body, /setViewerEmailHash\(/);
});

test('OperatorConfigPanel passes viewerEmailHash + history down to the audit-surface subcomponent', () => {
  const body = INSIGHTS_TSX.match(/function OperatorConfigPanel\([\s\S]*?\n\}\n\n\/\* /)[0];
  assert.match(
    body,
    /<OperatorConfigHistoryList\s+history=\{history\}\s+viewerEmailHash=\{viewerEmailHash\}\s*\/>/,
  );
});

// ── Layer 5: Renderer discipline ─────────────────────────────────

test('OperatorConfigHistoryList renders "Loading recent changes…" when history === null', () => {
  const block = INSIGHTS_TSX.match(
    /function OperatorConfigHistoryList\([\s\S]*?\n\}\n/,
  );
  assert.ok(block, 'OperatorConfigHistoryList body not located');
  assert.match(block[0], /history === null/);
  assert.match(block[0], /Loading recent changes/);
});

test('OperatorConfigHistoryList renders empty-state on brand-new orgs (history.length === 0)', () => {
  const body = INSIGHTS_TSX.match(
    /function OperatorConfigHistoryList\([\s\S]*?\n\}\n/,
  )[0];
  assert.match(body, /history\.length === 0/);
  assert.match(body, /No config changes yet/);
});

test('OperatorConfigHistoryList "You" affordance requires viewer hash === actor hash', () => {
  // Load-bearing — if this check softens (e.g. only checks
  // presence), every history entry would render as "You" for
  // any signed-in admin, which would be a silent identity leak.
  const body = INSIGHTS_TSX.match(
    /function OperatorConfigHistoryList\([\s\S]*?\n\}\n/,
  )[0];
  assert.match(
    body,
    /const isYou =[\s\S]*?entry\.actorEmailHash === viewerEmailHash/,
  );
});

test('OperatorConfigHistoryList non-viewer fallback is user:HASHPREFIX (first 8 chars)', () => {
  // Not a member email lookup — ADR-0008 pseudonymisation
  // posture: viewers can't resolve OTHER members' identity
  // past the stored hash prefix.
  const body = INSIGHTS_TSX.match(
    /function OperatorConfigHistoryList\([\s\S]*?\n\}\n/,
  )[0];
  assert.match(body, /`user:\$\{entry\.actorEmailHash\.slice\(0, 8\)\}`/);
});

test('OperatorConfigHistoryList knob-label map covers ALL FOUR knobs (four-corners pin)', () => {
  const mapBlock = INSIGHTS_TSX.match(
    /const OPERATOR_CONFIG_KNOB_LABEL: Record<keyof OperatorConfig, string> = \{[\s\S]*?\};/,
  );
  assert.ok(mapBlock, 'OPERATOR_CONFIG_KNOB_LABEL map not located');
  const map = mapBlock[0];
  assert.match(map, /stallThresholdDays: 'Stall threshold'/);
  assert.match(map, /declineSpikeRateMultiplier: 'Decline-spike multiplier'/);
  assert.match(map, /supplierConcentrationThreshold: 'Supplier-concentration threshold'/);
  assert.match(map, /ratingTrendDropThreshold: 'Rating-drop threshold'/);
});

test('formatKnobValue formats each knob with its native unit (drift-guard against unit drift)', () => {
  const fn = INSIGHTS_TSX.match(
    /function formatKnobValue\([\s\S]*?\n\}\n/,
  );
  assert.ok(fn, 'formatKnobValue body not located');
  const body = fn[0];
  assert.match(body, /'stallThresholdDays'[\s\S]*?`\$\{value\}d`/);
  assert.match(body, /'declineSpikeRateMultiplier'[\s\S]*?`\$\{value\.toFixed\(1\)\}×`/);
  assert.match(body, /'supplierConcentrationThreshold'[\s\S]*?`\$\{Math\.round\(value \* 100\)\}%`/);
  assert.match(body, /'ratingTrendDropThreshold'[\s\S]*?`\$\{value\.toFixed\(1\)\}★`/);
});

test('formatHistoryTimestamp uses UTC (removes cross-timezone ambiguity)', () => {
  const fn = INSIGHTS_TSX.match(
    /function formatHistoryTimestamp\([\s\S]*?\n\}\n/,
  );
  assert.ok(fn, 'formatHistoryTimestamp body not located');
  const body = fn[0];
  assert.match(body, /getUTCFullYear/);
  assert.match(body, /getUTCMonth/);
  assert.match(body, /getUTCHours/);
  // Suffix is literally " UTC" so the reader can never mistake
  // it for local time.
  assert.match(body, /UTC/);
});
