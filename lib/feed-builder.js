// RSS / Atom feed builder (Sprint AE).
//
// Scans the project's content directories at request time and emits a
// well-formed feed. Why runtime (not build-step):
//   - Vercel rebuilds on every push anyway — the cache becomes stale
//     in seconds, not days
//   - One handler covers RSS + Atom + per-section subfeeds
//   - Content lives in static HTML files; no extra metadata layer needed
//
// Title/description/canonical are pulled from each page's <title> +
// <meta name="description"> + <link rel="canonical">. mtime stamps the
// publication date — close enough for syndication when there's no
// front-matter date.
//
// Public API:
//   listFeedItems({ rootDir, sections })  → [{title, url, description, lastModified, section}]
//   buildRss({ items, ...feedMeta })      → string (RSS 2.0)
//   buildAtom({ items, ...feedMeta })     → string (Atom 1.0)

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SITE_ORIGIN = process.env.SITE_ORIGIN || 'https://orcatrade.pl';
const FEED_TITLE = 'OrcaTrade — Asia↔Europe import intelligence';
const FEED_DESCRIPTION = 'Calculator-grounded guides, worked examples, trade-defence dossiers, and preferential-origin walkthroughs for EU importers.';
const FEED_AUTHOR = 'OrcaTrade Group';
const MAX_ITEMS_DEFAULT = 200;

// Sections we consider "newsworthy" — exclude tool/account/dashboard pages
// that don't have evergreen editorial value.
const DEFAULT_SECTIONS = [
  { dir: 'guides', section: 'guide' },
  { dir: 'examples', section: 'example' },
];

function safeReadFile(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch (_e) { return null; }
}

function decodeEntities(s) {
  if (!s) return s;
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function extractMeta(html) {
  if (!html) return { title: '', description: '', canonical: '' };
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const descMatch = html.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i);
  const canonicalMatch = html.match(/<link\s+rel=["']canonical["']\s+href=["']([^"']+)["']/i);
  return {
    title: titleMatch ? decodeEntities(titleMatch[1].replace(/\s+/g, ' ').trim()) : '',
    description: descMatch ? decodeEntities(descMatch[1].trim()) : '',
    canonical: canonicalMatch ? canonicalMatch[1].trim() : '',
  };
}

function walkContentDir(rootDir, relDir) {
  const out = [];
  const absDir = path.join(rootDir, relDir);
  let entries;
  try { entries = fs.readdirSync(absDir, { withFileTypes: true }); }
  catch (_e) { return out; }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const subDir = path.join(absDir, entry.name);
    const indexHtml = path.join(subDir, 'index.html');
    const stat = (() => { try { return fs.statSync(indexHtml); } catch (_e) { return null; } })();
    if (stat && stat.isFile()) {
      out.push({
        absPath: indexHtml,
        relPath: path.posix.join(relDir.split(path.sep).join('/'), entry.name).replace(/\\/g, '/'),
        lastModifiedMs: stat.mtimeMs,
      });
    }
    // Recurse one level — guides/trade-defence/cn-pneumatic-tyres-ad/index.html
    const nested = walkContentDir(rootDir, path.join(relDir, entry.name));
    out.push(...nested);
  }
  return out;
}

function urlFor(relPath, origin = SITE_ORIGIN) {
  // Ensure leading slash and trailing slash for directories
  let u = '/' + relPath.replace(/^\/+|\/+$/g, '') + '/';
  return origin + u;
}

function listFeedItems({ rootDir, sections = DEFAULT_SECTIONS, max = MAX_ITEMS_DEFAULT } = {}) {
  if (!rootDir) throw new Error('listFeedItems: rootDir required');
  const items = [];
  for (const { dir, section } of sections) {
    const found = walkContentDir(rootDir, dir);
    for (const f of found) {
      const html = safeReadFile(f.absPath);
      const meta = extractMeta(html);
      if (!meta.title) continue; // skip pages without a parseable title
      items.push({
        title: meta.title,
        description: meta.description,
        url: meta.canonical || urlFor(f.relPath),
        lastModified: new Date(f.lastModifiedMs).toISOString(),
        section,
      });
    }
  }
  // Newest first
  items.sort((a, b) => Date.parse(b.lastModified) - Date.parse(a.lastModified));
  return items.slice(0, max);
}

// ── XML escapers ──────────────────────────────────────

function escapeXml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function rfc822Date(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return new Date().toUTCString();
  return d.toUTCString();
}

// ── RSS 2.0 ──────────────────────────────────────────

function buildRss({ items, origin = SITE_ORIGIN, title = FEED_TITLE, description = FEED_DESCRIPTION, generatedAt = new Date().toISOString() } = {}) {
  const itemsXml = items.map(it => `    <item>
      <title>${escapeXml(it.title)}</title>
      <link>${escapeXml(it.url)}</link>
      <guid isPermaLink="true">${escapeXml(it.url)}</guid>
      <pubDate>${rfc822Date(it.lastModified)}</pubDate>
      <category>${escapeXml(it.section)}</category>
      <description>${escapeXml(it.description)}</description>
    </item>`).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(title)}</title>
    <link>${escapeXml(origin)}/</link>
    <description>${escapeXml(description)}</description>
    <language>en</language>
    <lastBuildDate>${rfc822Date(generatedAt)}</lastBuildDate>
    <atom:link href="${escapeXml(origin)}/feed.xml" rel="self" type="application/rss+xml" />
${itemsXml}
  </channel>
</rss>`;
}

// ── Atom 1.0 ─────────────────────────────────────────

function buildAtom({ items, origin = SITE_ORIGIN, title = FEED_TITLE, description = FEED_DESCRIPTION, author = FEED_AUTHOR, generatedAt = new Date().toISOString() } = {}) {
  const updated = new Date(generatedAt).toISOString();
  const entriesXml = items.map(it => `  <entry>
    <title>${escapeXml(it.title)}</title>
    <link href="${escapeXml(it.url)}" />
    <id>${escapeXml(it.url)}</id>
    <updated>${escapeXml(it.lastModified)}</updated>
    <category term="${escapeXml(it.section)}" />
    <summary>${escapeXml(it.description)}</summary>
  </entry>`).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${escapeXml(title)}</title>
  <subtitle>${escapeXml(description)}</subtitle>
  <link href="${escapeXml(origin)}/atom.xml" rel="self" />
  <link href="${escapeXml(origin)}/" />
  <id>${escapeXml(origin)}/</id>
  <updated>${escapeXml(updated)}</updated>
  <author><name>${escapeXml(author)}</name></author>
${entriesXml}
</feed>`;
}

module.exports = {
  SITE_ORIGIN,
  FEED_TITLE,
  FEED_DESCRIPTION,
  DEFAULT_SECTIONS,
  MAX_ITEMS_DEFAULT,
  extractMeta,
  walkContentDir,
  listFeedItems,
  buildRss,
  buildAtom,
  escapeXml,
  rfc822Date,
};
