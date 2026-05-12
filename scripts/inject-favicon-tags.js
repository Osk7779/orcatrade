#!/usr/bin/env node
// Inject the standard favicon block into every HTML page that doesn't
// already have it.
//
// Walks the repo, finds every *.html file, and inserts the favicon
// <link> tags + manifest + theme-color meta just before </head>.
// Idempotent — re-running is a no-op once the marker comment exists.
//
// Usage:
//   node scripts/inject-favicon-tags.js [--dry-run]

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DRY_RUN = process.argv.includes('--dry-run');

const MARKER = '<!-- favicon set v4 injected by scripts/inject-favicon-tags.js -->';
const LEGACY_MARKERS = [
  '<!-- favicon set injected by scripts/inject-favicon-tags.js -->',
  '<!-- favicon set v2 injected by scripts/inject-favicon-tags.js -->',
  '<!-- favicon set v3 injected by scripts/inject-favicon-tags.js -->',
];

// Cache-busting query — bump on every favicon refresh. Without it browsers
// (and Google) hold onto the "this page has no favicon" decision per-URL
// long after the icons are actually live on the server.
const V = '4';

// The block we inject. Path-rooted so it works from any nested page.
// Order matters: Google's favicon crawler prefers the first <link rel="icon">
// and recommends a 48×48 minimum, ideally a multiple of 48 (96, 192). We list
// the 192×192 first so Google picks the high-res version. /favicon.ico is
// explicit (not just root fallback) so older crawlers find it reliably.
const FAVICON_BLOCK = `
  ${MARKER}
  <link rel="icon" type="image/png" sizes="192x192" href="/favicon-192x192.png?v=${V}" />
  <link rel="icon" type="image/png" sizes="512x512" href="/favicon-512x512.png?v=${V}" />
  <link rel="icon" type="image/png" sizes="48x48" href="/favicon-48x48.png?v=${V}" />
  <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png?v=${V}" />
  <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png?v=${V}" />
  <link rel="icon" href="/favicon.ico?v=${V}" sizes="any" />
  <link rel="shortcut icon" href="/favicon.ico?v=${V}" />
  <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png?v=${V}" />
  <link rel="manifest" href="/site.webmanifest?v=${V}" />
  <meta name="theme-color" content="#0a1628" />
`;

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

function inject(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  // Idempotent: skip if the marker is already present.
  if (text.includes(MARKER)) return { changed: false, reason: 'already-injected' };

  // Must have a </head> to know where to inject.
  const closingHeadIdx = text.indexOf('</head>');
  if (closingHeadIdx === -1) return { changed: false, reason: 'no-head' };

  // Remove any stale legacy favicon links we might have inserted before —
  // typically `<link rel="icon" ...>` lines elsewhere in <head>. Keep
  // intentional non-favicon `rel="alternate icon"` etc. untouched by
  // only matching `rel="icon"` exactly.
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
    .replace(/\n\s*<!-- Favicon placeholder[^>]*-->/gi, '');
  for (const legacy of LEGACY_MARKERS) {
    stripped = stripped.split(legacy).join('');
  }
  stripped = stripped.replace(/\n\s*\n\s*\n/g, '\n\n');

  const updated = stripped + FAVICON_BLOCK + tailSlice;
  if (!DRY_RUN) fs.writeFileSync(filePath, updated, 'utf8');
  return { changed: true };
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
  console.log(`${verb} favicon block into ${changed} files`);
  console.log(`(${alreadyInjected} already had it, ${noHead} had no <head>, ${files.length} scanned total)`);
}

if (require.main === module) {
  try { main(); }
  catch (err) {
    console.error('Failed:', err.message);
    process.exit(1);
  }
}

module.exports = { inject, MARKER };
