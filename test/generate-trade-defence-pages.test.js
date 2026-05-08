// Trade-defence page generator tests.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const tradeDefence = require('../lib/intelligence/data/eu-trade-defence');
const { generateDetailPage, generateIndexPage, STRINGS } = require('../scripts/generate-trade-defence-pages');

const ROOT = path.join(__dirname, '..');

// ── Page generation ────────────────────────────────────

test('generateDetailPage produces valid HTML for CN bicycles in EN', () => {
  const measure = tradeDefence.MEASURES.find(m => m.id === 'CN_BICYCLES');
  const page = generateDetailPage(measure, 'en');
  assert.match(page.html, /<!DOCTYPE html>/);
  assert.match(page.html, /<html lang="en">/);
  assert.match(page.html, /<title>.*Anti-dumping.*bicycles.*48\.5%/);
  assert.match(page.canonical, /\/guides\/trade-defence\/cn-bicycles\/$/);
  assert.match(page.relPath, /^guides\/trade-defence\/cn-bicycles\/index\.html$/);
});

test('detail page in PL has Polish chrome', () => {
  const measure = tradeDefence.MEASURES.find(m => m.id === 'CN_BICYCLES');
  const page = generateDetailPage(measure, 'pl');
  assert.match(page.html, /<html lang="pl">/);
  assert.match(page.html, /antydumpingowe/);
  assert.match(page.html, /Strona główna/);
});

test('detail page in DE has German chrome', () => {
  const measure = tradeDefence.MEASURES.find(m => m.id === 'CN_BICYCLES');
  const page = generateDetailPage(measure, 'de');
  assert.match(page.html, /<html lang="de">/);
  assert.match(page.html, /Antidumping/);
  assert.match(page.html, /Startseite/);
});

test('detail page contains EU regulation citation', () => {
  const measure = tradeDefence.MEASURES.find(m => m.id === 'CN_BICYCLES');
  const page = generateDetailPage(measure, 'en');
  assert.match(page.html, /Reg\. \(EU\) 2019\/1379/);
});

test('detail page contains worked example with realistic landed cost', () => {
  // CN bicycles: chapter 87 MFN 10% + AD 48.5% = 58.5%, on €50K customs value
  const measure = tradeDefence.MEASURES.find(m => m.id === 'CN_BICYCLES');
  const page = generateDetailPage(measure, 'en');
  // Duty on €50K at 58.5% = €29,250
  assert.match(page.html, /€29,250/);
});

test('detail page CTA links into the wizard with HS code pre-loaded', () => {
  const measure = tradeDefence.MEASURES.find(m => m.id === 'CN_BICYCLES');
  const page = generateDetailPage(measure, 'en');
  assert.match(page.html, /href="\/start\/\?p=/);
});

test('PL detail page CTA links into PL wizard', () => {
  const measure = tradeDefence.MEASURES.find(m => m.id === 'CN_BICYCLES');
  const page = generateDetailPage(measure, 'pl');
  assert.match(page.html, /href="\/pl\/start\/\?p=/);
});

test('detail page includes JSON-LD with Legislation type', () => {
  const measure = tradeDefence.MEASURES.find(m => m.id === 'CN_BICYCLES');
  const page = generateDetailPage(measure, 'en');
  assert.match(page.html, /"@type":"Legislation"/);
  assert.match(page.html, /"@type":"BreadcrumbList"/);
});

test('detail page has 4-way hreflang (en/pl/de/x-default)', () => {
  const measure = tradeDefence.MEASURES.find(m => m.id === 'CN_BICYCLES');
  const page = generateDetailPage(measure, 'en');
  assert.match(page.html, /hreflang="en"/);
  assert.match(page.html, /hreflang="pl"/);
  assert.match(page.html, /hreflang="de"/);
  assert.match(page.html, /hreflang="x-default"/);
});

test('AD+CVD measure (e-bikes) renders correct headline', () => {
  const measure = tradeDefence.MEASURES.find(m => m.id === 'CN_E_BIKES_AD');
  const page = generateDetailPage(measure, 'en');
  assert.match(page.html, /Anti-dumping duty/);
  assert.match(page.html, /Reg\. \(EU\) 2019\/73/);
});

test('CVD measure (BEV cars) renders correct CVD headline', () => {
  const measure = tradeDefence.MEASURES.find(m => m.id === 'CN_BEV_PASSENGER_CARS');
  const page = generateDetailPage(measure, 'en');
  assert.match(page.html, /Countervailing duty/);
  assert.match(page.html, /Reg\. \(EU\) 2024\/2754/);
});

// ── Index page ────────────────────────────────────────

test('index page lists all measures', () => {
  const idx = generateIndexPage('en');
  assert.match(idx.html, /Active EU trade defence measures/);
  // Should mention every regulation cited in the dataset
  for (const m of tradeDefence.MEASURES) {
    const escaped = m.citation.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.ok(idx.html.includes(m.citation), `index lists ${m.citation}`);
  }
});

test('index page in PL has Polish chrome and links to PL detail pages', () => {
  const idx = generateIndexPage('pl');
  assert.match(idx.html, /<html lang="pl">/);
  assert.match(idx.html, /href="\/pl\/guides\/trade-defence\/cn-bicycles\//);
});

// ── Disk presence (sanity after build) ────────────────

test('all generated detail pages exist on disk', () => {
  for (const locale of ['en', 'pl', 'de']) {
    const localePrefix = locale === 'en' ? '' : `${locale}/`;
    for (const m of tradeDefence.MEASURES) {
      const slug = m.id.toLowerCase().replace(/_/g, '-').replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '');
      const file = path.join(ROOT, `${localePrefix}guides/trade-defence/${slug}/index.html`);
      assert.ok(fs.existsSync(file), `${file} missing`);
    }
    const indexFile = path.join(ROOT, `${localePrefix}guides/trade-defence/index.html`);
    assert.ok(fs.existsSync(indexFile), `${indexFile} missing`);
  }
});

test('master sitemap.xml includes trade-defence URLs', () => {
  const sitemap = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
  assert.match(sitemap, /\/guides\/trade-defence\/cn-bicycles\//);
  assert.match(sitemap, /\/pl\/guides\/trade-defence\/cn-bicycles\//);
  assert.match(sitemap, /\/de\/guides\/trade-defence\/cn-bicycles\//);
});

// ── i18n parity ───────────────────────────────────────

test('STRINGS provides en, pl, de blocks', () => {
  assert.ok(STRINGS.en);
  assert.ok(STRINGS.pl);
  assert.ok(STRINGS.de);
});

test('every locale provides a titleAd, titleCvd, titleBoth', () => {
  for (const locale of ['en', 'pl', 'de']) {
    for (const fn of ['titleAd', 'titleCvd', 'titleBoth']) {
      assert.equal(typeof STRINGS[locale][fn], 'function', `${locale}.${fn} is a function`);
    }
  }
});

test('i18n key parity: every key in en exists in pl and de', () => {
  const enKeys = Object.keys(STRINGS.en);
  for (const lang of ['pl', 'de']) {
    for (const k of enKeys) {
      assert.ok(STRINGS[lang][k] !== undefined, `${lang} missing key: ${k}`);
    }
  }
});
