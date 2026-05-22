const test = require('node:test');
const assert = require('node:assert/strict');

const store = require('../lib/intelligence/sanctions-list-store');
const cron = require('../lib/handlers/cron');

// Tests run with no DATABASE_URL, so the store is unavailable and everything
// degrades to the documented fallbacks — never throws.

test('store: unavailable without DATABASE_URL; loadActiveList → null', async () => {
  assert.equal(store.isAvailable(), false);
  assert.equal(await store.loadActiveList(), null);
  assert.equal(await store.totalCount(), 0);
});

test('store: replaceEntries without a DB reports the reason, does not throw', async () => {
  const res = await store.replaceEntries('OFAC-SDN', [{ name: 'X' }]);
  assert.equal(res.ok, false);
  assert.match(res.reason, /DATABASE_URL/);
});

test('store: listMeta without a DB reports the sample (non-authoritative)', async () => {
  const meta = await store.listMeta();
  assert.equal(meta.authoritative, false);
  assert.equal(meta.source, 'ILLUSTRATIVE-SAMPLE');
  assert.ok(meta.totalCount >= 1); // the bundled sample has entries
  assert.deepEqual(meta.sources, []);
});

// ── cron ingest (fixture text, dry-run → no DB write) ───

const SDN = [
  '1,"ACME LOGISTICS LLC","entity","SDGT","-0-"',
  '2,"PETROV, Ivan","individual","UKRAINE-EO13662","-0-"',
].join('\n');

test('cron: ingestSanctions(dryRun) parses without writing', async () => {
  const r = await cron.ingestSanctions({ source: 'OFAC-SDN', text: SDN, dryRun: true });
  assert.equal(r.ok, true);
  assert.equal(r.dryRun, true);
  assert.equal(r.parsed, 2);
});

test('cron: ingestSanctions caps at maxEntries', async () => {
  const r = await cron.ingestSanctions({ text: SDN, dryRun: true, maxEntries: 1 });
  assert.equal(r.parsed, 2);
  assert.equal(r.capped, 1);
});

test('cron: ingestSanctions supports the simple CSV format', async () => {
  const simple = 'name,type\nGlobex Corporation,entity\nJane Roe,individual';
  const r = await cron.ingestSanctions({ source: 'EU-CFSP', text: simple, format: 'simple', dryRun: true });
  assert.equal(r.parsed, 2);
});

test('cron: ingestSanctions without a DB (non-dry) reports reason', async () => {
  const r = await cron.ingestSanctions({ text: SDN, dryRun: false });
  assert.equal(r.ok, false);
  assert.match(r.reason, /DATABASE_URL/);
});

test('cron: runSanctionsRefresh guards on no DB before any fetch', async () => {
  const r = await cron.runSanctionsRefresh({ dryRun: false });
  assert.equal(r.ok, false);
  assert.match(r.reason, /DATABASE_URL/);
});

test('cron: sanctions-refresh is registered in the dispatch table', () => {
  assert.equal(typeof cron.JOBS['sanctions-refresh'], 'function');
});
