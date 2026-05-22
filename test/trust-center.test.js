const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'trust', 'index.html'), 'utf8');

test('trust center covers the core posture sections', () => {
  assert.match(html, /Trust &amp; security/);
  assert.match(html, /GDPR/);
  assert.match(html, /\/account\/privacy\//);   // export + delete live there
  assert.match(html, /SSO|OpenID Connect|OIDC/);
  assert.match(html, /\/account\/security\//);   // session revocation
  assert.match(html, /\/status\//);              // reliability
  assert.match(html, /[Ss]ubprocessor/);
});

test('trust center lists the real subprocessors', () => {
  for (const name of ['Vercel', 'Neon', 'Resend', 'Stripe', 'Sentry', 'Anthropic']) {
    assert.match(html, new RegExp(name), `subprocessor ${name} listed`);
  }
});

test('trust center is HONEST about SOC 2 — does not claim a certification we do not hold', () => {
  // Must acknowledge SOC 2 readiness...
  assert.match(html, /SOC 2/);
  assert.match(html, /not\s+(?:yet\s+)?certified/i);
  // ...and must NOT assert we are certified / compliant.
  assert.doesNotMatch(html, /SOC 2[^.]{0,40}certified\b(?![^.]*not)/i);
  assert.doesNotMatch(html, /ISO 27001 certified/i);
});

test('trust center is publicly indexable (no noindex) and canonical-tagged', () => {
  assert.doesNotMatch(html, /noindex/);
  assert.match(html, /rel="canonical" href="https:\/\/orcatrade\.pl\/trust\/"/);
});

test('trust center gives a security contact', () => {
  assert.match(html, /security@orcatrade\.pl/);
});
