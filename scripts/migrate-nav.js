#!/usr/bin/env node
// One-shot migration: replace each EN page's inline <header>...</header> nav block
// with a placeholder rendered by js/site-nav.js. Idempotent — pages already migrated
// are skipped.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const SKIP_DIRS = ['/pl/', '/de/', '/node_modules/', '/docs/', '/scripts/'];
// Pages whose nav is not the standard site header (custom layouts) — leave alone.
const SKIP_FILES = new Set([
  'dashboard/index.html',
  'dashboard/login/index.html',
  'dashboard/signup/index.html',
]);

function findHtmlFiles(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = '/' + path.relative(ROOT, full).split(path.sep).join('/');
    if (entry.isDirectory()) {
      if (SKIP_DIRS.some(s => (rel + '/').includes(s))) continue;
      findHtmlFiles(full, acc);
    } else if (entry.name.endsWith('.html')) {
      acc.push(full);
    }
  }
  return acc;
}

function relativePath(fromFile, toRelativeFromRoot) {
  const dir = path.dirname(fromFile);
  const target = path.join(ROOT, toRelativeFromRoot);
  let rel = path.relative(dir, target).split(path.sep).join('/');
  if (!rel.startsWith('.') && !rel.startsWith('/')) rel = './' + rel;
  return rel;
}

function migrate(file) {
  const relFromRoot = path.relative(ROOT, file).split(path.sep).join('/');
  if (SKIP_FILES.has(relFromRoot)) return { file: relFromRoot, status: 'skipped (custom layout)' };

  let content = fs.readFileSync(file, 'utf8');

  if (content.includes('data-site-header')) {
    return { file: relFromRoot, status: 'already migrated' };
  }

  // Match <header> block that contains either nav-links or nav-dropdown — the standard site header.
  const headerRegex = /<header\b[^>]*>[\s\S]*?<\/header>/i;
  const match = content.match(headerRegex);
  if (!match) return { file: relFromRoot, status: 'no <header> block found — skipped' };

  const headerHtml = match[0];
  if (!/nav-links|nav-dropdown/.test(headerHtml)) {
    return { file: relFromRoot, status: 'header has no site nav inside — skipped' };
  }

  // Replace the <header> block with the placeholder.
  content = content.replace(headerRegex, '<header data-site-header></header>');

  // Inject site-nav.js if missing. Insert just before main.js if present, else before </body>.
  const navScriptPath = relativePath(file, 'js/site-nav.js');
  const navScriptTag = `<script src="${navScriptPath}"></script>`;

  if (!content.includes('site-nav.js')) {
    if (/<script src="[^"]*\/?js\/main\.js"><\/script>/.test(content)) {
      content = content.replace(
        /<script src="([^"]*\/?)js\/main\.js"><\/script>/,
        `${navScriptTag}\n  <script src="$1js/main.js"></script>`
      );
    } else if (content.includes('</body>')) {
      content = content.replace('</body>', `  ${navScriptTag}\n</body>`);
    }
  }

  fs.writeFileSync(file, content);
  return { file: relFromRoot, status: 'migrated' };
}

const files = findHtmlFiles(ROOT);
const results = files.map(migrate);

const counts = {};
for (const r of results) counts[r.status] = (counts[r.status] || 0) + 1;

console.log('Migration summary:');
for (const [status, n] of Object.entries(counts)) console.log(`  ${n.toString().padStart(3)} × ${status}`);
console.log('');
for (const r of results) {
  if (!['already migrated', 'no <header> block found — skipped', 'header has no site nav inside — skipped'].includes(r.status)) {
    console.log(`  ${r.status.padEnd(28)} ${r.file}`);
  }
}
