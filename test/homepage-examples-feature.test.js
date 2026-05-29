// Sprint AA — homepage examples-feature section tests.
// Verifies the worked-examples block is present on EN/PL/DE homepages with
// the right links, tags, and headlines.
//
// 2026-05-30 marketing-shell migration retired the static root index.html
// (commit 2c21a9d0). The EN entry is filtered out below if the file is
// missing, and three EN-specific assertions further down are skipped with
// the same marker. Coverage of the examples-feature block on the
// marketing-shell-rendered root is tracked under Phase 1 of
// docs/execution-plan.md. PL and DE locale homepages remain static and
// fully covered.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

const ALL_HOMEPAGES = [
  { locale: 'en', file: 'index.html', wizardHref: 'start/', allLink: 'examples/' },
  { locale: 'pl', file: 'pl/index.html', wizardHref: 'start/', allLink: 'examples/' },
  { locale: 'de', file: 'de/index.html', wizardHref: 'start/', allLink: 'examples/' },
];
const HOMEPAGES = ALL_HOMEPAGES.filter(hp => fs.existsSync(path.join(ROOT, hp.file)));
const SKIP_MARKETING_SHELL = { skip: 'marketing-shell migration: root index.html retired; coverage moved to Phase 1' };

const FEATURED_SLUGS = [
  'chinese-ebike-importer-87pct-combined-ad-cvd',
  'bangladesh-apparel-eba-zero-duty',
  'turkey-cold-rolled-steel-atr-with-ad',
];

for (const hp of HOMEPAGES) {
  test(`${hp.locale} homepage contains examples-feature section`, () => {
    const html = fs.readFileSync(path.join(ROOT, hp.file), 'utf8');
    assert.match(html, /id="examples-feature"/);
    assert.match(html, /class="examples-grid"/);
    assert.match(html, /examples-all-link/);
  });

  test(`${hp.locale} homepage links to all 3 featured example slugs`, () => {
    const html = fs.readFileSync(path.join(ROOT, hp.file), 'utf8');
    for (const slug of FEATURED_SLUGS) {
      assert.match(
        html,
        new RegExp(`href="examples/${slug}/"`),
        `${hp.locale} homepage should link to ${slug}`,
      );
    }
  });

  test(`${hp.locale} homepage has "See all examples" footer link`, () => {
    const html = fs.readFileSync(path.join(ROOT, hp.file), 'utf8');
    assert.match(html, new RegExp(`href="${hp.allLink}"[^>]*examples-all-link|examples-all-link[^>]*href="${hp.allLink}"`));
  });

  test(`${hp.locale} homepage hero CTA promotes /start/`, () => {
    const html = fs.readFileSync(path.join(ROOT, hp.file), 'utf8');
    assert.match(html, /class="btn btn-primary" href="start\/"/);
  });
}

test('EN homepage section title mentions "Three real scenarios"', SKIP_MARKETING_SHELL, () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.match(html, /Three real scenarios/);
});

test('PL homepage section title is in Polish ("Trzy realne scenariusze")', () => {
  const html = fs.readFileSync(path.join(ROOT, 'pl/index.html'), 'utf8');
  assert.match(html, /Trzy realne scenariusze/);
});

test('DE homepage section title is in German ("Drei reale Szenarien")', () => {
  const html = fs.readFileSync(path.join(ROOT, 'de/index.html'), 'utf8');
  assert.match(html, /Drei reale Szenarien/);
});

test('EN homepage e-bike card mentions €97,300', SKIP_MARKETING_SHELL, () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.match(html, /€97,300/);
});

test('PL homepage e-bike card mentions €97 300 (Polish thousands separator)', () => {
  const html = fs.readFileSync(path.join(ROOT, 'pl/index.html'), 'utf8');
  assert.match(html, /€97 300/);
});

test('DE homepage e-bike card mentions €97.300 (German thousands separator)', () => {
  const html = fs.readFileSync(path.join(ROOT, 'de/index.html'), 'utf8');
  assert.match(html, /€97\.300/);
});
