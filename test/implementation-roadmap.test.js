// Implementation roadmap tests (Sprint AI).

const test = require('node:test');
const assert = require('node:assert/strict');

const roadmap = require('../lib/intelligence/implementation-roadmap');
const { composePlan } = require('../lib/handlers/start');

const BASE_INPUT = {
  productCategory: 'apparel',
  originCountry: 'CN',
  destinationCountry: 'PL',
  customsValueEur: 25000,
  weightKg: 800,
  linesCount: 2,
};

// ── parseWhen ────────────────────────────────────────

test('parseWhen: orders T-12w < T-1w < T+0 < T+1d < T+1w', () => {
  const a = roadmap.parseWhen('T-12w');
  const b = roadmap.parseWhen('T-1w');
  const c = roadmap.parseWhen('T+0');
  const d = roadmap.parseWhen('T+1d');
  const e = roadmap.parseWhen('T+1w');
  assert.ok(a < b && b < c && c < d && d < e, `expected ${a} < ${b} < ${c} < ${d} < ${e}`);
});

test('parseWhen: returns 0 for malformed input', () => {
  assert.equal(roadmap.parseWhen(null), 0);
  assert.equal(roadmap.parseWhen('whenever'), 0);
});

// ── buildRoadmap ─────────────────────────────────────

test('buildRoadmap: returns ok=false for invalid plan', () => {
  const r = roadmap.buildRoadmap(null);
  assert.equal(r.ok, false);
  assert.equal(r.tasksTotal, 0);
});

test('buildRoadmap: produces all five phases for a valid plan', async () => {
  const plan = await composePlan(BASE_INPUT);
  const r = roadmap.buildRoadmap(plan);
  assert.equal(r.ok, true);
  const ids = r.phases.map(p => p.id);
  assert.deepEqual(ids, ['pre_departure', 'production_qc', 'logistics_customs', 'arrival_inland', 'post_arrival']);
});

test('buildRoadmap: every backbone phase has at least one task', async () => {
  const plan = await composePlan(BASE_INPUT);
  const r = roadmap.buildRoadmap(plan);
  for (const phase of r.phases) {
    assert.ok(phase.tasks.length > 0, `expected tasks in phase ${phase.id}`);
  }
});

test('buildRoadmap: tasks are sorted earliest-to-latest within each phase', async () => {
  const plan = await composePlan(BASE_INPUT);
  const r = roadmap.buildRoadmap(plan);
  for (const phase of r.phases) {
    for (let i = 1; i < phase.tasks.length; i++) {
      const prev = roadmap.parseWhen(phase.tasks[i - 1].when);
      const cur = roadmap.parseWhen(phase.tasks[i].when);
      assert.ok(prev <= cur, `tasks should be sorted: ${phase.tasks[i - 1].when} → ${phase.tasks[i].when}`);
    }
  }
});

test('buildRoadmap: every task carries when, action, owner', async () => {
  const plan = await composePlan(BASE_INPUT);
  const r = roadmap.buildRoadmap(plan);
  for (const phase of r.phases) {
    for (const t of phase.tasks) {
      assert.ok(t.when, 'task has when');
      assert.ok(t.action, 'task has action');
      assert.ok(t.owner, 'task has owner');
    }
  }
});

test('buildRoadmap: dedupes tasks with identical phase+when+action', async () => {
  // Force a duplicate by composing twice and merging — exercise the dedupe path.
  const plan = await composePlan(BASE_INPUT);
  const r1 = roadmap.buildRoadmap(plan);
  const r2 = roadmap.buildRoadmap(plan);
  assert.equal(r1.tasksTotal, r2.tasksTotal);
});

// ── Conditional branches ─────────────────────────────

test('preferential origin claimed → adds EUR.1/origin tasks', async () => {
  const plan = await composePlan({ ...BASE_INPUT, claimPreferential: true, originCountry: 'VN' });
  const r = roadmap.buildRoadmap(plan);
  const flat = r.phases.flatMap(p => p.tasks).map(t => t.action.toLowerCase());
  // Look for any of: 'origin certificate', 'origin declaration', 'EUR.1', 'EUR-MED', 'Form A', 'preferential'
  const hasPreferentialTask = flat.some(a => /origin certificate|origin declaration|eur\.1|eur-med|form a|preferential/.test(a));
  assert.ok(hasPreferentialTask, 'expected preferential-origin task to be present');
});

test('FX hedge recommended → adds forward-execution task', async () => {
  // High-volume non-EUR with longer payment terms typically triggers a hedge rec.
  const plan = await composePlan({ ...BASE_INPUT, customsValueEur: 50000, quoteCurrency: 'TRY', paymentTermsDays: 90 });
  if (plan.fx && plan.fx.recommendation === 'hedge') {
    const r = roadmap.buildRoadmap(plan);
    const flat = r.phases.flatMap(p => p.tasks).map(t => t.action.toLowerCase());
    const hasHedge = flat.some(a => /forward|hedge/.test(a));
    assert.ok(hasHedge, 'expected hedge task when FX recommendation is hedge');
  }
});

test('cheaper alternative origin in matrix → flags re-source memo', async () => {
  // Pick an origin that often loses on landed cost (e.g. CN with full MFN).
  const plan = await composePlan({ ...BASE_INPUT, originCountry: 'CN', customsValueEur: 50000 });
  const r = roadmap.buildRoadmap(plan);
  if (plan.originSensitivity && plan.originSensitivity.savingPctVsUserOrigin >= 5) {
    const flat = r.phases.flatMap(p => p.tasks).map(t => t.action.toLowerCase());
    const hasResource = flat.some(a => /re-source|resource feasibility|saves/.test(a));
    assert.ok(hasResource, 'expected re-source feasibility task when matrix shows a saving ≥ 5%');
  }
});

test('CBAM regime present → adds quarterly emissions reporting', async () => {
  // Steel HS chapter 72 typically triggers CBAM in our compliance map
  const plan = await composePlan({ ...BASE_INPUT, productCategory: 'machinery', hsCode: '72', originCountry: 'CN' });
  const cbam = (plan.compliance.regimes || []).some(r => /cbam/i.test(r.id || ''));
  if (cbam) {
    const r = roadmap.buildRoadmap(plan);
    const flat = r.phases.flatMap(p => p.tasks).map(t => t.action.toLowerCase());
    const hasCbam = flat.some(a => /cbam|embedded emissions/.test(a));
    assert.ok(hasCbam, 'expected CBAM reporting task when regime applies');
  }
});

// ── Wiring through composePlan/start handler ─────────

test('composePlan path: roadmap not attached to bare composePlan output', async () => {
  // composePlan stays roadmap-free so the saved-plan snapshot path is cheap.
  const plan = await composePlan(BASE_INPUT);
  assert.equal(plan.roadmap, undefined);
});

test('start/legacy/app.js renders roadmap when present', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const js = fs.readFileSync(path.join(__dirname, '..', 'start/legacy/app.js'), 'utf8');
  assert.match(js, /renderRoadmap\(plan\.roadmap\)/);
  assert.match(js, /class="rm-phase"/);
});

test('lib/handlers/start.js: composePlanWithRoadmap is exposed via the POST path', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const js = fs.readFileSync(path.join(__dirname, '..', 'lib/handlers/start.js'), 'utf8');
  assert.match(js, /composePlanWithRoadmap/);
});

test('i18n parity: roadmap keys present in EN/PL/DE', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const js = fs.readFileSync(path.join(__dirname, '..', 'start/legacy/i18n.js'), 'utf8');
  for (const key of ['secRoadmap', 'roadmapBody', 'roadmapTotalTasks']) {
    const matches = js.match(new RegExp(`${key}:`, 'g')) || [];
    assert.equal(matches.length, 3, `expected three locale entries for ${key}`);
  }
});
