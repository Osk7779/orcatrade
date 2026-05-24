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

const EXPECTED_PERSONAL_TOOLS = [
  'forgetForUser', 'getMyComplianceDeadlines', 'getMyPortfolioDrift', 'getMySavedPlanDrift',
  'listMyPortfolios', 'listMySavedPlans', 'recallMemory', 'rememberForUser',
];

test('personalTools: eight read-only/memory tools; the list tools take no input', () => {
  assert.equal(personal.personalTools.length, 8);
  const names = personal.personalTools.map((t) => t.name).sort();
  assert.deepEqual(names, EXPECTED_PERSONAL_TOOLS);
  for (const t of personal.personalTools) {
    assert.equal(t.input_schema.type, 'object');
    if (t.name === 'getMyPortfolioDrift') assert.deepEqual(t.input_schema.required, ['portfolioId']);
    else if (t.name === 'getMySavedPlanDrift') assert.deepEqual(t.input_schema.required, ['planId']);
    else if (t.name === 'getMyComplianceDeadlines') assert.deepEqual(Object.keys(t.input_schema.properties), ['horizonDays']);
    else if (t.name === 'rememberForUser') assert.deepEqual(t.input_schema.required, ['key', 'value']);
    else if (t.name === 'forgetForUser') assert.deepEqual(t.input_schema.required, ['key']);
    else if (t.name === 'recallMemory') assert.deepEqual(Object.keys(t.input_schema.properties), ['key']);
    else assert.deepEqual(Object.keys(t.input_schema.properties), []); // the two list tools
  }
});

test('PERSONAL_TOOL_NAMES matches the tool names', () => {
  assert.deepEqual(personal.PERSONAL_TOOL_NAMES.slice().sort(), EXPECTED_PERSONAL_TOOLS);
});

// ── Agent memory tools (Sprint agent-memory-v1) ─────────

test('rememberForUser → recallMemory round-trips, scoped to the user', async () => {
  kv._resetMemoryStore();
  const impls = personal.buildPersonalImpls('mem-user@example.com');
  const saved = await impls.rememberForUser({ key: 'Target Margin', value: '35%', kind: 'preference' });
  assert.equal(saved.key, 'target-margin'); // slugified
  assert.equal(saved.created, true);

  const recall = await impls.recallMemory({ key: 'target-margin' });
  assert.equal(recall.count, 1);
  assert.equal(recall.memories[0].value, '35%');
  assert.equal(recall.memories[0].kind, 'preference');

  // A different user sees nothing.
  const other = personal.buildPersonalImpls('someone-else@example.com');
  const empty = await other.recallMemory({});
  assert.equal(empty.count, 0);
});

test('recallMemory with no key lists everything; forgetForUser removes it', async () => {
  kv._resetMemoryStore();
  const impls = personal.buildPersonalImpls('mem2@example.com');
  await impls.rememberForUser({ key: 'main-supplier', value: 'Shenzhen Acme' });
  await impls.rememberForUser({ key: 'preferred-port', value: 'Rotterdam' });
  const all = await impls.recallMemory({});
  assert.equal(all.count, 2);

  const forgot = await impls.forgetForUser({ key: 'preferred-port' });
  assert.equal(forgot.removed, true);
  const after = await impls.recallMemory({});
  assert.equal(after.count, 1);
  assert.equal(after.memories[0].key, 'main-supplier');
});

test('rememberForUser rejects empty key/value', async () => {
  kv._resetMemoryStore();
  const impls = personal.buildPersonalImpls('mem3@example.com');
  assert.ok((await impls.rememberForUser({ key: '', value: 'x' })).error);
  assert.ok((await impls.rememberForUser({ key: 'k', value: '' })).error);
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
  assert.deepEqual(await impls.getMyComplianceDeadlines({}), { plansScanned: 0, count: 0, obligations: [] });
});

test('getMyComplianceDeadlines: aggregates the owner\'s in-window deadlines, deduped', async () => {
  kv._resetMemoryStore();
  // Two CBAM-applicable plans (steel ex-CN) → the 2027-05-31 annual declaration
  // appears once, not twice. As-of 2027-05-01 it's 30 days out (in window).
  const steel = { productCategory: 'steel', originCountry: 'CN', destinationCountry: 'DE', customsValueEur: 250000 };
  await savedPlans.savePlan({ email: 'me@example.com', inputs: steel, label: 'Steel A' });
  await savedPlans.savePlan({ email: 'me@example.com', inputs: steel, label: 'Steel B' });
  await savedPlans.savePlan({ email: 'other@example.com', inputs: steel, label: 'Not mine' });

  const impls = personal.buildPersonalImpls('me@example.com');
  const out = await impls.getMyComplianceDeadlines({ asOf: '2027-05-01' });
  assert.equal(out.plansScanned, 2); // only the owner's plans
  assert.equal(out.count, 1); // deduped across the two steel plans
  assert.equal(out.obligations[0].regime, 'cbam');
  assert.ok(out.obligations[0].citation);
});

test('getMyComplianceDeadlines: a plan covered by no regime yields no deadlines', async () => {
  kv._resetMemoryStore();
  await savedPlans.savePlan({ email: 'me@example.com', inputs: planInput, label: 'Apparel' }); // apparel ex-CN
  const impls = personal.buildPersonalImpls('me@example.com');
  const out = await impls.getMyComplianceDeadlines({ asOf: '2027-05-01' });
  assert.equal(out.plansScanned, 1);
  assert.equal(out.count, 0);
});

test('listMySavedPlans summary includes the id (so drift can target it)', async () => {
  kv._resetMemoryStore();
  const rec = await savedPlans.savePlan({ email: 'me@example.com', inputs: planInput, label: 'Mine', snapshot: { perShipmentLandedTotal: 62000 } });
  const impls = personal.buildPersonalImpls('me@example.com');
  const out = await impls.listMySavedPlans({});
  assert.equal(out.plans[0].id, rec.id);
});

test('getMySavedPlanDrift: recomputes + returns current + drift for the owner', async () => {
  kv._resetMemoryStore();
  // Stale low baseline so the recompute drifts up significantly.
  const stalePlanSnapshot = { perShipmentLandedTotal: 30000, dutyEur: 1000, vatEur: 1, transportEur: 1, brokerageEur: 1 };
  const rec = await savedPlans.savePlan({ email: 'me@example.com', inputs: planInput, label: 'CN apparel', snapshot: stalePlanSnapshot });
  const impls = personal.buildPersonalImpls('me@example.com');
  const out = await impls.getMySavedPlanDrift({ planId: rec.id });
  assert.equal(out.label, 'CN apparel');
  assert.equal(out.route, 'CN→PL');
  assert.ok(out.current.landedEur > 0);
  assert.ok(out.drift);
  assert.equal(out.drift.significant, true);
  assert.ok(out.drift.landedDeltaEur > 0);
});

test('getMySavedPlanDrift: drift null when the saved plan had no snapshot', async () => {
  kv._resetMemoryStore();
  const rec = await savedPlans.savePlan({ email: 'me@example.com', inputs: planInput, label: 'No snap' });
  const impls = personal.buildPersonalImpls('me@example.com');
  const out = await impls.getMySavedPlanDrift({ planId: rec.id });
  assert.equal(out.drift, null);
  assert.ok(out.current.landedEur > 0);
});

test('getMySavedPlanDrift: error for missing id / unknown / another user\'s plan', async () => {
  kv._resetMemoryStore();
  const rec = await savedPlans.savePlan({ email: 'owner@example.com', inputs: planInput, label: 'X', snapshot: { perShipmentLandedTotal: 1 } });
  const mine = personal.buildPersonalImpls('me@example.com');
  assert.match((await mine.getMySavedPlanDrift({})).error, /planId required/);
  assert.match((await mine.getMySavedPlanDrift({ planId: 'pl_doesnotexist000' })).error, /not found/i);
  assert.match((await mine.getMySavedPlanDrift({ planId: rec.id })).error, /not found/i); // ownership
});

test('listMyPortfolios summary includes the id (so drift can target it)', async () => {
  kv._resetMemoryStore();
  const rec = await savedPortfolios.savePortfolio({ email: 'me@example.com', lines: portfolioLines, label: 'Cat', snapshot: portfolioSnapshot });
  const impls = personal.buildPersonalImpls('me@example.com');
  const out = await impls.listMyPortfolios({});
  assert.equal(out.portfolios[0].id, rec.id);
});

test('getMyPortfolioDrift: recomputes + returns current + drift for the owner', async () => {
  kv._resetMemoryStore();
  // Stale baseline so the recompute drifts up materially.
  const stale = { lineCount: 1, blendedDutyRatePct: 4, consolidationSavingEur: 0, totals: { perShipmentLandedTotal: 30000, dutyEur: 1000 } };
  const rec = await savedPortfolios.savePortfolio({ email: 'me@example.com', lines: portfolioLines, label: 'Cat', snapshot: stale });
  const impls = personal.buildPersonalImpls('me@example.com');
  const out = await impls.getMyPortfolioDrift({ portfolioId: rec.id });
  assert.equal(out.label, 'Cat');
  assert.ok(out.current.landedEur > 0);
  assert.ok(out.drift);
  assert.equal(out.drift.direction, 'up');
  assert.equal(out.drift.material, true);
});

test('getMyPortfolioDrift: drift null when the saved portfolio had no snapshot', async () => {
  kv._resetMemoryStore();
  const rec = await savedPortfolios.savePortfolio({ email: 'me@example.com', lines: portfolioLines, label: 'Cat' }); // no snapshot
  const impls = personal.buildPersonalImpls('me@example.com');
  const out = await impls.getMyPortfolioDrift({ portfolioId: rec.id });
  assert.equal(out.drift, null);
  assert.ok(out.current.landedEur > 0);
});

test('getMyPortfolioDrift: error for missing id / unknown / another user\'s portfolio', async () => {
  kv._resetMemoryStore();
  const rec = await savedPortfolios.savePortfolio({ email: 'owner@example.com', lines: portfolioLines, label: 'Cat', snapshot: portfolioSnapshot });
  const mine = personal.buildPersonalImpls('me@example.com');
  assert.match((await mine.getMyPortfolioDrift({})).error, /portfolioId required/);
  assert.match((await mine.getMyPortfolioDrift({ portfolioId: 'pf_doesnotexist00' })).error, /not found/i);
  // Another user's portfolio id → ownership check fails → not found.
  assert.match((await mine.getMyPortfolioDrift({ portfolioId: rec.id })).error, /not found/i);
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
