// Sitemap hreflang tests (Sprint R).
// Verifies sitemap.xml + sitemap-guides.xml emit xhtml:link entries for the
// H0 sub-generator pages (trade-defence, preferential-origin, compliance,
// examples) where slugs are stable across locales.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

function readSitemap(filename) {
  return fs.readFileSync(path.join(ROOT, filename), 'utf8');
}

// ── XML namespace + structure ─────────────────────────

test('sitemap.xml declares xmlns:xhtml namespace', () => {
  const sitemap = readSitemap('sitemap.xml');
  assert.match(sitemap, /xmlns:xhtml="http:\/\/www\.w3\.org\/1999\/xhtml"/);
});

test('sitemap-guides.xml declares xmlns:xhtml namespace', () => {
  const sitemap = readSitemap('sitemap-guides.xml');
  assert.match(sitemap, /xmlns:xhtml="http:\/\/www\.w3\.org\/1999\/xhtml"/);
});

test('both sitemaps still open with the standard sitemap.org schema', () => {
  for (const f of ['sitemap.xml', 'sitemap-guides.xml']) {
    assert.match(readSitemap(f), /xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9"/);
  }
});

// ── Trade-defence URLs have hreflang alternates ───────

test('trade-defence URL has 4-way xhtml:link block (en/pl/de/x-default)', () => {
  const sitemap = readSitemap('sitemap.xml');
  // Pull the <url> block containing /guides/trade-defence/cn-bicycles/
  const urlBlock = sitemap.match(/<url>\s*<loc>https:\/\/orcatrade\.pl\/guides\/trade-defence\/cn-bicycles\/<\/loc>[\s\S]*?<\/url>/);
  assert.ok(urlBlock, 'trade-defence cn-bicycles URL block present');
  const block = urlBlock[0];
  for (const lang of ['en', 'pl', 'de', 'x-default']) {
    assert.match(block, new RegExp(`hreflang="${lang}"`), `${lang} hreflang missing`);
  }
});

// ── Preferential-origin URLs have hreflang alternates ──

test('preferential-origin URL has hreflang block', () => {
  const sitemap = readSitemap('sitemap.xml');
  const urlBlock = sitemap.match(/<url>\s*<loc>https:\/\/orcatrade\.pl\/guides\/preferential-origin\/eba\/<\/loc>[\s\S]*?<\/url>/);
  assert.ok(urlBlock, 'preferential EBA URL block present');
  const block = urlBlock[0];
  assert.match(block, /hreflang="en"/);
  assert.match(block, /hreflang="pl"/);
  assert.match(block, /hreflang="de"/);
  assert.match(block, /hreflang="x-default"/);
});

// ── Compliance URLs have hreflang alternates ──────────

test('compliance URL has hreflang block', () => {
  const sitemap = readSitemap('sitemap.xml');
  const urlBlock = sitemap.match(/<url>\s*<loc>https:\/\/orcatrade\.pl\/guides\/compliance\/cbam\/<\/loc>[\s\S]*?<\/url>/);
  assert.ok(urlBlock, 'compliance CBAM URL block present');
  const block = urlBlock[0];
  assert.match(block, /hreflang="en"/);
  assert.match(block, /hreflang="pl"/);
  assert.match(block, /hreflang="de"/);
  assert.match(block, /hreflang="x-default"/);
});

// ── Examples URLs have hreflang alternates ────────────

test('examples URL has hreflang block', () => {
  const sitemap = readSitemap('sitemap.xml');
  const urlBlock = sitemap.match(/<url>\s*<loc>https:\/\/orcatrade\.pl\/examples\/chinese-ebike-importer-87pct-combined-ad-cvd\/<\/loc>[\s\S]*?<\/url>/);
  assert.ok(urlBlock, 'examples e-bike URL block present');
  const block = urlBlock[0];
  assert.match(block, /hreflang="en"/);
  assert.match(block, /hreflang="pl"/);
  assert.match(block, /hreflang="de"/);
});

// ── Both sitemaps include xhtml:link entries ──────────

test('sitemap.xml contains substantial xhtml:link entries', () => {
  const sitemap = readSitemap('sitemap.xml');
  const matches = sitemap.match(/<xhtml:link/g);
  // 4 alternates per URL × ~210 H0/example URLs = ~840
  assert.ok(matches && matches.length >= 800, `expected ≥800 xhtml:link entries, got ${matches?.length || 0}`);
});

test('sitemap-guides.xml contains substantial xhtml:link entries', () => {
  const sitemap = readSitemap('sitemap-guides.xml');
  const matches = sitemap.match(/<xhtml:link/g);
  assert.ok(matches && matches.length >= 800, `expected ≥800 xhtml:link entries, got ${matches?.length || 0}`);
});

// ── x-default fallback to EN canonical ────────────────

test('x-default hreflang points to EN canonical for trade-defence', () => {
  const sitemap = readSitemap('sitemap.xml');
  const block = sitemap.match(/<url>\s*<loc>https:\/\/orcatrade\.pl\/guides\/trade-defence\/cn-bicycles\/<\/loc>[\s\S]*?<\/url>/)[0];
  assert.match(block, /hreflang="x-default" href="https:\/\/orcatrade\.pl\/guides\/trade-defence\/cn-bicycles\/"/);
});

// ── Reciprocity: PL URL points back to EN ─────────────

test('PL trade-defence URL has all 3 hreflang pointers (incl. back to EN)', () => {
  const sitemap = readSitemap('sitemap.xml');
  const urlBlock = sitemap.match(/<url>\s*<loc>https:\/\/orcatrade\.pl\/pl\/guides\/trade-defence\/cn-bicycles\/<\/loc>[\s\S]*?<\/url>/);
  assert.ok(urlBlock, 'PL trade-defence URL block present');
  const block = urlBlock[0];
  // PL URL itself should still link to EN, PL, DE
  assert.match(block, /hreflang="en" href="https:\/\/orcatrade\.pl\/guides\/trade-defence\/cn-bicycles\/"/);
  assert.match(block, /hreflang="pl" href="https:\/\/orcatrade\.pl\/pl\/guides\/trade-defence\/cn-bicycles\/"/);
});

// ── Sprint AD: Legacy guides also have hreflang ───────

test('legacy sourcing URL has hreflang block with locale-specific slugs', () => {
  const sitemap = readSitemap('sitemap.xml');
  const block = sitemap.match(/<url>\s*<loc>https:\/\/orcatrade\.pl\/guides\/sourcing\/apparel-from-cn\/<\/loc>[\s\S]*?<\/url>/);
  assert.ok(block, 'EN sourcing apparel-from-cn block present');
  // PL slug differs: apparel-z-cn
  assert.match(block[0], /hreflang="pl" href="https:\/\/orcatrade\.pl\/pl\/guides\/sourcing\/apparel-z-cn\/"/);
  // DE slug differs: apparel-cn (no separator)
  assert.match(block[0], /hreflang="de" href="https:\/\/orcatrade\.pl\/de\/guides\/sourcing\/apparel-cn\/"/);
});

test('legacy routing URL has hreflang block', () => {
  const sitemap = readSitemap('sitemap.xml');
  const block = sitemap.match(/<url>\s*<loc>https:\/\/orcatrade\.pl\/guides\/routing\/cn-to-de\/<\/loc>[\s\S]*?<\/url>/);
  assert.ok(block);
  assert.match(block[0], /hreflang="pl" href="https:\/\/orcatrade\.pl\/pl\/guides\/routing\/cn-do-de\/"/);
  assert.match(block[0], /hreflang="de" href="https:\/\/orcatrade\.pl\/de\/guides\/routing\/cn-de\/"/);
});

test('legacy customs URL has hreflang block', () => {
  const sitemap = readSitemap('sitemap.xml');
  const block = sitemap.match(/<url>\s*<loc>https:\/\/orcatrade\.pl\/guides\/customs\/electronics-into-pl\/<\/loc>[\s\S]*?<\/url>/);
  assert.ok(block);
  assert.match(block[0], /hreflang="pl"/);
  assert.match(block[0], /hreflang="de"/);
});

test('legacy warehouse URL has hreflang block', () => {
  const sitemap = readSitemap('sitemap.xml');
  // Find the first warehouse URL with hreflang
  const block = sitemap.match(/<url>\s*<loc>https:\/\/orcatrade\.pl\/guides\/warehouse\/[^<]+<\/loc>\s*<xhtml:link[\s\S]*?<\/url>/);
  assert.ok(block, 'at least one warehouse URL has hreflang block');
});

test('xhtml:link entry count is now substantially higher (legacy guides included)', () => {
  const sitemap = readSitemap('sitemap.xml');
  const matches = sitemap.match(/<xhtml:link/g);
  // Was ~840 before Sprint AD; should be ~2000+ now
  assert.ok(matches && matches.length >= 1500, `expected ≥1500 xhtml:link entries, got ${matches?.length || 0}`);
});
