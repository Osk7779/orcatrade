// Sprint AB — homepage example shuffler tests.
// All 6 example cards remain in the static HTML (so search engines see the
// full pool); inline JS hides 3 randomly per page load. Tests verify pool
// integrity, all 6 example slugs are linked, and the shuffle script is
// present + correctly-shaped.
//
// 2026-05-30 marketing-shell migration retired the static root index.html
// (commit 2c21a9d0). The EN entry is filtered out below if the file is
// missing, and the EN-only defensive-bail test further down is skipped.
// Coverage of the shuffler on the marketing-shell-rendered root is
// tracked under Phase 1 of docs/execution-plan.md. PL and DE locale
// homepages remain static and fully covered.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

const ALL_HOMEPAGES = [
  { locale: 'en', file: 'index.html' },
  { locale: 'pl', file: 'pl/index.html' },
  { locale: 'de', file: 'de/index.html' },
];
const HOMEPAGES = ALL_HOMEPAGES.filter(hp => fs.existsSync(path.join(ROOT, hp.file)));
const SKIP_MARKETING_SHELL = { skip: 'marketing-shell migration: root index.html retired; coverage moved to Phase 1' };

const POOL_SLUGS = [
  'chinese-ebike-importer-87pct-combined-ad-cvd',
  'bangladesh-apparel-eba-zero-duty',
  'turkey-cold-rolled-steel-atr-with-ad',
  'vietnam-electronics-evfta-zero-duty',
  'cn-aluminium-cbam-plus-32pct-ad',
  'cosmetics-india-reach-cosmetics-regulation',
];

for (const hp of HOMEPAGES) {
  test(`${hp.locale} homepage carries 6 example cards in the pool`, () => {
    const html = fs.readFileSync(path.join(ROOT, hp.file), 'utf8');
    // Count distinct example-card anchors inside the data-shuffle-pool grid
    const poolMatch = html.match(/<div class="examples-grid" data-shuffle-pool>([\s\S]*?)<\/div>\s*<div class="examples-footer">/);
    assert.ok(poolMatch, `${hp.locale}: shuffle-pool found`);
    const cards = poolMatch[1].match(/<a class="example-card"/g);
    assert.equal(cards.length, 6, `${hp.locale}: expected 6 cards in pool, got ${cards?.length || 0}`);
  });

  test(`${hp.locale} homepage links to all 6 pool slugs`, () => {
    const html = fs.readFileSync(path.join(ROOT, hp.file), 'utf8');
    for (const slug of POOL_SLUGS) {
      assert.match(
        html,
        new RegExp(`href="examples/${slug}/"`),
        `${hp.locale}: should link to ${slug}`,
      );
    }
  });

  test(`${hp.locale} homepage carries the shuffle script`, () => {
    const html = fs.readFileSync(path.join(ROOT, hp.file), 'utf8');
    assert.match(html, /shuffleExampleCards/);
    assert.match(html, /\[data-shuffle-pool\]/);
    // Fisher-Yates shuffle pattern
    assert.match(html, /Math\.floor\(Math\.random\(\) \* \(i \+ 1\)\)/);
    // Hide-after-3 logic
    assert.match(html, /idx < 3 \? '' : 'none'/);
  });

  test(`${hp.locale} shuffle script is gated on data-shuffle-pool presence`, () => {
    // If the pool attribute disappears (e.g. someone removes the cards),
    // the script should no-op rather than throw.
    const html = fs.readFileSync(path.join(ROOT, hp.file), 'utf8');
    assert.match(html, /var pool = document\.querySelector\('\[data-shuffle-pool\]'\);[\s\S]*?if \(!pool\) return;/);
  });
}

test('shuffle script bails out when ≤3 cards in pool (defensive)', SKIP_MARKETING_SHELL, () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.match(html, /if \(cards\.length <= 3\) return/);
});
