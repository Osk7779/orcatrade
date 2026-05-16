// Tests for lib/log.js — structured logging helper (Track 4.1).
//
// We capture stdout/stderr via console.log/warn/error monkey-patching
// so we can inspect the JSON payload emitted on each call.

const test = require('node:test');
const assert = require('node:assert/strict');

// Force level to debug so all messages flow through (default is info).
process.env.ORCATRADE_LOG_LEVEL = 'debug';

const log = require('../lib/log');

// ── Capture helpers ──────────────────────────────────────────────

function captureConsole(fn) {
  const captured = { log: [], warn: [], error: [] };
  const origLog = console.log;
  const origWarn = console.warn;
  const origError = console.error;
  console.log = (line) => captured.log.push(line);
  console.warn = (line) => captured.warn.push(line);
  console.error = (line) => captured.error.push(line);
  try {
    fn();
  } finally {
    console.log = origLog;
    console.warn = origWarn;
    console.error = origError;
  }
  return captured;
}

// ── Basic shape ──────────────────────────────────────────────────

test('log.info emits one JSON line on console.log with ts/level/msg', () => {
  const c = captureConsole(() => log.info('hello'));
  assert.equal(c.log.length, 1);
  const parsed = JSON.parse(c.log[0]);
  assert.equal(parsed.level, 'info');
  assert.equal(parsed.msg, 'hello');
  assert.match(parsed.ts, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
});

test('log.warn routes to console.warn (preserves severity for aggregators)', () => {
  const c = captureConsole(() => log.warn('careful'));
  assert.equal(c.warn.length, 1);
  assert.equal(c.log.length, 0);
  assert.equal(JSON.parse(c.warn[0]).level, 'warn');
});

test('log.error routes to console.error', () => {
  const c = captureConsole(() => log.error('boom'));
  assert.equal(c.error.length, 1);
  assert.equal(c.log.length, 0);
  assert.equal(c.warn.length, 0);
});

test('extras are merged into the payload', () => {
  const c = captureConsole(() => log.info('founding accepted', { spot: 7, locale: 'pl' }));
  const parsed = JSON.parse(c.log[0]);
  assert.equal(parsed.spot, 7);
  assert.equal(parsed.locale, 'pl');
  assert.equal(parsed.msg, 'founding accepted');
});

// ── PII redaction ────────────────────────────────────────────────

test('email is redacted by default', () => {
  const c = captureConsole(() => log.info('msg', { email: 'oskar@orcatrade.pl' }));
  const parsed = JSON.parse(c.log[0]);
  assert.notEqual(parsed.email, 'oskar@orcatrade.pl');
  assert.match(parsed.email, /^os\*\*\*$/);
});

test('token / apiKey / secret / cookie / authorization are all redacted', () => {
  const c = captureConsole(() => log.info('msg', {
    token: 'magic-abc-123', apiKey: 'sk_live_xyz',
    secret: 'shhh', cookie: 'sess=12345', authorization: 'Bearer xyz',
  }));
  const parsed = JSON.parse(c.log[0]);
  assert.notEqual(parsed.token, 'magic-abc-123');
  assert.notEqual(parsed.apiKey, 'sk_live_xyz');
  assert.notEqual(parsed.secret, 'shhh');
  assert.notEqual(parsed.cookie, 'sess=12345');
  assert.notEqual(parsed.authorization, 'Bearer xyz');
});

test('PII field matching is case-insensitive', () => {
  const c = captureConsole(() => log.info('msg', { Email: 'X', TOKEN: 'Y', ApiKey: 'Z' }));
  const parsed = JSON.parse(c.log[0]);
  assert.notEqual(parsed.Email, 'X');
  assert.notEqual(parsed.TOKEN, 'Y');
  assert.notEqual(parsed.ApiKey, 'Z');
});

test('redaction walks nested objects', () => {
  const c = captureConsole(() => log.info('msg', { user: { id: 42, email: 'leak@x.com' } }));
  const parsed = JSON.parse(c.log[0]);
  assert.equal(parsed.user.id, 42);
  assert.notEqual(parsed.user.email, 'leak@x.com');
});

test('arrays of PII are redacted element-wise', () => {
  const c = captureConsole(() => log.info('msg', { events: [{ email: 'a@b.c' }, { email: 'd@e.f' }] }));
  const parsed = JSON.parse(c.log[0]);
  assert.notEqual(parsed.events[0].email, 'a@b.c');
  assert.notEqual(parsed.events[1].email, 'd@e.f');
});

test('Error instance gets serialised with name + message + stack', () => {
  const err = new Error('upstream timeout');
  const c = captureConsole(() => log.error('handler crashed', { err }));
  const parsed = JSON.parse(c.error[0]);
  assert.equal(parsed.err.name, 'Error');
  assert.equal(parsed.err.message, 'upstream timeout');
  assert.ok(parsed.err.stack && parsed.err.stack.includes('Error: upstream timeout'));
});

// ── Context binding ──────────────────────────────────────────────

test('withContext merges handler/action onto every line', () => {
  const handlerLog = log.withContext({ handler: 'auth', action: 'verify' });
  const c = captureConsole(() => handlerLog.info('magic link consumed', { userId: 'u_1' }));
  const parsed = JSON.parse(c.log[0]);
  assert.equal(parsed.handler, 'auth');
  assert.equal(parsed.action, 'verify');
  assert.equal(parsed.userId, 'u_1');
});

test('withContext can be chained', () => {
  const handlerLog = log.withContext({ handler: 'auth' });
  const requestLog = handlerLog.withContext({ requestId: 'abc123' });
  const c = captureConsole(() => requestLog.info('ok'));
  const parsed = JSON.parse(c.log[0]);
  assert.equal(parsed.handler, 'auth');
  assert.equal(parsed.requestId, 'abc123');
});

// ── Level filtering ──────────────────────────────────────────────

test('debug is dropped when level is info', () => {
  const prev = process.env.ORCATRADE_LOG_LEVEL;
  process.env.ORCATRADE_LOG_LEVEL = 'info';
  try {
    const c = captureConsole(() => log.debug('verbose details'));
    assert.equal(c.log.length, 0);
    assert.equal(c.warn.length, 0);
    assert.equal(c.error.length, 0);
  } finally {
    process.env.ORCATRADE_LOG_LEVEL = prev;
  }
});

test('info + warn pass through when level is warn (info goes away)', () => {
  const prev = process.env.ORCATRADE_LOG_LEVEL;
  process.env.ORCATRADE_LOG_LEVEL = 'warn';
  try {
    const c = captureConsole(() => {
      log.info('info-message');
      log.warn('warn-message');
      log.error('error-message');
    });
    assert.equal(c.log.length, 0); // info dropped
    assert.equal(c.warn.length, 1);
    assert.equal(c.error.length, 1);
  } finally {
    process.env.ORCATRADE_LOG_LEVEL = prev;
  }
});

// ── Request id ───────────────────────────────────────────────────

test('generateRequestId returns 12 hex chars', () => {
  const id = log.generateRequestId();
  assert.match(id, /^[0-9a-f]{12}$/);
});

test('generateRequestId returns different values per call', () => {
  const a = log.generateRequestId();
  const b = log.generateRequestId();
  assert.notEqual(a, b);
});

// ── Non-string msg coerced ──────────────────────────────────────

test('non-string msg gets coerced (handlers sometimes pass numbers/objects)', () => {
  const c = captureConsole(() => log.info(42));
  const parsed = JSON.parse(c.log[0]);
  assert.equal(parsed.msg, '42');
});

// ── No-extras path ──────────────────────────────────────────────

test('extras of null or undefined is safe', () => {
  const c = captureConsole(() => {
    log.info('a', null);
    log.info('b', undefined);
  });
  assert.equal(c.log.length, 2);
  assert.equal(JSON.parse(c.log[0]).msg, 'a');
  assert.equal(JSON.parse(c.log[1]).msg, 'b');
});
