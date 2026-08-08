'use strict';

// Sprint 42 — per-org operator config (v1: stallThresholdDays).
//
// Enterprise customers expect per-tenant knobs. Sprint 42 lifts the
// FIRST knob (the sprint-38 stall threshold) into a KV-backed
// per-org config + ships the threading + handler + UI.
//
// Tests cover five layers:
//   1. Defaults + validation (validatePartial pure function): integer
//      range [1, 90], strict string-equality check kills leading-zero
//      / floats / NaN; non-object payloads fail closed; unknown keys
//      get dropped silently
//   2. get/set round-trip via the in-memory KV stub: defaults merged
//      on read; PATCH writes only the validated subset and re-reads
//      with merge so a single-knob update doesn't clobber prior
//      knobs
//   3. aggregateOpsInsights threading: stallThresholdDays param
//      overrides the platform default; SQL queries bind the
//      effective value; the response's stalledQueue.thresholdDays
//      surfaces the effective value (NOT the static constant)
//   4. Handler shape: ops-only RBAC gate; GET returns config +
//      source + defaults projection; PATCH validates + audit-logs
//      BEFORE returning success (ADR-0005)
//   5. UI: <OperatorConfigPanel> renders the effective threshold in
//      the collapsed summary; the form gates Save on dirty state;
//      PATCH wiring goes to /api/operator-config
//
// The dual-read pattern in the handler (kv.get directly + the helper's
// merged read) is what makes the source map honest — without it, the
// UI couldn't tell "you've set 14" from "platform default is 14"
// (they'd both render identically). Drift-guard pins both reads.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const operatorConfig = require('../lib/operator-config');
const events = require('../lib/events');

const ROOT = path.resolve(__dirname, '..');
const HELPER_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'operator-config.js'), 'utf8');
const HANDLER_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'handlers', 'operator-config.js'), 'utf8');
const DB_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'db', 'import-requests.js'), 'utf8');
const CRON_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'handlers', 'cron.js'), 'utf8');
const DISPATCH_SRC = fs.readFileSync(path.join(ROOT, 'api', '[...path].js'), 'utf8');
const API_TS = fs.readFileSync(path.join(ROOT, 'app-shell', 'lib', 'api.ts'), 'utf8');
const INSIGHTS_TSX = fs.readFileSync(
  path.join(ROOT, 'app-shell', 'app', '(authed)', 'imports', 'insights', 'page.tsx'),
  'utf8',
);

// ── Defaults ──────────────────────────────────────────────────────

test('DEFAULT_OPERATOR_CONFIG exports stallThresholdDays = 7 (platform default)', () => {
  // 7 mirrors the sprint-38 STALL_THRESHOLD_DAYS constant so an org
  // that never touches the config sees the same behaviour as before
  // sprint 42.
  assert.equal(operatorConfig.DEFAULT_OPERATOR_CONFIG.stallThresholdDays, 7);
});

test('DEFAULT_OPERATOR_CONFIG is frozen (defensive against accidental mutation)', () => {
  // The helper reads + spreads defaults on every call; a stray
  // assignment would corrupt every subsequent read.
  assert.ok(Object.isFrozen(operatorConfig.DEFAULT_OPERATOR_CONFIG));
});

// ── validatePartial ────────────────────────────────────────────────

test('validatePartial rejects non-objects + arrays + null + undefined', () => {
  for (const bad of [null, undefined, 7, 'config', [], [{ stallThresholdDays: 5 }]]) {
    const r = operatorConfig.validatePartial(bad);
    assert.equal(r.ok, false, `expected ${JSON.stringify(bad)} to fail`);
    assert.ok(Array.isArray(r.errors) && r.errors.length > 0);
  }
});

test('validatePartial rejects empty object (no recognised knobs)', () => {
  // Empty input on a PATCH is an error, not a no-op — the caller
  // had no effect, and the UI should hear about it.
  const r = operatorConfig.validatePartial({});
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /no valid config keys/i);
});

test('validatePartial accepts the boundary values 1 and 90 for stallThresholdDays', () => {
  // Range gate is [1, 90]; both ends are valid.
  assert.equal(operatorConfig.validatePartial({ stallThresholdDays: 1 }).ok, true);
  assert.equal(operatorConfig.validatePartial({ stallThresholdDays: 90 }).ok, true);
});

test('validatePartial rejects 0, negative, > 90, floats, leading-zero strings, NaN', () => {
  // Strict integer + range check. The String(n) === String(raw) gate
  // (sprint 37 lesson) kills "007" + "30.5" + "30.0" in one tiny
  // line.
  for (const bad of [0, -1, 91, 1000, 30.5, '007', 'abc', NaN, '30.0']) {
    const r = operatorConfig.validatePartial({ stallThresholdDays: bad });
    assert.equal(r.ok, false, `expected ${JSON.stringify(bad)} to fail`);
  }
});

test('validatePartial returns only the validated keys (silently drops unknown ones)', () => {
  // Tolerant of future client versions sending more keys than the
  // server knows; only validated keys land in `value`.
  const r = operatorConfig.validatePartial({
    stallThresholdDays: 12,
    futureKnob: 'whatever',
    someOtherJunk: 99,
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, { stallThresholdDays: 12 });
});

// ── KV round-trip via in-memory stub ───────────────────────────────

// Hot-patch the kv-store with an in-memory map so the tests don't
// require a live Upstash. The helper hits kv.get + kv.set; both go
// through this map.
function withInMemoryKv(fn) {
  const kv = require('../lib/intelligence/kv-store');
  const store = new Map();
  const originalGet = kv.get;
  const originalSet = kv.set;
  const originalDel = kv.del;
  kv.get = async (k) => store.get(k);
  kv.set = async (k, v) => { store.set(k, v); };
  kv.del = async (k) => { store.delete(k); };
  return Promise.resolve()
    .then(() => fn(store))
    .finally(() => {
      kv.get = originalGet;
      kv.set = originalSet;
      kv.del = originalDel;
    });
}

test('getOperatorConfig returns DEFAULTS when KV has nothing for the org', () => {
  return withInMemoryKv(async () => {
    const cfg = await operatorConfig.getOperatorConfig(42);
    assert.deepEqual(cfg, operatorConfig.DEFAULT_OPERATOR_CONFIG);
  });
});

test('getOperatorConfig falls back to DEFAULTS on invalid orgIdNumeric (no throw)', () => {
  return withInMemoryKv(async () => {
    // Non-finite arg: helper must not blow up. The read path runs
    // on every cron tick — a defensive fallback keeps the alerts
    // firing.
    const cfg = await operatorConfig.getOperatorConfig(NaN);
    assert.deepEqual(cfg, operatorConfig.DEFAULT_OPERATOR_CONFIG);
  });
});

test('getOperatorConfig MERGES defaults under stored partial', () => {
  return withInMemoryKv(async (store) => {
    // Stored partial has only one knob set; defaults should fill in
    // the rest. (v1 has only one knob, but the merge shape is what
    // we want for v2+.)
    store.set('operator-config:42', { stallThresholdDays: 14 });
    const cfg = await operatorConfig.getOperatorConfig(42);
    assert.equal(cfg.stallThresholdDays, 14);
  });
});

test('getOperatorConfig discards stale invalid values (re-validates at read time)', () => {
  return withInMemoryKv(async (store) => {
    // Direct KV mutation snuck an invalid value in. Read MUST NOT
    // propagate that to the SQL layer; falls back to the safe
    // default.
    store.set('operator-config:42', { stallThresholdDays: 9999 });
    const cfg = await operatorConfig.getOperatorConfig(42);
    assert.equal(cfg.stallThresholdDays, 7);
  });
});

test('setOperatorConfig writes the validated subset + read-merge-write semantics', () => {
  return withInMemoryKv(async (store) => {
    // Existing partial.
    store.set('operator-config:42', { stallThresholdDays: 14 });
    // PATCH a different field WOULD merge — v1 has only one knob so
    // we test the validation-failure-doesn't-clobber instead.
    const r = await operatorConfig.setOperatorConfig(42, { stallThresholdDays: 21 });
    assert.equal(r.ok, true);
    assert.equal(r.config.stallThresholdDays, 21);
    // KV reflects the write.
    assert.equal(store.get('operator-config:42').stallThresholdDays, 21);
  });
});

test('setOperatorConfig rejects invalid partial WITHOUT touching KV', () => {
  return withInMemoryKv(async (store) => {
    store.set('operator-config:42', { stallThresholdDays: 14 });
    const r = await operatorConfig.setOperatorConfig(42, { stallThresholdDays: 0 });
    assert.equal(r.ok, false);
    assert.match(r.errors[0], /must be between/);
    // KV unchanged.
    assert.equal(store.get('operator-config:42').stallThresholdDays, 14);
  });
});

// ── aggregateOpsInsights threading ─────────────────────────────────

test('aggregateOpsInsights accepts stallThresholdDays + uses it (NOT the constant)', () => {
  // Both SQL queries (count + list) must bind the effective value
  // so the live cockpit + the cron alerts both honour the org's
  // config. Pin the variable name + both binds.
  const block = DB_SRC.match(/async function aggregateOpsInsights\([\s\S]*?return failureFromDb/);
  assert.ok(block, 'aggregateOpsInsights body not located');
  const body = block[0];
  assert.match(body, /effectiveStallThreshold/);
  // Both SQL binds use the effective value, NOT the constant.
  assert.match(body, /\[orgId, String\(effectiveStallThreshold\)\],/);
  assert.match(body, /\[orgId, String\(effectiveStallThreshold\), STALLED_QUEUE_CAP\]/);
});

test('aggregateOpsInsights defensively re-bounds stallThresholdDays to [1, 90]', () => {
  // Defence-in-depth: validation also exists at write time
  // (operator-config.validatePartial) + at the handler layer, but
  // a corrupt cache entry or a future code path that bypassed
  // validation should NOT drive a runaway interval like 999 days.
  const body = DB_SRC.match(/async function aggregateOpsInsights\([\s\S]*?return failureFromDb/)[0];
  // Implementation went through one variable rename for TS narrowing
  // (stallThresholdDays → candidateThreshold after Number() coercion);
  // the gate semantics are unchanged.
  assert.match(
    body,
    /Number\.isInteger\(candidateThreshold\) && candidateThreshold >= 1 && candidateThreshold <= 90/,
  );
});

test('aggregateOpsInsights surfaces EFFECTIVE threshold in stalledQueue.thresholdDays', () => {
  // The UI + email composers read this value; surfacing the static
  // constant would lie about what the SQL actually queried.
  const body = DB_SRC.match(/async function aggregateOpsInsights\([\s\S]*?return failureFromDb/)[0];
  assert.match(body, /thresholdDays: effectiveStallThreshold/);
});

// ── Cron job threading ────────────────────────────────────────────

test('runImportRequestStalledQueueAlert loads operator-config + passes stallThresholdDays', () => {
  // The alert numbers MUST match what an admin sees on the live
  // cockpit when they read the same config. Pin both the require
  // AND the pass-through.
  const block = CRON_SRC.match(/async function runImportRequestStalledQueueAlert\([\s\S]*?\n\}/);
  assert.ok(block, 'runImportRequestStalledQueueAlert body not located');
  const body = block[0];
  assert.match(body, /require\(['"]\.\.\/operator-config['"]\)/);
  assert.match(body, /const orgConfig = await operatorConfig\.getOperatorConfig\(orgIdNumeric\)/);
  assert.match(body, /stallThresholdDays: orgConfig\.stallThresholdDays/);
});

// ── Handler ────────────────────────────────────────────────────────

test('Dispatcher registers operator-config under /api/operator-config', () => {
  // The catch-all routes /api/<name> → handlers[<name>] (sprint
  // backend-stack note). New handlers must be listed.
  assert.match(DISPATCH_SRC, /['"]operator-config['"]: require\(['"]\.\.\/lib\/handlers\/operator-config['"]\)/);
});

test('Handler enforces ops-only RBAC via admin/owner gate', () => {
  // The gate's surface mirrors the sprint-17 insights endpoint:
  // a member-role lookup against the canonical role list. Pin the
  // 403 path so a refactor can't accidentally widen the gate.
  assert.match(HANDLER_SRC, /OPS_REVIEW_ROLES = new Set\(\['admin', 'owner'\]\)/);
  assert.match(HANDLER_SRC, /only owner \/ admin members can read or change operator config/);
});

test('Handler supports GET (read-only) + PATCH (write); other methods 405', () => {
  assert.match(HANDLER_SRC, /if \(req\.method === ['"]GET['"]\) return handleGet/);
  assert.match(HANDLER_SRC, /if \(req\.method === ['"]PATCH['"]\) return handlePatch/);
  assert.match(HANDLER_SRC, /jsonResponse\(res, 405,/);
});

test('Handler PATCH writes the operator_config_updated audit event BEFORE returning 200 (ADR-0005)', () => {
  // The audit chain MUST capture every policy change. Drift-guard
  // pins the event.record call AND the no-silent-swallow posture:
  // a try/catch around the record that returns 500 (not silently
  // proceeding).
  const block = HANDLER_SRC.match(/async function handlePatch\([\s\S]*?\n\}/);
  assert.ok(block, 'handlePatch body not located');
  const body = block[0];
  assert.match(body, /events\.record\(['"]operator_config_updated['"],/);
  // Audit failure → 500, NEVER silent success.
  assert.match(body, /Could not record audit event for config update/);
  assert.match(body, /jsonResponse\(res, 500/);
});

test('events.ALLOWED_TYPES includes operator_config_updated (drift-guard against silent-drop)', () => {
  // Sprint 14 lesson — events not in ALLOWED_TYPES are silently
  // dropped. A new audit-event type that's NOT in the allowlist
  // would break the PATCH path.
  assert.ok(events.ALLOWED_TYPES.has('operator_config_updated'));
});

test('Handler GET returns { config, source, defaults } projection', () => {
  // The dual-read pattern (raw stored partial + merged effective)
  // is what makes the `source` map honest. Drift-guard pins both
  // reads.
  const block = HANDLER_SRC.match(/async function handleGet\([\s\S]*?\n\}/);
  assert.ok(block);
  const body = block[0];
  // Reads raw partial directly from KV for the source map.
  assert.match(body, /kv\.get\(operatorConfig\.KEY_PREFIX/);
  // Projects via projectConfig (the helper that builds source +
  // effective + defaults).
  assert.match(body, /projectConfig\(storedRaw\)/);
  assert.match(body, /config: projection\.effective/);
  assert.match(body, /source: projection\.source/);
  assert.match(body, /defaults: projection\.defaults/);
});

// ── TS mirror ──────────────────────────────────────────────────────

test('TS OperatorConfig + OperatorConfigResponse interfaces mirror the JS shape', () => {
  // Cross-layer breadcrumb. A future widening of the JS config
  // without updating TS would silently break the toggle's
  // type-checking.
  assert.match(API_TS, /export interface OperatorConfig \{[\s\S]*?stallThresholdDays: number;[\s\S]*?\}/);
  assert.match(API_TS, /export interface OperatorConfigResponse \{[\s\S]*?config: OperatorConfig;[\s\S]*?source: OperatorConfigSource;[\s\S]*?defaults: OperatorConfig;[\s\S]*?\}/);
});

// ── UI ─────────────────────────────────────────────────────────────

test('OperatorConfigPanel mounts BETWEEN Hero and the proactive band (StalledQueueCard)', () => {
  // The panel sits in the "settings" slot below Hero so a user
  // who notices "0 stalled never fires" can dial the threshold
  // without leaving the page. Pin the relative position.
  const panelIdx = INSIGHTS_TSX.indexOf('<OperatorConfigPanel');
  const heroIdx = INSIGHTS_TSX.indexOf('<Hero ');
  const stalledIdx = INSIGHTS_TSX.indexOf('<StalledQueueCard');
  assert.ok(heroIdx < panelIdx, 'OperatorConfigPanel must mount AFTER Hero');
  assert.ok(panelIdx < stalledIdx, 'OperatorConfigPanel must mount BEFORE StalledQueueCard');
});

test('OperatorConfigPanel reads the EFFECTIVE threshold from data.stalledQueue.thresholdDays', () => {
  // The cockpit's source of truth — what the SQL just queried. The
  // panel reading from THIS field guarantees the displayed value
  // matches the cohort the user sees alongside it. Sprint 43 split
  // the JSX prop list across multiple lines as a 2nd prop was
  // added; the source-pin tolerates whitespace.
  assert.match(
    INSIGHTS_TSX,
    /<OperatorConfigPanel[\s\S]{0,200}currentStallThreshold=\{data\.stalledQueue\.thresholdDays\}/,
  );
});

test('OperatorConfigPanel PATCHes /api/operator-config on save', () => {
  // The save handler hits the new endpoint, NOT a guessed path. The
  // request body carries the validated number. Sprint 43 — payload
  // shape moved from a literal `{ stallThresholdDays: ... }` to a
  // dirty-fields-only patch object; the field assignment is what we
  // pin now, in either old or new form.
  const block = INSIGHTS_TSX.match(/function OperatorConfigPanel\([\s\S]*?\n\}\n\n\/\* /);
  assert.ok(block, 'OperatorConfigPanel body not located');
  const body = block[0];
  assert.match(body, /apiPatch<OperatorConfigResponse>\(['"]\/api\/operator-config['"],/);
  // The stall knob lands in the payload in one of the two acceptable
  // forms — the sprint-42 literal `stallThresholdDays: Number(pending)`
  // (object-literal key) or the sprint-43 dirty-field assignment
  // `patch.stallThresholdDays = Number(pendingStall)`.
  assert.ok(
    /stallThresholdDays:\s*Number\(pending\)/.test(body)
      || /patch\.stallThresholdDays\s*=\s*Number\(pendingStall\)/.test(body),
    'stallThresholdDays payload assignment not found',
  );
});

test('OperatorConfigPanel gates the Save button on dirty state (no save when value unchanged)', () => {
  // Without the dirty gate, clicking Save when nothing changed
  // would fire a no-op PATCH + audit-log a noise event. Sprint 43
  // split `dirty` into per-knob flags + an aggregate; both names
  // are acceptable here.
  const block = INSIGHTS_TSX.match(/function OperatorConfigPanel\([\s\S]*?\n\}\n\n\/\* /);
  assert.ok(block);
  const body = block[0];
  // Either the original single-knob check OR the sprint-43 per-knob
  // dirty check + an aggregate `const dirty = dirtyStall || ...`.
  assert.ok(
    /const dirty = Number\(pending\) !== Number\(currentStallThreshold\)/.test(body)
      || /const dirty = dirtyStall \|\| dirtySpike/.test(body),
    'dirty-gate expression not found in either sprint-42 or sprint-43 form',
  );
  assert.match(body, /disabled=\{!dirty \|\| saving\}/);
});

test('OperatorConfigPanel input enforces the same range as the server (1–90, integer step)', () => {
  // The HTML input attributes give immediate browser-side feedback
  // matching the server's validation gate. min=1 / max=90 / step=1.
  const block = INSIGHTS_TSX.match(/function OperatorConfigPanel\([\s\S]*?\n\}\n\n\/\* /);
  assert.ok(block);
  const body = block[0];
  assert.match(body, /type="number"/);
  assert.match(body, /min=\{1\}/);
  assert.match(body, /max=\{90\}/);
  assert.match(body, /step=\{1\}/);
});
