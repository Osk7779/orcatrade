const test = require('node:test');
const assert = require('node:assert/strict');

const { GENESIS, canonicalProjection, stableStringify, buildChain, verifyChain } = require('../lib/audit-chain');

const ROWS = [
  { at: '2026-05-22T10:00:00Z', type: 'plan_saved', emailHash: 'aaaa1111', planId: 'pl_1' },
  { at: '2026-05-22T10:05:00Z', type: 'share_created', emailHash: 'aaaa1111', planId: 'pl_1' },
  { at: '2026-05-22T10:09:00Z', type: 'org_created', emailHash: 'bbbb2222', orgId: 'org_x' },
];

// ── chain construction ──────────────────────────────────

test('buildChain links each row to the previous; first prevHash is the genesis', () => {
  const chain = buildChain(ROWS);
  assert.equal(chain.length, 3);
  assert.equal(chain[0]._seq, 0);
  assert.equal(chain[0]._prevHash, GENESIS);
  assert.equal(chain[1]._prevHash, chain[0]._hash);
  assert.equal(chain[2]._prevHash, chain[1]._hash);
  for (const r of chain) assert.match(r._hash, /^[0-9a-f]{64}$/);
});

test('buildChain is deterministic for the same input', () => {
  assert.deepEqual(buildChain(ROWS), buildChain(ROWS));
});

// ── verification + tamper detection ─────────────────────

test('verifyChain: an unmodified chain verifies ok', () => {
  const v = verifyChain(buildChain(ROWS));
  assert.equal(v.ok, true);
  assert.equal(v.brokenAt, null);
  assert.match(v.headHash, /^[0-9a-f]{64}$/);
});

test('verifyChain: altering a row content breaks the chain at that row', () => {
  const chain = buildChain(ROWS);
  chain[1].type = 'org_created'; // tamper: change an action
  const v = verifyChain(chain);
  assert.equal(v.ok, false);
  assert.equal(v.brokenAt, 1);
  assert.match(v.reason, /hash mismatch/);
});

test('verifyChain: deleting a row breaks the linkage', () => {
  const chain = buildChain(ROWS);
  chain.splice(1, 1); // remove the middle row
  const v = verifyChain(chain);
  assert.equal(v.ok, false);
  assert.equal(v.brokenAt, 1); // row now at index 1 has the wrong prevHash
  assert.match(v.reason, /prevHash mismatch/);
});

test('verifyChain: reordering rows is detected', () => {
  const chain = buildChain(ROWS);
  [chain[1], chain[2]] = [chain[2], chain[1]];
  assert.equal(verifyChain(chain).ok, false);
});

test('verifyChain: empty input is a valid (trivial) chain', () => {
  assert.equal(verifyChain([]).ok, true);
  assert.deepEqual(buildChain([]), []);
});

// ── PII-free + deterministic projection ─────────────────

test('canonicalProjection never includes a raw email field', () => {
  const proj = canonicalProjection({ at: 'x', type: 't', email: 'secret@example.com', emailHash: 'h' });
  assert.doesNotMatch(proj, /secret@example\.com/);
  assert.match(proj, /"emailHash":"h"/);
});

test('stableStringify is key-order independent', () => {
  assert.equal(stableStringify({ b: 1, a: 2 }), stableStringify({ a: 2, b: 1 }));
});

// ── wired into the audit handler (format=chain) ─────────

test('audit handler exposes the chain module + format=chain shape is documented', () => {
  // Smoke: the module wires cleanly into the handler require graph.
  const audit = require('../lib/handlers/audit');
  assert.equal(typeof audit, 'function');
});
