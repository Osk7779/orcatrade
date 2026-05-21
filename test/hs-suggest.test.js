// Sprint hs-suggest-v1 — HS-code lookup helper: scorer, endpoint,
// dataset shape, the >=6-digit live-TARIC gate, i18n, wizard wiring.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

const hs = require('../lib/intelligence/data/hs-suggest');
const handler = require('../lib/handlers/hs-suggest');

function mockRes() {
  const res = {
    statusCode: 200, headers: {}, body: '',
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    status(code) { this.statusCode = code; return this; },
    end(body) { this.body = body || ''; return this; },
  };
  res.headersSent = false; res.writableEnded = false;
  return res;
}
function parseJsonBody(res) { try { return JSON.parse(res.body); } catch (_) { return null; } }

// ── Dataset shape ───────────────────────────────────────

test('every HS entry has hs6 (6 digits), label, chapter, keywords[]', () => {
  for (const e of hs.HS_ENTRIES) {
    assert.match(e.hs6, /^[0-9]{6}$/, 'bad hs6: ' + e.hs6);
    assert.equal(e.chapter, e.hs6.slice(0, 2), 'chapter must be first 2 of hs6: ' + e.hs6);
    assert.ok(typeof e.label === 'string' && e.label.length > 0);
    assert.ok(Array.isArray(e.keywords) && e.keywords.length > 0, 'no keywords: ' + e.hs6);
  }
});

test('no duplicate hs6 codes in the dataset', () => {
  const seen = new Set();
  for (const e of hs.HS_ENTRIES) {
    assert.ok(!seen.has(e.hs6), 'duplicate hs6: ' + e.hs6);
    seen.add(e.hs6);
  }
});

// ── Scorer ──────────────────────────────────────────────

test('suggest: common product descriptions return the right top hit', () => {
  const cases = [
    ['cotton t-shirt', '610910'],
    ['laptop', '847130'],
    ['running shoes', '640411'],
    ['sofa', '940161'],
    ['perfume', '330300'],
    ['e-bike', '871160'],
    ['wireless headphones', '851830'],
    ['stainless steel pots', '732393'],
  ];
  for (const [q, expectTop] of cases) {
    const r = hs.suggest(q, { limit: 5 });
    assert.ok(r.length > 0, 'no results for: ' + q);
    assert.equal(r[0].hs6, expectTop, `top hit for "${q}" expected ${expectTop}, got ${r[0].hs6}`);
  }
});

test('suggest: digit query matches by HS prefix', () => {
  const r = hs.suggest('6109');
  assert.ok(r.length > 0);
  assert.ok(r.every((c) => c.hs6.startsWith('6109')));
});

test('suggest: 2-digit chapter query matches the chapter', () => {
  const r = hs.suggest('85');
  assert.ok(r.length > 0);
  assert.ok(r.every((c) => c.chapter === '85'));
});

test('suggest: empty / whitespace / no-match returns empty array', () => {
  assert.deepEqual(hs.suggest(''), []);
  assert.deepEqual(hs.suggest('   '), []);
  assert.deepEqual(hs.suggest('zzzzz qwerty nonsense'), []);
  assert.deepEqual(hs.suggest(null), []);
});

test('suggest: respects the limit', () => {
  const r = hs.suggest('shoes', { limit: 2 });
  assert.ok(r.length <= 2);
});

test('suggest: results are ranked by score (desc)', () => {
  const r = hs.suggest('cotton shirt', { limit: 5 });
  for (let i = 1; i < r.length; i++) {
    assert.ok(r[i - 1].score >= r[i].score, 'not sorted by score desc');
  }
});

// ── Endpoint ────────────────────────────────────────────

test('GET /api/hs-suggest: 200 + candidates for a real query', async () => {
  const res = mockRes();
  await handler({ method: 'GET', headers: { 'x-forwarded-for': '1.1.1.1' }, query: { q: 'laptop' } }, res);
  assert.equal(res.statusCode, 200);
  const body = parseJsonBody(res);
  assert.equal(body.ok, true);
  assert.ok(body.candidates.length > 0);
  assert.equal(body.candidates[0].hs6, '847130');
});

test('GET /api/hs-suggest: empty q returns empty candidates (200)', async () => {
  const res = mockRes();
  await handler({ method: 'GET', headers: { 'x-forwarded-for': '2.2.2.2' }, query: { q: '' } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(parseJsonBody(res).candidates, []);
});

test('GET /api/hs-suggest: over-long query is truncated, not rejected', async () => {
  const res = mockRes();
  const long = 'cotton '.repeat(40); // > 80 chars
  await handler({ method: 'GET', headers: { 'x-forwarded-for': '3.3.3.3' }, query: { q: long } }, res);
  assert.equal(res.statusCode, 200);
  const body = parseJsonBody(res);
  assert.ok(body.query.length <= handler.MAX_QUERY_LEN);
});

test('GET /api/hs-suggest: 405 on non-GET', async () => {
  const res = mockRes();
  await handler({ method: 'POST', headers: {}, query: {} }, res);
  assert.equal(res.statusCode, 405);
});

test('GET /api/hs-suggest: 429 after the rate limit', async () => {
  const ip = '4.4.4.4';
  for (let i = 0; i < 61; i++) {
    const r = mockRes();
    await handler({ method: 'GET', headers: { 'x-forwarded-for': ip }, query: { q: 'laptop' } }, r);
  }
  const limited = mockRes();
  await handler({ method: 'GET', headers: { 'x-forwarded-for': ip }, query: { q: 'laptop' } }, limited);
  assert.equal(limited.statusCode, 429);
});

test('GET /api/hs-suggest: no PII / no email in the response', async () => {
  const res = mockRes();
  await handler({ method: 'GET', headers: { 'x-forwarded-for': '5.5.5.5' }, query: { q: 'sofa' } }, res);
  assert.ok(!/@/.test(res.body), 'response should carry no email');
});

// ── Dispatcher registration ─────────────────────────────

test('hs-suggest is registered in the api router', () => {
  const router = fs.readFileSync(path.join(__dirname, '..', 'api', '[...path].js'), 'utf8');
  assert.match(router, /'hs-suggest':\s*require\('\.\.\/lib\/handlers\/hs-suggest'\)/);
});

// ── Live-TARIC gate lowered to >= 6 digits ──────────────

test('customs-quote async path accepts a 6-digit HS code (gate >= 6)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'intelligence', 'customs-quote.js'), 'utf8');
  // The gate must allow 6-digit codes so HS6 suggestions trigger the
  // live-refined duty path.
  assert.match(src, /normHs\.length >= 6/);
});

// ── i18n completeness across EN/PL/DE ───────────────────

test('start/i18n.js carries hsLookup* keys in EN, PL, and DE', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'start', 'i18n.js'), 'utf8');
  const keys = ['hsLookupToggle', 'hsLookupQueryPh', 'hsLookupNote', 'hsLookupNoResults', 'hsLookupChapter'];
  // Each key must appear at least 3 times (once per locale block).
  for (const k of keys) {
    const count = (src.match(new RegExp(k + ':', 'g')) || []).length;
    assert.ok(count >= 3, `${k} should appear in all 3 locales, found ${count}`);
  }
});

// ── Wizard wiring ───────────────────────────────────────

test('start/app.js mounts the HS lookup + fetches /api/hs-suggest', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'start', 'app.js'), 'utf8');
  assert.match(js, /function mountHsLookup/);
  assert.match(js, /mountHsLookup\(\)/);
  assert.match(js, /\/api\/hs-suggest\?q=/);
  // Picking a candidate fills the #hsCode input.
  assert.match(js, /hsInput\.value = hs/);
  // Debounced (don't fire a request per keystroke).
  assert.match(js, /debounceTimer/);
});
