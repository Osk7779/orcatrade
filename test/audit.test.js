// Tests for lib/handlers/audit.js + the /dashboard/audit/ page — Sprint BG-5.3.
//
// Strategy: build a minimal req/res stub, seed events into the in-memory KV,
// exercise the four lifecycle paths (no env, no token, bad token, valid token)
// and assert the redaction contract — emails must be replaced by deterministic
// hashes, free-text fields truncated.

process.env.ORCATRADE_AUTH_SECRET = 'test-secret-do-not-use-in-prod';
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const events = require('../lib/events');
const kv = require('../lib/intelligence/kv-store');
const audit = require('../lib/handlers/audit');

function makeReq(qs = {}) {
  return {
    method: 'GET',
    url: '/api/audit?' + new URLSearchParams(qs).toString(),
    headers: {},
    query: { path: ['audit'], ...qs },
    requestId: 'test-req-id',
  };
}

function makeRes() {
  return {
    statusCode: 200,
    _headers: {},
    body: '',
    setHeader(k, v) { this._headers[k] = v; },
    end(b) { this.body = b || ''; return this; },
  };
}

function withEnv(overrides, fn) {
  const prev = {};
  for (const k of Object.keys(overrides)) prev[k] = process.env[k];
  for (const k of Object.keys(overrides)) {
    if (overrides[k] == null) delete process.env[k];
    else process.env[k] = overrides[k];
  }
  try { return fn(); }
  finally {
    for (const k of Object.keys(prev)) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
}

async function withEnvAsync(overrides, fn) {
  const prev = {};
  for (const k of Object.keys(overrides)) prev[k] = process.env[k];
  for (const k of Object.keys(overrides)) {
    if (overrides[k] == null) delete process.env[k];
    else process.env[k] = overrides[k];
  }
  try { return await fn(); }
  finally {
    for (const k of Object.keys(prev)) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
}

// ── Endpoint: auth gate ──────────────────────────────────────

test('returns 503 when no admin auth is configured', async () => {
  await withEnvAsync({ ORCATRADE_LEADS_TOKEN: null, ORCATRADE_ADMIN_EMAILS: null }, async () => {
    const req = makeReq();
    const res = makeRes();
    await audit(req, res);
    assert.equal(res.statusCode, 503);
    assert.match(JSON.parse(res.body).error, /not configured/);
  });
});

// Sprint admin-session-auth — session cookie when email on allowlist.
test('returns 200 with session cookie when signed-in email is on ORCATRADE_ADMIN_EMAILS', async () => {
  const auth = require('../lib/auth');
  kv._resetMemoryStore();
  await events.record('founding_applied', { name: 'alice', email: 'alice@example.com', company: 'ACo' });
  await withEnvAsync({
    ORCATRADE_LEADS_TOKEN: null,
    ORCATRADE_ADMIN_EMAILS: 'oskar@orcatrade.pl',
  }, async () => {
    const cookie = auth.buildSessionCookie('oskar@orcatrade.pl');
    const req = makeReq();
    req.headers.cookie = 'orcatrade_session=' + encodeURIComponent(cookie);
    const res = makeRes();
    await audit(req, res);
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.ok, true);
  });
});

test('returns 401 with session cookie when signed-in email is NOT on ORCATRADE_ADMIN_EMAILS', async () => {
  const auth = require('../lib/auth');
  await withEnvAsync({
    ORCATRADE_LEADS_TOKEN: null,
    ORCATRADE_ADMIN_EMAILS: 'oskar@orcatrade.pl',
  }, async () => {
    const cookie = auth.buildSessionCookie('intruder@example.com');
    const req = makeReq();
    req.headers.cookie = 'orcatrade_session=' + encodeURIComponent(cookie);
    const res = makeRes();
    await audit(req, res);
    assert.equal(res.statusCode, 401);
  });
});

test('returns 401 with no token query param', async () => {
  await withEnvAsync({ ORCATRADE_LEADS_TOKEN: 'sekret' }, async () => {
    const req = makeReq();
    const res = makeRes();
    await audit(req, res);
    assert.equal(res.statusCode, 401);
  });
});

test('returns 401 with wrong token', async () => {
  await withEnvAsync({ ORCATRADE_LEADS_TOKEN: 'sekret' }, async () => {
    const req = makeReq({ token: 'wrong' });
    const res = makeRes();
    await audit(req, res);
    assert.equal(res.statusCode, 401);
  });
});

test('returns 405 on POST', async () => {
  await withEnvAsync({ ORCATRADE_LEADS_TOKEN: 'sekret' }, async () => {
    const req = makeReq({ token: 'sekret' });
    req.method = 'POST';
    const res = makeRes();
    await audit(req, res);
    assert.equal(res.statusCode, 405);
  });
});

test('returns 200 with valid token + the expected response shape', async () => {
  kv._resetMemoryStore();
  await events.record('founding_applied', { name: 'alice', email: 'alice@example.com', company: 'ACo' });
  await events.record('founding_applied', { name: 'bob',   email: 'bob@example.com',   company: 'BCo' });
  await withEnvAsync({ ORCATRADE_LEADS_TOKEN: 'sekret' }, async () => {
    const req = makeReq({ token: 'sekret' });
    const res = makeRes();
    await audit(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res._headers['Content-Type'], 'application/json');
    assert.equal(res._headers['Cache-Control'], 'no-store');
    const body = JSON.parse(res.body);
    assert.equal(body.ok, true);
    assert.ok(Array.isArray(body.events));
    assert.equal(body.events.length, 2);
    assert.ok(Array.isArray(body.allowedTypes));
    assert.ok(body.allowedTypes.includes('founding_applied'));
  });
});

// ── Redaction ────────────────────────────────────────────────

test('redactRow: email replaced by 12-hex emailHash', () => {
  const r = audit.redactRow({ type: 'founding_applied', email: 'oskar@orcatrade.pl', name: 'Oskar' });
  assert.equal(r.email, undefined);
  assert.match(r.emailHash, /^[a-f0-9]{12}$/);
  assert.equal(r.name, 'Oskar');
});

test('redactRow: same email always hashes to the same emailHash (correlation across events)', () => {
  const a = audit.redactRow({ email: 'me@example.com' });
  const b = audit.redactRow({ email: 'ME@Example.com' });   // case-normalised
  const c = audit.redactRow({ email: 'me@example.com'.padEnd(30, ' ') });  // trim-normalised — note: trailing spaces are NOT trimmed in the assertion, only leading/trailing in hashEmail
  assert.equal(a.emailHash, b.emailHash);
  // c uses .trim() internally, so the trailing-space email should hash identical
  assert.equal(audit.hashEmail('me@example.com'), audit.hashEmail('  me@example.com  '));
});

test('redactRow: pseudonymised "deleted-<hash>" emails are NOT re-hashed', () => {
  const r = audit.redactRow({ email: 'deleted-abc123@anonymised.local', pseudonymised: true });
  // Should pass through — already a pseudonym, not a real PII leak.
  assert.equal(r.email, 'deleted-abc123@anonymised.local');
  assert.equal(r.emailHash, undefined);
});

test('redactRow: long messages truncated to 80 chars + ellipsis', () => {
  const long = 'x'.repeat(120);
  const r = audit.redactRow({ message: long });
  assert.equal(r.message.length, 81);  // 80 chars + the ellipsis char
  assert.ok(r.message.endsWith('…'));
});

test('redactRow: short messages pass through unchanged', () => {
  const r = audit.redactRow({ message: 'short note' });
  assert.equal(r.message, 'short note');
});

test('end-to-end: events with emails come back with emailHash, not raw addresses', async () => {
  kv._resetMemoryStore();
  await events.record('founding_applied', { name: 'alice', email: 'alice@example.com' });
  await withEnvAsync({ ORCATRADE_LEADS_TOKEN: 'sekret' }, async () => {
    const req = makeReq({ token: 'sekret' });
    const res = makeRes();
    await audit(req, res);
    const body = JSON.parse(res.body);
    const evt = body.events[0];
    assert.equal(evt.email, undefined, 'raw email must not appear in response');
    assert.match(evt.emailHash, /^[a-f0-9]{12}$/, 'emailHash must be present');
    assert.equal(evt.name, 'alice');
  });
});

// ── Type + limit filter ──────────────────────────────────────

test('type filter returns only events of that type', async () => {
  kv._resetMemoryStore();
  await events.record('founding_applied', { name: 'a', email: 'a@example.com' });
  await events.record('plan_saved', { planId: 'p1' });
  await events.record('founding_applied', { name: 'b', email: 'b@example.com' });
  await withEnvAsync({ ORCATRADE_LEADS_TOKEN: 'sekret' }, async () => {
    const req = makeReq({ token: 'sekret', type: 'plan_saved' });
    const res = makeRes();
    await audit(req, res);
    const body = JSON.parse(res.body);
    assert.equal(body.events.length, 1);
    assert.equal(body.events[0].type, 'plan_saved');
  });
});

test('limit clamps to 1000 maximum + 1 minimum', async () => {
  kv._resetMemoryStore();
  await events.record('plan_saved', { planId: 'p1' });
  await withEnvAsync({ ORCATRADE_LEADS_TOKEN: 'sekret' }, async () => {
    // Out-of-range limit values are clamped silently.
    const req1 = makeReq({ token: 'sekret', limit: '99999' });
    const res1 = makeRes();
    await audit(req1, res1);
    const body1 = JSON.parse(res1.body);
    assert.equal(body1.limit, 1000);

    const req2 = makeReq({ token: 'sekret', limit: '0' });
    const res2 = makeRes();
    await audit(req2, res2);
    const body2 = JSON.parse(res2.body);
    assert.equal(body2.limit, 1);
  });
});

// ── Page contract ────────────────────────────────────────────

test('audit dashboard HTML carries the required hooks', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'dashboard', 'audit', 'index.html'), 'utf8');
  assert.match(html, /<meta name="robots" content="noindex,\s*nofollow"/i);
  for (const id of ['tokenInput', 'typeFilter', 'limitInput', 'reloadBtn', 'stats', 'tableHost', 'errBanner', 'lastChecked']) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `id="${id}" present`);
  }
  // The PII discipline note must be in the page so an admin understands
  // why they're seeing hashes not addresses.
  assert.match(html, /pseudonymised/);
  assert.match(html, /deterministic.*hash/i);
});

test('audit dashboard app.js fetches /api/audit and persists token via sessionStorage', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'dashboard', 'audit', 'app.js'), 'utf8');
  assert.match(js, /fetch\(['"`]\/api\/audit/);
  assert.match(js, /sessionStorage/);
  assert.match(js, /STORAGE_KEY\s*=\s*['"]orcatrade\.audit\.token['"]/);
});
