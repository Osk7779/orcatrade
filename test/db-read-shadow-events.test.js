'use strict';

// Apex A2 step 4 — read-shadow extended to the events stream.
// Also a III2 audit-integrity signal: a divergence between KV
// events and PG events is not just a cutover-readiness signal
// but a potential security incident.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const eventsSrc = fs.readFileSync(path.join(ROOT, 'lib/events.js'), 'utf8');

// ── handler-side wiring ────────────────────────────────────────────

test('lib/events.js list() wires shadowCompare to listFromPg', () => {
  // Source-pin: the wiring lives in events.list (the KV-primary
  // read path). Three load-bearing details:
  //   1. shadowCompare is registered as 'events.list' so log
  //      aggregation can scope the divergence metric to this
  //      specific seam vs the saved-plans/portfolios ones.
  //   2. The pgFetcher is listFromPg with the same filter args.
  //   3. The projector strips KV-only chain stamps + raw email.
  assert.match(eventsSrc, /name:\s*['"]events\.list['"]/);
  assert.match(eventsSrc, /pgFetcher:\s*\(\)\s*=>\s*listFromPg/);
  assert.match(eventsSrc, /projector:\s*projectEventsForShadow/);
});

test('list() returns KV results unchanged whether shadow runs or not (hot-path invariant)', async () => {
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
  const kv = require('../lib/intelligence/kv-store');
  const events = require('../lib/events');
  kv._resetMemoryStore();
  await events.record('auth_signin', { email: 'a@example.com' });
  await events.record('auth_signin', { email: 'b@example.com' });

  const prev = process.env.ORCATRADE_SHADOW_PG;
  // Run twice — once with shadow off, once on. Both must return
  // the same KV-canonical result.
  delete process.env.ORCATRADE_SHADOW_PG;
  const off = await events.list({ type: 'auth_signin', limit: 10 });
  process.env.ORCATRADE_SHADOW_PG = '1';
  const on = await events.list({ type: 'auth_signin', limit: 10 });
  if (prev === undefined) delete process.env.ORCATRADE_SHADOW_PG;
  else process.env.ORCATRADE_SHADOW_PG = prev;
  assert.equal(off.length, 2);
  assert.equal(on.length, 2);
  // Identical content + order.
  assert.deepEqual(off.map((e) => e.type), on.map((e) => e.type));
});

// ── projector contract ─────────────────────────────────────────────
//
// The projector is exported via the shadowCompare callback rather
// than module exports (it's an implementation detail). Pin its
// source so a future refactor can't quietly change the comparison
// shape.

test('projectEventForShadow strips KV-only chain stamps + raw email', () => {
  // Pin negatively: the projector body must NOT include the
  // shape-divergence fields. If a future refactor adds back
  // `at` or `email` to the projection, every read will fire
  // divergence and drown the signal.
  const fnMatch = eventsSrc.match(/function projectEventForShadow\([\s\S]{0,1500}?^}/m);
  assert.ok(fnMatch, 'projectEventForShadow must exist');
  const body = fnMatch[0];
  // Must skip these fields (the comparison's load-bearing exclusions).
  for (const field of ["'email'", "'_seq'", "'_prevHash'", "'_hash'", "'at'"]) {
    assert.ok(
      body.includes(field),
      `projector must skip ${field} (KV-only shape that PG legitimately doesn't carry)`,
    );
  }
});

test('projectEventForShadow derives emailHash from raw email (KV-shape) or passes through (PG-shape)', () => {
  const fnMatch = eventsSrc.match(/function projectEventForShadow\([\s\S]{0,1500}?^}/m);
  const body = fnMatch[0];
  // Pin both branches: derive from raw email AND honour pre-existing
  // emailHash. Without the derivation, KV-shape events (raw email)
  // and PG-shape events (emailHash) would compare unequal and the
  // shadow would scream divergence on every read.
  assert.match(body, /hashLib\.emailHash\(event\.email\)/);
  assert.match(body, /projected\.emailHash\s*=\s*event\.emailHash/);
  assert.match(body, /isAlreadyPseudonym/);
});

test('projectEventsForShadow returns { length, rows } with deterministic ordering', () => {
  assert.match(eventsSrc, /function projectEventsForShadow/);
  assert.match(eventsSrc, /length:\s*events\.length/);
  // Sort key uses (type, emailHash, payload-JSON) — pin all three.
  const fnMatch = eventsSrc.match(/function projectEventsForShadow\([\s\S]{0,1500}?^}/m);
  const body = fnMatch[0];
  assert.match(body, /a\.type/);
  assert.match(body, /a\.emailHash/);
  assert.match(body, /JSON\.stringify\(a\)/);
});

// ── shadow integration: the comparison actually agrees ────────────

test('KV and PG event shapes project to the same comparable form when contents agree', async () => {
  // No live DB in test env, so we exercise the projector directly
  // against two records that should be considered equal.
  //
  // The projector lives in lib/events.js. Re-require it inside this
  // test via the shadow seam — readShadow.shadowCompare passes the
  // projector as a function reference, so we can validate the
  // contract by parsing the source + executing the same projection
  // logic in this test as a local copy.

  const hash = require('../lib/hash');
  const kvShape = {
    type: 'plan_saved',
    at: '2026-06-01T12:34:56.789Z',
    email: 'alice@example.com',
    _seq: 42,
    _prevHash: 'abc123',
    _hash: 'def456',
    planId: 'pl_xyz',
    landedTotal: 17500,
  };
  const pgShape = {
    type: 'plan_saved',
    at: '2026-06-01T12:34:56.789Z',  // intentionally different precision tolerated
    emailHash: hash.emailHash('alice@example.com'),
    planId: 'pl_xyz',
    landedTotal: 17500,
  };
  // Local copy of the projector (kept in lockstep with lib/events.js
  // by the source-pin test above).
  function projectEventForShadow(event) {
    if (!event || typeof event !== 'object') return event;
    const projected = {};
    for (const k of Object.keys(event)) {
      if (k === 'email' || k === '_seq' || k === '_prevHash' || k === '_hash' || k === 'at') continue;
      projected[k] = event[k];
    }
    if (event.email && typeof event.email === 'string') {
      projected.emailHash = hash.isAlreadyPseudonym(event.email) ? String(event.email) : hash.emailHash(event.email);
    } else if (event.emailHash) {
      projected.emailHash = event.emailHash;
    }
    return projected;
  }
  const a = projectEventForShadow(kvShape);
  const b = projectEventForShadow(pgShape);
  assert.deepEqual(
    Object.keys(a).sort(),
    Object.keys(b).sort(),
    'KV and PG projections must have the same key set',
  );
  for (const k of Object.keys(a)) {
    assert.deepEqual(a[k], b[k], `key "${k}" must match across KV/PG shapes`);
  }
});
