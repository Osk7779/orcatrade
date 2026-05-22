const test = require('node:test');
const assert = require('node:assert/strict');

const agent = require('../lib/handlers/agent');

// ── tool schema is registered on the compliance agent ───

test('getComplianceCalendar is registered in the agent toolset', () => {
  const tool = agent.TOOLS.find(t => t.name === 'getComplianceCalendar');
  assert.ok(tool, 'getComplianceCalendar tool should exist');
  assert.deepEqual(tool.input_schema.required, ['productCategory']);
  assert.ok(tool.input_schema.properties.asOf, 'tool should expose an asOf parameter for reproducible answers');
});

test('the impl is present and callable', () => {
  assert.equal(typeof agent.toolImpls.getComplianceCalendar, 'function');
});

// ── derives regimes from shipment facts ─────────────────

test('CBAM-covered product from a non-EEA origin puts cbam in scope with dated obligations', () => {
  const result = agent.toolImpls.getComplianceCalendar({
    productCategory: 'steel',
    originCountry: 'CN',
    asOf: '2026-06-01',
  });
  assert.ok(result.regimesInScope.includes('cbam'));
  assert.equal(result.obligationCount, result.obligations.length);
  assert.equal(result.note, null);
  for (const o of result.obligations) {
    assert.ok(o.regime);
    assert.ok(o.dueDate);
    assert.ok(o.citation);
    assert.ok(['critical', 'high', 'medium', 'low'].includes(o.severity));
    assert.ok(Number.isInteger(o.daysUntil) && o.daysUntil >= 0);
  }
});

test('a product covered by neither CBAM nor EUDR returns no regimes + an explanatory note', () => {
  const result = agent.toolImpls.getComplianceCalendar({
    productCategory: 'consumer electronics',
    originCountry: 'CN',
    asOf: '2026-06-01',
  });
  assert.deepEqual(result.regimesInScope, []);
  assert.deepEqual(result.obligations, []);
  assert.equal(result.obligationCount, 0);
  assert.ok(result.note);
});

// ── SME resolution flows from turnover ──────────────────

test('small global turnover marks the importer as an SME', () => {
  const result = agent.toolImpls.getComplianceCalendar({
    productCategory: 'steel',
    originCountry: 'CN',
    globalTurnoverEur: 500000,
    asOf: '2026-06-01',
  });
  assert.equal(result.isSME, true);
});

test('missing turnover defaults to non-SME', () => {
  const result = agent.toolImpls.getComplianceCalendar({
    productCategory: 'steel',
    originCountry: 'CN',
    asOf: '2026-06-01',
  });
  assert.equal(result.isSME, false);
});

test('horizon defaults to 365 when not supplied', () => {
  const result = agent.toolImpls.getComplianceCalendar({
    productCategory: 'steel',
    originCountry: 'CN',
    asOf: '2026-06-01',
  });
  assert.equal(result.horizonDays, 365);
});
