// Tests for the programmatic SEO page generator. Network-free.
// Verifies the generator's helper functions and that the produced
// HTML files have the structural elements the SEO strategy requires.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { slug, escapeHtml } = require('../scripts/generate-seo-pages');

const ROOT = path.resolve(__dirname, '..');

// ── slug ────────────────────────────────────────────────

test('slug lowercases ASCII strings', () => {
  assert.equal(slug('Apparel'), 'apparel');
  assert.equal(slug('China'), 'china');
});

test('slug strips Polish/Czech diacritics correctly (Poznań → poznan)', () => {
  assert.equal(slug('Poznań'), 'poznan');
  assert.equal(slug('Łódź'), 'lodz');
  assert.equal(slug('Małaszewicze'), 'malaszewicze');
});

test('slug strips German umlauts (Hamburg → hamburg, München → munchen)', () => {
  assert.equal(slug('Hamburg'), 'hamburg');
  assert.equal(slug('München'), 'munchen');
  assert.equal(slug('Köln'), 'koln');
});

test('slug joins multi-word strings with single hyphens', () => {
  assert.equal(slug('Hong Kong'), 'hong-kong');
  assert.equal(slug('Knitted apparel'), 'knitted-apparel');
});

test('slug strips leading/trailing hyphens', () => {
  assert.equal(slug('  spaces  '), 'spaces');
  assert.equal(slug('-leading'), 'leading');
  assert.equal(slug('trailing-'), 'trailing');
});

// ── escapeHtml ──────────────────────────────────────────

test('escapeHtml encodes the five reserved characters', () => {
  assert.equal(escapeHtml('<script>alert("x")</script>'), '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
  assert.equal(escapeHtml("Tom & Jerry's"), 'Tom &amp; Jerry&#39;s');
});

test('escapeHtml handles null and undefined', () => {
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
});

// ── Generated output structural checks ─────────────────

function pageContent(p) {
  return fs.readFileSync(path.join(ROOT, p, 'index.html'), 'utf8');
}

test('Sourcing page (CN apparel) exists and has SEO essentials', () => {
  const html = pageContent('guides/sourcing/apparel-from-cn');
  assert.match(html, /<title>.*Source Apparel.*from China/i);
  assert.match(html, /<meta name="description"/);
  assert.match(html, /<link rel="canonical" href="https:\/\/orcatrade\.pl\/guides\/sourcing\/apparel-from-cn\/" \/>/);
  assert.match(html, /<meta property="og:type" content="article"/);
  assert.match(html, /application\/ld\+json/);
  assert.match(html, /BreadcrumbList/);
});

test('Sourcing page includes the cross-origin comparison table', () => {
  const html = pageContent('guides/sourcing/electronics-from-vn');
  assert.match(html, /Compare with other origins/i);
  assert.match(html, /Bangladesh/);   // BD listed in comparison
  assert.match(html, /T(ü|u)rkiye/);  // TR listed
});

test('Routing page (CN→PL) shows the rail-corridor section', () => {
  const html = pageContent('guides/routing/cn-to-pl');
  assert.match(html, /China-Europe Railway Express/);
  assert.match(html, /Małaszewicze|Malaszewicze/);
});

test('Routing page (VN→DE) does NOT show rail-corridor section (VN not viable)', () => {
  const html = pageContent('guides/routing/vn-to-de');
  // Rail not viable from VN — section should be absent
  assert.doesNotMatch(html, /China-Europe Railway Express/);
});

test('Customs page (woven apparel into DE) shows duty math + EVFTA comparison', () => {
  const html = pageContent('guides/customs/woven-apparel-into-de');
  assert.match(html, /MFN duty rate/i);
  assert.match(html, /EVFTA/);
  assert.match(html, /19%|19\.0%/);  // German VAT
});

test('Customs page (footwear into PL) shows anti-dumping callout (CN-origin chapter 64)', () => {
  const html = pageContent('guides/customs/footwear-into-pl');
  assert.match(html, /Anti-dumping risk/i);
});

test('Customs page (electronics into DE) does NOT show anti-dumping (chapter 85 unaffected)', () => {
  const html = pageContent('guides/customs/electronics-into-de');
  assert.doesNotMatch(html, /Anti-dumping risk/i);
});

test('Warehouse page (Poznań) renders correctly with NFD-normalised slug', () => {
  const html = pageContent('guides/warehouse/poznan-3pl');
  assert.match(html, /Pozna(ń|n)/);
  assert.match(html, /pallet\/mo|per pallet\/month|pallet\/month/);
});

test('Warehouse page lists all 6 hubs in comparison table', () => {
  const html = pageContent('guides/warehouse/rotterdam-3pl');
  assert.match(html, /Rotterdam/);
  assert.match(html, /Hamburg/);
  assert.match(html, /Frankfurt/);
  assert.match(html, /Pozna(ń|n)/);
  assert.match(html, /Prague/);
  assert.match(html, /Barcelona/);
});

// ── Sitemap and robots ─────────────────────────────────

test('sitemap.xml exists at root with 100+ URLs', () => {
  const xml = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
  const matches = xml.match(/<loc>/g);
  assert.ok(matches && matches.length >= 100, `expected 100+ URLs, got ${matches?.length}`);
  assert.match(xml, /<loc>https:\/\/orcatrade\.pl\/<\/loc>/);
  assert.match(xml, /<loc>https:\/\/orcatrade\.pl\/agents\/<\/loc>/);
});

test('sitemap-guides.xml exists with 100+ guide URLs', () => {
  const xml = fs.readFileSync(path.join(ROOT, 'sitemap-guides.xml'), 'utf8');
  const matches = xml.match(/<loc>/g);
  assert.ok(matches && matches.length >= 100);
});

test('robots.txt declares both sitemaps and disallows /api/', () => {
  const robots = fs.readFileSync(path.join(ROOT, 'robots.txt'), 'utf8');
  assert.match(robots, /Sitemap:\s+https:\/\/orcatrade\.pl\/sitemap\.xml/);
  assert.match(robots, /Sitemap:\s+https:\/\/orcatrade\.pl\/sitemap-guides\.xml/);
  assert.match(robots, /Disallow:\s+\/api\//);
});

// ── Generator idempotence ──────────────────────────────

test('Re-running the generator does not error', async () => {
  const { run } = require('../scripts/generate-seo-pages');
  // Should be safe to re-run (idempotent overwrite)
  await run();
});

// ── Page count check ───────────────────────────────────

test('EN guide pages: 40 sourcing + 30 routing + 36 customs + 6 warehouse', () => {
  const sourcing = fs.readdirSync(path.join(ROOT, 'guides/sourcing')).filter(d => d !== 'index.html').length;
  const routing = fs.readdirSync(path.join(ROOT, 'guides/routing')).filter(d => d !== 'index.html').length;
  const customs = fs.readdirSync(path.join(ROOT, 'guides/customs')).filter(d => d !== 'index.html').length;
  const warehouse = fs.readdirSync(path.join(ROOT, 'guides/warehouse')).filter(d => d !== 'index.html').length;
  assert.equal(sourcing, 40);
  assert.equal(routing, 30);
  assert.equal(customs, 36);
  assert.equal(warehouse, 6);
});

test('PL guide pages: 40 sourcing + 30 routing + 36 customs + 6 warehouse', () => {
  const sourcing = fs.readdirSync(path.join(ROOT, 'pl/guides/sourcing')).filter(d => d !== 'index.html').length;
  const routing = fs.readdirSync(path.join(ROOT, 'pl/guides/routing')).filter(d => d !== 'index.html').length;
  const customs = fs.readdirSync(path.join(ROOT, 'pl/guides/customs')).filter(d => d !== 'index.html').length;
  const warehouse = fs.readdirSync(path.join(ROOT, 'pl/guides/warehouse')).filter(d => d !== 'index.html').length;
  assert.equal(sourcing, 40);
  assert.equal(routing, 30);
  assert.equal(customs, 36);
  assert.equal(warehouse, 6);
});

test('DE guide pages: 40 sourcing + 30 routing + 36 customs + 6 warehouse', () => {
  const sourcing = fs.readdirSync(path.join(ROOT, 'de/guides/sourcing')).filter(d => d !== 'index.html').length;
  const routing = fs.readdirSync(path.join(ROOT, 'de/guides/routing')).filter(d => d !== 'index.html').length;
  const customs = fs.readdirSync(path.join(ROOT, 'de/guides/customs')).filter(d => d !== 'index.html').length;
  const warehouse = fs.readdirSync(path.join(ROOT, 'de/guides/warehouse')).filter(d => d !== 'index.html').length;
  assert.equal(sourcing, 40);
  assert.equal(routing, 30);
  assert.equal(customs, 36);
  assert.equal(warehouse, 6);
});

test('PL routing page (cn-do-pl) renders with rail-corridor section', () => {
  const html = fs.readFileSync(path.join(ROOT, 'pl/guides/routing/cn-do-pl/index.html'), 'utf8');
  assert.match(html, /China-Europe Railway Express/);
  assert.match(html, /Małaszewicz/);
});

test('DE customs page (footwear → PL) shows anti-dumping callout in German', () => {
  const html = fs.readFileSync(path.join(ROOT, 'de/guides/customs/schuhwaren-pl/index.html'), 'utf8');
  assert.match(html, /Anti-Dumping-Risiko/);
});

test('DE warehouse page uses Posen for Poznań (German city name)', () => {
  // Should exist at /de/guides/warehouse/posen-3pl/
  const dePath = path.join(ROOT, 'de/guides/warehouse/posen-3pl/index.html');
  assert.ok(fs.existsSync(dePath), 'de/guides/warehouse/posen-3pl/ should exist');
  const html = fs.readFileSync(dePath, 'utf8');
  assert.match(html, /Posen/);
});

test('Sourcing page hreflang now includes en + pl + de + x-default', () => {
  const html = fs.readFileSync(path.join(ROOT, 'guides/sourcing/apparel-from-cn/index.html'), 'utf8');
  assert.match(html, /hreflang="en"/);
  assert.match(html, /hreflang="pl"/);
  assert.match(html, /hreflang="de"/);
  assert.match(html, /hreflang="x-default"/);
});
