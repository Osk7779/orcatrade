'use strict';

// Pins the 2026-06-08 flip of read-shadow's default posture: production
// defaults to ENABLED (always-on dual-write divergence detection), non-
// production defaults to DISABLED (preserves test-suite hermeticity).
// Explicit ORCATRADE_SHADOW_PG env values override in either direction.
//
// The audit gap: read-shadow was opt-in-only, so dual-write divergence
// could go undetected in production for days. See docs/strategic-plan-
// 2026-2031.md §2 (enterprise blockers list, item 4).
//
// This test file is intentionally isolated from test/db-read-shadow.test.js
// (which pins the comparison contract) — these tests mutate NODE_ENV and we
// want the env-mutation surface confined here so an accidental NODE_ENV leak
// can't poison the older suite.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const shadow = require(path.join(ROOT, 'lib', 'db', 'read-shadow'));

function withEnv({ NODE_ENV, ORCATRADE_SHADOW_PG }, fn) {
  const prevNode = process.env.NODE_ENV;
  const prevFlag = process.env.ORCATRADE_SHADOW_PG;
  if (NODE_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = NODE_ENV;
  if (ORCATRADE_SHADOW_PG === undefined) delete process.env.ORCATRADE_SHADOW_PG;
  else process.env.ORCATRADE_SHADOW_PG = ORCATRADE_SHADOW_PG;
  try { return fn(); }
  finally {
    if (prevNode === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNode;
    if (prevFlag === undefined) delete process.env.ORCATRADE_SHADOW_PG;
    else process.env.ORCATRADE_SHADOW_PG = prevFlag;
  }
}

// ── Default posture: NODE_ENV decides when the env flag is unset ──────

test('isEnabled() → TRUE in production when flag is unset (audit-gap fix)', () => {
  withEnv({ NODE_ENV: 'production', ORCATRADE_SHADOW_PG: undefined }, () => {
    assert.equal(shadow.isEnabled(), true, 'production must default to enabled');
  });
});

test('isEnabled() → FALSE in test when flag is unset (preserves hermeticity)', () => {
  withEnv({ NODE_ENV: 'test', ORCATRADE_SHADOW_PG: undefined }, () => {
    assert.equal(shadow.isEnabled(), false, 'test env must default to disabled');
  });
});

test('isEnabled() → FALSE in development when flag is unset', () => {
  withEnv({ NODE_ENV: 'development', ORCATRADE_SHADOW_PG: undefined }, () => {
    assert.equal(shadow.isEnabled(), false, 'development must default to disabled');
  });
});

test('isEnabled() → FALSE when NODE_ENV is unset and flag is unset', () => {
  withEnv({ NODE_ENV: undefined, ORCATRADE_SHADOW_PG: undefined }, () => {
    assert.equal(shadow.isEnabled(), false, 'unknown NODE_ENV must default to disabled (safe choice)');
  });
});

// ── Explicit env override: production force-off ───────────────────────

for (const off of ['0', 'false', 'off', 'no']) {
  test(`isEnabled() → FALSE when ORCATRADE_SHADOW_PG=${JSON.stringify(off)} (force-off override wins, even in production)`, () => {
    withEnv({ NODE_ENV: 'production', ORCATRADE_SHADOW_PG: off }, () => {
      assert.equal(shadow.isEnabled(), false, `${off} must force-disable in production`);
    });
  });
}

// ── Explicit env override: test/dev force-on ──────────────────────────

for (const on of ['1', 'true', 'yes']) {
  test(`isEnabled() → TRUE when ORCATRADE_SHADOW_PG=${JSON.stringify(on)} (force-on override wins, even in non-production)`, () => {
    withEnv({ NODE_ENV: 'test', ORCATRADE_SHADOW_PG: on }, () => {
      assert.equal(shadow.isEnabled(), true, `${on} must force-enable in test`);
    });
  });
}

// ── Empty-string flag treated as unset (defensive) ────────────────────

test('isEnabled() → defaults apply when ORCATRADE_SHADOW_PG is empty string', () => {
  withEnv({ NODE_ENV: 'production', ORCATRADE_SHADOW_PG: '' }, () => {
    assert.equal(shadow.isEnabled(), true, 'empty-string flag must fall through to default (production → on)');
  });
  withEnv({ NODE_ENV: 'test', ORCATRADE_SHADOW_PG: '' }, () => {
    assert.equal(shadow.isEnabled(), false, 'empty-string flag must fall through to default (test → off)');
  });
});

// ── Regression: legacy expectation that bare-truthy enables stays true ─

test('isEnabled() → still TRUE for legacy truthy values (no regression on existing callers)', () => {
  // The flip is opt-out-by-default in production; legacy environments
  // that explicitly set ORCATRADE_SHADOW_PG=1 in non-production must
  // continue to see shadowing enabled.
  withEnv({ NODE_ENV: 'development', ORCATRADE_SHADOW_PG: '1' }, () => {
    assert.equal(shadow.isEnabled(), true, 'legacy ORCATRADE_SHADOW_PG=1 must still enable');
  });
});
