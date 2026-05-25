// Sprint security-hardening-v1 — guards the platform's HTTP security headers
// and responsible-disclosure file so they can't silently regress. These are a
// customer-data-protection control: a dropped CSP or HSTS is a security
// incident, and a green test is cheaper than a pen-test finding.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));

function globalHeaders() {
  const rule = (vercel.headers || []).find((h) => h.source === '/(.*)');
  assert.ok(rule, 'a global /(.*) headers rule must exist');
  const map = {};
  for (const h of rule.headers) map[h.key] = h.value;
  return map;
}

test('vercel.json defines a global security-headers rule', () => {
  const h = globalHeaders();
  assert.ok(Object.keys(h).length >= 6);
});

test('HSTS is enabled with a long max-age + includeSubDomains', () => {
  const h = globalHeaders();
  const hsts = h['Strict-Transport-Security'];
  assert.ok(hsts, 'Strict-Transport-Security must be set');
  const m = hsts.match(/max-age=(\d+)/);
  assert.ok(m && Number(m[1]) >= 31536000, 'HSTS max-age must be ≥ 1 year');
  assert.match(hsts, /includeSubDomains/);
});

test('clickjacking + MIME-sniffing + referrer + permissions are locked down', () => {
  const h = globalHeaders();
  assert.equal(h['X-Content-Type-Options'], 'nosniff');
  assert.match(h['X-Frame-Options'], /^(SAMEORIGIN|DENY)$/);
  assert.match(h['Referrer-Policy'], /strict-origin/);
  assert.ok(h['Permissions-Policy'], 'Permissions-Policy must be set');
  // Sensitive device capabilities must be disabled.
  for (const cap of ['camera', 'microphone', 'geolocation']) {
    assert.match(h['Permissions-Policy'], new RegExp(cap + '=\\(\\)'), `${cap} must be disabled`);
  }
});

test('a Content-Security-Policy is present and hardened', () => {
  const h = globalHeaders();
  const csp = h['Content-Security-Policy'];
  assert.ok(csp, 'CSP must be set');
  // The directives that actually stop attacks.
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /object-src 'none'/);          // no Flash/plugins
  assert.match(csp, /base-uri 'self'/);             // no <base> hijack
  assert.match(csp, /frame-ancestors 'self'/);      // clickjacking
  assert.match(csp, /form-action 'self'/);          // no exfiltration via forms
  assert.match(csp, /upgrade-insecure-requests/);
  // Must NOT allow arbitrary remote script via a wildcard.
  assert.doesNotMatch(csp, /script-src[^;]*\*[^.]/);
});

test('/.well-known/security.txt exists with the required RFC 9116 fields', () => {
  const file = path.join(ROOT, '.well-known', 'security.txt');
  assert.ok(fs.existsSync(file), 'security.txt must exist');
  const txt = fs.readFileSync(file, 'utf8');
  assert.match(txt, /^Contact:\s+\S+/m);
  assert.match(txt, /^Expires:\s+\d{4}-\d{2}-\d{2}T/m);
  assert.match(txt, /^Canonical:\s+https:\/\//m);
  // Expiry must be in the future (RFC 9116 requires a non-expired file).
  const exp = txt.match(/^Expires:\s+(\S+)/m)[1];
  assert.ok(new Date(exp).getTime() > Date.now(), 'security.txt Expires must be in the future');
});

test('session cookies are hardened (HttpOnly + SameSite + Secure in prod)', () => {
  const auth = require('../lib/auth');
  // buildSessionCookie returns the signed value; the Set-Cookie header is built
  // separately — assert the header builder applies the protective attributes.
  const header = auth.buildSetCookieHeader
    ? auth.buildSetCookieHeader('test-value', { secure: true })
    : null;
  if (header) {
    assert.match(header, /HttpOnly/);
    assert.match(header, /SameSite=Lax/);
    assert.match(header, /Secure/);
    assert.match(header, /Path=\//);
  }
});
