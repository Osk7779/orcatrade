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

const MARKER = '<!-- favicon set v5 injected by scripts/inject-favicon-tags.js -->';
const LEGACY_MARKERS = [
  '<!-- favicon set injected by scripts/inject-favicon-tags.js -->',
  '<!-- favicon set v2 injected by scripts/inject-favicon-tags.js -->',
  '<!-- favicon set v3 injected by scripts/inject-favicon-tags.js -->',
  '<!-- favicon set v4 injected by scripts/inject-favicon-tags.js -->',
];

// v5: Safari and Chrome cache "no favicon" decisions by document URL, not
// favicon URL. ?v=4 cache-busters didn't help on pages where the browser
// had already decided. Solution: move the files to a brand-new path the
// browser has never seen (/icons/orca-*), and inject them dynamically via
// inline JS so the link tags can't be pre-decided as missing.
const FAVICON_BLOCK = `
  ${MARKER}
  <link rel="icon" type="image/png" sizes="192x192" href="/icons/orca-192.png" />
  <link rel="icon" type="image/png" sizes="512x512" href="/icons/orca-512.png" />
  <link rel="icon" type="image/png" sizes="48x48" href="/icons/orca-48.png" />
  <link rel="icon" type="image/png" sizes="32x32" href="/icons/orca-32.png" />
  <link rel="icon" type="image/png" sizes="16x16" href="/icons/orca-16.png" />
  <link rel="icon" href="/icons/orca.ico" sizes="any" />
  <link rel="shortcut icon" href="/icons/orca.ico" />
  <link rel="apple-touch-icon" sizes="180x180" href="/icons/orca-apple.png" />
  <link rel="manifest" href="/site.webmanifest" />
  <meta name="theme-color" content="#0a1628" />
  <script>
    /* v5 defensive favicon: re-inject the icon link at runtime so the
       browser can't reuse a stale "no favicon for this URL" decision
       from before the icons were added. */
    (function () {
      try {
        var existing = document.querySelectorAll('link[rel~="icon"]');
        existing.forEach(function (el) { el.parentNode && el.parentNode.removeChild(el); });
        var sizes = [
          ['192x192', '/icons/orca-192.png'],
          ['512x512', '/icons/orca-512.png'],
          ['48x48',   '/icons/orca-48.png'],
          ['32x32',   '/icons/orca-32.png'],
          ['16x16',   '/icons/orca-16.png'],
        ];
        sizes.forEach(function (s) {
          var l = document.createElement('link');
          l.rel = 'icon'; l.type = 'image/png'; l.sizes = s[0]; l.href = s[1];
          document.head.appendChild(l);
        });
        var ico = document.createElement('link');
        ico.rel = 'icon'; ico.href = '/icons/orca.ico';
        document.head.appendChild(ico);
        var apple = document.createElement('link');
        apple.rel = 'apple-touch-icon'; apple.setAttribute('sizes', '180x180');
        apple.href = '/icons/orca-apple.png';
        document.head.appendChild(apple);
      } catch (e) {}
    })();
  </script>
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
    .replace(/\n\s*<!-- Favicon placeholder[^>]*-->/gi, '')
    // Strip prior defensive favicon scripts so re-injection doesn't duplicate.
    .replace(/\n\s*<script>\s*\/\* v\d+ defensive favicon[\s\S]*?<\/script>/g, '');
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
