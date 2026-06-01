'use strict';

// Apex P1.7 follow-up — every specialist agent handler must wire
// the bill-protection gate. PR #45 shipped the spend-cap module +
// gate + orchestrator wiring; this PR extends the gate to the 4
// specialist handlers (compliance, finance, logistics, sourcing).
//
// Source-pin per handler so a future refactor can't accidentally
// drop the spend gate from one of them — a single uncovered
// handler reverts the bill-protection guarantee.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

const SPECIALISTS = [
  { name: 'compliance', file: 'lib/handlers/agent.js' },
  { name: 'finance',    file: 'lib/handlers/finance-agent.js' },
  { name: 'logistics',  file: 'lib/handlers/logistics-agent.js' },
  { name: 'sourcing',   file: 'lib/handlers/sourcing-agent.js' },
];

for (const { name, file } of SPECIALISTS) {
  test(`${name} agent imports lib/auth`, () => {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    assert.match(
      src,
      /const auth = require\(['"]\.\.\/auth['"]\)/,
      `${file} must import lib/auth so the user identity is available for the spend ledger`,
    );
  });

  test(`${name} agent calls gating.checkAgentSpend pre-flight`, () => {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    assert.match(
      src,
      /gating\.checkAgentSpend\(req\)/,
      `${file} must call checkAgentSpend before invoking Anthropic`,
    );
  });

  test(`${name} agent runs the spend gate AFTER the feature + quota gates and BEFORE callAnthropic`, () => {
    // Gate order: feature → quota → spend → callAnthropic. The
    // ordering matters: a tier-locked user should get the
    // tier-gate copy (402) before the quota copy (429) before
    // the spend copy (429). If a future refactor inverts the
    // order, the user-facing error message becomes confusing.
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    assert.match(
      src,
      /checkFeature[\s\S]{0,1000}checkQuota[\s\S]{0,1000}checkAgentSpend[\s\S]{0,8000}callAnthropic/,
      `${file} gate order: feature → quota → spend → callAnthropic`,
    );
  });

  test(`${name} agent threads email into withCostTelemetry`, () => {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    // The spend cap is bidirectional: the gate reads the ledger,
    // and the telemetry side writes to it. Without the email in
    // withCostTelemetry, the ledger never gets populated and the
    // gate has nothing to count. Pin both ends.
    assert.match(
      src,
      /withCostTelemetry\(\s*\{[\s\S]{0,1200}email:\s*\(auth\.getCurrentUser\(req\)\s*\|\|\s*\{\}\)\.email/,
      `${file} withCostTelemetry must receive email so the ledger is populated`,
    );
  });
}

test('all 4 specialist agents + the orchestrator all wire the spend cap (5/5 coverage)', () => {
  const all = [...SPECIALISTS, { name: 'orchestrator', file: 'lib/handlers/orchestrator.js' }];
  let withGate = 0;
  for (const { file } of all) {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    if (/gating\.checkAgentSpend\(req\)/.test(src)) withGate += 1;
  }
  assert.equal(withGate, 5, 'all 5 agent endpoints must wire the spend cap; partial coverage reverts the bill-protection guarantee');
});
