const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeName, similarity, screen } = require('../lib/intelligence/sanctions-screening');

// ── normalisation ──────────────────────────────────────

test('normalizeName strips diacritics, punctuation, and form words', () => {
  assert.equal(normalizeName('Açme Ltd.'), 'acme');
  assert.equal(normalizeName('ACME, LLC'), 'acme');
  assert.equal(normalizeName('  Acme   Corporation  '), 'acme');
});

test('normalizeName is token-order invariant (sorts tokens)', () => {
  assert.equal(normalizeName('Petrov, Ivan'), normalizeName('Ivan Petrov'));
  assert.equal(normalizeName('Ivan Petrov'), 'ivan petrov');
});

test('normalizeName returns empty for unscreenable input', () => {
  assert.equal(normalizeName(''), '');
  assert.equal(normalizeName('   ,. '), '');
  assert.equal(normalizeName('Ltd LLC GmbH'), ''); // all form words
});

test('similarity: exact normalised match is 1, unrelated is low', () => {
  assert.equal(similarity('acme', 'acme'), 1);
  assert.ok(similarity('acme', 'globex') < 0.5);
});

// ── screening against the illustrative sample ───────────

test('exact name → potential_match with score 1', () => {
  const r = screen({ name: 'Volcano Trading Company' });
  assert.equal(r.status, 'potential_match');
  assert.equal(r.matches[0].id, 'SMP-001');
  assert.equal(r.matches[0].score, 1);
});

test('alias match is found', () => {
  const r = screen({ name: 'Vulkan Handel GmbH' });
  assert.equal(r.status, 'potential_match');
  assert.equal(r.matches[0].id, 'SMP-001');
  assert.equal(r.matches[0].matchedOn, 'Vulkan Handel GmbH');
});

test('name-order variance still matches (Surname, Firstname)', () => {
  const r = screen({ name: 'Petrov Ivan' });
  assert.equal(r.status, 'potential_match');
  assert.equal(r.matches[0].id, 'SMP-002');
  assert.equal(r.matches[0].score, 1);
});

test('typo within threshold still flags', () => {
  const r = screen({ name: 'Ivan Petrof' }); // missing the final v/f
  assert.equal(r.status, 'potential_match');
  assert.equal(r.matches[0].id, 'SMP-002');
  assert.ok(r.matches[0].score >= 0.85);
});

test('corporate-suffix variance matches (LLC dropped)', () => {
  const r = screen({ name: 'Crescent Marine Logistics' });
  assert.equal(r.status, 'potential_match');
  assert.equal(r.matches[0].id, 'SMP-004');
});

test('an unrelated party returns no_sample_match — never "clear"', () => {
  const r = screen({ name: 'Acme Widgets International' });
  assert.equal(r.status, 'no_sample_match');
  assert.equal(r.matchCount, 0);
  assert.notEqual(r.status, 'clear');
  assert.match(r.advisory, /authoritative consolidated lists/);
  assert.equal(r.authoritative, false);
});

test('the screen NEVER reports an all-clear status', () => {
  for (const name of ['Volcano Trading Company', 'Totally Unrelated Co', '', 'x']) {
    const r = screen({ name });
    assert.ok(['potential_match', 'no_sample_match', 'invalid'].includes(r.status));
    assert.notEqual(r.status, 'clear');
  }
});

test('empty / unscreenable input → invalid (with advisory)', () => {
  const r = screen({ name: '   ' });
  assert.equal(r.status, 'invalid');
  assert.ok(r.advisory);
});

test('threshold is tunable', () => {
  // A loose 0.3 threshold lets a weak token overlap through; the strict
  // default (0.85) rejects it.
  const loose = screen({ name: 'Volcano Imports', threshold: 0.3 });
  assert.equal(loose.status, 'potential_match'); // shares "volcano"
  const strict = screen({ name: 'Volcano Imports' });
  assert.equal(strict.status, 'no_sample_match');
});

test('list is injectable (engine runs against any provided list)', () => {
  const custom = { source: 'TEST', authoritative: true, entries: [{ id: 'X1', name: 'Globex Corporation', aliases: [] }] };
  const r = screen({ name: 'Globex Corp', list: custom });
  assert.equal(r.status, 'potential_match');
  assert.equal(r.matches[0].id, 'X1');
  assert.equal(r.listSource, 'TEST');
  assert.equal(r.authoritative, true);
});

// ── wired onto the compliance agent (flows to the orchestrator) ──

test('screenCounterparty is registered as an agent tool and works', async () => {
  const agent = require('../lib/handlers/agent');
  const tool = agent.TOOLS.find(t => t.name === 'screenCounterparty');
  assert.ok(tool);
  assert.deepEqual(tool.input_schema.required, ['name']);
  // async now — loads the active list (sample when no DB) then screens.
  const out = await agent.toolImpls.screenCounterparty({ name: 'Volcano Trading Company' });
  assert.equal(out.status, 'potential_match');
  assert.equal(out.matches[0].id, 'SMP-001');
});

test('getActiveList falls back to the bundled sample when no DB is configured', async () => {
  const { getActiveList, SAMPLE } = require('../lib/intelligence/sanctions-screening');
  const list = await getActiveList();
  assert.ok(list && Array.isArray(list.entries) && list.entries.length);
  // No DATABASE_URL in tests → the sample, which is explicitly non-authoritative.
  assert.equal(list.authoritative, false);
  assert.equal(list.source, SAMPLE.source);
});
