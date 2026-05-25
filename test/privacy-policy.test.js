// Guards the public privacy-policy pages (Sprint privacy-policy-v1). The cookie
// consent banner links to these; a missing file is a live 404 on a legal page,
// so we assert every privacyHref the banner uses resolves to a real file with
// the substance a privacy policy must have.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

// Extract every privacyHref from the cookie-consent script.
const consent = fs.readFileSync(path.join(ROOT, 'js', 'cookie-consent.js'), 'utf8');
const hrefs = [...consent.matchAll(/privacyHref:\s*'([^']+)'/g)].map((m) => m[1]);

test('cookie banner declares a privacy link for each locale (en/pl/de)', () => {
  assert.ok(hrefs.length >= 3, `expected ≥3 privacyHref entries, found ${hrefs.length}`);
  assert.ok(hrefs.includes('/regulations/privacy.html'));
  assert.ok(hrefs.includes('/pl/regulations/privacy.html'));
  assert.ok(hrefs.includes('/de/regulations/privacy.html'));
});

test('every privacyHref resolves to a real, substantial file (no 404)', () => {
  for (const href of hrefs) {
    const file = path.join(ROOT, href.replace(/^\//, ''));
    assert.ok(fs.existsSync(file), `privacy page missing on disk: ${href}`);
    const html = fs.readFileSync(file, 'utf8');
    assert.ok(html.length > 2000, `${href} should be a substantial document`);
  }
});

test('each privacy policy covers the required substance', () => {
  const checks = [
    { file: 'regulations/privacy.html', rights: /Article 17|Article 20|erasure|portability/i, cookies: /cookie/i, controller: /data controller/i, contact: /privacy@orcatrade\.pl/ },
    { file: 'pl/regulations/privacy.html', rights: /art\.\s*1[57]|usuni|przenosz/i, cookies: /cookie/i, controller: /administrator/i, contact: /privacy@orcatrade\.pl/ },
    { file: 'de/regulations/privacy.html', rights: /Art\.\s*1[57]|Löschung|Übertragbarkeit/i, cookies: /Cookie/i, controller: /Verantwortliche/i, contact: /privacy@orcatrade\.pl/ },
  ];
  for (const c of checks) {
    const html = fs.readFileSync(path.join(ROOT, c.file), 'utf8');
    assert.match(html, c.rights, `${c.file}: must cover data-subject rights`);
    assert.match(html, c.cookies, `${c.file}: must cover cookies`);
    assert.match(html, c.controller, `${c.file}: must name the data controller`);
    assert.match(html, c.contact, `${c.file}: must give a privacy contact`);
    // Must link to the self-serve export/delete page + the Trust Centre.
    assert.match(html, /\/account\/privacy\//, `${c.file}: must link to self-serve data controls`);
    assert.match(html, /\/trust\//, `${c.file}: must link to the Trust Centre`);
  }
});

test('privacy policies are indexable (unlike the account data-controls page)', () => {
  const html = fs.readFileSync(path.join(ROOT, 'regulations', 'privacy.html'), 'utf8');
  assert.doesNotMatch(html, /noindex/i, 'the public privacy policy should be indexable');
});
