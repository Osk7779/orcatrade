#!/usr/bin/env node
// Inject the standard favicon block (+ OG/Twitter meta) into every HTML
// page's <head>, AND the Vercel Analytics block before every </body>.
//
// Two injection phases, each idempotent via its own marker comment:
//   - Favicon + OG + theme-color → inserted just before </head>
//   - Vercel Analytics scripts   → inserted just before </body>
//
// Why one script, not two: the SEO generators
// (generate-seo-pages.js#run etc.) call this once at the end of every
// regen. Splitting the analytics into a separate script would mean
// patching five generators to invoke it too. One canonical injector
// keeps re-runs deterministic.
//
// Usage:
//   node scripts/inject-favicon-tags.js [--dry-run]

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DRY_RUN = process.argv.includes('--dry-run');

const MARKER = '<!-- favicon set v9 injected by scripts/inject-favicon-tags.js -->';
const LEGACY_MARKERS = [
  '<!-- favicon set injected by scripts/inject-favicon-tags.js -->',
  '<!-- favicon set v2 injected by scripts/inject-favicon-tags.js -->',
  '<!-- favicon set v3 injected by scripts/inject-favicon-tags.js -->',
  '<!-- favicon set v4 injected by scripts/inject-favicon-tags.js -->',
  '<!-- favicon set v5 injected by scripts/inject-favicon-tags.js -->',
  '<!-- favicon set v6 injected by scripts/inject-favicon-tags.js -->',
  '<!-- favicon set v7 injected by scripts/inject-favicon-tags.js -->',
  '<!-- favicon set v8 injected by scripts/inject-favicon-tags.js -->',
];

// Sprint J.1: Vercel Analytics block. Hand-rolled pages got these tags
// in commit b004cd97 (`Add Vercel Analytics to static pages`); SEO-
// generated pages did not. Every test run regenerates SEO pages and
// stripped the analytics. Folding analytics into this injector means
// the SEO generator picks them up via the post-regen hook, so the two
// surfaces stay in lock-step.
const ANALYTICS_MARKER = '<!-- analytics v1 injected by scripts/inject-favicon-tags.js -->';
const ANALYTICS_BLOCK = `
${ANALYTICS_MARKER}
<script>window.va=window.va||function(){(window.vaq=window.vaq||[]).push(arguments);};</script>
<script defer src="/_vercel/insights/script.js"></script>
`;

// v7: Embed the favicon as a base64 data URI in the FIRST <link rel="icon">.
// This bypasses every per-URL "no favicon" browser cache — the icon is in
// the HTML bytes the browser already received, no separate fetch, no cache
// lookup. File-based icons stay as supplements for crawlers/larger sizes.
const ICON_B64_32 = fs.readFileSync(
  path.join(ROOT, 'favicon-32x32.png')
).toString('base64');
const ICON_B64_48 = fs.readFileSync(
  path.join(ROOT, 'favicon-48x48.png')
).toString('base64');

function buildFaviconBlock(ogType = 'website') {
  return `
  ${MARKER}
  <link rel="icon" type="image/png" sizes="32x32" href="data:image/png;base64,${ICON_B64_32}" />
  <link rel="icon" type="image/png" sizes="48x48" href="data:image/png;base64,${ICON_B64_48}" />
  <link rel="icon" type="image/png" sizes="192x192" href="/icons/orca-192.png" />
  <link rel="icon" type="image/png" sizes="512x512" href="/icons/orca-512.png" />
  <link rel="icon" type="image/png" sizes="16x16" href="/icons/orca-16.png" />
  <link rel="icon" href="/icons/orca.ico" sizes="any" />
  <link rel="shortcut icon" href="/icons/orca.ico" />
  <link rel="apple-touch-icon" sizes="180x180" href="/icons/orca-apple.png" />
  <link rel="manifest" href="/site.webmanifest" />
  <meta name="theme-color" content="#0a1628" />
  <!-- Sprint H: Open Graph + Twitter Card. Per-page og:title / og:description
       stay where they're defined; we just inject the brand-shared image,
       site_name, type, and Twitter card meta so every share renders as a
       branded preview card instead of a bare URL. og:type preserves the
       page's own value (e.g. "article" on SEO guides) when present. -->
  <meta property="og:image" content="https://orcatrade.pl/og-1200x630.png" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:image:alt" content="OrcaTrade — Asia to Europe import operating system" />
  <meta property="og:type" content="${ogType}" />
  <meta property="og:site_name" content="OrcaTrade" />
  <meta property="og:locale" content="en_GB" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:image" content="https://orcatrade.pl/og-1200x630.png" />
  <meta name="twitter:site" content="@orcatradegroup" />
  <script>
    /* v7 defensive favicon: re-inject as data URI at runtime so the browser
       can't reuse a stale per-URL "no favicon" decision. The data URI
       guarantees the icon exists even if every network fetch is suppressed. */
    (function () {
      try {
        var existing = document.querySelectorAll('link[rel~="icon"]');
        existing.forEach(function (el) { el.parentNode && el.parentNode.removeChild(el); });
        var primary = document.createElement('link');
        primary.rel = 'icon'; primary.type = 'image/png';
        primary.setAttribute('sizes', '32x32');
        primary.href = 'data:image/png;base64,${ICON_B64_32}';
        document.head.appendChild(primary);
        var large = document.createElement('link');
        large.rel = 'icon'; large.type = 'image/png';
        large.setAttribute('sizes', '192x192');
        large.href = '/icons/orca-192.png';
        document.head.appendChild(large);
        var apple = document.createElement('link');
        apple.rel = 'apple-touch-icon'; apple.setAttribute('sizes', '180x180');
        apple.href = '/icons/orca-apple.png';
        document.head.appendChild(apple);
      } catch (e) {}
    })();
  </script>
`;
}

// Skip directories that don't contain user-facing pages.
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.github', 'lib', 'test', 'scripts',
  'docs', 'css', 'js', 'assets', 'api',
]);

function* walk(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch (_e) { return; }
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.') continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.html')) yield full;
  }
}

// Insert the favicon + OG block just before </head>. Idempotent via MARKER.
function injectHead(text) {
  if (text.includes(MARKER)) return { changed: false, text };

  const closingHeadIdx = text.indexOf('</head>');
  if (closingHeadIdx === -1) return { changed: false, text, reason: 'no-head' };

  // Sprint H: detect an existing og:type before we strip it. SEO-generated
  // guide pages emit og:type="article" (correct for Google's Article
  // rich-result eligibility); hand-rolled landing pages have nothing. We
  // preserve the page-specific value and only default to "website" when
  // the page didn't declare one.
  const ogTypeMatch = text.slice(0, closingHeadIdx).match(/<meta\s+property="og:type"[^>]*content="([^"]+)"[^>]*>/i);
  const existingOgType = ogTypeMatch ? ogTypeMatch[1] : 'website';

  const headSlice = text.slice(0, closingHeadIdx);
  const tailSlice = text.slice(closingHeadIdx);

  // Strip prior favicon/manifest/theme-color/apple-touch-icon links we
  // might have injected by hand in earlier work. Match the precise patterns
  // we know about. Safer than a generic regex.
  let stripped = headSlice
    .replace(/\n\s*<link\s+rel="icon"[^>]*\/?>/gi, '')
    .replace(/\n\s*<link\s+rel="shortcut icon"[^>]*\/?>/gi, '')
    .replace(/\n\s*<link\s+rel="apple-touch-icon"[^>]*\/?>/gi, '')
    .replace(/\n\s*<link\s+rel="manifest"[^>]*\/?>/gi, '')
    .replace(/\n\s*<meta\s+name="theme-color"[^>]*\/?>/gi, '')
    .replace(/\n\s*<!-- Favicon placeholder[^>]*-->/gi, '')
    // Strip prior defensive favicon scripts so re-injection doesn't duplicate.
    .replace(/\n\s*<script>\s*\/\* v\d+ defensive favicon[\s\S]*?<\/script>/g, '')
    // Sprint H: strip prior og:image / og:type / og:site_name / og:locale /
    // twitter:* meta. The injector replaces these with the canonical set.
    // Page-specific og:title and og:description are KEPT (different regex).
    .replace(/\n\s*<meta\s+property="og:image[^"]*"[^>]*\/?>/gi, '')
    .replace(/\n\s*<meta\s+property="og:type"[^>]*\/?>/gi, '')
    .replace(/\n\s*<meta\s+property="og:site_name"[^>]*\/?>/gi, '')
    .replace(/\n\s*<meta\s+property="og:locale"[^>]*\/?>/gi, '')
    .replace(/\n\s*<meta\s+name="twitter:(card|image|site)"[^>]*\/?>/gi, '')
    .replace(/\n\s*<!-- Sprint H: Open Graph[^>]*-->/gi, '');
  for (const legacy of LEGACY_MARKERS) {
    stripped = stripped.split(legacy).join('');
  }
  stripped = stripped.replace(/\n\s*\n\s*\n/g, '\n\n');

  return { changed: true, text: stripped + buildFaviconBlock(existingOgType) + tailSlice };
}

// Insert the analytics block just before </body>. Idempotent via
// ANALYTICS_MARKER. Strips any prior un-markered analytics scripts so
// pages that received the b004cd97 commit don't double-inject.
function injectAnalytics(text) {
  if (text.includes(ANALYTICS_MARKER)) return { changed: false, text };

  const closingBodyIdx = text.lastIndexOf('</body>');
  if (closingBodyIdx === -1) return { changed: false, text, reason: 'no-body' };

  // Strip any prior unmarked analytics tags so we don't duplicate.
  // Handles the variant from commit b004cd97 that lacked our marker.
  let cleaned = text
    .replace(/\n?<script>window\.va=window\.va\|\|function\(\)\{\(window\.vaq=window\.vaq\|\|\[\]\)\.push\(arguments\);\};<\/script>/g, '')
    .replace(/\n?<script\s+defer\s+src="\/_vercel\/insights\/script\.js"><\/script>/g, '');

  const newClosingBodyIdx = cleaned.lastIndexOf('</body>');
  if (newClosingBodyIdx === -1) return { changed: false, text, reason: 'no-body' };

  const updated =
    cleaned.slice(0, newClosingBodyIdx) +
    ANALYTICS_BLOCK +
    cleaned.slice(newClosingBodyIdx);
  return { changed: true, text: updated };
}

function inject(filePath) {
  const original = fs.readFileSync(filePath, 'utf8');

  const head = injectHead(original);
  const after = injectAnalytics(head.text);

  const anyChange = head.changed || after.changed;
  if (!anyChange) {
    // Preserve historic return shape: callers may check reason.
    const reason = head.reason || after.reason || 'already-injected';
    return { changed: false, reason };
  }
  if (!DRY_RUN) fs.writeFileSync(filePath, after.text, 'utf8');
  return { changed: true, headChanged: head.changed, analyticsChanged: after.changed };
}

function main() {
  const files = [...walk(ROOT)];
  let changed = 0;
  let alreadyInjected = 0;
  let noHead = 0;

  for (const f of files) {
    const r = inject(f);
    if (r.changed) changed++;
    else if (r.reason === 'already-injected') alreadyInjected++;
    else if (r.reason === 'no-head') noHead++;
  }

  const verb = DRY_RUN ? 'would inject' : 'injected';
  console.log(`${verb} head/analytics into ${changed} files`);
  console.log(`(${alreadyInjected} already had everything, ${noHead} had no <head>, ${files.length} scanned total)`);
}

if (require.main === module) {
  try { main(); }
  catch (err) {
    console.error('Failed:', err.message);
    process.exit(1);
  }
}

module.exports = { inject, MARKER, ANALYTICS_MARKER, injectHead, injectAnalytics };
