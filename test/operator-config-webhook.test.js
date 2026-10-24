'use strict';

// Sprint 72 — operator_config_updated joins the webhook dispatch
// surface + the audit event captures before-values (`previous`).
//
// Two halves, one sprint:
//   A. Config governance goes push: external systems (SIEM, GRC,
//      Slack bridges) can subscribe to operator_config_updated —
//      the SAP-GTS "config audit export" pattern, push not batch.
//      Strictly opt-in: subscriptions store explicit eventTypes
//      arrays, so no existing endpoint receives the new type
//      until its owner asks for it.
//   B. The audit event carries `previous` — before-values for
//      every knob the PATCH touched (set OR reset). Webhook
//      subscribers see the full old→new diff without querying
//      back; the history panel renders "(was 7d)"; a future undo
//      affordance has its raw material.
//
// Truthfulness discipline (the load-bearing bit):
//   - A kv.get MISS (key absent) is NOT a failure — it genuinely
//     means "nothing stored, all knobs at defaults" → per-knob
//     null inside `previous`.
//   - A kv.get THROW means we did not observe prior state →
//     `previous` is OMITTED from the detail entirely. Absence =
//     "unknown", never a fabricated "was default".
//   - The snapshot MUST be read BEFORE setOperatorConfig /
//     unsetKnobs — a post-mutation read would see the new values.
//     Positional pins below enforce.
//
// Test layers:
//   1. WEBHOOK_EVENT_TYPES membership + curated-subset + opt-in
//      dispatch runtime smoke (in-memory KV, mock fetch)
//   2. Handler source pins: pre-mutation positional order,
//      per-knob null semantics, fail-soft catch, conditional
//      spread into detail
//   3. Projection: listOperatorConfigHistory carries previous
//      (runtime smoke: populated / legacy-null / malformed-array)
//   4. TS mirror + UI rendering pins ("(was …)" on set AND reset,
//      'was default' for per-knob null, whole-field-null hides)

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const webhooks = require('../lib/webhooks');
const dispatch = require('../lib/webhooks-dispatch');
const events = require('../lib/events');

const ROOT = path.resolve(__dirname, '..');
const WEBHOOKS_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'webhooks.js'), 'utf8');
const HANDLER_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'handlers', 'operator-config.js'), 'utf8');
const EVENTS_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'events.js'), 'utf8');
const API_TS = fs.readFileSync(path.join(ROOT, 'app-shell', 'lib', 'api.ts'), 'utf8');
const INSIGHTS_TSX = fs.readFileSync(
  path.join(ROOT, 'app-shell', 'app', '(authed)', 'imports', 'insights', 'page.tsx'),
  'utf8',
);

// Same in-memory KV harness as test/webhooks-dispatch.test.js —
// swaps the store for the duration of one test, restores after.
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

// ── Layer 1: dispatch surface ─────────────────────────────────────

test('operator_config_updated is in WEBHOOK_EVENT_TYPES (runtime)', () => {
  assert.ok(webhooks.WEBHOOK_EVENT_TYPES.includes('operator_config_updated'));
});

test('operator_config_updated appears in the WEBHOOK_EVENT_TYPES source literal (drift-guard)', () => {
  // Source pin so a refactor that rebuilt the list from some other
  // shape can't silently drop the config-governance type.
  const block = WEBHOOKS_SRC.match(/const WEBHOOK_EVENT_TYPES = Object\.freeze\(\[[\s\S]*?\]\);/);
  assert.ok(block, 'WEBHOOK_EVENT_TYPES literal not found');
  assert.match(block[0], /'operator_config_updated',/);
});

test('operator_config_updated stays a curated subset of events.ALLOWED_TYPES', () => {
  // The generic subset test in webhooks.test.js also covers this;
  // pinned here too so THIS sprint\'s suite fails standalone if the
  // events-side registration is ever removed.
  assert.ok(events.ALLOWED_TYPES.has('operator_config_updated'));
});

test('dispatchEvent delivers operator_config_updated to a subscribed endpoint with the full detail (previous included, chain stamps stripped)', () => {
  return withInMemoryKv(async () => {
    const calls = [];
    const fakeFetch = async (url, opts) => {
      calls.push({ url, headers: opts.headers, body: opts.body });
      return { ok: true, status: 200 };
    };
    await webhooks.createWebhook({
      orgIdNumeric: 72,
      label: 'GRC bridge',
      url: 'https://example.com/grc',
      eventTypes: ['operator_config_updated'],
    });
    const r = await dispatch.dispatchEvent({
      event: {
        type: 'operator_config_updated',
        orgId: 72,
        at: '2026-07-07T00:00:00Z',
        actorEmailHash: 'abc123def456ghi7',
        _seq: 9, _hash: 'h', _prevHash: 'p',
        detail: {
          patched: { stallThresholdDays: 3 },
          previous: { stallThresholdDays: null },
          reason: 'sprint-72 smoke',
        },
      },
      fetchImpl: fakeFetch,
    });
    assert.equal(r.attempted, 1);
    assert.equal(r.succeeded, 1);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].headers['X-OrcaTrade-Event'], 'operator_config_updated');
    const envelope = JSON.parse(calls[0].body);
    assert.equal(envelope.type, 'operator_config_updated');
    // The full audit diff travels: after-values AND before-values.
    assert.deepEqual(envelope.event.detail.patched, { stallThresholdDays: 3 });
    assert.deepEqual(envelope.event.detail.previous, { stallThresholdDays: null });
    assert.equal(envelope.event.detail.reason, 'sprint-72 smoke');
    // Chain-stamp internals NEVER reach a customer endpoint.
    assert.equal(envelope.event._seq, undefined);
    assert.equal(envelope.event._hash, undefined);
    assert.equal(envelope.event._prevHash, undefined);
  });
});

test('operator_config_updated dispatch is opt-in — a sub on import lifecycle types alone is NOT hit', () => {
  return withInMemoryKv(async () => {
    const calls = [];
    const fakeFetch = async (url, opts) => {
      calls.push({ url, body: opts.body });
      return { ok: true, status: 200 };
    };
    // A pre-sprint-72 subscription shape: import lifecycle only.
    await webhooks.createWebhook({
      orgIdNumeric: 73,
      label: 'Legacy lifecycle sub',
      url: 'https://example.com/lifecycle',
      eventTypes: ['import_request_created', 'import_request_rated'],
    });
    const r = await dispatch.dispatchEvent({
      event: { type: 'operator_config_updated', orgId: 73, detail: { patched: {} } },
      fetchImpl: fakeFetch,
    });
    assert.equal(r.attempted, 0, 'no sub asked for config events — nothing may fire');
    assert.equal(calls.length, 0);
  });
});

// ── Layer 2: handler pre-mutation capture (source pins) ──────────

test('previous snapshot is read BEFORE setOperatorConfig/unsetKnobs (positional pin)', () => {
  // A post-mutation read would see the NEW values — the whole
  // point of the capture dies silently. indexOf ordering enforces.
  const snapshotIdx = HANDLER_SRC.indexOf('const rawPre = await kvPre.get(operatorConfig.KEY_PREFIX');
  const setIdx = HANDLER_SRC.indexOf('await operatorConfig.setOperatorConfig(ctx.orgIdNumeric, knobPatch)');
  const unsetIdx = HANDLER_SRC.indexOf('await operatorConfig.unsetKnobs(ctx.orgIdNumeric, resetResult.keys)');
  assert.ok(snapshotIdx > -1, 'pre-mutation snapshot read not found');
  assert.ok(setIdx > -1, 'setOperatorConfig call not found');
  assert.ok(unsetIdx > -1, 'unsetKnobs call not found');
  assert.ok(snapshotIdx < setIdx, 'previous snapshot MUST be captured before setOperatorConfig');
  assert.ok(snapshotIdx < unsetIdx, 'previous snapshot MUST be captured before unsetKnobs');
});

test('previous covers BOTH set and reset keys with per-knob null = "was at platform default"', () => {
  // The touched-key union: Object.keys(knobPatch) + resetResult.keys.
  assert.match(
    HANDLER_SRC,
    /for \(const k of \[\.\.\.Object\.keys\(knobPatch\), \.\.\.resetResult\.keys\]\)/,
  );
  // A knob absent from the stored partial was at platform default →
  // per-knob null. hasOwnProperty (not truthiness) so a stored 0
  // could never be misread as "default".
  assert.match(
    HANDLER_SRC,
    /previous\[k\] = Object\.prototype\.hasOwnProperty\.call\(storedPre, k\)\s*\?\s*storedPre\[k\]\s*:\s*null;/,
  );
});

test('pre-read THROW omits previous entirely — never a fabricated "was default" (audit truthfulness)', () => {
  // The catch resets to null…
  const captureBlock = HANDLER_SRC.match(/let previous = null;[\s\S]*?catch \(_\) \{\s*previous = null;\s*\}/);
  assert.ok(captureBlock, 'fail-soft capture block not found');
  // …and the detail spread is conditional on that null.
  assert.match(HANDLER_SRC, /\.\.\.\(previous !== null \? \{ previous \} : \{\}\),/);
});

test('previous travels inside the operator_config_updated audit detail (alongside patched)', () => {
  // The spread must live inside the events.record detail object —
  // between `patched: knobPatch,` and the reset/reason spreads.
  const recordBlock = HANDLER_SRC.match(/await events\.record\('operator_config_updated',[\s\S]*?\}\);/);
  assert.ok(recordBlock, 'events.record call not found');
  assert.match(recordBlock[0], /patched: knobPatch,/);
  assert.match(recordBlock[0], /\.\.\.\(previous !== null \? \{ previous \} : \{\}\),/);
});

// ── Layer 3: history projection ───────────────────────────────────

test('listOperatorConfigHistory projects previous with object-shape + array guards (source pin)', () => {
  const block = EVENTS_SRC.match(/async function listOperatorConfigHistory[\s\S]*?\n\}/);
  assert.ok(block, 'listOperatorConfigHistory not found');
  const body = block[0];
  assert.match(body, /\bprevious:/);
  // Guard shape: object AND not-array. A malformed historical
  // event renders as "no before-values", never a UI crash.
  assert.match(
    body,
    /e\.detail\.previous && typeof e\.detail\.previous === 'object'\s*&& !Array\.isArray\(e\.detail\.previous\)/,
  );
});

test('listOperatorConfigHistory carries previous through for a populated event (runtime)', async () => {
  // Under ORCATRADE_DISABLE_LIVE_TARIC the KV store is in-memory
  // so events.record works in unit tests.
  const orgId = 999_997_201;
  await events.record('operator_config_updated', {
    orgId,
    entityType: 'operator_config',
    entityId: 'sprint72-smoke',
    actorEmailHash: 'abc123def456ghi7',
    detail: {
      patched: { stallThresholdDays: 3 },
      previous: { stallThresholdDays: 7, quoteFollowUpThresholdDays: null },
      reset: ['quoteFollowUpThresholdDays'],
    },
  });
  const list = await events.listOperatorConfigHistory({ orgId, limit: 5 });
  assert.equal(list.length, 1);
  assert.deepEqual(list[0].previous, {
    stallThresholdDays: 7,
    quoteFollowUpThresholdDays: null,
  });
  assert.deepEqual(list[0].patched, { stallThresholdDays: 3 });
  assert.deepEqual(list[0].reset, ['quoteFollowUpThresholdDays']);
});

test('listOperatorConfigHistory previous is null for legacy events that predate the capture (runtime)', async () => {
  const orgId = 999_997_202;
  await events.record('operator_config_updated', {
    orgId,
    entityType: 'operator_config',
    entityId: 'sprint72-legacy',
    actorEmailHash: 'abc123def456ghi7',
    // Sprint-42..71 shape — no previous field.
    detail: { patched: { stallThresholdDays: 5 } },
  });
  const list = await events.listOperatorConfigHistory({ orgId, limit: 5 });
  assert.equal(list.length, 1);
  assert.equal(list[0].previous, null);
});

test('listOperatorConfigHistory previous is null when a malformed event stored an array (runtime)', async () => {
  const orgId = 999_997_203;
  await events.record('operator_config_updated', {
    orgId,
    entityType: 'operator_config',
    entityId: 'sprint72-malformed',
    actorEmailHash: 'abc123def456ghi7',
    detail: { patched: { stallThresholdDays: 5 }, previous: [7] },
  });
  const list = await events.listOperatorConfigHistory({ orgId, limit: 5 });
  assert.equal(list.length, 1);
  assert.equal(list[0].previous, null);
});

// ── Layer 4: TS mirror + UI rendering ─────────────────────────────

test('OperatorConfigHistoryEntry TS extends with previous: Record<string, number | null> | null', () => {
  assert.match(
    API_TS,
    /export interface OperatorConfigHistoryEntry \{[\s\S]*?patched: Partial<OperatorConfig>;[\s\S]*?previous: Record<string, number \| null> \| null;[\s\S]*?\}/,
  );
});

test('OperatorConfigHistoryList renders the "(was …)" suffix on set AND reset branches', () => {
  const block = INSIGHTS_TSX.match(/function OperatorConfigHistoryList\([\s\S]*?\n\}\n\n\/\* /);
  assert.ok(block, 'OperatorConfigHistoryList not found');
  const body = block[0];
  // The helper distinguishes whole-field null (unknown → no
  // suffix) from per-knob null ("was default").
  assert.match(body, /const wasLabel = \(k: keyof OperatorConfig\): string \| null =>/);
  assert.match(body, /if \(prev === null\) return 'was default';/);
  assert.match(body, /`was \$\{formatKnobValue\(k, prev\)\}`/);
  // Whole-field-null guard: hasOwnProperty against entry.previous,
  // not truthiness of the per-knob value (a stored 0 must render).
  assert.match(body, /!Object\.prototype\.hasOwnProperty\.call\(entry\.previous, k\)/);
  // Rendered in BOTH branches — set values and reset knob names.
  const suffixCount = (body.match(/\{was && \(/g) || []).length;
  assert.ok(suffixCount >= 2, `"(was …)" suffix must render on set AND reset branches (found ${suffixCount})`);
  assert.match(body, /\(\{was\}\)/);
});
