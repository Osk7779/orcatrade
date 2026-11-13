#!/usr/bin/env node
// Builds marketing-shell/lib/locale-alternates.json — the EN → PL/DE path
// map the marketing header's language switcher uses.
//
// Source of truth is the hreflang alternates every static page already
// declares, so translated slugs (/guides/customs/electronics-into-de/ →
// /pl/guides/customs/elektronika-do-de/) resolve instead of 404ing. Only
// targets that exist on disk are kept. Re-run after generating guides:
//   node scripts/generate-locale-alternates.js
// test/locale-alternates.test.js fails when the committed map is stale.

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'marketing-shell', 'lib', 'locale-alternates.json');
const SKIP_DIRS = new Set(['node_modules', '.git', 'marketing-shell', 'app-shell', 'legacy', 'test', 'docs', '.vercel']);
const HREFLANG_RE = /<link rel="alternate" hreflang="(en|pl|de)" href="https?:\/\/[^/"]+(\/[^"]*)"/g;

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name), out);
    } else if (entry.name.endsWith('.html')) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

function existsOnDisk(urlPath) {
  const clean = urlPath.split(/[?#]/)[0];
  const candidates = clean.endsWith('/')
    ? [clean + 'index.html']
    : [clean, clean + '.html', clean + '/index.html'];
  return candidates.some((c) => fs.existsSync(path.join(ROOT, c)));
}

function buildMap() {
  /** @type {Record<string, { pl?: string, de?: string }>} */
  const map = {};
  for (const file of walk(ROOT, [])) {
    const html = fs.readFileSync(file, 'utf8');
    /** @type {Record<string, string>} */
    const alt = {};
    for (const m of html.matchAll(HREFLANG_RE)) alt[m[1]] = m[2];
    if (!alt.en || alt.en === '/') continue;
    for (const lang of ['pl', 'de']) {
      const target = alt[lang];
      if (!target || target === alt.en || !existsOnDisk(target)) continue;
      map[alt.en] = map[alt.en] || {};
      map[alt.en][lang] = target;
    }
  }
  return Object.fromEntries(Object.keys(map).sort().map((k) => [k, map[k]]));
}

function render() {
  return JSON.stringify(buildMap(), null, 0).replace(/},"/g, '},\n"') + '\n';
}

if (require.main === module) {
  fs.writeFileSync(OUT, render());
  console.log(`wrote ${path.relative(ROOT, OUT)}`);
}

module.exports = { buildMap, render, OUT };
