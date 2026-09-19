'use strict';

// Sprint 24 — operator-wedge notification preferences.
//
// Tests cover four layers:
//   1. PREF_KEYS surface: 6 new operator-wedge keys added to the
//      existing notification-prefs module
//   2. Sender integration: each of the 6 operator email touchpoints
//      consults isMuted / filterMutedRecipients before sending
//   3. Schema-016: migration shape is idempotent + safe
//   4. TS mirror + /preferences UI: Prefs type carries the new keys,
//      the UI surfaces them in the right group, default-to-ON
//      rendering when no stored value
//
// The fail-soft posture is load-bearing: a KV blip on a prefs lookup
// MUST NOT silently drop a quote-ready notification. Drift-guard pins
// the catch-and-return-false behaviour at the source.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const notificationPrefs = require('../lib/notification-prefs');

const ROOT = path.resolve(__dirname, '..');
const PREFS_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'notification-prefs.js'), 'utf8');
const SENDERS_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'imports-emails.js'), 'utf8');
const SCHEMA_SRC = fs.readFileSync(
  path.join(ROOT, 'lib', 'db', 'schema-016-notification-preferences.sql'),
  'utf8',
);
const API_TS = fs.readFileSync(path.join(ROOT, 'app-shell', 'lib', 'api.ts'), 'utf8');
const PREFS_TSX = fs.readFileSync(
  path.join(ROOT, 'app-shell', 'app', '(authed)', 'preferences', 'page.tsx'),
  'utf8',
);

// ── PREF_KEYS surface ──────────────────────────────────────────────

test('PREF_KEYS includes all 6 sprint-24 operator-wedge categories', () => {
  for (const key of [
    'importQuoteReadyEmails',
    'importDeclineEmails',
    'importShipmentStatusEmails',
    'importMessageEmails',
    'importQueueIntakeEmails',
    'importCustomerDecisionEmails',
  ]) {
    assert.ok(
      notificationPrefs.PREF_KEYS.includes(key),
      `PREF_KEYS missing the new category: ${key}`,
    );
  }
});

test('Legacy PREF_KEYS preserved (no accidental removal)', () => {
  // The legacy 4 keys still drive existing senders (plan-revision,
  // weekly digest, compliance deadlines, monitoring alerts). A
  // refactor that swapped them out would break those flows.
  for (const key of [
    'planRevisionEmails',
    'weeklyDigestEmails',
    'complianceDeadlineEmails',
    'monitoringAlerts',
  ]) {
    assert.ok(
      notificationPrefs.PREF_KEYS.includes(key),
      `legacy pref key ${key} was dropped`,
    );
  }
});

test('defaultPrefs returns every key as true (opt-out posture preserved)', () => {
  const def = notificationPrefs.defaultPrefs();
  for (const key of notificationPrefs.PREF_KEYS) {
    assert.equal(def[key], true, `default for ${key} must be true (opt-out semantics)`);
  }
});

test('isEnabled returns the default (true) for a brand new user', async () => {
  // A user who has never visited /preferences has no stored record.
  // The lookup must return true so they get every notification
  // until they actively opt out.
  const enabled = await notificationPrefs.isEnabled('nobody-special-' + Date.now() + '@test.local', 'importQuoteReadyEmails');
  assert.equal(enabled, true);
});

test('isEnabled returns false for an unknown key (drift safety)', async () => {
  // The whitelist gate is what stops a forged PUT from setting an
  // arbitrary key. Pin the rejection at the read path too.
  const enabled = await notificationPrefs.isEnabled('x@test.local', 'definitely_not_a_real_key');
  assert.equal(enabled, false);
});

// ── Sender integration: each of 6 senders consults the prefs gate ──

test('isMuted helper is defined in lib/imports-emails.js and is fail-soft', () => {
  // The shared helper is the single chokepoint for the prefs check.
  // Pin the function definition + the catch-and-return-false body
  // so a refactor that drops the fail-soft posture surfaces here.
  assert.match(SENDERS_SRC, /async function isMuted\(/);
  // The catch block must return false (default-to-send) — never
  // true (default-to-mute) which would silently swallow notifications.
  const block = SENDERS_SRC.match(/async function isMuted\([\s\S]*?\n\}/);
  assert.ok(block, 'isMuted body not located');
  assert.match(block[0], /catch \(err\) \{[\s\S]*?return false/);
});

test('filterMutedRecipients drops per-recipient, fail-soft per check', () => {
  // The bulk filter is used by ops-side senders. Each recipient gets
  // an independent isMuted call; a failure on one MUST NOT drop the
  // rest. Pin the loop shape.
  const block = SENDERS_SRC.match(/async function filterMutedRecipients\([\s\S]*?\n\}/);
  assert.ok(block, 'filterMutedRecipients body not located');
  assert.match(block[0], /for \(const r of recipients\)/);
  assert.match(block[0], /if \(!\(await isMuted\(r, prefKey\)\)\) out\.push\(r\)/);
});

test('sendQuoteReadyEmail consults importQuoteReadyEmails before sending', () => {
  const block = SENDERS_SRC.match(/async function sendQuoteReadyEmail\([\s\S]*?\nasync function /);
  assert.ok(block, 'sendQuoteReadyEmail body not located');
  assert.match(block[0], /isMuted\(to, ['"]importQuoteReadyEmails['"]\)/);
  // Returns the muted reason so the audit log explains the skip.
  assert.match(block[0], /reason: ['"]muted['"]/);
});

test('sendCustomerRejectedEmail consults importDeclineEmails before sending', () => {
  const block = SENDERS_SRC.match(/async function sendCustomerRejectedEmail\([\s\S]*?\nasync function /);
  assert.ok(block);
  assert.match(block[0], /isMuted\(to, ['"]importDeclineEmails['"]\)/);
});

test('sendShipmentStatusUpdateEmail consults importShipmentStatusEmails before sending', () => {
  const block = SENDERS_SRC.match(/async function sendShipmentStatusUpdateEmail\([\s\S]*?\nasync function /);
  assert.ok(block);
  assert.match(block[0], /isMuted\(to, ['"]importShipmentStatusEmails['"]\)/);
});

test('sendImportRequestMessageEmail consults importMessageEmails on BOTH branches', () => {
  // Customer-side post → fan out to ops admins (filterMuted),
  // ops-side post → notify customer (isMuted). Both branches must
  // gate on the same key.
  const block = SENDERS_SRC.match(/async function sendImportRequestMessageEmail\([\s\S]*?\nasync function /);
  assert.ok(block, 'sendImportRequestMessageEmail body not located');
  const body = block[0];
  // Customer branch — bulk filter.
  assert.match(body, /filterMutedRecipients\(resolution\.recipients, ['"]importMessageEmails['"]\)/);
  // Ops branch — direct isMuted.
  assert.match(body, /isMuted\(to, ['"]importMessageEmails['"]\)/);
});

test('sendNewInQueueEmail filters ops recipients via importQueueIntakeEmails', () => {
  const block = SENDERS_SRC.match(/async function sendNewInQueueEmail\([\s\S]*?\nasync function /);
  assert.ok(block);
  assert.match(block[0], /filterMutedRecipients\(resolution\.recipients, ['"]importQueueIntakeEmails['"]\)/);
});

test('sendCustomerApprovedEmail filters ops recipients via importCustomerDecisionEmails', () => {
  // Tail of file — no trailing "async function" anchor. Match to
  // the module.exports block instead.
  const block = SENDERS_SRC.match(/async function sendCustomerApprovedEmail\([\s\S]*?module\.exports/);
  assert.ok(block, 'sendCustomerApprovedEmail body not located');
  assert.match(block[0], /filterMutedRecipients\(resolution\.recipients, ['"]importCustomerDecisionEmails['"]\)/);
});

test('Every operator sender returns an all-muted / muted reason rather than calling email.send', () => {
  // The mute path must SHORT-CIRCUIT, not just observe. A regression
  // that logged "muted" but still called email.send would defeat
  // the prefs entirely. Pin the early return on every sender.
  const muteReturns = (SENDERS_SRC.match(/return \{ ok: false, reason: ['"](muted|all-muted)['"] \}/g) || []).length;
  // 6 senders × 1 mute branch each, except sendImportRequestMessageEmail
  // has 2 (one per role). Total = 7.
  assert.ok(muteReturns >= 7, `expected ≥7 mute early-returns across senders, got ${muteReturns}`);
});

// ── Schema-016 ──────────────────────────────────────────────────────

test('schema-016 adds notification_preferences JSONB column idempotently', () => {
  assert.match(SCHEMA_SRC, /ADD COLUMN IF NOT EXISTS notification_preferences jsonb/);
  // Defensive CHECK: must be object, not array or scalar.
  assert.match(SCHEMA_SRC, /jsonb_typeof\(notification_preferences\) = 'object'/);
  // Idempotent CHECK wrapper for re-runs.
  assert.match(SCHEMA_SRC, /DO \$\$[\s\S]*?ADD CONSTRAINT[\s\S]*?EXCEPTION[\s\S]*?WHEN duplicate_object/);
});

// ── TS mirror + UI ─────────────────────────────────────────────────

test('Prefs TS interface covers every PREF_KEYS entry', () => {
  for (const key of notificationPrefs.PREF_KEYS) {
    assert.match(
      API_TS,
      new RegExp(`\\b${key}\\?:\\s*boolean`),
      `Prefs interface missing the ${key} field`,
    );
  }
});

test('/preferences page renders 3 toggle groups (customer / ops / legacy)', () => {
  // Three distinct groups so the customer's category is at the top
  // and ops-only toggles don't clutter the customer-view. Drift-
  // guard pins the group count.
  const groups = (PREFS_TSX.match(/heading: ['"]/g) || []).length;
  assert.equal(groups, 3, `expected 3 toggle groups, found ${groups}`);
});

test('/preferences page surfaces every new operator-wedge toggle', () => {
  // Each key must surface as a toggle row OR the user has no way to
  // mute it. Pin each PREF_KEYS entry the sprint added.
  for (const key of [
    'importQuoteReadyEmails',
    'importDeclineEmails',
    'importShipmentStatusEmails',
    'importMessageEmails',
    'importQueueIntakeEmails',
    'importCustomerDecisionEmails',
  ]) {
    assert.match(
      PREFS_TSX,
      new RegExp(`key: ['"]${key}['"]`),
      `/preferences page missing toggle for ${key}`,
    );
  }
});

test('/preferences page renders unstored preferences as ON (opt-out posture)', () => {
  // prefValue helper returns true when prefs[key] is undefined. A
  // refactor that returned false (or coerced via !!prefs[key]) would
  // make every toggle render OFF on first load, misleading the user
  // about their actual state.
  assert.match(PREFS_TSX, /function prefValue\(prefs: Prefs, key: keyof Prefs\): boolean/);
  assert.match(PREFS_TSX, /if \(typeof v === ['"]boolean['"]\) return v;\s*return true;/);
});

test('/preferences page importMessageEmails appears in BOTH the customer + ops groups', () => {
  // The messages email fires for both audiences (customer + ops);
  // the key is one (importMessageEmails) — the UI surfaces it twice
  // so each role-context audience sees the toggle in their group.
  const msgMatches = (PREFS_TSX.match(/key: ['"]importMessageEmails['"]/g) || []).length;
  assert.equal(msgMatches, 2, `expected importMessageEmails toggle in 2 groups, found ${msgMatches}`);
});
