'use strict';

// Apex A2 step 1 — read-shadow tests.
//
// shadowCompare's contract is observability-only: never throw, never
// mutate the caller's value, and emit exactly one of three structured
// log lines per call: match, divergence, unavailable. These tests
// exercise each path against an in-process log capture so the
// contract is pinned without needing a live PG.
//
// Coverage:
//   - off-by-default (no ORCATRADE_SHADOW_PG env) → zero log lines
//   - enabled + matching projections             → exactly one
//                                                   db_shadow_match
//   - enabled + diverging projections            → exactly one
//                                                   db_shadow_divergence
//                                                   with divergedKeys + both projections
//   - enabled + pgFetcher returns null while KV has a value
//                                                → db_shadow_unavailable
//   - enabled + pgFetcher throws                 → db_shadow_unavailable
//   - enabled + projector throws                 → db_shadow_unavailable
//   - both projections null                       → db_shadow_match
//   - never throws on any of the above paths

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

// In-process log capture: stash + replace console.* before each test,
// then read what was written. We do NOT mock require('./log') because
// the module's emit() writes to stdout/stderr — capturing console is
// sufficient and avoids fragile module-cache surgery.

function makeCapture() {
  const lines = [];
  const orig = { log: console.log, warn: console.warn, error: console.error, info: console.info };
  console.log = console.warn = console.error = console.info = (...args) => {
    lines.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
  };
  return {
    lines,
    restore() { Object.assign(console, orig); },
  };
}

function eventsFrom(lines) {
  // log.js emits structured JSON; surface the `event` field from each
  // captured line that parses as JSON.
  const events = [];
  for (const line of lines) {
    // Each line is a string; emit() prints `${level} ${JSON.stringify(payload)}`.
    // Extract the JSON portion via the first '{' onward.
    const start = line.indexOf('{');
    if (start < 0) continue;
    try {
      const obj = JSON.parse(line.slice(start));
      if (obj && obj.event) events.push(obj);
    } catch (_) { /* skip */ }
  }
  return events;
}

// Stable handle to the module under test (loaded once, ORCATRADE_SHADOW_PG
// is read on every shadowCompare call so we can flip it per-test).
const shadow = require(path.join(ROOT, 'lib', 'db', 'read-shadow'));

// ── canonical / jsonEq helpers (the load-bearing comparison primitives) ──

test('_canonical sorts object keys at every depth', () => {
  const a = shadow._canonical({ b: 1, a: { y: 2, x: 1 } });
  // Stringify into ordered JSON to assert the key order is deterministic.
  assert.equal(JSON.stringify(a), '{"a":{"x":1,"y":2},"b":1}');
});

test('_canonical normalises Date → ISO string', () => {
  const iso = '2026-06-01T12:00:00.000Z';
  assert.equal(shadow._canonical(new Date(iso)), iso);
});

test('_jsonEq treats Date and ISO string as equal', () => {
  assert.ok(shadow._jsonEq({ at: new Date('2026-06-01T00:00:00Z') }, { at: '2026-06-01T00:00:00.000Z' }));
});

test('_jsonEq is field-order-insensitive', () => {
  assert.ok(shadow._jsonEq({ a: 1, b: 2 }, { b: 2, a: 1 }));
});

test('_divergedKeys lists only the keys whose values differ', () => {
  const keys = shadow._divergedKeys(
    { id: 1, label: 'x', snapshot: { a: 1 } },
    { id: 1, label: 'y', snapshot: { a: 1 } },
  );
  assert.deepEqual(keys, ['label']);
});

// ── isEnabled gating ──────────────────────────────────────────────────

test('isEnabled() reads ORCATRADE_SHADOW_PG fresh each call', () => {
  const prev = process.env.ORCATRADE_SHADOW_PG;
  delete process.env.ORCATRADE_SHADOW_PG;
  assert.equal(shadow.isEnabled(), false);
  process.env.ORCATRADE_SHADOW_PG = '1';
  assert.equal(shadow.isEnabled(), true);
  if (prev === undefined) delete process.env.ORCATRADE_SHADOW_PG;
  else process.env.ORCATRADE_SHADOW_PG = prev;
});

test('shadowCompare is a no-op when ORCATRADE_SHADOW_PG is unset', async () => {
  const prev = process.env.ORCATRADE_SHADOW_PG;
  delete process.env.ORCATRADE_SHADOW_PG;
  const cap = makeCapture();
  try {
    let pgFetcherCalled = false;
    await shadow.shadowCompare({
      name: 'test.off',
      kvValue: { id: 1 },
      pgFetcher: async () => { pgFetcherCalled = true; return { id: 1 }; },
    });
    assert.equal(pgFetcherCalled, false, 'pgFetcher must not run when feature is off');
    assert.equal(eventsFrom(cap.lines).length, 0, 'no log lines emitted when off');
  } finally {
    cap.restore();
    if (prev === undefined) delete process.env.ORCATRADE_SHADOW_PG;
    else process.env.ORCATRADE_SHADOW_PG = prev;
  }
});

// ── the three documented outcomes ─────────────────────────────────────

async function withShadowOn(fn) {
  const prev = process.env.ORCATRADE_SHADOW_PG;
  process.env.ORCATRADE_SHADOW_PG = '1';
  const cap = makeCapture();
  try {
    return await fn(cap);
  } finally {
    cap.restore();
    if (prev === undefined) delete process.env.ORCATRADE_SHADOW_PG;
    else process.env.ORCATRADE_SHADOW_PG = prev;
  }
}

test('shadowCompare → match when projections agree', () => withShadowOn(async (cap) => {
  await shadow.shadowCompare({
    name: 'test.match',
    kvValue: { id: 'p1', label: 'x', noise: 'kv-only' },
    pgFetcher: async () => ({ id: 'p1', label: 'x' }),
    projector: (v) => v && ({ id: v.id, label: v.label }),
  });
  const events = eventsFrom(cap.lines);
  const match = events.filter((e) => e.event === 'db_shadow_match');
  assert.equal(match.length, 1, 'exactly one db_shadow_match');
  assert.equal(match[0].name, 'test.match');
}));

test('shadowCompare → divergence with divergedKeys + both projections', () => withShadowOn(async (cap) => {
  await shadow.shadowCompare({
    name: 'test.diverge',
    kvValue: { id: 'p1', label: 'NEW', snapshot: { a: 1 } },
    pgFetcher: async () => ({ id: 'p1', label: 'OLD', snapshot: { a: 1 } }),
    projector: (v) => v && ({ id: v.id, label: v.label, snapshot: v.snapshot }),
  });
  const events = eventsFrom(cap.lines);
  const diverge = events.filter((e) => e.event === 'db_shadow_divergence');
  assert.equal(diverge.length, 1, 'exactly one db_shadow_divergence');
  assert.equal(diverge[0].name, 'test.diverge');
  assert.deepEqual(diverge[0].divergedKeys, ['label']);
  assert.equal(diverge[0].kvProjection.label, 'NEW');
  assert.equal(diverge[0].pgProjection.label, 'OLD');
}));

test('shadowCompare → unavailable when pgFetcher returns null and kv has a value', () => withShadowOn(async (cap) => {
  await shadow.shadowCompare({
    name: 'test.pg-null',
    kvValue: { id: 'p1' },
    pgFetcher: async () => null,
  });
  const events = eventsFrom(cap.lines);
  const unavail = events.filter((e) => e.event === 'db_shadow_unavailable');
  assert.equal(unavail.length, 1);
  assert.equal(unavail[0].name, 'test.pg-null');
}));

test('shadowCompare → match when BOTH kv and pg project to null (e.g. record not found)', () => withShadowOn(async (cap) => {
  await shadow.shadowCompare({
    name: 'test.both-null',
    kvValue: null,
    pgFetcher: async () => null,
  });
  const events = eventsFrom(cap.lines);
  assert.equal(events.filter((e) => e.event === 'db_shadow_match').length, 1);
  assert.equal(events.filter((e) => e.event === 'db_shadow_divergence').length, 0);
}));

test('shadowCompare → unavailable when pgFetcher throws', () => withShadowOn(async (cap) => {
  await shadow.shadowCompare({
    name: 'test.pg-throws',
    kvValue: { id: 'p1' },
    pgFetcher: async () => { throw new Error('pool exhausted'); },
  });
  const events = eventsFrom(cap.lines);
  const unavail = events.filter((e) => e.event === 'db_shadow_unavailable');
  assert.equal(unavail.length, 1);
  assert.match(unavail[0].err || '', /pool exhausted/);
}));

test('shadowCompare → unavailable when projector throws', () => withShadowOn(async (cap) => {
  await shadow.shadowCompare({
    name: 'test.projector-throws',
    kvValue: { id: 'p1' },
    pgFetcher: async () => ({ id: 'p1' }),
    projector: () => { throw new Error('bad projector'); },
  });
  const events = eventsFrom(cap.lines);
  const unavail = events.filter((e) => e.event === 'db_shadow_unavailable');
  assert.equal(unavail.length, 1);
  assert.match(unavail[0].err || '', /bad projector/);
}));

// ── non-throwing contract ────────────────────────────────────────────

test('shadowCompare never throws regardless of input', async () => {
  // Run with feature on but exercise every error path; no rejection.
  await withShadowOn(async () => {
    await shadow.shadowCompare({
      name: 'test.never-throw',
      kvValue: { x: 1 },
      pgFetcher: async () => { throw new Error('x'); },
    });
    await shadow.shadowCompare({
      name: 'test.never-throw',
      kvValue: undefined,
      pgFetcher: async () => { throw new Error('x'); },
    });
  });
  // Run with degenerate inputs; should also not throw.
  await shadow.shadowCompare({});
  await shadow.shadowCompare({ name: '', pgFetcher: () => null });
  await shadow.shadowCompare({ name: 'x' });           // missing pgFetcher
  await shadow.shadowCompare({ name: 'x', pgFetcher: 'not-a-function' });
});
