'use strict';

// The marketing header's EN/PL/DE switcher resolves translated slugs via
// marketing-shell/lib/locale-alternates.json, generated from the hreflang
// alternates every static page declares. A stale map sends visitors to the
// locale homepage instead of the translated page (or, before this map
// existed, to guessed /pl/<en-slug>/ URLs that 404ed).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { render, buildMap, OUT } = require('../scripts/generate-locale-alternates');

test('committed locale-alternates.json matches the hreflang tags on disk', () => {
  const committed = fs.readFileSync(OUT, 'utf8');
  assert.equal(committed, render(), 'run: node scripts/generate-locale-alternates.js');
});

test('every mapped PL/DE target exists as a static page', () => {
  const root = path.resolve(__dirname, '..');
  for (const [en, alt] of Object.entries(buildMap())) {
    for (const target of [alt.pl, alt.de].filter(Boolean)) {
      const file = target.endsWith('/') ? `${target}index.html` : target;
      assert.ok(
        fs.existsSync(path.join(root, file)) || fs.existsSync(path.join(root, `${target}.html`)),
        `${en} → ${target} missing`,
      );
    }
  }
});

test('translated guide slugs are mapped (regression: /pl/<en-slug>/ 404s)', () => {
  const map = buildMap();
  assert.equal(map['/guides/customs/electronics-into-de/'].pl, '/pl/guides/customs/elektronika-do-de/');
  assert.equal(map['/guides/customs/electronics-into-de/'].de, '/de/guides/customs/elektronik-de/');
});
