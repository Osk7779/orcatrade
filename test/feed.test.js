// RSS / Atom feed tests (Sprint AE).

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const feedBuilder = require('../lib/feed-builder');
const feedHandler = require('../lib/handlers/feed');

const PROJECT_ROOT = path.resolve(__dirname, '..');

// ── extractMeta ──────────────────────────────────────

test('extractMeta: pulls title + description + canonical', () => {
  const html = `
    <html><head>
      <title>EU Compliance Guide — OrcaTrade</title>
      <meta name="description" content="A guide on EU compliance." />
      <link rel="canonical" href="https://orcatrade.pl/guides/compliance/" />
    </head></html>`;
  const m = feedBuilder.extractMeta(html);
  assert.equal(m.title, 'EU Compliance Guide — OrcaTrade');
  assert.equal(m.description, 'A guide on EU compliance.');
  assert.equal(m.canonical, 'https://orcatrade.pl/guides/compliance/');
});

test('extractMeta: handles missing tags gracefully', () => {
  const m = feedBuilder.extractMeta('<html><head></head></html>');
  assert.equal(m.title, '');
  assert.equal(m.description, '');
  assert.equal(m.canonical, '');
});

test('extractMeta: decodes entities in title', () => {
  const m = feedBuilder.extractMeta('<title>EU &amp; UK trade</title>');
  assert.equal(m.title, 'EU & UK trade');
});

// ── listFeedItems against the live tree ──────────────

test('listFeedItems: returns guides + examples sorted newest first', () => {
  const items = feedBuilder.listFeedItems({ rootDir: PROJECT_ROOT });
  assert.ok(items.length > 30, `expected >30 feed items, got ${items.length}`);
  // All have URLs and titles
  for (const it of items.slice(0, 10)) {
    assert.ok(it.title, 'item has title');
    assert.ok(it.url.startsWith('http'), 'item has absolute URL');
    assert.ok(['guide', 'example'].includes(it.section));
  }
  // Sorted desc by lastModified
  for (let i = 1; i < items.length; i++) {
    assert.ok(
      Date.parse(items[i - 1].lastModified) >= Date.parse(items[i].lastModified),
      'items should be sorted newest first',
    );
  }
});

test('listFeedItems: respects max param', () => {
  const items = feedBuilder.listFeedItems({ rootDir: PROJECT_ROOT, max: 5 });
  assert.equal(items.length, 5);
});

test('listFeedItems: throws when rootDir missing', () => {
  assert.throws(() => feedBuilder.listFeedItems({}), /rootDir required/);
});

// ── XML builders ─────────────────────────────────────

test('buildRss: well-formed channel + items', async () => {
  const xml = feedBuilder.buildRss({
    items: [
      { title: 'Test guide', description: 'Hi', url: 'https://orcatrade.pl/guides/x/', lastModified: '2026-05-08T10:00:00Z', section: 'guide' },
    ],
  });
  assert.match(xml, /<\?xml version="1\.0"/);
  assert.match(xml, /<rss version="2\.0"/);
  assert.match(xml, /<title>Test guide<\/title>/);
  assert.match(xml, /<link>https:\/\/orcatrade\.pl\/guides\/x\/<\/link>/);
  assert.match(xml, /<category>guide<\/category>/);
  assert.match(xml, /atom:link/); // RSS-self link present
});

test('buildAtom: well-formed feed + entries', async () => {
  const xml = feedBuilder.buildAtom({
    items: [
      { title: 'Test ex', description: 'Hi', url: 'https://orcatrade.pl/examples/y/', lastModified: '2026-05-08T10:00:00Z', section: 'example' },
    ],
  });
  assert.match(xml, /<feed xmlns="http:\/\/www\.w3\.org\/2005\/Atom">/);
  assert.match(xml, /<title>Test ex<\/title>/);
  assert.match(xml, /<link href="https:\/\/orcatrade\.pl\/examples\/y\/" \/>/);
  assert.match(xml, /<category term="example" \/>/);
  assert.match(xml, /<author><name>OrcaTrade Group<\/name><\/author>/);
});

test('escapeXml: escapes the five special chars', () => {
  assert.equal(feedBuilder.escapeXml(`<a href="x">it's & cool</a>`), '&lt;a href=&quot;x&quot;&gt;it&apos;s &amp; cool&lt;/a&gt;');
});

test('rfc822Date: handles ISO input', () => {
  const out = feedBuilder.rfc822Date('2026-05-08T10:00:00Z');
  assert.match(out, /Fri, 08 May 2026/);
});

test('rfc822Date: falls back to now on garbage input', () => {
  const out = feedBuilder.rfc822Date('not-a-date');
  // Must still be an RFC-822 string (e.g. "Mon, 01 Jan 2024 …")
  assert.match(out, /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4}/);
});

// ── /api/feed handler ────────────────────────────────

function mockRes() {
  return {
    statusCode: 200, headers: {}, body: '',
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(b) { this.body = b || ''; return this; },
  };
}

test('handler: GET /api/feed returns RSS by default', async () => {
  const req = { method: 'GET', headers: {}, url: '/api/feed', query: {} };
  const res = mockRes();
  await feedHandler(req, res);
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /rss\+xml/);
  assert.match(res.body, /<rss version="2\.0"/);
});

test('handler: GET /api/feed?format=atom returns Atom', async () => {
  const req = { method: 'GET', headers: {}, url: '/api/feed?format=atom', query: { format: 'atom' } };
  const res = mockRes();
  await feedHandler(req, res);
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /atom\+xml/);
  assert.match(res.body, /<feed xmlns="http:\/\/www\.w3\.org\/2005\/Atom"/);
});

test('handler: rejects unknown format', async () => {
  const req = { method: 'GET', headers: {}, url: '/api/feed?format=json', query: { format: 'json' } };
  const res = mockRes();
  await feedHandler(req, res);
  assert.equal(res.statusCode, 400);
});

test('handler: 405 on non-GET', async () => {
  const req = { method: 'POST', headers: {}, url: '/api/feed', query: {} };
  const res = mockRes();
  await feedHandler(req, res);
  assert.equal(res.statusCode, 405);
});

test('handler: sets Cache-Control for edge caching', async () => {
  const req = { method: 'GET', headers: {}, url: '/api/feed', query: {} };
  const res = mockRes();
  await feedHandler(req, res);
  assert.match(res.headers['cache-control'], /max-age=3600/);
  assert.match(res.headers['cache-control'], /stale-while-revalidate/);
});

// ── Wiring ───────────────────────────────────────────

test('vercel.json rewrites /feed.xml + /atom.xml to /api/feed', () => {
  const fs = require('node:fs');
  const cfg = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'vercel.json'), 'utf8'));
  const sources = (cfg.rewrites || []).map(r => r.source);
  assert.ok(sources.includes('/feed.xml'), 'expected /feed.xml rewrite');
  assert.ok(sources.includes('/atom.xml'), 'expected /atom.xml rewrite');
});

// 2026-05-30 marketing-shell migration retired the static root index.html
// (commit 2c21a9d0). The RSS/Atom <link rel="alternate"> assertion below
// targeted that file. Coverage for the rendered marketing-shell root is
// tracked under Phase 1 of docs/execution-plan.md (marketing-shell-aware
// HTTP/Playwright tests).
test('home page advertises RSS + Atom feeds via <link rel="alternate">', { skip: 'marketing-shell migration: root index.html retired; coverage moved to Phase 1' }, () => {
  const fs = require('node:fs');
  const html = fs.readFileSync(path.join(PROJECT_ROOT, 'index.html'), 'utf8');
  assert.match(html, /type="application\/rss\+xml"/);
  assert.match(html, /type="application\/atom\+xml"/);
});

test('api/[...path].js dispatcher registers feed handler', () => {
  const fs = require('node:fs');
  const dispatcher = fs.readFileSync(path.join(PROJECT_ROOT, 'api/[...path].js'), 'utf8');
  assert.match(dispatcher, /feed: require\('\.\.\/lib\/handlers\/feed'\)/);
});
