// Preferential-origin page generator tests.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  generateRegimePage,
  generatePivotPage,
  generateIndexPage,
  REGIMES,
  ORIGIN_PIVOTS,
  STRINGS,
} = require('../scripts/generate-preferential-pages');

const ROOT = path.join(__dirname, '..');

// ── Regime pages ──────────────────────────────────────

test('generateRegimePage(EBA, en) produces valid HTML with saving figure', () => {
  const eba = REGIMES.find(r => r.slug === 'eba');
  const page = generateRegimePage(eba, 'en');
  assert.match(page.html, /<!DOCTYPE html>/);
  assert.match(page.html, /<html lang="en">/);
  assert.match(page.html, /Everything But Arms/);
  // EBA on €50K apparel: 12% MFN → 0% = €6,000 saving
  assert.match(page.html, /€6,000/);
  assert.match(page.canonical, /\/guides\/preferential-origin\/eba\/$/);
});

test('regime page in PL has Polish chrome', () => {
  const eba = REGIMES.find(r => r.slug === 'eba');
  const page = generateRegimePage(eba, 'pl');
  assert.match(page.html, /<html lang="pl">/);
  assert.match(page.html, /Strona główna/);
  assert.match(page.html, /ścieżka/);
});

test('regime page in DE has German chrome', () => {
  const eba = REGIMES.find(r => r.slug === 'eba');
  const page = generateRegimePage(eba, 'de');
  assert.match(page.html, /<html lang="de">/);
  assert.match(page.html, /Startseite/);
  assert.match(page.html, /Präferenz/);
});

test('regime page mentions required document', () => {
  for (const r of REGIMES) {
    const page = generateRegimePage(r, 'en');
    // Each regime mentions its document in the body
    assert.ok(page.html.includes(r.document), `${r.slug} mentions document`);
  }
});

test('regime page CTA links into wizard with claimPreferential pre-set', () => {
  const evfta = REGIMES.find(r => r.slug === 'evfta');
  const page = generateRegimePage(evfta, 'en');
  assert.match(page.html, /href="\/start\/\?p=/);
});

test('regime page in PL CTA links into PL wizard', () => {
  const evfta = REGIMES.find(r => r.slug === 'evfta');
  const page = generateRegimePage(evfta, 'pl');
  assert.match(page.html, /href="\/pl\/start\/\?p=/);
});

test('regime page has 4-way hreflang', () => {
  const eba = REGIMES.find(r => r.slug === 'eba');
  const page = generateRegimePage(eba, 'en');
  assert.match(page.html, /hreflang="en"/);
  assert.match(page.html, /hreflang="pl"/);
  assert.match(page.html, /hreflang="de"/);
  assert.match(page.html, /hreflang="x-default"/);
});

test('regime page includes JSON-LD with GovernmentService + BreadcrumbList', () => {
  const evfta = REGIMES.find(r => r.slug === 'evfta');
  const page = generateRegimePage(evfta, 'en');
  assert.match(page.html, /"@type":"GovernmentService"/);
  assert.match(page.html, /"@type":"BreadcrumbList"/);
});

test('regime page warns about trade-defence override', () => {
  const atr = REGIMES.find(r => r.slug === 'atr');
  const page = generateRegimePage(atr, 'en');
  assert.match(page.html, /trade.defence|Antidump|anti-dumping/i);
});

test('regime page warns "no document = no preferential rate"', () => {
  const eba = REGIMES.find(r => r.slug === 'eba');
  const page = generateRegimePage(eba, 'en');
  assert.match(page.html, /no document|no preferential/i);
});

// ── Pivot pages ───────────────────────────────────────

test('generatePivotPage(BD) renders Bangladesh + EBA framing', () => {
  const pivot = ORIGIN_PIVOTS.find(p => p.code === 'BD');
  const page = generatePivotPage(pivot, 'en');
  assert.match(page.html, /Bangladesh/);
  assert.match(page.html, /EBA|Everything But Arms/);
  assert.match(page.canonical, /from-bd/);
});

test('pivot page in PL uses Polish origin name', () => {
  const pivot = ORIGIN_PIVOTS.find(p => p.code === 'TR');
  const page = generatePivotPage(pivot, 'pl');
  // PL name for TR is "Turcja"
  assert.match(page.html, /Turcj/);
});

test('pivot page in DE uses German origin name', () => {
  const pivot = ORIGIN_PIVOTS.find(p => p.code === 'KR');
  const page = generatePivotPage(pivot, 'de');
  assert.match(page.html, /Südkorea/);
});

// ── Index page ────────────────────────────────────────

test('index page lists all regimes + all pivots', () => {
  const idx = generateIndexPage('en');
  for (const r of REGIMES) {
    assert.ok(idx.html.includes(r.name), `index lists ${r.name}`);
  }
  for (const p of ORIGIN_PIVOTS) {
    const name = { BD: 'Bangladesh', VN: 'Vietnam', KR: 'South Korea', JP: 'Japan', TR: 'Türkiye', IN: 'India', PK: 'Pakistan' }[p.code];
    assert.ok(idx.html.includes(name), `index lists ${name}`);
  }
});

// ── Disk presence ─────────────────────────────────────

test('every generated page exists on disk', () => {
  for (const locale of ['en', 'pl', 'de']) {
    const localePrefix = locale === 'en' ? '' : `${locale}/`;
    for (const r of REGIMES) {
      const file = path.join(ROOT, `${localePrefix}guides/preferential-origin/${r.slug}/index.html`);
      assert.ok(fs.existsSync(file), `${file} missing`);
    }
    for (const p of ORIGIN_PIVOTS) {
      const file = path.join(ROOT, `${localePrefix}guides/preferential-origin/from-${p.code.toLowerCase()}/index.html`);
      assert.ok(fs.existsSync(file), `${file} missing`);
    }
    const idxFile = path.join(ROOT, `${localePrefix}guides/preferential-origin/index.html`);
    assert.ok(fs.existsSync(idxFile), `${idxFile} missing`);
  }
});

test('master sitemap includes preferential-origin URLs', () => {
  const sitemap = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
  assert.match(sitemap, /\/guides\/preferential-origin\/eba\//);
  assert.match(sitemap, /\/pl\/guides\/preferential-origin\/from-bd\//);
  assert.match(sitemap, /\/de\/guides\/preferential-origin\/from-vn\//);
});

// ── i18n parity ───────────────────────────────────────

test('STRINGS provides en, pl, de blocks', () => {
  for (const lang of ['en', 'pl', 'de']) assert.ok(STRINGS[lang], `${lang} present`);
});

test('i18n key parity: every key in en exists in pl and de', () => {
  const enKeys = Object.keys(STRINGS.en);
  for (const lang of ['pl', 'de']) {
    for (const k of enKeys) {
      assert.ok(STRINGS[lang][k] !== undefined, `${lang} missing key: ${k}`);
    }
  }
});

// ── Catalogue ─────────────────────────────────────────

test('REGIMES covers EBA, GSP+, GSP standard, EVFTA, EUKFTA, EUJEPA, ATR', () => {
  const codes = REGIMES.map(r => r.code).sort();
  for (const expected of ['ATR', 'EBA', 'EUJEPA', 'EUKFTA', 'EVFTA', 'GSP_PLUS', 'GSP_STANDARD']) {
    assert.ok(codes.includes(expected), `${expected} catalogued`);
  }
});

test('ORIGIN_PIVOTS includes BD/VN/KR/JP/TR/IN/PK', () => {
  const codes = ORIGIN_PIVOTS.map(p => p.code).sort();
  assert.deepEqual(codes, ['BD', 'IN', 'JP', 'KR', 'PK', 'TR', 'VN']);
});
