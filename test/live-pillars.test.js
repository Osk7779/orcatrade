const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildTriageReply,
  detectPillarIntent,
  isOutOfScope,
} = require('../lib/intelligence/live-pillars');

test('detectPillarIntent routes shipment questions to supply chain', () => {
  assert.equal(
    detectPillarIntent('Track this shipment ETA and tell me if the port delay is getting worse.'),
    'supply_chain'
  );
});

test('detectPillarIntent routes compliance questions correctly', () => {
  assert.equal(
    detectPillarIntent('Is this import order compliant with EUDR and CBAM?'),
    'compliance'
  );
});

test('unrelated questions are treated as out of scope', () => {
  assert.equal(isOutOfScope('Who won the match last night?'), true);
});

test('triage reply lists the three live workflows', () => {
  const reply = buildTriageReply();
  assert.match(reply, /\/supply-chain\//);
  assert.match(reply, /\/compliance\//);
  assert.match(reply, /\/factory-risk\//);
});
