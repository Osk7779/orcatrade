#!/usr/bin/env node
/* Inject the shared OrcaTrade shell assets into a set of static HTML pages.
 *
 * Adds, idempotently, just before </head>:
 *   - <link rel="preconnect" href="https://fonts.googleapis.com" crossorigin>
 *   - <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
 *   - <link href="…Fraunces + Inter + IBM Plex Mono…" rel="stylesheet">
 *   - <link rel="stylesheet" href="/css/orcatrade-shell.css">
 *
 * And just before </body>:
 *   - <script src="/js/orcatrade-motion.js" defer></script>
 *
 * Idempotency: each insertion is keyed by a sentinel comment
 * (<!-- orcatrade-shell:fonts -->, etc.). Already-injected pages are
 * skipped at that block; running the script a second time is a no-op.
 *
 * Usage:
 *   node scripts/inject-shell-assets.js account dashboard
 *   node scripts/inject-shell-assets.js --dry-run guides
 */

'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');

const FONT_LINKS = [
  '<!-- orcatrade-shell:fonts -->',
  '  <link rel="preconnect" href="https://fonts.googleapis.com">',
  '  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
  '  <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">',
].join('\n');

const SHELL_CSS = [
  '<!-- orcatrade-shell:css -->',
  '  <link rel="stylesheet" href="/css/orcatrade-shell.css">',
].join('\n');

const SHELL_JS = [
  '<!-- orcatrade-shell:js -->',
  '  <script src="/js/orcatrade-motion.js" defer></script>',
].join('\n');

const HEAD_BLOCKS = [
  { sentinel: 'orcatrade-shell:fonts', html: FONT_LINKS },
  { sentinel: 'orcatrade-shell:css', html: SHELL_CSS },
];

const BODY_BLOCKS = [
  { sentinel: 'orcatrade-shell:js', html: SHELL_JS },
];

function* walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip dependency-y directories outright.
      if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === '.git') continue;
      yield* walk(full);
    } else if (entry.isFile() && entry.name.endsWith('.html')) {
      yield full;
    }
  }
}

function injectBefore(source, marker, blocks) {
  const lowerSource = source.toLowerCase();
  const idx = lowerSource.lastIndexOf(marker);
  if (idx === -1) return { changed: false, source };

  let html = source;
  let changed = false;
  // Re-find marker each loop because earlier inserts shift the index.
  for (const block of blocks) {
    if (html.includes(block.sentinel)) continue;
    const markerIdx = html.toLowerCase().lastIndexOf(marker);
    if (markerIdx === -1) continue;
    html = html.slice(0, markerIdx) + '  ' + block.html + '\n' + html.slice(markerIdx);
    changed = true;
  }
  return { changed, source: html };
}

function inject(source) {
  let { source: html, changed: c1 } = injectBefore(source, '</head>', HEAD_BLOCKS);
  let { source: html2, changed: c2 } = injectBefore(html, '</body>', BODY_BLOCKS);
  return { source: html2, changed: c1 || c2 };
}

function processFile(file, dryRun) {
  const original = fs.readFileSync(file, 'utf8');
  const { source, changed } = inject(original);
  if (!changed) return { file, status: 'unchanged' };
  if (!dryRun) fs.writeFileSync(file, source, 'utf8');
  return { file, status: dryRun ? 'would-change' : 'changed' };
}

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const dirs = args.filter((a) => !a.startsWith('--'));
  if (dirs.length === 0) {
    console.error('Usage: node scripts/inject-shell-assets.js [--dry-run] <dir> [<dir>...]');
    process.exit(2);
  }

  const targets = [];
  for (const d of dirs) {
    const abs = path.isAbsolute(d) ? d : path.join(REPO_ROOT, d);
    if (!fs.existsSync(abs)) {
      console.error(`skip: ${d} (does not exist)`);
      continue;
    }
    for (const f of walk(abs)) targets.push(f);
  }

  let changed = 0;
  let unchanged = 0;
  for (const f of targets) {
    const r = processFile(f, dryRun);
    if (r.status === 'unchanged') {
      unchanged++;
    } else {
      changed++;
      console.log(`${r.status}: ${path.relative(REPO_ROOT, f)}`);
    }
  }
  console.log(
    `\n${dryRun ? 'DRY RUN — ' : ''}${changed} file(s) ${dryRun ? 'would change' : 'updated'}, ${unchanged} unchanged. (${targets.length} total)`
  );
}

main();
