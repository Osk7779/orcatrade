// Sprint api-v1-contract — frozen response contracts for the /api/v1/* surface
// + the versioned-alias routing. Schema drift on a pinned endpoint breaks CI.

const test = require('node:test');
const assert = require('node:assert/strict');

// KV-free + deterministic duty path for the in-process handler calls.
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;
process.env.ORCATRADE_DISABLE_LIVE_TARIC = '1';

const { validate, SCHEMAS } = require('../lib/contracts/v1');
const router = require('../api/[...path].js');
const { calculateQuote } = require('../lib/intelligence/customs-quote');

function mockRes() {
  const res = {
    statusCode: 200, headers: {}, body: '',
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    status(code) { this.statusCode = code; return this; },
    json(obj) { this.body = JSON.stringify(obj); return this; },
    end(body) { this.body = body || ''; return this; },
  };
  res.headersSent = false; res.writableEnded = false;
  return res;
}
function parse(res) { try { return JSON.parse(res.body); } catch (_) { return null; } }

// ── Validator self-tests (proves drift detection actually works) ─────────

test('validator: passes a conforming object', () => {
  const schema = { type: 'object', required: ['a'], properties: { a: { type: 'string' } } };
  assert.deepEqual(validate(schema, { a: 'x' }), []);
});

test('validator: additive new fields are non-breaking (forward-compatible)', () => {
  const schema = { type: 'object', required: ['a'], properties: { a: { type: 'string' } } };
  assert.deepEqual(validate(schema, { a: 'x', newField: 123 }), []);
});

test('validator: a removed required field is a breaking change (CI fails)', () => {
  const schema = { type: 'object', required: ['a'], properties: { a: { type: 'string' } } };
  const errs = validate(schema, { b: 'x' });
  assert.ok(errs.length >= 1);
  assert.match(errs[0], /\.a: required field missing/);
});

test('validator: a retyped field is a breaking change (CI fails)', () => {
  const schema = { type: 'object', properties: { a: { type: 'number' } } };
  const errs = validate(schema, { a: 'not-a-number' });
  assert.ok(errs.some((e) => /expected number/.test(e)));
});

test('validator: nullable permits null; enum is enforced', () => {
  assert.deepEqual(validate({ type: 'number', nullable: true }, null), []);
  assert.ok(validate({ type: 'string', enum: ['ok', 'down'] }, 'nope').length >= 1);
  assert.deepEqual(validate({ type: 'string', enum: ['ok', 'down'] }, 'ok'), []);
});

// ── Real handler output conforms to the frozen contracts ─────────────────

test('GET /api/v1/tiers conforms to the tiers contract', async () => {
  const res = mockRes();
  await router({ method: 'GET', headers: {}, query: { path: ['v1', 'tiers'] } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['x-api-version'], 'v1');
  const errs = validate(SCHEMAS.tiers, parse(res));
  assert.deepEqual(errs, [], 'tiers contract drift: ' + errs.join('; '));
});

test('GET /api/v1/hs-suggest conforms to the hs-suggest contract', async () => {
  const res = mockRes();
  await router({ method: 'GET', headers: { 'x-forwarded-for': '9.9.9.9' }, query: { path: ['v1', 'hs-suggest'], q: 'laptop' } }, res);
  assert.equal(res.statusCode, 200);
  const body = parse(res);
  assert.ok(body.candidates.length > 0);
  const errs = validate(SCHEMAS['hs-suggest'], body);
  assert.deepEqual(errs, [], 'hs-suggest contract drift: ' + errs.join('; '));
});

test('customs quote output conforms to the customs contract', () => {
  const quote = calculateQuote({
    productCategory: 'electronics', originCountry: 'CN', destinationCountry: 'PL',
    customsValueEur: 25000, weightKg: 500, hsCode: '8471.30',
  });
  const errs = validate(SCHEMAS.customs, quote);
  assert.deepEqual(errs, [], 'customs contract drift: ' + errs.join('; '));
});

// ── Versioned-alias routing ──────────────────────────────────────────────

test('bare /api/tiers is the v1 alias (x-api-version: v1, same shape)', async () => {
  const res = mockRes();
  await router({ method: 'GET', headers: {}, query: { path: ['tiers'] } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['x-api-version'], 'v1');
  assert.deepEqual(validate(SCHEMAS.tiers, parse(res)), []);
});

test('the v1 prefix is transparent to sub-action handlers (path is stripped)', async () => {
  // /api/v1/hs-suggest must reach the hs-suggest handler exactly like the bare
  // path — i.e. the handler must NOT see "v1" as its first segment.
  const res = mockRes();
  await router({ method: 'GET', headers: { 'x-forwarded-for': '8.8.4.4' }, query: { path: ['v1', 'hs-suggest'], q: 'sofa' } }, res);
  assert.equal(res.statusCode, 200);
  const body = parse(res);
  assert.equal(body.ok, true);
  assert.ok(Array.isArray(body.candidates));
});

test('an explicit /api/v2/<name> alias also routes (forward room) + stamps version', async () => {
  const res = mockRes();
  await router({ method: 'GET', headers: {}, query: { path: ['v2', 'tiers'] } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['x-api-version'], 'v2');
});

test('every frozen schema is a well-formed object schema', () => {
  for (const [name, schema] of Object.entries(SCHEMAS)) {
    assert.equal(schema.type, 'object', `${name} root must be an object schema`);
    assert.ok(Array.isArray(schema.required) && schema.required.length, `${name} must pin required fields`);
  }
});
