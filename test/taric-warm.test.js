'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const cron = require('../lib/handlers/cron');
const kv = require('../lib/intelligence/kv-store');
const taric = require('../lib/intelligence/taric-client');
const { WARM_LIST } = require('../lib/intelligence/data/taric-warm-list');

// All these tests run with ORCATRADE_DISABLE_LIVE_TARIC=1 (set by npm test).
// That means real upstream fetches return null. Each scenario manipulates
// the KV cache directly to simulate the states the warmer will encounter
// in prod, and asserts the bookkeeping is correct.

test.beforeEach(() => {
  kv._resetMemoryStore();
});

// ── WARM_LIST shape contract ──────────────────────────────────────────

test('WARM_LIST has 25+ entries with well-formed HS codes + ISO origins', () => {
  assert.ok(WARM_LIST.length >= 25, `expected ≥25 entries, got ${WARM_LIST.length}`);
  for (const entry of WARM_LIST) {
    assert.ok(/^\d{6,10}$/.test(entry.hs), `bad hs: ${entry.hs}`);
    assert.ok(/^[A-Z]{2}$/.test(entry.origin), `bad origin: ${entry.origin}`);
    assert.ok(entry.label && entry.label.length > 3, `bad label: ${entry.label}`);
  }
});

test('WARM_LIST covers all eight wizard categories at least once', () => {
  // Map first-2-digit HS chapter to the category it serves.
  const chapters = new Set(WARM_LIST.map(e => e.hs.slice(0, 2)));
  // Apparel (61/62), Electronics (85), Furniture (94), Toys (95),
  // Cosmetics (33), Homeware (69/70/73), Footwear (64), Machinery (84).
  const requiredChapters = ['33', '64', '69', '85', '94', '95', '84'];
  for (const ch of requiredChapters) {
    assert.ok(
      Array.from(chapters).some(c => c === ch),
      `missing chapter ${ch}`
    );
  }
  // Apparel can be either 61 or 62
  assert.ok(chapters.has('61') || chapters.has('62'), 'missing apparel chapter');
});

// ── runTaricWarm: behaviour ───────────────────────────────────────────

test('runTaricWarm with dryRun=true never writes to KV', async () => {
  const before = (await kv.listKeys('taric:rate:')).length;
  const r = await cron.runTaricWarm({ dryRun: true, max: 5 });
  assert.equal(r.ok, true);
  assert.equal(r.dryRun, true);
  assert.equal(r.attempted, 5);
  assert.equal(r.written, 0);
  const after = (await kv.listKeys('taric:rate:')).length;
  assert.equal(after, before);
});

test('runTaricWarm counts already-fresh cache entries as unchanged', async () => {
  // Seed two entries from the WARM_LIST so they look fresh.
  const seeded = WARM_LIST.slice(0, 2);
  for (const entry of seeded) {
    await kv.setJson(taric._cacheKey(entry.hs, entry.origin), {
      rate: 0.10,
      source: 'uk-trade-tariff',
      sourceLabel: 'UK Trade Tariff',
      asOf: '2026-05-01',
      savedAt: Math.floor(Date.now() / 1000),  // fresh
    }, 60 * 60);
  }

  const r = await cron.runTaricWarm({ max: 3 });
  assert.equal(r.attempted, 3);
  assert.equal(r.unchanged, 2);
  // The third one had no cache; upstream is killed by env var so it
  // counts as miss, not as a successful fetch.
  assert.equal(r.miss, 1);
  assert.equal(r.hit, 0);
});

test('runTaricWarm reports failures with status=upstream-failed when upstream is dead', async () => {
  const r = await cron.runTaricWarm({ max: 4 });
  // All 4 have empty cache; upstream is killed → all 4 should be misses.
  assert.equal(r.miss, 4);
  assert.equal(r.hit, 0);
  for (const d of r.details) {
    // Either upstream-failed or already-fresh — never "fetched" since
    // upstream is killed in tests.
    assert.ok(d.status === 'upstream-failed' || d.status === 'already-fresh');
  }
});

test('runTaricWarm summary fields all populate', async () => {
  const r = await cron.runTaricWarm({ max: 3 });
  assert.equal(typeof r.attempted, 'number');
  assert.equal(typeof r.hit, 'number');
  assert.equal(typeof r.miss, 'number');
  assert.equal(typeof r.cached, 'number');
  assert.equal(typeof r.unchanged, 'number');
  assert.equal(typeof r.written, 'number');
  assert.ok(r.durationMs >= 0);
  assert.equal(r.details.length, 3);
  for (const d of r.details) {
    assert.equal(typeof d.hs, 'string');
    assert.equal(typeof d.origin, 'string');
    assert.equal(typeof d.status, 'string');
    assert.equal(typeof d.durationMs, 'number');
  }
});

test('runTaricWarm walks the entire WARM_LIST by default (no max)', async () => {
  const r = await cron.runTaricWarm({});
  assert.equal(r.attempted, WARM_LIST.length);
});

// ── Dispatcher wiring ────────────────────────────────────────────────

test("cron dispatcher exposes 'taric-warm' alongside the other jobs", () => {
  assert.ok(cron.JOBS['taric-warm']);
  assert.equal(typeof cron.JOBS['taric-warm'], 'function');
});

test('runTaricWarm is exported on the cron module', () => {
  assert.equal(typeof cron.runTaricWarm, 'function');
});
