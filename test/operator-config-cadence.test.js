'use strict';

// Sprint 75 — per-org alert cadence ('daily' | 'weekly').
//
// The ONESOURCE/SAP-GTS "notification policy" pattern: org-level
// noise control layered UNDER the per-recipient prefs. 'weekly'
// suppresses the three daily proactive alert emails (stalled
// 08:00, decline-spike 08:30, aging-quotes 08:45) org-wide; the
// weekly digests + the live cockpit are unaffected.
//
// Load-bearing invariants:
//   - cadence is NOT a sixth knob. The knob machinery is numeric-
//     typed end to end (validatePartial branches, preset values,
//     identifyPreset's Number() comparison) — an enum in KNOB_KEYS
//     would make every org identify as 'custom'. Runtime pin below.
//   - Default stored as ABSENCE (kv.del on 'daily') — keyspace
//     holds real overrides only.
//   - Fail-open reads: a KV blip resolves to 'daily' (an unwanted
//     email beats a missed one — the safe failure direction).
//   - Idempotent re-submit of the current value is a no-op 400,
//     not a meaningless audit event (cadenceChange only when the
//     value actually flips).
//   - Cadence write lands BEFORE the audit event (never record a
//     change that didn't land); mutually exclusive with preset
//     and undo (one-click ops stay unambiguous).
//   - Cadence-only PATCHes collapse previous {} → null so the UI
//     never offers an undo pill the server must refuse.
//
// Test layers:
//   1. lib runtime: constants, not-a-knob pin, get/set roundtrip,
//      default-as-absence, invalid input
//   2. Handler source pins: cheap 400, knobPatch strip, preset/
//      undo exclusivity, idempotence gate, write-before-audit
//      positional order, 500 wording, detail spread, previous
//      {} → null, GET + PATCH echo
//   3. Cron: three-corners across the daily runners + exactly-3
//      contrast (weekly runners stay ungated)
//   4. Projection runtime + TS mirror + UI pins

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const operatorConfig = require('../lib/operator-config');
const events = require('../lib/events');
const kv = require('../lib/intelligence/kv-store');

const ROOT = path.resolve(__dirname, '..');
const HANDLER_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'handlers', 'operator-config.js'), 'utf8');
const CRON_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'handlers', 'cron.js'), 'utf8');
const EVENTS_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'events.js'), 'utf8');
const API_TS = fs.readFileSync(path.join(ROOT, 'app-shell', 'lib', 'api.ts'), 'utf8');
const INSIGHTS_TSX = fs.readFileSync(
  path.join(ROOT, 'app-shell', 'app', '(authed)', 'imports', 'insights', 'page.tsx'),
  'utf8',
);

const PATCH_BODY = HANDLER_SRC.match(/async function handlePatch\([\s\S]*?\n\}/)[0];

// ── Layer 1: lib runtime ──────────────────────────────────────────

test('ALERT_CADENCES is the frozen [daily, weekly] pair with daily as default', () => {
  assert.deepEqual([...operatorConfig.ALERT_CADENCES], ['daily', 'weekly']);
  assert.ok(Object.isFrozen(operatorConfig.ALERT_CADENCES));
  assert.equal(operatorConfig.DEFAULT_ALERT_CADENCE, 'daily');
});

test('alertCadence is NOT a knob — KNOB_KEYS and presets stay numeric (identifyPreset invariant)', () => {
  // An enum in KNOB_KEYS would break identifyPreset's Number()
  // comparison and every org would silently identify as 'custom'.
  assert.ok(!operatorConfig.KNOB_KEYS.includes('alertCadence'));
  assert.ok(!Object.prototype.hasOwnProperty.call(operatorConfig.DEFAULT_OPERATOR_CONFIG, 'alertCadence'));
  for (const name of operatorConfig.PRESET_NAMES) {
    assert.ok(!Object.prototype.hasOwnProperty.call(operatorConfig.PRESETS[name], 'alertCadence'));
  }
});

test('getAlertCadence defaults to daily when nothing is stored (runtime)', async () => {
  assert.equal(await operatorConfig.getAlertCadence(999_997_401), 'daily');
  // Defensive: bad org ids resolve to the default, never throw.
  assert.equal(await operatorConfig.getAlertCadence(NaN), 'daily');
});

test('setAlertCadence weekly → stored; daily → stored as ABSENCE (runtime roundtrip)', async () => {
  const orgId = 999_997_402;
  const cadKey = operatorConfig.CADENCE_KEY_PREFIX + String(orgId);
  const w = await operatorConfig.setAlertCadence(orgId, 'weekly');
  assert.equal(w.ok, true);
  assert.equal(await operatorConfig.getAlertCadence(orgId), 'weekly');
  assert.equal(await kv.get(cadKey), 'weekly');
  // Back to daily — the key is DELETED, not written as 'daily'.
  const d = await operatorConfig.setAlertCadence(orgId, 'daily');
  assert.equal(d.ok, true);
  assert.equal(await operatorConfig.getAlertCadence(orgId), 'daily');
  const stored = await kv.get(cadKey);
  assert.ok(stored === undefined || stored === null, 'daily must be stored as absence');
});

test('setAlertCadence rejects unknown values and bad org ids (runtime)', async () => {
  const bad = await operatorConfig.setAlertCadence(999_997_403, 'hourly');
  assert.equal(bad.ok, false);
  assert.match(bad.errors[0], /alertCadence must be one of: daily \| weekly/);
  const noOrg = await operatorConfig.setAlertCadence(NaN, 'weekly');
  assert.equal(noOrg.ok, false);
});

test('getAlertCadence ignores a malformed stored value (fail-open to daily, runtime)', async () => {
  const orgId = 999_997_404;
  await kv.set(operatorConfig.CADENCE_KEY_PREFIX + String(orgId), { bogus: true });
  assert.equal(await operatorConfig.getAlertCadence(orgId), 'daily');
});

// ── Layer 2: handler discipline ───────────────────────────────────

test('cadence shape-validates cheap (400) and is stripped from knobPatch', () => {
  assert.match(PATCH_BODY, /error: `alertCadence must be one of: \$\{operatorConfig\.ALERT_CADENCES\.join\(' \| '\)\}`/);
  assert.match(PATCH_BODY, /delete knobPatch\.alertCadence;/);
});

test('cadence is mutually exclusive with preset and undo (two 400 pins)', () => {
  assert.match(PATCH_BODY, /preset cannot be combined with alertCadence/);
  assert.match(PATCH_BODY, /undo cannot be combined with alertCadence/);
});

test('idempotent cadence re-submit produces NO change object (falls to the no-op guard)', () => {
  // cadenceChange only materialises when the value actually flips —
  // re-submitting the current value must not write a meaningless
  // audit event.
  assert.match(PATCH_BODY, /if \(currentCadence !== rawCadence\) \{\s*\n\s*cadenceChange = \{ from: currentCadence, to: rawCadence \};/);
  assert.match(PATCH_BODY, /&& cadenceChange === null\)/);
});

test('cadence write lands AFTER knob mutations and BEFORE the audit event (positional pins)', () => {
  const writeIdx = PATCH_BODY.indexOf('await operatorConfig.setAlertCadence(');
  const unsetIdx = PATCH_BODY.indexOf('await operatorConfig.unsetKnobs(');
  const auditIdx = PATCH_BODY.indexOf("await events.record('operator_config_updated'");
  assert.ok(writeIdx > -1 && unsetIdx > -1 && auditIdx > -1);
  assert.ok(unsetIdx < writeIdx, 'cadence write must follow the knob mutations');
  assert.ok(writeIdx < auditIdx, 'cadence write must precede the audit event (never record a change that did not land)');
  // KV write fault after validation → 500.
  assert.match(PATCH_BODY, /could not persist alert cadence/);
});

test('cadence change travels in the audit detail via conditional spread', () => {
  const recordBlock = PATCH_BODY.match(/await events\.record\('operator_config_updated',[\s\S]*?\}\);/);
  assert.ok(recordBlock);
  assert.match(recordBlock[0], /\.\.\.\(cadenceChange !== null \? \{ alertCadence: cadenceChange \} : \{\}\),/);
});

test('cadence-only PATCH collapses previous {} → null (no untruthful undo affordance)', () => {
  assert.match(PATCH_BODY, /if \(Object\.keys\(previous\)\.length === 0\) previous = null;/);
});

test('GET and PATCH responses both echo alertCadence (contract symmetry)', () => {
  const getBody = HANDLER_SRC.match(/async function handleGet\([\s\S]*?\n\}/)[0];
  assert.match(getBody, /const alertCadence = await operatorConfig\.getAlertCadence\(ctx\.orgIdNumeric\);/);
  assert.match(getBody, /alertCadence,/);
  assert.match(PATCH_BODY, /alertCadence: cadenceChange !== null\s*\n\s*\? cadenceChange\.to\s*\n\s*: await operatorConfig\.getAlertCadence\(ctx\.orgIdNumeric\),/);
});

// ── Layer 3: cron gates ───────────────────────────────────────────

test('all three daily runners gate on cadence (three-corners); weekly runners stay ungated', () => {
  const DAILY_RUNNERS = [
    'runImportRequestStalledQueueAlert',
    'runImportRequestQuoteFollowUpAlert',
    'runImportRequestDeclineSpikeAlert',
    // Sprint 92 — the SLA-at-risk alert joins the daily family
    // (four-corners now; extend when a fifth daily alert lands).
    'runImportRequestSlaAtRiskAlert',
  ];
  for (const name of DAILY_RUNNERS) {
    const start = CRON_SRC.indexOf(`async function ${name}(`);
    assert.ok(start > -1, `${name} not found`);
    const next = CRON_SRC.indexOf('async function ', start + 10);
    const body = CRON_SRC.slice(start, next === -1 ? CRON_SRC.length : next);
    assert.match(body, /await operatorConfig\.getAlertCadence\(orgIdNumeric\)/, `${name} must read the cadence`);
    assert.match(body, /if \(alertCadence === 'weekly'\) \{\s*\n\s*weeklyOnlyByOrg \+= 1;\s*\n\s*continue;/, `${name} must skip weekly orgs`);
    assert.match(body, /weeklyOnlyByOrg,/, `${name} must report the skip count`);
  }
  // Exactly the DAILY runners gate — the weekly digest runners
  // must NOT (weekly is precisely what those orgs asked for). The
  // count derives from the enumerated list so a new daily alert
  // extends the list rather than editing a magic number.
  const gates = CRON_SRC.match(/weeklyOnlyByOrg \+= 1;/g) || [];
  assert.equal(gates.length, DAILY_RUNNERS.length, 'every daily runner gates on cadence — and only they do');
});

test('the cadence gate runs BEFORE the per-org aggregation (one KV read, not a SQL fan-out)', () => {
  const start = CRON_SRC.indexOf('async function runImportRequestStalledQueueAlert(');
  const next = CRON_SRC.indexOf('async function ', start + 10);
  const body = CRON_SRC.slice(start, next);
  const gateIdx = body.indexOf('getAlertCadence(orgIdNumeric)');
  const aggIdx = body.indexOf('aggregateOpsInsights(');
  assert.ok(gateIdx > -1 && aggIdx > -1 && gateIdx < aggIdx);
});

// ── Layer 4: projection + TS + UI ─────────────────────────────────

test('listOperatorConfigHistory projects alertCadence with from/to string guards (source pin)', () => {
  const block = EVENTS_SRC.match(/async function listOperatorConfigHistory[\s\S]*?\n\}/);
  assert.ok(block);
  assert.match(
    block[0],
    /typeof e\.detail\.alertCadence\.from === 'string'\s*\n\s*&& typeof e\.detail\.alertCadence\.to === 'string'/,
  );
});

test('listOperatorConfigHistory carries the cadence change through (runtime)', async () => {
  const orgId = 999_997_405;
  await events.record('operator_config_updated', {
    orgId,
    entityType: 'operator_config',
    entityId: 'sprint75-smoke',
    actorEmailHash: 'abc123def456ghi7',
    detail: { patched: {}, alertCadence: { from: 'daily', to: 'weekly' } },
  });
  const list = await events.listOperatorConfigHistory({ orgId, limit: 5 });
  assert.equal(list.length, 1);
  assert.deepEqual(list[0].alertCadence, { from: 'daily', to: 'weekly' });
  // Cadence-only entries carry no knob before-values → no undo.
  assert.equal(list[0].previous, null);
});

test('listOperatorConfigHistory alertCadence is null for legacy and malformed events (runtime)', async () => {
  const orgId = 999_997_406;
  await events.record('operator_config_updated', {
    orgId,
    entityType: 'operator_config',
    entityId: 'sprint75-legacy',
    actorEmailHash: 'abc123def456ghi7',
    detail: { patched: { stallThresholdDays: 5 }, alertCadence: 'weekly' },
  });
  const list = await events.listOperatorConfigHistory({ orgId, limit: 5 });
  assert.equal(list.length, 1);
  assert.equal(list[0].alertCadence, null);
});

test('TS mirrors: AlertCadence union + response field + history entry field', () => {
  assert.match(API_TS, /export type AlertCadence = 'daily' \| 'weekly';/);
  assert.match(
    API_TS,
    /export interface OperatorConfigResponse \{[\s\S]*?alertCadence: AlertCadence;[\s\S]*?\}/,
  );
  assert.match(
    API_TS,
    /export interface OperatorConfigHistoryEntry \{[\s\S]*?alertCadence: \{ from: string; to: string \} \| null;[\s\S]*?\}/,
  );
});

test('panel cadence toggle: instant-apply, idempotent-click blocked client-side, PATCH shape', () => {
  const body = INSIGHTS_TSX.match(/function OperatorConfigPanel\([\s\S]*?\n\}\n\n\/\* /)[0];
  assert.match(body, /async function onSetCadence\(value: AlertCadence\)/);
  // The server's no-op guard would 400 an idempotent click — block
  // it client-side.
  assert.match(body, /if \(settingCadence \|\| cadence === value\) return;/);
  assert.match(body, /apiPatch<OperatorConfigResponse>\('\/api\/operator-config', \{\s*\n\s*alertCadence: value,\s*\n\s*\}\)/);
  // Toggle renders both options with honest labels.
  assert.match(body, /data-testid="operator-config-cadence"/);
  assert.match(body, /\{value === 'daily' \? 'Daily alerts' : 'Weekly digests only'\}/);
});

test('history renderer shows cadence changes and keeps the no-fields fallback truthful', () => {
  const block = INSIGHTS_TSX.match(/function OperatorConfigHistoryList\([\s\S]*?\n\}\n\n\/\* /);
  assert.ok(block);
  const body = block[0];
  assert.match(body, /const hasCadence = entry\.alertCadence !== null;/);
  // A cadence-only entry must NOT render as "no fields".
  assert.match(body, /\{!hasSet && !hasReset && !hasCadence && \(/);
  // from → to segment, new value as the headline.
  assert.match(body, /\{'cadence '\}/);
  assert.match(body, /\{entry\.alertCadence\.from\}/);
  assert.match(body, /\{entry\.alertCadence\.to\}/);
});
