'use strict';

// Sprint 88 — cockpit knob threading (BUG FIX) + two standing
// coverage guards.
//
// THE BUG: since sprint 42, handleInsights never loaded per-org
// config — aggregateOpsInsights received no knob params from the
// cockpit path, so the dashboard the customer tunes their knobs
// against kept using platform defaults while the cron emails
// honoured the overrides. Five sprints of knob machinery (42, 43,
// 60, 64, 71) affected only the alert emails. No pin ever covered
// the handler→aggregation threading; these do, knob-derived, so
// knob #6 can never ship half-threaded.
//
// Also closes Track A with a standing audit-coverage guard: the
// org audit CSV reads through listForOrg, whose ORG_ACTIVITY_TYPES
// allowlist must remain a SUPERSET of the audit-export taxonomy —
// a future audit type missing from the activity allowlist would
// silently vanish from the auditor's CSV.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const events = require('../lib/events');
const operatorConfig = require('../lib/operator-config');

const ROOT = path.resolve(__dirname, '..');
const HANDLER_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'handlers', 'imports.js'), 'utf8');

// ── The fix ───────────────────────────────────────────────────────

test('handleInsights loads per-org config and threads EVERY knob into the aggregation (knob-derived pin)', () => {
  const block = HANDLER_SRC.match(/async function handleInsights\([\s\S]*?\n\}/);
  assert.ok(block, 'handleInsights not found');
  const body = block[0];
  assert.match(body, /const orgConfig = await operatorConfig\.getOperatorConfig\(ctx\.orgIdNumeric\);/);
  // Knob-DERIVED coverage: iterate the canonical KNOB_KEYS so a
  // sixth knob added to DEFAULT_OPERATOR_CONFIG fails this pin
  // until it's threaded here too — the exact half-threading gap
  // that caused the original bug.
  for (const knob of operatorConfig.KNOB_KEYS) {
    assert.match(
      body,
      new RegExp(`${knob}: orgConfig\\.${knob},`),
      `handleInsights must thread ${knob} — a knob the cockpit ignores is the sprint-42..87 bug again`,
    );
  }
});

test('threading is positioned: config load AFTER the role gate, knobs INSIDE the aggregation call', () => {
  const block = HANDLER_SRC.match(/async function handleInsights\([\s\S]*?\n\}/)[0];
  const gateIdx = block.indexOf('requireOpsRole');
  const loadIdx = block.indexOf('getOperatorConfig');
  const aggIdx = block.indexOf('aggregateOpsInsights');
  assert.ok(gateIdx > -1 && loadIdx > -1 && aggIdx > -1);
  assert.ok(gateIdx < loadIdx, 'no per-org read before the RBAC gate');
  assert.ok(loadIdx < aggIdx, 'config must be loaded before the aggregation consumes it');
});

// ── Standing guard 1: knob-threading parity with the cron paths ──

test('every knob the crons thread, the cockpit threads too (parity across all call sites)', () => {
  // The original bug was a PARITY failure between call sites. This
  // guard greps the cron daily/weekly runners for orgConfig.<knob>
  // usage and asserts the cockpit passes the same knob.
  const CRON_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'handlers', 'cron.js'), 'utf8');
  const insightsBlock = HANDLER_SRC.match(/async function handleInsights\([\s\S]*?\n\}/)[0];
  const cronKnobs = new Set(
    [...CRON_SRC.matchAll(/(\w+): orgConfig\.(\w+),/g)].map((m) => m[2]),
  );
  for (const knob of cronKnobs) {
    assert.match(
      insightsBlock,
      new RegExp(`orgConfig\\.${knob}`),
      `cron paths thread ${knob} but the cockpit does not — the two surfaces would disagree`,
    );
  }
});

// ── Standing guard 2: audit-CSV coverage (Track A close-out) ─────

test('IMPORT_REQUEST_AUDIT_EVENT_TYPES ⊆ ORG_ACTIVITY_TYPES — no audit type can silently vanish from the org CSV', () => {
  // The org audit CSV reads through listForOrg (PG-first since
  // sprint 79), which filters by ORG_ACTIVITY_TYPES before the
  // handler applies the audit taxonomy. Any audit type missing
  // from the activity allowlist would be silently absent from the
  // auditor's export — an integrity gap, not a rendering nit.
  const auditBlock = HANDLER_SRC.match(/const IMPORT_REQUEST_AUDIT_EVENT_TYPES = new Set\(\[([\s\S]*?)\]\);/);
  assert.ok(auditBlock, 'audit taxonomy not found');
  const auditTypes = [...auditBlock[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  assert.ok(auditTypes.length >= 10, `expected the full taxonomy, got ${auditTypes.length}`);
  for (const t of auditTypes) {
    assert.ok(
      events.ORG_ACTIVITY_TYPES.has(t),
      `audit type ${t} is not in ORG_ACTIVITY_TYPES — it would silently vanish from the org audit CSV`,
    );
  }
});
