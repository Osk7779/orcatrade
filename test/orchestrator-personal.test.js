// Sprint orchestrator-personal-v1 — the orchestrator's read-only
// "my saved plans / portfolios" tools + per-request auth-gated merge.

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.ORCATRADE_AUTH_SECRET = 'test-secret-do-not-use-in-prod';
process.env.ORCATRADE_DISABLE_LIVE_TARIC = '1';
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

const personal = require('../lib/handlers/orchestrator-personal');
const orchestrator = require('../lib/handlers/orchestrator');
const auth = require('../lib/auth');
const kv = require('../lib/intelligence/kv-store');
const savedPlans = require('../lib/saved-plans');
const savedPortfolios = require('../lib/saved-portfolios');

function cookieReq(email) {
  return { headers: { cookie: 'orcatrade_session=' + encodeURIComponent(auth.buildSessionCookie(email)) } };
}

const planInput = { productCategory: 'apparel', originCountry: 'CN', destinationCountry: 'PL', customsValueEur: 50000, weightKg: 2000, hsCode: '610910' };
const portfolioLines = [
  { productCategory: 'apparel', originCountry: 'CN', destinationCountry: 'PL', customsValueEur: 50000, weightKg: 2000 },
];
const portfolioSnapshot = {
  lineCount: 1, blendedDutyRatePct: 9.4, consolidationSavingEur: 0,
  totals: { perShipmentLandedTotal: 62000, dutyEur: 4700 },
};

// ── Tool schemas ────────────────────────────────────────

test('personalTools: two read-only tools with empty input schemas', () => {
  assert.equal(personal.personalTools.length, 2);
  const names = personal.personalTools.map((t) => t.name).sort();
  assert.deepEqual(names, ['listMyPortfolios', 'listMySavedPlans']);
  for (const t of personal.personalTools) {
    assert.equal(t.input_schema.type, 'object');
    assert.deepEqual(Object.keys(t.input_schema.properties), []);
  }
});

test('PERSONAL_TOOL_NAMES matches the tool names', () => {
  assert.deepEqual(personal.PERSONAL_TOOL_NAMES.sort(), ['listMyPortfolios', 'listMySavedPlans']);
});

// ── Summaries ───────────────────────────────────────────

test('summarisePlan trims a saved plan to route/landed/category', () => {
  const s = personal.summarisePlan({
    label: 'CN apparel', inputs: planInput, snapshot: { perShipmentLandedTotal: 62000 }, savedAt: '2026-04-01', actual: { landedCents: 1 },
  });
  assert.equal(s.route, 'CN→PL');
  assert.equal(s.category, 'apparel');
  assert.equal(s.landedEur, 62000);
  assert.equal(s.hasActual, true);
});

test('summarisePortfolio trims to skuCount/blended/landed', () => {
  const s = personal.summarisePortfolio({ label: 'Cat', lines: portfolioLines, snapshot: portfolioSnapshot, savedAt: '2026-04-01' });
  assert.equal(s.skuCount, 1);
  assert.equal(s.blendedDutyRatePct, 9.4);
  assert.equal(s.landedEur, 62000);
});

// ── Impls read the right user's data ────────────────────

test('buildPersonalImpls: listMySavedPlans returns the user\'s plans only', async () => {
  kv._resetMemoryStore();
  await savedPlans.savePlan({ email: 'me@example.com', inputs: planInput, label: 'Mine', snapshot: { perShipmentLandedTotal: 62000 } });
  await savedPlans.savePlan({ email: 'other@example.com', inputs: planInput, label: 'Theirs', snapshot: { perShipmentLandedTotal: 99000 } });
  const impls = personal.buildPersonalImpls('me@example.com');
  const out = await impls.listMySavedPlans({});
  assert.equal(out.count, 1);
  assert.equal(out.plans[0].label, 'Mine');
});

test('buildPersonalImpls: listMyPortfolios returns the user\'s portfolios only', async () => {
  kv._resetMemoryStore();
  await savedPortfolios.savePortfolio({ email: 'me@example.com', lines: portfolioLines, label: 'My cat', snapshot: portfolioSnapshot });
  await savedPortfolios.savePortfolio({ email: 'other@example.com', lines: portfolioLines, label: 'Their cat', snapshot: portfolioSnapshot });
  const impls = personal.buildPersonalImpls('me@example.com');
  const out = await impls.listMyPortfolios({});
  assert.equal(out.count, 1);
  assert.equal(out.portfolios[0].label, 'My cat');
});

test('buildPersonalImpls: empty email yields empty results (no leak)', async () => {
  const impls = personal.buildPersonalImpls('');
  assert.deepEqual(await impls.listMySavedPlans({}), { count: 0, plans: [] });
  assert.deepEqual(await impls.listMyPortfolios({}), { count: 0, portfolios: [] });
});

// ── classifyTool ───────────────────────────────────────

test('classifyTool tags the personal tools as "account"', () => {
  assert.equal(orchestrator.classifyTool('listMySavedPlans'), 'account');
  assert.equal(orchestrator.classifyTool('listMyPortfolios'), 'account');
});

test('base orchestrator tools are unchanged (personal tools are per-request, not in base TOOLS)', () => {
  const names = orchestrator.TOOLS.map((t) => t.name);
  assert.ok(!names.includes('listMySavedPlans'));
  assert.ok(!names.includes('listMyPortfolios'));
});

// ── buildToolset: auth-gated merge ──────────────────────

test('buildToolset: anonymous request gets the base toolset only', async () => {
  const { tools, impls, user } = await orchestrator.buildToolset({ headers: {} });
  assert.equal(user, null);
  assert.equal(tools.length, orchestrator.TOOLS.length);
  assert.ok(!impls.listMySavedPlans);
});

test('buildToolset: signed-in request merges in the personal tools + impls', async () => {
  kv._resetMemoryStore();
  const { tools, impls, user } = await orchestrator.buildToolset(cookieReq('me@example.com'));
  assert.ok(user && user.email === 'me@example.com');
  const names = tools.map((t) => t.name);
  assert.ok(names.includes('listMySavedPlans'));
  assert.ok(names.includes('listMyPortfolios'));
  assert.equal(typeof impls.listMySavedPlans, 'function');
  // Base tools still present.
  assert.ok(names.includes('estimateLandedCost'));
});

test('buildToolset: the merged impls are scoped to the requesting user', async () => {
  kv._resetMemoryStore();
  await savedPlans.savePlan({ email: 'scoped@example.com', inputs: planInput, label: 'Scoped', snapshot: { perShipmentLandedTotal: 1 } });
  await savedPlans.savePlan({ email: 'intruder@example.com', inputs: planInput, label: 'Intruder', snapshot: { perShipmentLandedTotal: 2 } });
  const { impls } = await orchestrator.buildToolset(cookieReq('scoped@example.com'));
  const out = await impls.listMySavedPlans({});
  assert.equal(out.count, 1);
  assert.equal(out.plans[0].label, 'Scoped');
});
