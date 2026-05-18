// Sprint BG-1.4 — Actuals capture v1.
//
// Three layers asserted:
//   1. Pure helpers — sanitisers + buildActualRecord + computeVariance.
//      These are the calculator-grounded math; if they drift the
//      variance shown to users is wrong and the Track 1 reality-check
//      loop emits noise.
//   2. KV persistence — setActual / clearActual write to the plan
//      record without disturbing other fields.
//   3. /api/plans/<id>/actual handler — auth gate, ownership check,
//      audit-event emission, response shape.
// HTML/JS markup contract is in test/account-plans-ui.test.js next.

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.ORCATRADE_AUTH_SECRET = 'test-secret-do-not-use-in-prod';
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

const actuals = require('../lib/actuals');
const savedPlans = require('../lib/saved-plans');
const events = require('../lib/events');
const auth = require('../lib/auth');
const kv = require('../lib/intelligence/kv-store');
const plansHandler = require('../lib/handlers/plans');

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(body) { this.body = body || ''; return this; },
  };
}

function reqWithCookie(method, email, extras = {}) {
  const cookie = auth.buildSessionCookie(email);
  return {
    method,
    headers: { cookie: `orcatrade_session=${encodeURIComponent(cookie)}` },
    body: {},
    ...extras,
  };
}

async function seedPlan(email, overrides = {}) {
  return savedPlans.savePlan({
    email,
    inputs: {
      productCategory: 'apparel',
      originCountry: 'CN',
      destinationCountry: 'PL',
      customsValueEur: 25000,
      weightKg: 800,
      ...overrides.inputs,
    },
    label: overrides.label || 'test',
    snapshot: overrides.snapshot || {
      perShipmentLandedTotal: 30000,
      schemaVersion: 1,
    },
  });
}

// ── ALLOWED_TYPES surface ─────────────────────────────

test('events.ALLOWED_TYPES includes actual_reported + actual_cleared', () => {
  assert.ok(events.ALLOWED_TYPES.has('actual_reported'));
  assert.ok(events.ALLOWED_TYPES.has('actual_cleared'));
});

// ── sanitiseLandedEur ─────────────────────────────────

test('sanitiseLandedEur: accepts positive numbers', () => {
  assert.equal(actuals.sanitiseLandedEur(12345.67), 12345.67);
  assert.equal(actuals.sanitiseLandedEur('12345.67'), 12345.67);
  assert.equal(actuals.sanitiseLandedEur(0.01), 0.01);
});

test('sanitiseLandedEur: rejects zero, negative, NaN, undefined', () => {
  assert.equal(actuals.sanitiseLandedEur(0), null);
  assert.equal(actuals.sanitiseLandedEur(-50), null);
  assert.equal(actuals.sanitiseLandedEur('abc'), null);
  assert.equal(actuals.sanitiseLandedEur(undefined), null);
  assert.equal(actuals.sanitiseLandedEur(null), null);
  assert.equal(actuals.sanitiseLandedEur(NaN), null);
  assert.equal(actuals.sanitiseLandedEur(Infinity), null);
});

test('sanitiseLandedEur: rejects nonsensically large values (>1B)', () => {
  assert.equal(actuals.sanitiseLandedEur(actuals.MAX_LANDED_EUR + 1), null);
  assert.equal(actuals.sanitiseLandedEur(actuals.MAX_LANDED_EUR), actuals.MAX_LANDED_EUR);
});

// ── sanitiseNotes ─────────────────────────────────────

test('sanitiseNotes: trims + caps at MAX_NOTES_LEN', () => {
  assert.equal(actuals.sanitiseNotes('  hello  '), 'hello');
  assert.equal(actuals.sanitiseNotes(''), '');
  assert.equal(actuals.sanitiseNotes(null), '');
  assert.equal(actuals.sanitiseNotes(undefined), '');
  const long = 'x'.repeat(actuals.MAX_NOTES_LEN + 100);
  assert.equal(actuals.sanitiseNotes(long).length, actuals.MAX_NOTES_LEN);
});

// ── buildActualRecord ─────────────────────────────────

test('buildActualRecord: produces integer-cents record', () => {
  const r = actuals.buildActualRecord({ landedEur: 28450.50, notes: 'surprise duty' });
  assert.equal(r.landedCents, 2845050);
  assert.equal(r.currency, 'EUR');
  assert.equal(r.notes, 'surprise duty');
  assert.match(r.reportedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('buildActualRecord: half-even rounding on the EUR→cents conversion edge', () => {
  // 0.005 should round to nearest even (banker's). Math.round(0.5*100)
  // does round-half-away-from-zero, which is what we use — pin the
  // contract so a future refactor doesn't silently switch.
  assert.equal(actuals.buildActualRecord({ landedEur: 0.005, notes: '' }).landedCents, 1);
  assert.equal(actuals.buildActualRecord({ landedEur: 100.005, notes: '' }).landedCents, 10001);
});

test('buildActualRecord: throws on bad input', () => {
  assert.throws(() => actuals.buildActualRecord({ landedEur: 0, notes: '' }), /positive/);
  assert.throws(() => actuals.buildActualRecord({ landedEur: -50, notes: '' }), /positive/);
  assert.throws(() => actuals.buildActualRecord({ landedEur: 'abc', notes: '' }), /positive/);
  assert.throws(() => actuals.buildActualRecord({}), /positive/);
});

// ── computeVariance ───────────────────────────────────

test('computeVariance: actual > estimate → over-budget', () => {
  const v = actuals.computeVariance(
    { landedCents: 3300000 },                         // €33,000 actual
    { perShipmentLandedTotal: 30000 }                 // €30,000 estimate
  );
  assert.equal(v.direction, 'over');
  assert.equal(v.estimateEur, 30000);
  assert.equal(v.actualEur, 33000);
  assert.equal(v.deltaEur, 3000);
  assert.equal(v.deltaPct, 10);
  assert.equal(v.significant, true);                  // 10% >> 3% threshold
});

test('computeVariance: actual < estimate → under-budget', () => {
  const v = actuals.computeVariance(
    { landedCents: 2700000 },                         // €27,000 actual
    { perShipmentLandedTotal: 30000 }                 // €30,000 estimate
  );
  assert.equal(v.direction, 'under');
  assert.equal(v.deltaEur, -3000);
  assert.equal(v.deltaPct, -10);
  assert.equal(v.significant, true);
});

test('computeVariance: actual == estimate → on-target, not significant', () => {
  const v = actuals.computeVariance(
    { landedCents: 3000000 },
    { perShipmentLandedTotal: 30000 }
  );
  assert.equal(v.direction, 'on-target');
  assert.equal(v.deltaEur, 0);
  assert.equal(v.deltaPct, 0);
  assert.equal(v.significant, false);
});

test('computeVariance: 1% deviation is not significant', () => {
  const v = actuals.computeVariance(
    { landedCents: 3030000 },                         // €30,300 — 1% over
    { perShipmentLandedTotal: 30000 }
  );
  assert.equal(v.significant, false);
  assert.equal(v.deltaPct, 1);
});

test('computeVariance: 3% deviation IS significant (boundary)', () => {
  const v = actuals.computeVariance(
    { landedCents: 3090000 },                         // €30,900 — 3% over
    { perShipmentLandedTotal: 30000 }
  );
  assert.equal(v.significant, true);
});

test('computeVariance: null on missing inputs', () => {
  assert.equal(actuals.computeVariance(null, { perShipmentLandedTotal: 30000 }), null);
  assert.equal(actuals.computeVariance({ landedCents: 1000 }, null), null);
  assert.equal(actuals.computeVariance({ landedCents: 1000 }, {}), null);
  assert.equal(actuals.computeVariance({}, { perShipmentLandedTotal: 30000 }), null);
});

test('computeVariance: rejects non-positive estimate to avoid div-by-zero', () => {
  assert.equal(actuals.computeVariance({ landedCents: 1000 }, { perShipmentLandedTotal: 0 }), null);
  assert.equal(actuals.computeVariance({ landedCents: 1000 }, { perShipmentLandedTotal: -5 }), null);
});

// ── setActual / clearActual ───────────────────────────

test('setActual: attaches actual to the plan record without disturbing other fields', async () => {
  kv._resetMemoryStore();
  const plan = await seedPlan('me@example.com');
  const updated = await actuals.setActual(plan.id, 'me@example.com', {
    landedEur: 31250.00,
    notes: 'duty came in higher than expected',
  });
  assert.ok(updated);
  assert.equal(updated.id, plan.id);                  // same plan
  assert.equal(updated.inputs.productCategory, 'apparel');  // untouched
  assert.equal(updated.actual.landedCents, 3125000);
  assert.equal(updated.actual.notes, 'duty came in higher than expected');
  // And it's persisted: a fresh getPlan should return the actual too.
  const refetched = await savedPlans.getPlan(plan.id, 'me@example.com');
  assert.equal(refetched.actual.landedCents, 3125000);
});

test('setActual: re-reporting overwrites the previous actual', async () => {
  kv._resetMemoryStore();
  const plan = await seedPlan('me@example.com');
  await actuals.setActual(plan.id, 'me@example.com', { landedEur: 31000 });
  const second = await actuals.setActual(plan.id, 'me@example.com', { landedEur: 32000, notes: 'corrected' });
  assert.equal(second.actual.landedCents, 3200000);
  assert.equal(second.actual.notes, 'corrected');
});

test('setActual: returns null for non-existent plan', async () => {
  kv._resetMemoryStore();
  const r = await actuals.setActual('pl_does_not_exist', 'me@example.com', { landedEur: 1000 });
  assert.equal(r, null);
});

test('setActual: ownership-checked — wrong user gets null', async () => {
  kv._resetMemoryStore();
  const plan = await seedPlan('owner@example.com');
  const r = await actuals.setActual(plan.id, 'attacker@example.com', { landedEur: 1000 });
  assert.equal(r, null);
});

test('clearActual: removes the actual field; idempotent on already-empty plans', async () => {
  kv._resetMemoryStore();
  const plan = await seedPlan('me@example.com');
  await actuals.setActual(plan.id, 'me@example.com', { landedEur: 31000 });
  const cleared = await actuals.clearActual(plan.id, 'me@example.com');
  assert.equal(cleared.actual, undefined);
  // Re-clearing is a no-op.
  const cleared2 = await actuals.clearActual(plan.id, 'me@example.com');
  assert.equal(cleared2.actual, undefined);
});

// ── /api/plans/<id>/actual handler ────────────────────

test('POST /api/plans/<id>/actual: 401 when not signed in', async () => {
  kv._resetMemoryStore();
  const req = {
    method: 'POST', headers: {}, body: { landedEur: 1000 },
    query: { path: ['plans', 'pl_xxx', 'actual'] },
    url: '/api/plans/pl_xxx/actual',
  };
  const res = mockRes();
  await plansHandler(req, res);
  assert.equal(res.statusCode, 401);
});

test('POST /api/plans/<id>/actual: 404 on unknown plan', async () => {
  kv._resetMemoryStore();
  const req = reqWithCookie('POST', 'me@example.com', {
    body: { landedEur: 1000 },
    query: { path: ['plans', 'pl_does_not_exist', 'actual'] },
    url: '/api/plans/pl_does_not_exist/actual',
  });
  const res = mockRes();
  await plansHandler(req, res);
  assert.equal(res.statusCode, 404);
});

test('POST /api/plans/<id>/actual: 400 on missing/zero landedEur', async () => {
  kv._resetMemoryStore();
  const plan = await seedPlan('me@example.com');
  const req = reqWithCookie('POST', 'me@example.com', {
    body: { landedEur: 0 },
    query: { path: ['plans', plan.id, 'actual'] },
    url: `/api/plans/${plan.id}/actual`,
  });
  const res = mockRes();
  await plansHandler(req, res);
  assert.equal(res.statusCode, 400);
});

test('POST /api/plans/<id>/actual: happy path + emits actual_reported audit event', async () => {
  kv._resetMemoryStore();
  const plan = await seedPlan('me@example.com');
  const req = reqWithCookie('POST', 'me@example.com', {
    body: { landedEur: 32500.00, notes: 'duty surprise' },
    query: { path: ['plans', plan.id, 'actual'] },
    url: `/api/plans/${plan.id}/actual`,
  });
  const res = mockRes();
  await plansHandler(req, res);
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.ok, true);
  assert.equal(body.plan.actual.landedCents, 3250000);
  // Variance must come back in the response.
  assert.ok(body.plan.actualVariance);
  assert.equal(body.plan.actualVariance.deltaPct, 8.3);  // (32500-30000)/30000 = 8.333 → 8.3
  assert.equal(body.plan.actualVariance.direction, 'over');
  // Audit event was written with the variance percent.
  const log = (await events.list({})).filter(e => e.type === 'actual_reported');
  assert.equal(log.length, 1);
  assert.equal(log[0].planId, plan.id);
  assert.equal(log[0].landedCents, 3250000);
  assert.equal(log[0].deltaPct, 8.3);
});

test('POST /api/plans/<id>/actual: ownership enforced — different user gets 404', async () => {
  kv._resetMemoryStore();
  const plan = await seedPlan('owner@example.com');
  const req = reqWithCookie('POST', 'attacker@example.com', {
    body: { landedEur: 1000 },
    query: { path: ['plans', plan.id, 'actual'] },
    url: `/api/plans/${plan.id}/actual`,
  });
  const res = mockRes();
  await plansHandler(req, res);
  // We return 404 (not 403) so we don't leak that the plan exists.
  assert.equal(res.statusCode, 404);
});

test('DELETE /api/plans/<id>/actual: clears + emits actual_cleared audit event', async () => {
  kv._resetMemoryStore();
  const plan = await seedPlan('me@example.com');
  await actuals.setActual(plan.id, 'me@example.com', { landedEur: 31000 });
  const req = reqWithCookie('DELETE', 'me@example.com', {
    query: { path: ['plans', plan.id, 'actual'] },
    url: `/api/plans/${plan.id}/actual`,
  });
  const res = mockRes();
  await plansHandler(req, res);
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.plan.actual, undefined);
  assert.equal(body.plan.actualVariance, undefined);
  const log = (await events.list({})).filter(e => e.type === 'actual_cleared');
  assert.equal(log.length, 1);
  assert.equal(log[0].planId, plan.id);
});

test('GET /api/plans includes actualVariance for plans with an actual', async () => {
  kv._resetMemoryStore();
  const a = await seedPlan('me@example.com', { label: 'with-actual' });
  await actuals.setActual(a.id, 'me@example.com', { landedEur: 33000 });
  await seedPlan('me@example.com', { label: 'no-actual' });

  const req = reqWithCookie('GET', 'me@example.com', {
    query: { path: ['plans'] },
    url: '/api/plans',
  });
  const res = mockRes();
  await plansHandler(req, res);
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  const withActual = body.plans.find(p => p.label === 'with-actual');
  const noActual = body.plans.find(p => p.label === 'no-actual');
  assert.ok(withActual.actualVariance);
  assert.equal(withActual.actualVariance.direction, 'over');
  assert.equal(noActual.actualVariance, undefined);
});

// ── UI markup contract ────────────────────────────────

test('/account/plans/index.html includes actual + variance CSS hooks', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const html = fs.readFileSync(path.join(__dirname, '..', 'account', 'plans', 'index.html'), 'utf8');
  assert.match(html, /\.actual-form\b/);
  assert.match(html, /\.plan-variance\b/);
  assert.match(html, /\.plan-variance\.over\b/);
  assert.match(html, /\.plan-variance\.under\b/);
});

test('/account/plans/app.js wires the actuals endpoints', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const js = fs.readFileSync(path.join(__dirname, '..', 'account', 'plans', 'app.js'), 'utf8');
  // POST + DELETE against the actual sub-resource.
  assert.match(js, /\/api\/plans\/['"]?\s*\+\s*encodeURIComponent\([^)]+\)\s*\+\s*['"`]\/actual/);
  assert.match(js, /method:\s*['"]POST['"]/);
  assert.match(js, /method:\s*['"]DELETE['"]/);
  // Sends { landedEur, notes } as JSON.
  assert.match(js, /JSON\.stringify\(\{\s*landedEur:/);
  // Renders the variance badge + the form.
  assert.match(js, /renderVarianceBadge/);
  assert.match(js, /renderActualForm/);
});
