// lib/circuit.js export-shape contract.
//
// circuit.test.js already covers the state-transition behaviour. What
// it doesn't pin is the EXPORT SURFACE — the set of functions, internals,
// and constants that handlers depend on. An "API cleanup" refactor could
// rename `run` to `wrap` or drop `_effectiveState` (used by tests) and
// the behavioural suite would still pass while consumers silently break
// at deploy time.
//
// Current consumers (lib/welcome.js, lib/handlers/start.js, .../health.js,
// .../auth.js) call circuit.run() and circuit.state(). The DEFAULT_*
// constants are referenced indirectly via the test suite. Pin the
// public + internal surface so a future rename forces a deliberate
// edit here in the same commit.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const circuit = require('../lib/circuit');

// The required export shape. Adding to this set is fine (additive
// change to the public surface); removing requires a deliberate
// edit + an updated assertion.
const REQUIRED_EXPORTS = Object.freeze({
  // Public API consumed by handlers.
  run: 'function',
  state: 'function',
  reset: 'function',
  // Internals exposed for the existing circuit.test.js suite. The
  // leading underscore is the convention for "not part of the public
  // contract, but referenced by tests".
  _readState: 'function',
  _writeState: 'function',
  _effectiveState: 'function',
  // Tunable constants. Handlers may read these to align timeouts.
  DEFAULT_THRESHOLD: 'number',
  DEFAULT_COOLDOWN_MS: 'number',
  STATE_TTL_SECONDS: 'number',
});

test('lib/circuit exports every required member with the right type', () => {
  const missing = [];
  const wrongType = [];
  for (const [name, expectedType] of Object.entries(REQUIRED_EXPORTS)) {
    if (!(name in circuit)) {
      missing.push(name);
      continue;
    }
    if (typeof circuit[name] !== expectedType) {
      wrongType.push(`${name}: expected ${expectedType}, got ${typeof circuit[name]}`);
    }
  }
  assert.deepEqual(missing, [],
    `lib/circuit is missing required exports:\n  ${missing.join('\n  ')}\n\n` +
    'These are consumed by lib/welcome.js / lib/handlers/start.js / .../health.js / .../auth.js ' +
    '(public API) and by test/circuit.test.js (internals). Renaming or removing one would ' +
    'break those consumers at deploy time.');
  assert.deepEqual(wrongType, [],
    `lib/circuit has exports with the wrong type:\n  ${wrongType.join('\n  ')}`);
});

test('DEFAULT_THRESHOLD is a positive integer ≥ 2 (sensible breaker math)', () => {
  // A threshold of 1 would trip on a single transient failure — too
  // aggressive. Zero or negative is nonsense. Pin a floor so a future
  // tuning edit can't accidentally make the breaker hyperactive.
  assert.ok(Number.isInteger(circuit.DEFAULT_THRESHOLD));
  assert.ok(circuit.DEFAULT_THRESHOLD >= 2,
    `DEFAULT_THRESHOLD ${circuit.DEFAULT_THRESHOLD} too aggressive (need ≥2 to ignore transient flaps)`);
  assert.ok(circuit.DEFAULT_THRESHOLD <= 20,
    `DEFAULT_THRESHOLD ${circuit.DEFAULT_THRESHOLD} too lenient (>20 = breaker never trips in practice)`);
});

test('DEFAULT_COOLDOWN_MS is in a sensible band [5s, 5min]', () => {
  // Too short: hammers a flaky upstream into a worse outage.
  // Too long: a recovered upstream stays "open" forever; users see
  // fallback responses long after the real service is healthy.
  assert.ok(Number.isInteger(circuit.DEFAULT_COOLDOWN_MS));
  assert.ok(circuit.DEFAULT_COOLDOWN_MS >= 5_000,
    `DEFAULT_COOLDOWN_MS ${circuit.DEFAULT_COOLDOWN_MS} < 5s (would hammer flaky upstream)`);
  assert.ok(circuit.DEFAULT_COOLDOWN_MS <= 5 * 60_000,
    `DEFAULT_COOLDOWN_MS ${circuit.DEFAULT_COOLDOWN_MS} > 5min (recovered upstream stays open too long)`);
});

test('STATE_TTL_SECONDS > DEFAULT_COOLDOWN_MS (state survives a full cooldown)', () => {
  // If the KV state TTL is shorter than the cooldown, the open state
  // could expire while the breaker is mid-cooldown and reset silently.
  // Defensive ordering invariant.
  assert.ok(circuit.STATE_TTL_SECONDS * 1000 > circuit.DEFAULT_COOLDOWN_MS,
    `STATE_TTL_SECONDS (${circuit.STATE_TTL_SECONDS}s) must exceed DEFAULT_COOLDOWN_MS (${circuit.DEFAULT_COOLDOWN_MS}ms)`);
});

test('lib/circuit does not export anything unexpected (drift tripwire)', () => {
  // Loose tripwire — if the surface ever grows by 5+ unexpected
  // members, flag it. We don't ban additions outright (that's too
  // strict for a working module), but a sudden bloat would indicate
  // either an internal-detail leak or an unplanned API surface
  // expansion that should be reviewed.
  const expected = new Set(Object.keys(REQUIRED_EXPORTS));
  const extra = Object.keys(circuit).filter(k => !expected.has(k));
  assert.ok(extra.length <= 4,
    `Unexpected new exports from lib/circuit: ${extra.join(', ')}\n` +
    'If intentional, add them to REQUIRED_EXPORTS in this test with the appropriate type.');
});
