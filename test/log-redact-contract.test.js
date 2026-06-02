// lib/log.js redact() contract pins.
//
// redact() is the last line of defence between
//   log.info('signed in', { email: user.email, token: magicLink })
// and what shows up in Vercel's log stream. A silent regression here
// means every log line leaks PII for as long as it takes someone to
// notice. This file pins:
//   1. The required PII key set (no shrinking without a deliberate edit).
//   2. The masking convention (first-2-chars + "***" — short tokens fully
//      redacted, non-strings replaced wholesale).
//   3. Recursion + array handling (nested objects redacted at every level).
//   4. Error handling (Error objects normalised to name/message/stack —
//      important because a thrown error might wrap a token in a message).
//   5. Depth-limit defense (no infinite-recursion crash on cyclic input).
//   6. Case-insensitive key matching.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const log = require('../lib/log');

// ── PII key set ───────────────────────────────────────────────

test('redact: masks email at the top level', () => {
  const r = log.redact({ email: 'alice@example.com' });
  assert.equal(r.email, 'al***', 'two-char prefix + *** convention');
});

test('redact: masks every documented PII key family', () => {
  // Each key MUST be redacted. Adding one to the set is fine; removing
  // requires a deliberate edit + a justified failing assertion here.
  const piiKeys = [
    'email', 'emails',
    'token', 'tokens', 'apiToken', 'authToken', 'magic_token', 'magicToken',
    'password', 'passcode', 'pwd',
    'secret', 'apiKey', 'api_key',
    'cookie', 'cookies',
    'authorization', 'auth',
    'sessionId', 'session_id',
  ];
  for (const k of piiKeys) {
    const r = log.redact({ [k]: 'super-secret-value-12345' });
    assert.notEqual(r[k], 'super-secret-value-12345',
      `key "${k}" must be redacted, got: ${JSON.stringify(r[k])}`);
    assert.match(r[k], /\*\*\*/,
      `key "${k}" must be masked with *** (got ${JSON.stringify(r[k])})`);
  }
});

test('redact: key matching is case-insensitive', () => {
  // The dispatcher might pass headers as { Authorization: 'Bearer …' }
  // or the canonical lowercase form. Both must be masked.
  for (const k of ['Email', 'EMAIL', 'eMaIl', 'Authorization', 'AUTHORIZATION']) {
    const r = log.redact({ [k]: 'sensitive-content-here' });
    assert.match(r[k], /\*\*\*/, `${k} variant must be masked`);
  }
});

test('redact: short strings (<=3 chars) get fully redacted, not partial-masked', () => {
  // The 2-char prefix would leak too much of a short value. Pin the
  // boundary so a "simplify" refactor doesn't accidentally surface
  // a 3-char password.
  assert.equal(log.redact({ email: 'ab' }).email, '[redacted]');
  assert.equal(log.redact({ email: 'abc' }).email, '[redacted]');
  assert.equal(log.redact({ email: 'abcd' }).email, 'ab***');
});

test('redact: non-string values for PII keys become [redacted] wholesale', () => {
  // A buffer or number under a PII key still must not pass through —
  // a Buffer toString could be a binary secret.
  assert.equal(log.redact({ token: 12345 }).token, '[redacted]');
  assert.equal(log.redact({ secret: { nested: 'val' } }).secret, '[redacted]');
  assert.equal(log.redact({ apiKey: Buffer.from('hi') }).apiKey, '[redacted]');
});

// ── Recursion + arrays ────────────────────────────────────────

test('redact: nested objects are walked recursively', () => {
  const r = log.redact({
    request: {
      headers: { authorization: 'Bearer abc123' },
      user: { email: 'bob@example.com' },
    },
  });
  assert.match(r.request.headers.authorization, /\*\*\*/);
  assert.equal(r.request.user.email, 'bo***');
});

test('redact: arrays of objects are walked element-by-element', () => {
  const r = log.redact({
    users: [
      { name: 'Alice', email: 'a@example.com' },
      { name: 'Bob', email: 'b@example.com' },
    ],
  });
  assert.equal(r.users[0].name, 'Alice', 'non-PII passes through');
  assert.equal(r.users[0].email, 'a@***');
  assert.equal(r.users[1].email, 'b@***');
});

test('redact: non-PII keys pass through unchanged', () => {
  const r = log.redact({
    requestId: 'req-abc-123',
    durationMs: 42,
    status: 200,
    path: '/api/customs',
  });
  assert.deepEqual(r, {
    requestId: 'req-abc-123',
    durationMs: 42,
    status: 200,
    path: '/api/customs',
  });
});

// ── Error handling ────────────────────────────────────────────

test('redact: Error objects are normalised to { name, message, stack }', () => {
  const err = new Error('boom');
  const r = log.redact({ err });
  assert.equal(r.err.name, 'Error');
  assert.equal(r.err.message, 'boom');
  assert.equal(typeof r.err.stack, 'string');
  assert.ok(r.err.stack.includes('boom'));
});

// ── Depth-limit defense ───────────────────────────────────────

test('redact: cyclic structures do not crash (depth limit kicks in)', () => {
  // A real bug log might capture an object with a circular reference.
  // The function MUST NOT throw or recurse infinitely.
  const a = { name: 'a' };
  const b = { name: 'b', parent: a };
  a.child = b;
  assert.doesNotThrow(() => log.redact(a),
    'cyclic structures must be tolerated (depth limit ≤ 6)');
});

// ── Edge cases ────────────────────────────────────────────────

test('redact: null and undefined pass through', () => {
  assert.equal(log.redact(null), null);
  assert.equal(log.redact(undefined), undefined);
});

test('redact: primitive at top level passes through', () => {
  assert.equal(log.redact('hello'), 'hello');
  assert.equal(log.redact(42), 42);
  assert.equal(log.redact(true), true);
});

test('redact: empty object returns empty object', () => {
  assert.deepEqual(log.redact({}), {});
});

// ── End-to-end via log.info ────────────────────────────────────

test('redact: log.info-emitted JSON line has masked PII (end-to-end)', () => {
  // Capture stdout to verify the masking is wired through emit().
  // log.info -> emit -> JSON.stringify -> console.log
  const originalLog = console.log;
  let captured = '';
  console.log = (line) => { captured = line; };
  try {
    log.info('user signed in', { email: 'charlie@example.com', requestId: 'r-1' });
  } finally {
    console.log = originalLog;
  }
  assert.ok(captured, 'a log line was emitted');
  const parsed = JSON.parse(captured);
  assert.equal(parsed.email, 'ch***', 'email must be masked in emitted line');
  assert.equal(parsed.requestId, 'r-1', 'non-PII passes through');
  assert.equal(parsed.msg, 'user signed in');
});
