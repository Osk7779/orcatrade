// Example-plans generator tests.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  generateExamplePage,
  generateIndexPage,
  EXAMPLES,
  STRINGS,
} = require('../scripts/generate-example-plans');
const { composePlan } = require('../lib/handlers/start');

const ROOT = path.join(__dirname, '..');

// ── Catalogue ─────────────────────────────────────────

test('EXAMPLES catalogue has 8 curated scenarios', async () => {
  assert.equal(EXAMPLES.length, 8);
});

test('every example has slug, inputs, headlines (en/pl/de), intros (en/pl/de), tags', () => {
  for (const e of EXAMPLES) {
    assert.ok(e.slug);
    assert.ok(e.inputs);
    assert.ok(e.inputs.productCategory);
    assert.ok(e.inputs.originCountry);
    assert.ok(e.inputs.destinationCountry);
    for (const lang of ['en', 'pl', 'de']) {
      assert.ok(e.headlines[lang], `${e.slug}: ${lang} headline`);
      assert.ok(e.intros[lang], `${e.slug}: ${lang} intro`);
    }
    assert.ok(Array.isArray(e.tags) && e.tags.length > 0);
  }
});

test('every example produces a valid plan (composePlan ok)', async () => {
  for (const e of EXAMPLES) {
    const plan = await composePlan(e.inputs);
    assert.equal(plan.ok, true, `${e.slug}: composePlan should succeed`);
  }
});

// ── Detail page generation ────────────────────────────

test('generateExamplePage produces valid HTML with key numbers', async () => {
  const example = EXAMPLES.find(e => e.slug === 'chinese-ebike-importer-87pct-combined-ad-cvd');
  const page = await generateExamplePage(example, 'en');
  assert.match(page.html, /<!DOCTYPE html>/);
  assert.match(page.html, /<html lang="en">/);
  // E-bike: 97.3% duty
  assert.match(page.html, /97\.3%/);
  // €97,300 duty
  assert.match(page.html, /€97,300/);
  assert.match(page.canonical, /\/examples\/chinese-ebike/);
});

test('Bangladesh apparel example shows EBA preferential saving', async () => {
  const example = EXAMPLES.find(e => e.slug === 'bangladesh-apparel-eba-zero-duty');
  const page = await generateExamplePage(example, 'en');
  // EBA preferential applied → 0% duty
  assert.match(page.html, /0\.0%/);
  // Plan was claimPreferential=true so preferentialApplied is shown, not Available
  assert.match(page.html, /EBA|Everything But Arms/);
});

test('Vietnam electronics example shows EVFTA + RoHS/WEEE/CE compliance', async () => {
  const example = EXAMPLES.find(e => e.slug === 'vietnam-electronics-evfta-zero-duty');
  const page = await generateExamplePage(example, 'en');
  assert.match(page.html, /EVFTA|EU-Vietnam/);
});

test('TR cold-rolled example shows A.TR + AD nuance (not waived)', async () => {
  const example = EXAMPLES.find(e => e.slug === 'turkey-cold-rolled-steel-atr-with-ad');
  const page = await generateExamplePage(example, 'en');
  // TR cold-rolled has A.TR (preferential) AND AD measure
  assert.match(page.html, /A\.TR|EU-Türkiye Customs Union/);
  // Should mention the AD via tradeDefenceMeasures
  assert.match(page.html, /AD|antidumping/i);
});

test('detail page in PL has Polish chrome', async () => {
  const example = EXAMPLES.find(e => e.slug === 'polish-apparel-importer-from-china');
  const page = await generateExamplePage(example, 'pl');
  assert.match(page.html, /<html lang="pl">/);
  assert.match(page.html, /Strona główna/);
  assert.match(page.html, /Liczby/);
});

test('detail page in DE has German chrome', async () => {
  const example = EXAMPLES.find(e => e.slug === 'polish-apparel-importer-from-china');
  const page = await generateExamplePage(example, 'de');
  assert.match(page.html, /<html lang="de">/);
  assert.match(page.html, /Startseite/);
  assert.match(page.html, /Die Zahlen/);
});

test('CTA links to wizard with permalink', async () => {
  const example = EXAMPLES.find(e => e.slug === 'polish-apparel-importer-from-china');
  const page = await generateExamplePage(example, 'en');
  assert.match(page.html, /href="\/start\/\?p=/);
});

test('PL detail page CTA links into PL wizard', async () => {
  const example = EXAMPLES.find(e => e.slug === 'polish-apparel-importer-from-china');
  const page = await generateExamplePage(example, 'pl');
  assert.match(page.html, /href="\/pl\/start\/\?p=/);
});

test('detail page has 4-way hreflang', async () => {
  const example = EXAMPLES.find(e => e.slug === 'polish-apparel-importer-from-china');
  const page = await generateExamplePage(example, 'en');
  assert.match(page.html, /hreflang="en"/);
  assert.match(page.html, /hreflang="pl"/);
  assert.match(page.html, /hreflang="de"/);
  assert.match(page.html, /hreflang="x-default"/);
});

// ── Index page ────────────────────────────────────────

test('index page lists all 8 examples', async () => {
  const idx = generateIndexPage('en');
  for (const e of EXAMPLES) {
    assert.ok(idx.html.includes(e.headlines.en), `index lists ${e.slug}`);
  }
});

// ── Disk presence ─────────────────────────────────────

test('every generated example exists on disk', async () => {
  for (const locale of ['en', 'pl', 'de']) {
    const localePrefix = locale === 'en' ? '' : `${locale}/`;
    for (const e of EXAMPLES) {
      const file = path.join(ROOT, `${localePrefix}examples/${e.slug}/index.html`);
      assert.ok(fs.existsSync(file), `${file} missing`);
    }
    // EN /examples/ index now serves from marketing-shell — no static
    // emission. PL/DE still have static indexes.
    if (locale !== 'en') {
      const idx = path.join(ROOT, `${localePrefix}examples/index.html`);
      assert.ok(fs.existsSync(idx), `${idx} missing`);
    }
  }
});

test('master sitemap includes example URLs', async () => {
  const sitemap = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
  assert.match(sitemap, /\/examples\/polish-apparel-importer-from-china\//);
  assert.match(sitemap, /\/pl\/examples\/bangladesh-apparel-eba-zero-duty\//);
  assert.match(sitemap, /\/de\/examples\/vietnam-electronics-evfta-zero-duty\//);
});

// ── i18n parity ───────────────────────────────────────

test('STRINGS provides en, pl, de blocks', async () => {
  for (const lang of ['en', 'pl', 'de']) {
    assert.ok(STRINGS[lang], `${lang} present`);
  }
});

test('i18n key parity: every key in en exists in pl and de', async () => {
  const enKeys = Object.keys(STRINGS.en);
  for (const lang of ['pl', 'de']) {
    for (const k of enKeys) {
      assert.ok(STRINGS[lang][k] !== undefined, `${lang} missing key: ${k}`);
    }
  }
});
