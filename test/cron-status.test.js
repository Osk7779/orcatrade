// Sprint cron-observability-v1 — tests for the cron status reader.
//
// Covers:
//   - summariseJobResult shape (scalars passthrough, arrays → _len,
//     nested objects → _keys count, null/undefined handled)
//   - Dispatcher write-through: a successful job fire persists
//     cron:lastRun:<job>; a thrown job persists cron:lastError:<job>;
//     ok:false return from a job is recorded as a noop (ok:false, but
//     no error key)
//   - handleStatus auth: 503 when neither admin env set, 401 wrong
//     token, 200 with session cookie when email is on allowlist
//   - handleStatus payload shape: jobs array sorted by name, each entry
//     carries { name, lastRun, lastError }
//   - Router registration: /api/cron-status routes to handleStatus
//   - /dashboard/cron/ markup + JS contract

'use strict';

process.env.ORCATRADE_AUTH_SECRET = 'test-secret-do-not-use-in-prod';
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const kv = require('../lib/intelligence/kv-store');
const auth = require('../lib/auth');
const cronHandler = require('../lib/handlers/cron');

function withEnv(overrides, fn) {
  const prev = {};
  for (const k of Object.keys(overrides)) prev[k] = process.env[k];
  for (const k of Object.keys(overrides)) {
    if (overrides[k] === undefined) delete process.env[k];
    else process.env[k] = overrides[k];
  }
  return Promise.resolve(fn()).finally(() => {
    for (const k of Object.keys(prev)) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  });
}

function mockRes() {
  return {
    statusCode: 200, headers: {}, body: '',
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(b) { this.body = b || ''; return this; },
  };
}

// ── summariseJobResult ────────────────────────────────

test('summariseJobResult: scalars pass through, arrays collapse to _len, nested objects to _keys', () => {
  const s = cronHandler.summariseJobResult({
    ok: true,
    sent: 3,
    skipped: 0,
    message: 'all good',
    details: [1, 2, 3, 4],
    inner: { a: 1, b: 2, c: { nested: true } },
    nullField: null,
    undefField: undefined,
  });
  assert.equal(s.ok, true);
  assert.equal(s.sent, 3);
  assert.equal(s.skipped, 0);
  assert.equal(s.message, 'all good');
  assert.deepEqual(s.details, { _len: 4 });
  assert.deepEqual(s.inner, { _keys: 3 });
  assert.equal(s.nullField, null);
  // undefined → null in the summary
  assert.equal(s.undefField, null);
});

test('summariseJobResult: non-object inputs pass through (or null)', () => {
  assert.equal(cronHandler.summariseJobResult(null), null);
  assert.equal(cronHandler.summariseJobResult(undefined), null);
  assert.equal(cronHandler.summariseJobResult(42), 42);
  assert.equal(cronHandler.summariseJobResult('ok'), 'ok');
});

// ── Dispatcher write-through (lastRun + lastError) ────

test('dispatcher: successful job persists cron:lastRun:<job> with summary + durationMs', () =>
  withEnv({ ORCATRADE_CRON_TOKEN: 'sekret' }, async () => {
    kv._resetMemoryStore();
    const req = {
      method: 'POST',
      url: '/api/cron',
      headers: { 'x-cron-token': 'sekret' },
      query: { path: ['cron'] },
      body: { job: 'taric-warm', params: { dryRun: true, max: 0 } },
    };
    const res = mockRes();
    await cronHandler(req, res);
    assert.equal(res.statusCode, 200);
    const stored = await kv.get(cronHandler.CRON_LAST_RUN_PREFIX + 'taric-warm');
    assert.ok(stored, 'lastRun key should be written');
    assert.ok(stored.ranAt);
    assert.ok(stored.completedAt);
    assert.equal(typeof stored.durationMs, 'number');
    assert.ok(stored.summary, 'summary should exist');
    assert.deepEqual(stored.params, { dryRun: true, max: 0 });
  })
);

test('dispatcher: job returning ok:false records lastRun with ok:false (noop semantics)', () =>
  withEnv({ ORCATRADE_CRON_TOKEN: 'sekret' }, async () => {
    kv._resetMemoryStore();
    // plan-revision-emails returns ok:false when RESEND_API_KEY is unset
    delete process.env.RESEND_API_KEY;
    const req = {
      method: 'POST', url: '/api/cron',
      headers: { 'x-cron-token': 'sekret' },
      query: { path: ['cron'] },
      body: { job: 'plan-revision-emails' },
    };
    const res = mockRes();
    await cronHandler(req, res);
    assert.equal(res.statusCode, 200);
    const stored = await kv.get(cronHandler.CRON_LAST_RUN_PREFIX + 'plan-revision-emails');
    assert.ok(stored);
    assert.equal(stored.ok, false, 'ok:false captured for noop runs');
    // No lastError written — the job didn't throw, it just returned ok:false.
    const err = await kv.get(cronHandler.CRON_LAST_ERROR_PREFIX + 'plan-revision-emails');
    assert.equal(err, null);
  })
);

test('dispatcher: thrown job persists cron:lastError:<job>, returns 500', () =>
  withEnv({ ORCATRADE_CRON_TOKEN: 'sekret' }, async () => {
    kv._resetMemoryStore();
    // Monkey-patch one JOBS entry to throw.
    const originalJob = cronHandler.JOBS['taric-warm'];
    cronHandler.JOBS['taric-warm'] = async () => { throw new Error('synthetic failure'); };
    try {
      const req = {
        method: 'POST', url: '/api/cron',
        headers: { 'x-cron-token': 'sekret' },
        query: { path: ['cron'] },
        body: { job: 'taric-warm' },
      };
      const res = mockRes();
      await cronHandler(req, res);
      assert.equal(res.statusCode, 500);
      const stored = await kv.get(cronHandler.CRON_LAST_ERROR_PREFIX + 'taric-warm');
      assert.ok(stored);
      assert.equal(stored.ok, false);
      assert.equal(stored.error, 'synthetic failure');
      assert.ok(stored.ranAt);
      assert.ok(stored.completedAt);
    } finally {
      cronHandler.JOBS['taric-warm'] = originalJob;
    }
  })
);

// ── handleStatus (admin-only reader) ──────────────────

test('GET /api/cron-status: 503 when neither admin env is set', () =>
  withEnv({ ORCATRADE_ADMIN_EMAILS: undefined, ORCATRADE_LEADS_TOKEN: undefined }, async () => {
    const req = { method: 'GET', url: '/api/cron-status', headers: {} };
    const res = mockRes();
    await cronHandler.handleStatus(req, res);
    assert.equal(res.statusCode, 503);
  })
);

test('GET /api/cron-status: 401 with no cookie and no token', () =>
  withEnv({ ORCATRADE_ADMIN_EMAILS: 'admin@orcatrade.pl', ORCATRADE_LEADS_TOKEN: 'sekret' }, async () => {
    const req = { method: 'GET', url: '/api/cron-status', headers: {} };
    const res = mockRes();
    await cronHandler.handleStatus(req, res);
    assert.equal(res.statusCode, 401);
  })
);

test('GET /api/cron-status: 405 on POST', () =>
  withEnv({ ORCATRADE_ADMIN_EMAILS: 'admin@orcatrade.pl' }, async () => {
    const req = { method: 'POST', url: '/api/cron-status', headers: {} };
    const res = mockRes();
    await cronHandler.handleStatus(req, res);
    assert.equal(res.statusCode, 405);
  })
);

test('GET /api/cron-status: 200 with admin session cookie + payload shape', () =>
  withEnv({ ORCATRADE_ADMIN_EMAILS: 'admin@orcatrade.pl', ORCATRADE_LEADS_TOKEN: undefined }, async () => {
    kv._resetMemoryStore();
    // Seed one lastRun + one lastError so the payload has signal.
    await kv.set(cronHandler.CRON_LAST_RUN_PREFIX + 'taric-warm', {
      ranAt: '2026-05-19T04:15:00Z', completedAt: '2026-05-19T04:15:14Z',
      durationMs: 14_000, ok: true, summary: { ok: true, attempted: 30, written: 30 },
    });
    await kv.set(cronHandler.CRON_LAST_ERROR_PREFIX + 'regime-change-check', {
      ranAt: '2026-05-18T05:00:00Z', completedAt: '2026-05-18T05:00:01Z',
      durationMs: 800, ok: false, error: 'upstream 503',
    });
    const cookie = auth.buildSessionCookie('admin@orcatrade.pl');
    const req = {
      method: 'GET', url: '/api/cron-status',
      headers: { cookie: 'orcatrade_session=' + encodeURIComponent(cookie) },
    };
    const res = mockRes();
    await cronHandler.handleStatus(req, res);
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.ok, true);
    assert.ok(Array.isArray(body.jobs));
    // All known jobs are present (sorted).
    const names = body.jobs.map((j) => j.name);
    const sorted = names.slice().sort();
    assert.deepEqual(names, sorted, 'jobs sorted by name');
    assert.ok(names.includes('taric-warm'));
    assert.ok(names.includes('regime-change-check'));
    // Seeded values surface.
    const warm = body.jobs.find((j) => j.name === 'taric-warm');
    assert.ok(warm.lastRun);
    assert.equal(warm.lastRun.summary.written, 30);
    assert.equal(warm.lastError, null);
    const regime = body.jobs.find((j) => j.name === 'regime-change-check');
    assert.ok(regime.lastError);
    assert.equal(regime.lastError.error, 'upstream 503');
  })
);

test('GET /api/cron-status: 200 with X-Admin-Token (legacy token path)', () =>
  withEnv({ ORCATRADE_ADMIN_EMAILS: undefined, ORCATRADE_LEADS_TOKEN: 'admintok' }, async () => {
    kv._resetMemoryStore();
    const req = { method: 'GET', url: '/api/cron-status', headers: { 'x-admin-token': 'admintok' } };
    const res = mockRes();
    await cronHandler.handleStatus(req, res);
    assert.equal(res.statusCode, 200);
  })
);

// ── Router registration ───────────────────────────────

test('router registers /api/cron-status → handleStatus', () => {
  const router = fs.readFileSync(path.join(__dirname, '..', 'api', '[...path].js'), 'utf8');
  assert.match(router, /['"]cron-status['"]\s*:\s*require\(['"]\.\.\/lib\/handlers\/cron['"]\)\.handleStatus/);
});

// ── /dashboard/cron/ contracts ────────────────────────

test('/dashboard/cron/index.html: noindex + DOM hooks + xrefs', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'dashboard', 'cron', 'index.html'), 'utf8');
  assert.match(html, /noindex/i);
  assert.match(html, /id=["']jobs["']/);
  assert.match(html, /id=["']token-form["']/);
  assert.match(html, /id=["']empty["']/);
  // Cross-links to siblings — making the cron dashboard discoverable.
  assert.match(html, /href=["']\/dashboard\/leads\/["']/);
  assert.match(html, /href=["']\/dashboard\/audit\/["']/);
});

test('/dashboard/cron/app.js: cookie-first probe + token fallback + /api/cron-status fetch', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'dashboard', 'cron', 'app.js'), 'utf8');
  assert.match(js, /\/api\/cron-status/);
  assert.match(js, /credentials:\s*['"]same-origin['"]/);
  // load(true) on DOMContentLoaded = silent cookie-first probe.
  assert.match(js, /DOMContentLoaded[\s\S]{0,300}load\(true\)/);
  // sessionStorage persistence (token fallback).
  assert.match(js, /sessionStorage\.setItem/);
});

test('/account/ admin card links to /dashboard/cron/ (Sprint cron-observability-v1)', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'account', 'index.html'), 'utf8');
  assert.match(html, /href=["']\/dashboard\/cron\/["']/);
});

test('/dashboard/leads/ subtitle cross-links to /dashboard/cron/', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'dashboard', 'leads', 'index.html'), 'utf8');
  assert.match(html, /href=["']\/dashboard\/cron\/["']/);
});

// ── Module surface ────────────────────────────────────

test('cron handler exposes the observability surface', () => {
  for (const name of ['handleStatus', 'summariseJobResult', 'CRON_LAST_RUN_PREFIX', 'CRON_LAST_ERROR_PREFIX', 'CRON_LAST_RUN_TTL_SECONDS']) {
    assert.ok(cronHandler[name] !== undefined, name + ' exported');
  }
});
