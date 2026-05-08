// H0 cross-link helper tests.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { findRelatedH0, renderRelatedH0Aside, CATEGORY_TO_CHAPTER } = require('../scripts/find-related-h0');

const ROOT = path.join(__dirname, '..');

// ── Sourcing pages ────────────────────────────────────

test('CN apparel sourcing → trade-defence index fallback (no AD on chapter 62 from CN)', () => {
  const links = findRelatedH0({ category: 'apparel', origin: 'CN', locale: 'en', pageType: 'sourcing' });
  // CN has no preferential — no preferential link
  assert.equal(links.find(l => l.type === 'preferential'), undefined);
  // No chapter-62 AD on CN — should fall back to trade-defence index
  assert.ok(links.some(l => l.href.endsWith('/guides/trade-defence/')));
  // Compliance: REACH or GPSR for apparel
  assert.ok(links.some(l => l.type === 'compliance' || l.href.endsWith('/guides/compliance/')));
});

test('VN electronics sourcing → EVFTA preferential link', () => {
  const links = findRelatedH0({ category: 'electronics', origin: 'VN', locale: 'en', pageType: 'sourcing' });
  const pref = links.find(l => l.type === 'preferential');
  assert.ok(pref);
  assert.match(pref.href, /\/guides\/preferential-origin\/from-vn\//);
  assert.match(pref.subtitle, /Vietnam/);
});

test('BD apparel sourcing → EBA preferential link', () => {
  const links = findRelatedH0({ category: 'apparel', origin: 'BD', locale: 'en', pageType: 'sourcing' });
  const pref = links.find(l => l.type === 'preferential');
  assert.ok(pref);
  assert.match(pref.href, /\/guides\/preferential-origin\/from-bd\//);
});

test('TR machinery sourcing → ATR Customs Union link', () => {
  const links = findRelatedH0({ category: 'machinery', origin: 'TR', locale: 'en', pageType: 'sourcing' });
  const pref = links.find(l => l.type === 'preferential');
  assert.ok(pref);
  assert.match(pref.href, /\/guides\/preferential-origin\/from-tr\//);
});

// ── Routing pages ────────────────────────────────────

test('VN→DE routing → EVFTA preferential', () => {
  const links = findRelatedH0({ origin: 'VN', destination: 'DE', locale: 'en', pageType: 'routing' });
  const pref = links.find(l => l.type === 'preferential');
  assert.ok(pref);
  assert.match(pref.href, /\/guides\/preferential-origin\/from-vn\//);
});

test('CN→PL routing → no preferential, fallback to indexes', () => {
  const links = findRelatedH0({ origin: 'CN', destination: 'PL', locale: 'en', pageType: 'routing' });
  assert.equal(links.find(l => l.type === 'preferential'), undefined);
  // Fallback indexes should be present
  assert.ok(links.length >= 2);
});

// ── Customs pages (chapter-driven) ───────────────────

test('Customs chapter 85 (electronics) → CE LVD/EMC/RED compliance link', () => {
  const links = findRelatedH0({ hsChapter: '85', destination: 'PL', locale: 'en', pageType: 'customs' });
  const compliance = links.find(l => l.type === 'compliance');
  assert.ok(compliance);
});

test('Customs chapter 95 (toys) → Toy Safety + REACH high-severity links', () => {
  const links = findRelatedH0({ hsChapter: '95', destination: 'PL', locale: 'en', pageType: 'customs' });
  const compliance = links.filter(l => l.type === 'compliance');
  assert.ok(compliance.length >= 1);
});

// ── Locale routing ────────────────────────────────────

test('PL locale: hrefs prefixed with /pl/', () => {
  const links = findRelatedH0({ category: 'apparel', origin: 'VN', locale: 'pl', pageType: 'sourcing' });
  for (const l of links) {
    assert.ok(l.href.startsWith('/pl/'), `${l.href} should start with /pl/`);
  }
});

test('DE locale: hrefs prefixed with /de/', () => {
  const links = findRelatedH0({ category: 'electronics', origin: 'KR', locale: 'de', pageType: 'sourcing' });
  for (const l of links) {
    assert.ok(l.href.startsWith('/de/'), `${l.href} should start with /de/`);
  }
});

test('EN locale: hrefs without locale prefix', () => {
  const links = findRelatedH0({ category: 'apparel', origin: 'BD', locale: 'en', pageType: 'sourcing' });
  for (const l of links) {
    assert.ok(!l.href.startsWith('/pl/') && !l.href.startsWith('/de/'), `${l.href} should not have locale prefix`);
  }
});

// ── Caps + dedup ──────────────────────────────────────

test('result is capped at 5 links', () => {
  const links = findRelatedH0({ category: 'electronics', origin: 'CN', destination: 'PL', locale: 'en', pageType: 'sourcing' });
  assert.ok(links.length <= 5);
});

test('result has no duplicate hrefs', () => {
  const links = findRelatedH0({ category: 'electronics', origin: 'CN', destination: 'PL', locale: 'en', pageType: 'sourcing' });
  const hrefs = links.map(l => l.href);
  const unique = new Set(hrefs);
  assert.equal(hrefs.length, unique.size);
});

// ── Fallback when context is sparse ──────────────────

test('warehouse pageType (no category/origin) → falls back to indexes only', () => {
  const links = findRelatedH0({ destination: 'PL', locale: 'en', pageType: 'warehouse' });
  assert.ok(links.length >= 1);
  assert.ok(links.every(l => l.type === 'index' || l.type === 'compliance'));
});

// ── Render aside ─────────────────────────────────────

test('renderRelatedH0Aside returns empty string when no links', () => {
  assert.equal(renderRelatedH0Aside([], 'en'), '');
  assert.equal(renderRelatedH0Aside(null, 'en'), '');
});

test('renderRelatedH0Aside returns HTML aside when given links', () => {
  const html = renderRelatedH0Aside([{ type: 'preferential', href: '/x', title: 'T', subtitle: 'S' }], 'en');
  assert.match(html, /<aside class="related-h0"/);
  assert.match(html, /Related guides/);
  assert.match(html, /href="\/x"/);
});

test('renderRelatedH0Aside uses Polish heading in pl locale', () => {
  const html = renderRelatedH0Aside([{ type: 'compliance', href: '/x', title: 'T', subtitle: 'S' }], 'pl');
  assert.match(html, /Powiązane poradniki/);
});

test('renderRelatedH0Aside uses German heading in de locale', () => {
  const html = renderRelatedH0Aside([{ type: 'compliance', href: '/x', title: 'T', subtitle: 'S' }], 'de');
  assert.match(html, /Verwandte Leitfäden/);
});

// ── Disk-rendered pages ──────────────────────────────

test('apparel-from-cn page contains the related-h0 aside', () => {
  const html = fs.readFileSync(path.join(ROOT, 'guides/sourcing/apparel-from-cn/index.html'), 'utf8');
  assert.match(html, /class="related-h0"/);
  assert.match(html, /Related guides/);
});

test('vn-to-de routing page links to /guides/preferential-origin/from-vn/', () => {
  const html = fs.readFileSync(path.join(ROOT, 'guides/routing/vn-to-de/index.html'), 'utf8');
  assert.match(html, /\/guides\/preferential-origin\/from-vn\//);
});

test('CATEGORY_TO_CHAPTER catalogue covers all 8 wizard categories', () => {
  for (const cat of ['apparel', 'electronics', 'furniture', 'toys', 'cosmetics', 'homeware', 'footwear', 'machinery']) {
    assert.ok(CATEGORY_TO_CHAPTER[cat], `${cat} mapped`);
  }
});
