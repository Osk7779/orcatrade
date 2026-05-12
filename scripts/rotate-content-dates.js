#!/usr/bin/env node
// Daily content date rotator.
//
// Walks the repo's content trees (guides, examples, sitemaps) and replaces
// recent rotation-pattern dates with today's date. This keeps JSON-LD
// freshness signals and sitemap `<lastmod>` entries current without anyone
// running anything manually — it's wired to a GitHub Actions cron job that
// commits and pushes daily.
//
// What it rewrites:
//   - JSON-LD:    "datePublished":"YYYY-MM-DD" and "dateModified":"YYYY-MM-DD"
//   - Sitemap:    <lastmod>YYYY-MM-DD</lastmod>
//   - Footer text: "Snapshot reviewed on YYYY-MM-DD"
//                  "Snapshot überprüft am YYYY-MM-DD"      (DE)
//                  "Snapshot zweryfikowano w YYYY-MM-DD"   (PL)
//
// What it does NOT rewrite (deliberately):
//   - Arbitrary YYYY-MM-DD strings in body copy (e.g. "from 1 January 2026")
//   - JSON-LD inside docs/ — that tree is not customer-facing
//   - Dates in source code (lib/, scripts/, test/)
//
// Idempotent: running it twice on the same day is a no-op.
//
// Usage:
//   node scripts/rotate-content-dates.js [--dry-run]
//
// Exit codes:
//   0  success (changes applied, or no changes needed)
//   1  fatal error

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DRY_RUN = process.argv.includes('--dry-run');
const TODAY = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

// Roots we scan. Anything outside these stays untouched.
const SCAN_ROOTS = ['guides', 'examples', 'pl', 'de', '.'];

// File patterns we consider rotatable. The .xml entry catches sitemaps.
const ROTATABLE_EXTENSIONS = new Set(['.html', '.xml']);

// Paths inside SCAN_ROOTS we explicitly skip — speeds up the walk and
// avoids accidentally rewriting non-content files.
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.github', 'lib', 'test', 'scripts',
  'docs', 'css', 'js', 'assets', 'api', 'account', 'agent',
  'agents', 'analysis', 'buyer-verification', 'compliance', 'customs',
  'dashboard', 'documents', 'factory-risk', 'insurance', 'logistics',
  'marketplace', 'partners', 'platform', 'press', 'pricing',
  'returns', 'routing', 'samples', 'search', 'start',
  'supply-chain', 'warehouse',
]);

// ── Replacement patterns ─────────────────────────────

// Each entry: regex that matches a rotation-eligible date AND captures the
// date itself in group 1. We only rewrite when the matched date is within
// the last 7 days (i.e., recently bumped — not an arbitrary historical
// reference like "effective 2025-01-01").
const PATTERNS = [
  // JSON-LD: "datePublished":"2026-05-08"
  /"datePublished"\s*:\s*"(\d{4}-\d{2}-\d{2})"/g,
  // JSON-LD: "dateModified":"2026-05-08"
  /"dateModified"\s*:\s*"(\d{4}-\d{2}-\d{2})"/g,
  // Sitemap: <lastmod>2026-05-08</lastmod>
  /<lastmod>(\d{4}-\d{2}-\d{2})<\/lastmod>/g,
  // English footer: "Snapshot reviewed on 2026-05-08"
  /Snapshot reviewed on (\d{4}-\d{2}-\d{2})/g,
  // German footer: "Snapshot überprüft am 2026-05-08"
  /Snapshot überprüft am (\d{4}-\d{2}-\d{2})/g,
  // Polish footer: "Snapshot zweryfikowano w 2026-05-08"
  /Snapshot zweryfikowano w (\d{4}-\d{2}-\d{2})/g,
];

// Rewrite recent dates only — anything older than the rotation window
// is presumed deliberate (regulation effective date, citation, etc.).
const ROTATION_WINDOW_DAYS = 7;

function isWithinRotationWindow(dateStr) {
  const then = Date.parse(dateStr + 'T00:00:00Z');
  if (!Number.isFinite(then)) return false;
  const now = Date.parse(TODAY + 'T00:00:00Z');
  const diffDays = (now - then) / 86400000;
  return diffDays >= 0 && diffDays <= ROTATION_WINDOW_DAYS;
}

// ── Walker ───────────────────────────────────────────

function* walk(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch (_e) { return; }
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.') continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (ROTATABLE_EXTENSIONS.has(ext)) yield full;
    }
  }
}

function rotateFile(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  let updated = text;
  let replacements = 0;

  for (const pattern of PATTERNS) {
    updated = updated.replace(pattern, (match, dateInMatch) => {
      if (dateInMatch === TODAY) return match; // already today
      if (!isWithinRotationWindow(dateInMatch)) return match; // out of window
      replacements++;
      return match.replace(dateInMatch, TODAY);
    });
  }

  if (replacements > 0 && !DRY_RUN) {
    fs.writeFileSync(filePath, updated, 'utf8');
  }
  return replacements;
}

function main() {
  const seen = new Set();
  const filesToScan = [];

  // Walk specific roots, plus the repo root for sitemap.xml and similar
  for (const root of SCAN_ROOTS) {
    const abs = path.join(ROOT, root);
    if (!fs.existsSync(abs)) continue;
    if (root === '.') {
      // Only scan top-level files at the repo root, not all subdirs
      for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
        if (!entry.isFile()) continue;
        const ext = path.extname(entry.name).toLowerCase();
        if (!ROTATABLE_EXTENSIONS.has(ext)) continue;
        filesToScan.push(path.join(abs, entry.name));
      }
    } else {
      for (const f of walk(abs)) filesToScan.push(f);
    }
  }

  let filesChanged = 0;
  let totalReplacements = 0;
  for (const f of filesToScan) {
    if (seen.has(f)) continue;
    seen.add(f);
    const n = rotateFile(f);
    if (n > 0) {
      filesChanged++;
      totalReplacements += n;
    }
  }

  const verb = DRY_RUN ? 'would rotate' : 'rotated';
  console.log(`${verb} ${totalReplacements} dates across ${filesChanged} files → ${TODAY}`);
  console.log(`(scanned ${filesToScan.length} files in ${SCAN_ROOTS.join(', ')})`);
}

if (require.main === module) {
  try { main(); }
  catch (err) {
    console.error('Rotation failed:', err.message);
    process.exit(1);
  }
}

module.exports = { rotateFile, isWithinRotationWindow, PATTERNS, ROTATION_WINDOW_DAYS };
