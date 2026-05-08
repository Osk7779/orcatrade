// Compliance page generator tests.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const compliance = require('../lib/intelligence/data/eu-compliance');
const { generateDetailPage, generateIndexPage, STRINGS } = require('../scripts/generate-compliance-pages');

const ROOT = path.join(__dirname, '..');

// ── Detail page generation ─────────────────────────────

test('generateDetailPage(CBAM, en) produces valid HTML with citation', () => {
  const cbam = compliance.REGIMES.find(r => r.id === 'CBAM');
  const page = generateDetailPage(cbam, 'en');
  assert.match(page.html, /<!DOCTYPE html>/);
  assert.match(page.html, /<html lang="en">/);
  assert.match(page.html, /Carbon Border Adjustment Mechanism/);
  assert.match(page.html, /CBAM declarant/);
  assert.match(page.canonical, /\/guides\/compliance\/cbam\/$/);
});

test('detail page in PL has Polish chrome', () => {
  const eudr = compliance.REGIMES.find(r => r.id === 'EUDR');
  const page = generateDetailPage(eudr, 'pl');
  assert.match(page.html, /<html lang="pl">/);
  assert.match(page.html, /obowiązki importera/);
  assert.match(page.html, /Strona główna/);
});

test('detail page in DE has German chrome', () => {
  const reach = compliance.REGIMES.find(r => r.id === 'REACH');
  const page = generateDetailPage(reach, 'de');
  assert.match(page.html, /<html lang="de">/);
  assert.match(page.html, /Importeur-Pflichten/);
  assert.match(page.html, /Startseite/);
});

test('detail page contains importer obligation text', () => {
  for (const r of compliance.REGIMES) {
    const page = generateDetailPage(r, 'en');
    // Each page should include the regime's actual obligation
    const obligationStart = r.importerObligation.slice(0, 60);
    const escaped = obligationStart
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
    assert.ok(
      page.html.includes(escaped),
      `${r.id}: obligation text missing from page`,
    );
  }
});

test('detail page CTA links into wizard with HS code pre-loaded', () => {
  const cbam = compliance.REGIMES.find(r => r.id === 'CBAM');
  const page = generateDetailPage(cbam, 'en');
  assert.match(page.html, /href="\/start\/\?p=/);
});

test('PL detail page CTA links into PL wizard', () => {
  const cbam = compliance.REGIMES.find(r => r.id === 'CBAM');
  const page = generateDetailPage(cbam, 'pl');
  assert.match(page.html, /href="\/pl\/start\/\?p=/);
});

test('detail page has 4-way hreflang', () => {
  const cbam = compliance.REGIMES.find(r => r.id === 'CBAM');
  const page = generateDetailPage(cbam, 'en');
  assert.match(page.html, /hreflang="en"/);
  assert.match(page.html, /hreflang="pl"/);
  assert.match(page.html, /hreflang="de"/);
  assert.match(page.html, /hreflang="x-default"/);
});

test('detail page includes JSON-LD with Legislation + BreadcrumbList', () => {
  const reach = compliance.REGIMES.find(r => r.id === 'REACH');
  const page = generateDetailPage(reach, 'en');
  assert.match(page.html, /"@type":"Legislation"/);
  assert.match(page.html, /"@type":"BreadcrumbList"/);
});

test('detail page severity badge matches regime severity', () => {
  const cbam = compliance.REGIMES.find(r => r.id === 'CBAM'); // high
  const page = generateDetailPage(cbam, 'en');
  assert.match(page.html, /sev-high/);

  const ppwr = compliance.REGIMES.find(r => r.id === 'PPWR'); // low
  const ppwrPage = generateDetailPage(ppwr, 'en');
  assert.match(ppwrPage.html, /sev-low/);
});

test('detail page warns "non-compliance is a market-access event"', () => {
  const cbam = compliance.REGIMES.find(r => r.id === 'CBAM');
  const page = generateDetailPage(cbam, 'en');
  assert.match(page.html, /market.access|forced re-export|customs.*hold/i);
});

test('detail page links to deeper guide via related-callout', () => {
  const cbam = compliance.REGIMES.find(r => r.id === 'CBAM');
  const page = generateDetailPage(cbam, 'en');
  assert.match(page.html, new RegExp(`href="${cbam.deeperGuide}"`));
});

// ── Index page ────────────────────────────────────────

test('index page lists every regime', () => {
  const idx = generateIndexPage('en');
  for (const r of compliance.REGIMES) {
    assert.ok(idx.html.includes(r.name), `index lists ${r.name}`);
  }
});

test('index page in PL has Polish chrome and links to PL detail pages', () => {
  const idx = generateIndexPage('pl');
  assert.match(idx.html, /<html lang="pl">/);
  assert.match(idx.html, /href="\/pl\/guides\/compliance\/cbam\//);
});

test('index sorts high severity first', () => {
  const idx = generateIndexPage('en');
  const cbamIdx = idx.html.indexOf('CBAM');
  const ppwrIdx = idx.html.indexOf('PPWR');
  // CBAM is high, PPWR is low — high should appear earlier in the table body
  assert.ok(cbamIdx < ppwrIdx, 'CBAM (high) appears before PPWR (low) in index');
});

// ── Disk presence ─────────────────────────────────────

test('every generated detail page exists on disk', () => {
  for (const locale of ['en', 'pl', 'de']) {
    const localePrefix = locale === 'en' ? '' : `${locale}/`;
    for (const r of compliance.REGIMES) {
      const slug = r.id.toLowerCase().replace(/_/g, '-');
      const file = path.join(ROOT, `${localePrefix}guides/compliance/${slug}/index.html`);
      assert.ok(fs.existsSync(file), `${file} missing`);
    }
    const idx = path.join(ROOT, `${localePrefix}guides/compliance/index.html`);
    assert.ok(fs.existsSync(idx), `${idx} missing`);
  }
});

test('master sitemap includes compliance URLs', () => {
  const sitemap = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
  assert.match(sitemap, /\/guides\/compliance\/cbam\//);
  assert.match(sitemap, /\/pl\/guides\/compliance\/eudr\//);
  assert.match(sitemap, /\/de\/guides\/compliance\/reach\//);
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
