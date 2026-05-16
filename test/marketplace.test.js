// Marketplace shell tests (Sprint H4).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const exemplars = require('../lib/intelligence/data/supplier-exemplars');

// ── Data shape: server-side module ───────────────────

test('exemplars: catalogue is non-empty + frozen', () => {
  assert.ok(exemplars.EXEMPLARS.length >= 12, 'expected ≥12 exemplars');
  assert.ok(Object.isFrozen(exemplars.EXEMPLARS), 'EXEMPLARS must be frozen');
  for (const e of exemplars.EXEMPLARS) {
    assert.ok(Object.isFrozen(e), 'each exemplar must be frozen');
  }
});

test('exemplars: every entry has the required fields', () => {
  const required = ['id', 'category', 'country', 'region', 'yearsOperating', 'moqRange', 'leadTimeWeeks', 'certifications', 'capabilities', 'preferentialOriginEligible', 'notes'];
  for (const e of exemplars.EXEMPLARS) {
    for (const k of required) {
      assert.ok(e[k] !== undefined, `${e.id} missing required field: ${k}`);
    }
    assert.ok(Array.isArray(e.certifications) && e.certifications.length > 0, `${e.id} certifications must be non-empty array`);
    assert.ok(Array.isArray(e.capabilities) && e.capabilities.length > 0, `${e.id} capabilities must be non-empty array`);
    assert.ok(typeof e.preferentialOriginEligible === 'boolean', `${e.id} preferentialOriginEligible must be boolean`);
  }
});

test('exemplars: ids are unique', () => {
  const ids = exemplars.EXEMPLARS.map(e => e.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate ids found');
});

test('exemplars: COUNTRIES + CATEGORIES are computed correctly', () => {
  assert.deepEqual(
    [...exemplars.COUNTRIES],
    [...new Set(exemplars.EXEMPLARS.map(e => e.country))].sort(),
  );
  assert.deepEqual(
    [...exemplars.CATEGORIES],
    [...new Set(exemplars.EXEMPLARS.map(e => e.category))].sort(),
  );
});

test('exemplars: listExemplars filters by country', () => {
  const cn = exemplars.listExemplars({ country: 'CN' });
  assert.ok(cn.length > 0);
  for (const e of cn) assert.equal(e.country, 'CN');
});

test('exemplars: listExemplars filters by category', () => {
  const cat = exemplars.CATEGORIES[0];
  const filtered = exemplars.listExemplars({ category: cat });
  assert.ok(filtered.length > 0);
  for (const e of filtered) assert.equal(e.category, cat);
});

test('exemplars: at least one preferential-origin eligible entry exists', () => {
  const elig = exemplars.EXEMPLARS.filter(e => e.preferentialOriginEligible);
  assert.ok(elig.length >= 5, 'expected ≥5 preferential-origin-eligible entries');
});

test('exemplars: country mix covers both ASEAN + South Asia + EU', () => {
  const countries = new Set(exemplars.EXEMPLARS.map(e => e.country));
  // ASEAN representative (VN), South Asia (IN or BD), EU (IT or other 2-letter EU)
  assert.ok(countries.has('VN') || countries.has('TH') || countries.has('ID'), 'expected ASEAN representative');
  assert.ok(countries.has('IN') || countries.has('BD'), 'expected South Asia representative');
  assert.ok(countries.has('IT') || countries.has('PL') || countries.has('DE'), 'expected EU-resident representative');
});

// ── Static page presence ─────────────────────────────

test('/marketplace/index.html present + canonical points to /marketplace/', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'marketplace/index.html'), 'utf8');
  assert.match(html, /Vetted supplier directory/);
  assert.match(html, /id="supplier-grid"/);
  assert.match(html, /id="country-filter"/);
  assert.match(html, /canonical" href="https:\/\/orcatrade\.pl\/marketplace\/"/);
});

test('/marketplace/index.html surfaces the anonymisation banner', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'marketplace/index.html'), 'utf8');
  assert.match(html, /anonymised/i);
  assert.match(html, /Why anonymised/);
});

test('/marketplace/app.js EXEMPLARS count matches server-side count', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'marketplace/app.js'), 'utf8');
  // Parse out the inline data array length by counting "{ id: 'ex_..." entries
  const idMatches = js.match(/id:\s*'ex_\d+'/g) || [];
  assert.equal(idMatches.length, exemplars.EXEMPLARS.length, `inline data count (${idMatches.length}) must match server-side count (${exemplars.EXEMPLARS.length})`);
});

test('/marketplace/app.js renders intro CTA per card', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'marketplace/app.js'), 'utf8');
  assert.match(js, /Request introduction/);
  assert.match(js, /\?intent=supplier-introduction/);
});

test('/marketplace/index.html links to vetting application CTA', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'marketplace/index.html'), 'utf8');
  assert.match(html, /\?intent=supplier-vetting/);
});

// ── Sprint K: Founding 10 positioning alignment ──────

const FOUNDING_LINKS = [
  { file: 'marketplace/index.html',    href: '/founding/',          phrase: 'Founding 10' },
  { file: 'pl/marketplace/index.html', href: '/pl/zalozyciele-10/', phrase: 'Założycieli 10' },
  { file: 'de/marketplace/index.html', href: '/de/gruender-10/',    phrase: 'Gründer 10' },
];

for (const { file, href, phrase } of FOUNDING_LINKS) {
  test(`${file} cross-links to the locale-correct Founding 10 page`, () => {
    const full = path.join(__dirname, '..', file);
    assert.ok(fs.existsSync(full), `${file} must exist`);
    const html = fs.readFileSync(full, 'utf8');
    const hrefRe = new RegExp(`href="${href.replace(/\//g, '\\/')}"`);
    assert.match(html, hrefRe, `${file} missing href="${href}" — cross-link not wired`);
    assert.ok(html.includes(phrase), `${file} missing visible "${phrase}" — cross-link is unlabelled`);
  });
}

test('EN marketplace banner explains both WHY anonymised AND WHEN it goes live', () => {
  // Sprint K tied the live-directory timeline to the Founding 10 onboarding
  // milestone. Before J/K the page said "why" but not "when" — the new copy
  // must surface both halves.
  const en = fs.readFileSync(path.join(__dirname, '..', 'marketplace/index.html'), 'utf8');
  assert.match(en, /Why anonymised/, 'EN marketplace lost the "Why anonymised" framing');
  assert.match(en, /when it goes live|when we'?ve onboarded|onboarded our first/i,
    'EN marketplace must surface the live-directory timeline');
});
