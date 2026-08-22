'use strict';

// Sprint 99 — the trust surfaces join the deploy gate.
//
// The post-deploy smoke is the prod tripwire (ADR 0017), and none
// of the sprint-80-98 public endpoints were in it. The trust
// endpoints are designed to NEVER 5xx (they degrade to truthful
// reduced states), so a status-code probe would sleep through a
// breakage — the new probes assert the SHAPE every consumer
// (marketing pages, trust pack, agents) depends on.
//
// The probe checks are pure ({status, text}) → verdict functions,
// exported via scripts/smoke.js `probes` — so this guard runs
// them against synthetic payloads without HTTP.

const test = require('node:test');
const assert = require('node:assert/strict');

const { probes } = require('../scripts/smoke.js');

const byName = Object.fromEntries(probes.map(([name, path, check]) => [name, { path, check }]));

test('the six trust-surface probes are registered (four-corners over the gate list)', () => {
  for (const name of [
    'accuracy ledger shaped',
    'sla attainment shaped',
    'trust pack shaped',
    'operator triage staff-gated',
    'trust/accuracy page',
    'trust/sla page',
  ]) {
    assert.ok(byName[name], `smoke gate missing probe: ${name}`);
  }
  assert.equal(byName['accuracy ledger shaped'].path, '/api/accuracy');
  assert.equal(byName['sla attainment shaped'].path, '/api/sla');
  assert.equal(byName['trust pack shaped'].path, '/api/trust-pack');
  assert.equal(byName['operator triage staff-gated'].path, '/api/operator-triage');
});

test('accuracy probe: shape-asserting, not status-sleeping (200 with a broken body FAILS)', () => {
  const check = byName['accuracy ledger shaped'].check;
  assert.equal(check({ status: 200, text: JSON.stringify({ ledger: { tier: 'insufficient', sampleSize: 0 } }) }).ok, true);
  // A 200 that lost the shape fails the gate — the degrade-never-5xx
  // design means status alone proves nothing.
  assert.equal(check({ status: 200, text: JSON.stringify({ ok: true }) }).ok, false);
  assert.equal(check({ status: 200, text: 'not json' }).ok, false);
  assert.equal(check({ status: 500, text: '{}' }).ok, false);
});

test('sla probe requires BOTH the attainment shape and the sprint-98 breach ledger', () => {
  const check = byName['sla attainment shaped'].check;
  const good = { sla: { quoteTurnaround: { tier: 'measured' }, breachesRecorded: { windowDays: 90, count: 0 } } };
  assert.equal(check({ status: 200, text: JSON.stringify(good) }).ok, true);
  const noLedger = { sla: { quoteTurnaround: { tier: 'measured' } } };
  const verdict = check({ status: 200, text: JSON.stringify(noLedger) });
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /breachesRecorded/);
});

test('trust-pack probe asserts the STATIC sections (they survive even the degrade path)', () => {
  const check = byName['trust pack shaped'].check;
  const good = { pack: { verification: {}, security: { documents: [{ name: 'SECURITY.md' }] } } };
  assert.equal(check({ status: 200, text: JSON.stringify(good) }).ok, true);
  assert.equal(check({ status: 200, text: JSON.stringify({ pack: { verification: {} } }) }).ok, false);
  assert.equal(check({ status: 200, text: JSON.stringify({ pack: { security: { documents: [] }, verification: {} } }) }).ok, false);
});

test('triage probe: an OPEN cross-org feed fails the deploy gate', () => {
  const check = byName['operator triage staff-gated'].check;
  assert.equal(check({ status: 401 }).ok, true);
  assert.equal(check({ status: 503 }).ok, true);
  const open = check({ status: 200 });
  assert.equal(open.ok, false, 'a 200 without auth means the staff gate fell off — the gate must catch it');
  assert.match(open.reason, /never be open/);
});

test('marketing-page probes require content, not just a 200 shell', () => {
  assert.equal(byName['trust/accuracy page'].check({ status: 200, text: '<h1>Quote Accuracy</h1>' }).ok, true);
  assert.equal(byName['trust/accuracy page'].check({ status: 200, text: '<html></html>' }).ok, false);
  assert.equal(byName['trust/sla page'].check({ status: 200, text: 'Service commitments, measured' }).ok, true);
  assert.equal(byName['trust/sla page'].check({ status: 404, text: '' }).ok, false);
});
