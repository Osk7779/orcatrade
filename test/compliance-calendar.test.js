const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_HORIZON_DAYS,
  SUPPORTED_REGIMES,
  severityFor,
  getUpcomingObligations,
  getNextObligation,
} = require('../lib/intelligence/compliance-calendar');

// ── severity bands ──────────────────────────────────────

test('severityFor: critical at and below 14 days', () => {
  assert.equal(severityFor(0), 'critical');
  assert.equal(severityFor(14), 'critical');
});

test('severityFor: high 15–30, medium 31–90, low beyond', () => {
  assert.equal(severityFor(15), 'high');
  assert.equal(severityFor(30), 'high');
  assert.equal(severityFor(31), 'medium');
  assert.equal(severityFor(90), 'medium');
  assert.equal(severityFor(91), 'low');
});

// ── regime resolution ───────────────────────────────────

test('cbam and eudr are supported regimes', () => {
  assert.ok(SUPPORTED_REGIMES.includes('cbam'));
  assert.ok(SUPPORTED_REGIMES.includes('eudr'));
});

test('empty regimes → no obligations', () => {
  assert.deepEqual(getUpcomingObligations({ regimes: [], asOf: '2026-06-01' }), []);
});

test('unknown regimes are ignored', () => {
  assert.deepEqual(getUpcomingObligations({ regimes: ['bogus', 'gdpr'], asOf: '2026-06-01' }), []);
});

test('regimes accept applicability-like objects ({ regulationId })', () => {
  const obligations = getUpcomingObligations({
    regimes: [{ regulationId: 'eudr' }],
    asOf: '2026-12-01',
  });
  assert.ok(obligations.length >= 1);
  assert.ok(obligations.every(o => o.regime === 'eudr'));
});

// ── EUDR SME vs non-SME application date ────────────────

test('non-SME importer sees the standard EUDR application date (2026-12-30)', () => {
  const obligations = getUpcomingObligations({ regimes: ['eudr'], asOf: '2026-12-01', isSME: false });
  assert.equal(obligations.length, 1);
  assert.equal(obligations[0].regime, 'eudr');
  assert.equal(obligations[0].dueDate, '2026-12-30');
  assert.equal(obligations[0].daysUntil, 29);
  assert.equal(obligations[0].severity, 'high');
  assert.ok(obligations[0].citation);
  assert.ok(obligations[0].detail);
});

test('SME importer sees the SME application date (2027-06-30), not the non-SME date', () => {
  // From 2026-12-01 the SME date (2027-06-30) is ~211 days out — inside the
  // default 365d horizon — while the non-SME date (2026-12-30) is filtered out.
  const obligations = getUpcomingObligations({ regimes: ['eudr'], asOf: '2026-12-01', isSME: true });
  assert.equal(obligations.length, 1);
  assert.equal(obligations[0].dueDate, '2027-06-30');
  assert.equal(obligations[0].severity, 'low');
  assert.ok(obligations.every(o => o.dueDate !== '2026-12-30'));
});

test('horizon can exclude the SME application date for an SME importer', () => {
  // Tighten the window so even the SME date falls outside it → nothing upcoming.
  assert.deepEqual(
    getUpcomingObligations({ regimes: ['eudr'], asOf: '2026-12-01', isSME: true, horizonDays: 90 }),
    [],
  );
});

// ── horizon + past filtering ────────────────────────────

test('past milestones are excluded', () => {
  // After every curated EUDR date → nothing upcoming.
  assert.deepEqual(getUpcomingObligations({ regimes: ['eudr'], asOf: '2027-07-01' }), []);
});

test('horizon window excludes far-future obligations', () => {
  // CBAM's next milestone from mid-2026 is the 2027-05-31 annual declaration —
  // far outside a 30-day window.
  assert.deepEqual(getUpcomingObligations({ regimes: ['cbam'], asOf: '2026-06-01', horizonDays: 30 }), []);
});

test('today-due milestone (daysUntil 0) is included as critical', () => {
  const obligations = getUpcomingObligations({ regimes: ['eudr'], asOf: '2026-12-30', isSME: false });
  assert.equal(obligations.length, 1);
  assert.equal(obligations[0].daysUntil, 0);
  assert.equal(obligations[0].severity, 'critical');
});

// ── ordering across regimes ─────────────────────────────

test('obligations are sorted soonest-first across regimes', () => {
  const obligations = getUpcomingObligations({ regimes: ['cbam', 'eudr'], asOf: '2026-06-01', isSME: false });
  // EUDR application 2026-12-30 is sooner than CBAM annual declaration 2027-05-31.
  assert.equal(obligations[0].regime, 'eudr');
  assert.equal(obligations[0].dueDate, '2026-12-30');
  assert.equal(obligations[obligations.length - 1].regime, 'cbam');
  assert.equal(obligations[obligations.length - 1].dueDate, '2027-05-31');
  for (let i = 1; i < obligations.length; i += 1) {
    assert.ok(obligations[i].daysUntil >= obligations[i - 1].daysUntil);
  }
});

// ── input shapes + determinism ──────────────────────────

test('asOf accepts a Date object equivalently to an ISO string', () => {
  const fromString = getUpcomingObligations({ regimes: ['eudr'], asOf: '2026-12-01' });
  const fromDate = getUpcomingObligations({ regimes: ['eudr'], asOf: new Date('2026-12-01T00:00:00Z') });
  assert.deepEqual(fromDate, fromString);
});

test('invalid asOf falls back to today without throwing', () => {
  const obligations = getUpcomingObligations({ regimes: ['cbam', 'eudr'], asOf: 'not-a-date' });
  assert.ok(Array.isArray(obligations));
});

test('deterministic: identical inputs → identical output', () => {
  const args = { regimes: ['cbam', 'eudr'], asOf: '2026-06-01', isSME: false, horizonDays: 400 };
  assert.deepEqual(getUpcomingObligations(args), getUpcomingObligations(args));
});

test('default horizon is 365 days', () => {
  assert.equal(DEFAULT_HORIZON_DAYS, 365);
});

// ── getNextObligation ───────────────────────────────────

test('getNextObligation returns the single soonest obligation', () => {
  const next = getNextObligation({ regimes: ['cbam', 'eudr'], asOf: '2026-06-01', isSME: false });
  assert.equal(next.regime, 'eudr');
  assert.equal(next.dueDate, '2026-12-30');
});

test('getNextObligation returns null when nothing is upcoming', () => {
  assert.equal(getNextObligation({ regimes: ['eudr'], asOf: '2027-07-01' }), null);
});
