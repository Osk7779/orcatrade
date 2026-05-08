// Backend i18n parity tests for the Import Plan Builder.
//
// Goal: any string key present in EN must exist in PL and DE — preventing
// regressions where a refactor adds a new email line in English but forgets
// to localise it.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { STRINGS, pickLocale } = require('../lib/start-i18n');
const { composePlan } = require('../lib/handlers/start');

// ── Locale pickers ─────────────────────────────────────

test('pickLocale returns en for unknown / undefined locale', () => {
  assert.equal(pickLocale(undefined), 'en');
  assert.equal(pickLocale(null), 'en');
  assert.equal(pickLocale('fr'), 'en');
  assert.equal(pickLocale('xx'), 'en');
});

test('pickLocale passes through valid locales', () => {
  assert.equal(pickLocale('en'), 'en');
  assert.equal(pickLocale('pl'), 'pl');
  assert.equal(pickLocale('de'), 'de');
});

// ── Backend i18n parity ────────────────────────────────

test('STRINGS provides en, pl, de', () => {
  for (const lang of ['en', 'pl', 'de']) {
    assert.ok(STRINGS[lang], `${lang} present`);
  }
});

test('every locale exposes subject, leadSubject, userBody, founderBody', () => {
  for (const lang of ['en', 'pl', 'de']) {
    for (const fn of ['subject', 'leadSubject', 'userBody', 'founderBody']) {
      assert.equal(typeof STRINGS[lang][fn], 'function', `${lang}.${fn} is a function`);
    }
  }
});

test('subject/leadSubject return non-empty strings for sample inputs', () => {
  const inputs = { productCategory: 'apparel', originCountry: 'CN', destinationCountry: 'PL', customsValueEur: 25000, weightKg: 800 };
  for (const lang of ['en', 'pl', 'de']) {
    const s = STRINGS[lang].subject({ inputs });
    const ls = STRINGS[lang].leadSubject({ inputs });
    assert.ok(s.length > 10, `${lang} subject length`);
    assert.ok(ls.length > 10, `${lang} leadSubject length`);
    assert.ok(s.includes('CN') && s.includes('PL'), `${lang} subject mentions route`);
  }
});

test('userBody contains share URL placeholder', () => {
  const inputs = { productCategory: 'apparel', originCountry: 'CN', destinationCountry: 'PL', customsValueEur: 25000, weightKg: 800 };
  const plan = composePlan(inputs);
  assert.equal(plan.ok, true);
  const shareUrl = 'https://orcatrade.pl/start/?p=ABC';
  for (const lang of ['en', 'pl', 'de']) {
    const body = STRINGS[lang].userBody({
      inputs: plan.inputs,
      plan,
      totals: plan.totals,
      name: 'Test',
      shareUrl,
      siteOrigin: 'https://orcatrade.pl',
    });
    assert.ok(body.includes(shareUrl), `${lang} body includes share URL`);
    assert.ok(body.includes('Test'), `${lang} body addresses name`);
    assert.ok(body.includes('25'), `${lang} body shows customs value`);
  }
});

test('founderBody includes contact + permalink', () => {
  const inputs = { productCategory: 'electronics', originCountry: 'VN', destinationCountry: 'DE', customsValueEur: 50000, weightKg: 300 };
  const plan = composePlan(inputs);
  const shareUrl = 'https://orcatrade.pl/de/start/?p=XYZ';
  for (const lang of ['en', 'pl', 'de']) {
    const body = STRINGS[lang].founderBody({
      inputs: plan.inputs,
      plan,
      totals: plan.totals,
      name: 'Buyer',
      email: 'buyer@example.com',
      companyName: 'Acme GmbH',
      shareUrl,
    });
    assert.ok(body.includes('buyer@example.com'), `${lang} founder body includes email`);
    assert.ok(body.includes('Acme GmbH'), `${lang} founder body includes company`);
    assert.ok(body.includes(shareUrl), `${lang} founder body includes permalink`);
  }
});

// ── Frontend i18n parity (parsed from start/i18n.js text) ─

test('start/i18n.js declares en, pl, de blocks', () => {
  const text = fs.readFileSync(path.join(__dirname, '..', 'start', 'i18n.js'), 'utf8');
  for (const lang of ['en:', 'pl:', 'de:']) {
    assert.ok(text.includes(lang), `${lang} block present`);
  }
});

test('every key in en block has matching pl and de keys', () => {
  // We can't require() the browser-side i18n.js (it sets window.START_I18N),
  // so we extract top-level keys from each locale block via regex.
  const text = fs.readFileSync(path.join(__dirname, '..', 'start', 'i18n.js'), 'utf8');

  function extractKeysForLocale(localeName) {
    // Match the locale block: e.g. `en: { ... },` allowing nested braces
    const start = text.indexOf(`  ${localeName}: {`);
    if (start === -1) return null;
    let depth = 0, i = start + `  ${localeName}: `.length, end = -1;
    for (; i < text.length; i++) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}') {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }
    if (end === -1) return null;
    const block = text.slice(start, end + 1);
    // Only top-level keys: lines starting with two-space indent + identifier + ':'
    const keys = new Set();
    const re = /\n    ([A-Za-z_][\w]*)\s*:/g;
    let m;
    while ((m = re.exec(block))) keys.add(m[1]);
    return keys;
  }

  const en = extractKeysForLocale('en');
  const pl = extractKeysForLocale('pl');
  const de = extractKeysForLocale('de');
  assert.ok(en && en.size > 20, `en has > 20 keys (got ${en?.size})`);

  for (const k of en) {
    assert.ok(pl.has(k), `pl missing key: ${k}`);
    assert.ok(de.has(k), `de missing key: ${k}`);
  }
});

// ── Handler accepts locale parameter ───────────────────

test('composePlan still works regardless of locale (locale is email-only)', () => {
  const inputs = { productCategory: 'apparel', originCountry: 'CN', destinationCountry: 'PL', customsValueEur: 25000, weightKg: 800 };
  const plan = composePlan(inputs);
  assert.equal(plan.ok, true);
  // composePlan does not touch locale — locale only matters for email rendering
  assert.equal(plan.inputs.originCountry, 'CN');
});
