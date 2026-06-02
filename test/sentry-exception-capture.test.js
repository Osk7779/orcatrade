'use strict';

// Phase 0 task P0.7 of docs/execution-plan.md.
//
// Verifies that the Sentry drain (lib/sentry.js) actually captures errors
// — not just plain messages — with stack frames preserved into the
// exception event format. Also verifies the dispatcher installs
// process-level handlers (uncaughtException / unhandledRejection) so
// errors that escape the dispatcher's try/catch still leave a trace.
//
// Why this is the load-bearing test for P0.7:
//   - The audit said "Sentry initialised but uncalled."
//   - Reality: log.warn + log.error already forward to Sentry via
//     captureMessage — that wiring lives in lib/log.js forwardToSentry.
//   - But: captureMessage flattens an Error into a text payload, losing
//     the stack. For a "handler threw" log line, the stack is the most
//     useful debug data.
//   - P0.7 adds captureException + routes Error-bearing log.error
//     through it. This test pins both pieces.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sentry = require('../lib/sentry');

const ROOT = path.resolve(__dirname, '..');

// ── parseStackFrames ────────────────────────────────────────────────────

test('parseStackFrames returns [] when err has no .stack', () => {
  assert.deepEqual(sentry.parseStackFrames(null), []);
  assert.deepEqual(sentry.parseStackFrames({}), []);
  assert.deepEqual(sentry.parseStackFrames({ stack: null }), []);
});

test('parseStackFrames converts V8 stack to Sentry frames (oldest first)', () => {
  // Synthetic V8-style stack covering both parenthesised + bare shapes
  const err = {
    stack: [
      'Error: boom',
      '    at foo (/repo/lib/foo.js:42:10)',
      '    at bar (/repo/lib/bar.js:15:5)',
      '    at /repo/lib/baz.js:8:1',
      '    at runMicrotasks (<anonymous>)',
    ].join('\n'),
  };
  const frames = sentry.parseStackFrames(err);
  // Oldest-first order means runMicrotasks (last in V8) is first in output.
  // The <anonymous> frame can't be location-parsed; it shows up as a
  // file-only frame.
  assert.equal(frames[0].function, 'runMicrotasks');
  // The baz frame is bare-shape "    at path:line:col".
  // After reverse, it should be third-from-last:
  const bazFrame = frames.find((f) => f.filename === '/repo/lib/baz.js');
  assert.ok(bazFrame, 'baz frame should be present');
  assert.equal(bazFrame.function, '<anonymous>');
  assert.equal(bazFrame.lineno, 8);
  assert.equal(bazFrame.colno, 1);
  assert.equal(bazFrame.in_app, true);
  // The foo frame is parenthesised-shape.
  const fooFrame = frames.find((f) => f.function === 'foo');
  assert.ok(fooFrame);
  assert.equal(fooFrame.filename, '/repo/lib/foo.js');
  assert.equal(fooFrame.lineno, 42);
  assert.equal(fooFrame.colno, 10);
});

test('parseStackFrames marks node_modules frames as in_app=false', () => {
  const err = {
    stack: 'Error: x\n    at qux (/repo/node_modules/foo/bar.js:1:1)\n    at quux (/repo/lib/own.js:2:2)',
  };
  const frames = sentry.parseStackFrames(err);
  const nm = frames.find((f) => f.filename.includes('/node_modules/'));
  const own = frames.find((f) => f.filename === '/repo/lib/own.js');
  assert.equal(nm.in_app, false);
  assert.equal(own.in_app, true);
});

// ── buildExceptionEvent ─────────────────────────────────────────────────

test('buildExceptionEvent emits Sentry "exception" shape with stack', () => {
  const err = new Error('boom');
  const ev = sentry.buildExceptionEvent({ err, extras: { handler: 'agent', requestId: 'r1', extraNote: 'noise' } });
  assert.equal(ev.payload.platform, 'node');
  assert.equal(ev.payload.level, 'error');
  assert.ok(ev.payload.exception);
  assert.equal(ev.payload.exception.values.length, 1);
  assert.equal(ev.payload.exception.values[0].type, 'Error');
  assert.equal(ev.payload.exception.values[0].value, 'boom');
  assert.ok(Array.isArray(ev.payload.exception.values[0].stacktrace.frames));
  assert.ok(ev.payload.exception.values[0].stacktrace.frames.length > 0, 'stack frames should be populated');
  // handler + requestId go to tags (per TAG_FIELDS); extraNote stays in extra.
  assert.equal(ev.payload.tags.handler, 'agent');
  assert.equal(ev.payload.tags.requestId, 'r1');
  assert.equal(ev.payload.extra.extraNote, 'noise');
});

test('buildExceptionEvent handles a thrown non-Error', () => {
  // Sometimes code throws a string or an object.
  const ev = sentry.buildExceptionEvent({ err: 'string-only', extras: {} });
  assert.equal(ev.payload.exception.values[0].type, 'Error');
  assert.equal(ev.payload.exception.values[0].value, 'string-only');
  assert.deepEqual(ev.payload.exception.values[0].stacktrace.frames, []);
});

test('captureException returns no-dsn when SENTRY_DSN is not set', async () => {
  // Don't depend on env state outside the test — explicitly clear.
  const prev = process.env.SENTRY_DSN;
  delete process.env.SENTRY_DSN;
  try {
    const result = await sentry.captureException(new Error('test'), {});
    assert.deepEqual(result, { sent: false, reason: 'no-dsn' });
  } finally {
    if (prev !== undefined) process.env.SENTRY_DSN = prev;
  }
});

// ── log.js → captureException routing ───────────────────────────────────

test('lib/log.js forwardToSentry routes Error-bearing log.error through captureException', () => {
  // Read the source + assert the route exists. (Avoids a hairy
  // module-mocking harness; this is the canonical pin for the route.)
  const src = fs.readFileSync(path.join(ROOT, 'lib/log.js'), 'utf8');
  assert.match(src, /errCandidate instanceof Error/,
    'lib/log.js must branch on whether the err extra is an Error');
  assert.match(src, /sentry\.captureException\(errCandidate/,
    'lib/log.js must call sentry.captureException with the Error');
  assert.match(src, /sentry\.captureMessage\(\{/,
    'lib/log.js must retain the captureMessage path for non-Error log lines');
});

// ── installProcessHandlers ──────────────────────────────────────────────

test('installProcessHandlers is idempotent', () => {
  sentry._resetProcessHandlersForTesting();
  try {
    const first = sentry.installProcessHandlers();
    const second = sentry.installProcessHandlers();
    assert.equal(first, true, 'first call installs');
    assert.equal(second, false, 'second call is a no-op');
  } finally {
    sentry._resetProcessHandlersForTesting();
    process.removeAllListeners('uncaughtException');
    process.removeAllListeners('unhandledRejection');
  }
});

test('installProcessHandlers wires both process listeners', () => {
  sentry._resetProcessHandlersForTesting();
  // Capture listener counts before + after.
  const beforeUncaught = process.listenerCount('uncaughtException');
  const beforeUnhandled = process.listenerCount('unhandledRejection');
  try {
    sentry.installProcessHandlers();
    assert.equal(
      process.listenerCount('uncaughtException'), beforeUncaught + 1,
      'uncaughtException listener added',
    );
    assert.equal(
      process.listenerCount('unhandledRejection'), beforeUnhandled + 1,
      'unhandledRejection listener added',
    );
  } finally {
    sentry._resetProcessHandlersForTesting();
    process.removeAllListeners('uncaughtException');
    process.removeAllListeners('unhandledRejection');
  }
});

// ── dispatcher wiring pin ───────────────────────────────────────────────

test('api/[...path].js calls sentry.installProcessHandlers at module load', () => {
  const src = fs.readFileSync(path.join(ROOT, 'api/[...path].js'), 'utf8');
  assert.match(
    src,
    /require\(['"]\.\.\/lib\/sentry['"]\)\.installProcessHandlers\(\)/,
    'dispatcher must install process handlers at module load',
  );
});
