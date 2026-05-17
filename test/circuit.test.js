// Tests for lib/circuit.js — Sprint BG-4.4 circuit breaker.
//
// Strategy: reset the KV memory store between tests, then walk through
// each state transition (closed → counting failures → open → half-open → closed)
// asserting persistence + fallback invocation + correct return values.

const test = require('node:test');
const assert = require('node:assert/strict');

const kv = require('../lib/intelligence/kv-store');
const circuit = require('../lib/circuit');

// ── Pure state transition (no KV) ────────────────────────────────

test('_effectiveState: closed stays closed', () => {
  assert.equal(circuit._effectiveState({ state: 'closed', failures: 0, openedAt: null }, 0, 30000), 'closed');
});

test('_effectiveState: open within cooldown stays open', () => {
  const openedAt = 10_000;
  const now = openedAt + 5_000; // 5s in, cooldown is 30s
  assert.equal(circuit._effectiveState({ state: 'open', failures: 5, openedAt }, now, 30_000), 'open');
});

test('_effectiveState: open beyond cooldown promotes to half-open', () => {
  const openedAt = 10_000;
  const now = openedAt + 30_001; // 30s + 1ms in
  assert.equal(circuit._effectiveState({ state: 'open', failures: 5, openedAt }, now, 30_000), 'half-open');
});

test('_effectiveState: open with no openedAt timestamp stays open (defensive)', () => {
  assert.equal(circuit._effectiveState({ state: 'open', failures: 5, openedAt: null }, 100_000, 30_000), 'open');
});

// ── End-to-end behaviour ─────────────────────────────────────────

test('run: closed circuit forwards fn result on success', async () => {
  kv._resetMemoryStore();
  const result = await circuit.run('test_ok', async () => 'live-data', {
    fallback: () => 'fallback-data',
  });
  assert.equal(result, 'live-data');
  const s = await circuit._readState('test_ok');
  assert.equal(s.state, 'closed');
  assert.equal(s.failures, 0);
});

test('run: on failure, increments counter but stays closed until threshold', async () => {
  kv._resetMemoryStore();
  // Threshold of 3 means 2 failures should leave state closed, the 3rd should open.
  for (let i = 0; i < 2; i++) {
    const result = await circuit.run('test_threshold', async () => { throw new Error('upstream timeout'); }, {
      fallback: () => 'fb',
      threshold: 3,
    });
    assert.equal(result, 'fb');
  }
  const s = await circuit._readState('test_threshold');
  assert.equal(s.state, 'closed');
  assert.equal(s.failures, 2);
});

test('run: opens after exactly `threshold` failures', async () => {
  kv._resetMemoryStore();
  for (let i = 0; i < 3; i++) {
    await circuit.run('test_open', async () => { throw new Error('boom'); }, {
      fallback: () => 'fb',
      threshold: 3,
    });
  }
  const s = await circuit._readState('test_open');
  assert.equal(s.state, 'open');
  assert.equal(s.failures, 3);
  assert.ok(Number.isFinite(s.openedAt));
});

test('run: when open, short-circuits without calling fn', async () => {
  kv._resetMemoryStore();
  await circuit._writeState('test_shortcircuit', { state: 'open', failures: 5, openedAt: Date.now() });
  let fnCalled = false;
  let fbArgs = null;
  const result = await circuit.run('test_shortcircuit', async () => { fnCalled = true; return 'live'; }, {
    fallback: (args) => { fbArgs = args; return 'fb'; },
  });
  assert.equal(fnCalled, false, 'fn must not be invoked when circuit is open');
  assert.equal(result, 'fb');
  assert.equal(fbArgs.shortCircuited, true);
  assert.equal(fbArgs.state, 'open');
});

test('run: half-open lets one probe through; success closes the circuit', async () => {
  kv._resetMemoryStore();
  // Recorded as open, but openedAt is older than cooldown — effective state is half-open.
  await circuit._writeState('test_recover', { state: 'open', failures: 5, openedAt: Date.now() - 60_000 });
  let fnCalled = false;
  const result = await circuit.run('test_recover', async () => { fnCalled = true; return 'live'; }, {
    fallback: () => 'fb',
    cooldownMs: 30_000,
  });
  assert.equal(fnCalled, true, 'half-open should let the probe through');
  assert.equal(result, 'live');
  const s = await circuit._readState('test_recover');
  assert.equal(s.state, 'closed');
  assert.equal(s.failures, 0);
});

test('run: half-open + probe fails → goes straight back to open (no slow re-counting)', async () => {
  kv._resetMemoryStore();
  await circuit._writeState('test_reopen', { state: 'open', failures: 5, openedAt: Date.now() - 60_000 });
  const result = await circuit.run('test_reopen', async () => { throw new Error('still broken'); }, {
    fallback: () => 'fb',
    cooldownMs: 30_000,
    threshold: 5,
  });
  assert.equal(result, 'fb');
  const s = await circuit._readState('test_reopen');
  assert.equal(s.state, 'open');
  // failures was 5 + 1 for the probe attempt
  assert.equal(s.failures, 6);
});

test('run: requires a fallback function', async () => {
  kv._resetMemoryStore();
  await assert.rejects(
    circuit.run('test_no_fb', async () => 'ok', {}),
    /fallback function required/
  );
});

test('state(): public API returns the effective state', async () => {
  kv._resetMemoryStore();
  assert.equal(await circuit.state('test_pub'), 'closed');
  await circuit._writeState('test_pub', { state: 'open', failures: 3, openedAt: Date.now() });
  assert.equal(await circuit.state('test_pub'), 'open');
  await circuit._writeState('test_pub', { state: 'open', failures: 3, openedAt: Date.now() - 60_000 });
  assert.equal(await circuit.state('test_pub', { cooldownMs: 30_000 }), 'half-open');
});

test('reset(): force-closes a circuit', async () => {
  kv._resetMemoryStore();
  await circuit._writeState('test_reset', { state: 'open', failures: 99, openedAt: Date.now() });
  await circuit.reset('test_reset');
  const s = await circuit._readState('test_reset');
  assert.equal(s.state, 'closed');
  assert.equal(s.failures, 0);
});

test('fallback receives shortCircuited:false + err on a real failure', async () => {
  kv._resetMemoryStore();
  let fbArgs = null;
  await circuit.run('test_fb_args', async () => { throw new Error('upstream-5xx'); }, {
    fallback: (args) => { fbArgs = args; return null; },
    threshold: 10,
  });
  assert.equal(fbArgs.shortCircuited, false);
  assert.equal(fbArgs.err.message, 'upstream-5xx');
});

test('successful call after some failures clears the failure count', async () => {
  kv._resetMemoryStore();
  // Two failures, threshold 5 → state stays closed but failures=2.
  for (let i = 0; i < 2; i++) {
    await circuit.run('test_clear', async () => { throw new Error('blip'); }, {
      fallback: () => 'fb', threshold: 5,
    });
  }
  let s = await circuit._readState('test_clear');
  assert.equal(s.failures, 2);
  // Now a success.
  await circuit.run('test_clear', async () => 'live', { fallback: () => 'fb' });
  s = await circuit._readState('test_clear');
  assert.equal(s.failures, 0);
  assert.equal(s.state, 'closed');
});
