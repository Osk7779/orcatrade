'use strict';

// Drift-guard: every event type ANYWHERE in lib/ that the codebase
// calls events.record('<type>', ...) on MUST be present in
// lib/events.js ALLOWED_TYPES. Otherwise events.record returns false
// silently — the audit row never lands in KV, the dual-write to
// Postgres never fires, and ADR 0005 ("every mutation writes the audit
// log before returning success") is broken without any test surfacing
// the regression.
//
// Discovered in sprint 14: the entire operator wedge's import-request
// events had been silently dropped since sprint 1 because four
// types (import_request_created / _updated / _status_transition /
// _archived) were missing from the allowlist. The TransitionHistory
// component on /imports/[externalId] was rendering 0 events for
// every customer. Same gap had silently dropped human-review queue
// events (ADR 0015) and SCIM provisioning events.
//
// This test prevents the regression at the source: a future PR that
// adds events.record('<new_type>', ...) without extending ALLOWED_TYPES
// fails at PR-smoke time, not in production weeks later when an
// auditor asks for the audit trail.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const LIB = path.join(ROOT, 'lib');
const events = require('../lib/events');

// Walk lib/ recursively, returning every .js file.
function walk(dir) {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) out.push(...walk(full));
    else if (full.endsWith('.js') && !full.endsWith('.test.js')) out.push(full);
  }
  return out;
}

// Match events.record('<type>', ...) — single-quoted string literal
// argument. We do not match dynamic record(type, ...) calls because
// those would be inherently un-checkable; the only one of those is
// inside lib/events.js itself (the function definition).
const RECORD_RE = /events\.record\(\s*['"]([a-z][a-z0-9_]*)['"]/g;

function collectRecordedTypes() {
  const found = new Map();  // type → [file, file, ...]
  for (const file of walk(LIB)) {
    // Skip the events module itself — its own type-token strings
    // appear in code comments + allowlist constants, not in actual
    // record() calls.
    if (file.endsWith('/lib/events.js')) continue;
    const src = fs.readFileSync(file, 'utf8');
    let m;
    RECORD_RE.lastIndex = 0;
    while ((m = RECORD_RE.exec(src)) !== null) {
      const type = m[1];
      if (!found.has(type)) found.set(type, []);
      const rel = path.relative(ROOT, file);
      if (!found.get(type).includes(rel)) found.get(type).push(rel);
    }
  }
  return found;
}

test('every events.record(<type>, ...) call in lib/ targets an ALLOWED_TYPES entry', () => {
  const recorded = collectRecordedTypes();
  assert.ok(recorded.size > 0, 'no events.record calls found — the regex is likely broken');

  const missing = [];
  for (const [type, files] of recorded.entries()) {
    if (!events.ALLOWED_TYPES.has(type)) {
      missing.push({ type, files });
    }
  }

  if (missing.length > 0) {
    const lines = missing.map(({ type, files }) => `  - "${type}"   recorded in: ${files.join(', ')}`);
    assert.fail(
      `Found ${missing.length} event type(s) recorded by lib/ but missing from ALLOWED_TYPES:\n` +
      lines.join('\n') +
      `\n\nAdd each missing type to ALLOWED_TYPES in lib/events.js with a comment ` +
      `explaining the lifecycle event. Otherwise events.record() returns false silently ` +
      `and ADR 0005's "audit log before success" promise is broken for that path.`,
    );
  }
});

test('events.record returns true for an allowlisted type (smoke — proves the gate matters)', async () => {
  // The cheapest possible end-to-end proof: pick a type we know is in
  // the allowlist (one of the goods events, since goods_master_created
  // is the simplest payload), call record(), and assert true. If the
  // gate flipped (e.g. someone inverted the !ALLOWED_TYPES.has check),
  // this would catch it immediately.
  const ok = await events.record('goods_master_created', {
    orgId: 'test-allowlist-smoke',
    entityType: 'goods_master',
    entityId: 'sm_drift_guard_test',
    after: { id: 'sm_drift_guard_test' },
  });
  assert.equal(ok, true, 'events.record must return true for an allowlisted type');
});

test('events.record returns false for an unknown type (the gate is still doing its job)', async () => {
  const ok = await events.record('definitely_not_a_real_event_type_xyz', {});
  assert.equal(ok, false, 'events.record must reject unknown types so typos in record() calls do not pollute the log');
});

test('all 4 operator-wedge import-request event types are in the allowlist (sprint 14 ground truth)', () => {
  // Explicit-by-name guard so a future refactor that drops one of the
  // four can't pass because the others still cover the regex. The
  // operator wedge is the load-bearing customer journey — its audit
  // trail must not regress.
  for (const t of [
    'import_request_created',
    'import_request_updated',
    'import_request_status_transition',
    'import_request_archived',
  ]) {
    assert.ok(events.ALLOWED_TYPES.has(t), `import-request event ${t} must be allowlisted`);
  }
});
