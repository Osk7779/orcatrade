// CONTRIBUTING.md contract.
//
// Documents the *internal* engineering norms — what a new hire reads
// first to understand the hard rules + conventions. Pin the
// load-bearing sections so a casual edit can't strip:
//   - the "read CLAUDE.md first" pointer
//   - the non-negotiables list (calculator-grounded, integer cents,
//     no raw PII, audit-log-before-success, circuit-wrap, …)
//   - the security-issue redirect to SECURITY.md
//   - the test/commit/branch conventions
//
// If a section legitimately needs to change, update the assertion in
// the same commit — the gate is intentional, not a description of
// "whatever's in the file now".

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const CONTRIBUTING_PATH = path.join(__dirname, '..', 'CONTRIBUTING.md');
function read() { return fs.readFileSync(CONTRIBUTING_PATH, 'utf8'); }

test('CONTRIBUTING.md exists at repo root', () => {
  assert.ok(fs.existsSync(CONTRIBUTING_PATH), 'CONTRIBUTING.md must exist at repo root');
});

test('CONTRIBUTING.md points new readers at CLAUDE.md first', () => {
  // CLAUDE.md is the source of truth. CONTRIBUTING.md must redirect
  // there before stating any opinion of its own.
  const body = read();
  assert.match(body, /CLAUDE\.md/, 'CLAUDE.md referenced');
  assert.match(body, /(read|source of truth|hard rules)/i, 'positioned as authoritative');
});

test('CONTRIBUTING.md restates the non-negotiables (drift surface)', () => {
  const body = read();
  // Each phrase is load-bearing — it names a hard rule from CLAUDE.md
  // that has burned us before or is enforced by a CI gate.
  for (const phrase of [
    /calculator-grounded/i,
    /integer-cents/i,
    /No raw PII/i,
    /audit log before/i,
    /circuit/i,
  ]) {
    assert.match(body, phrase, `Non-negotiable phrase missing: ${phrase}`);
  }
});

test('CONTRIBUTING.md redirects security reports to SECURITY.md', () => {
  // Without this redirect, a researcher might open a public issue
  // disclosing a vulnerability before a fix can ship.
  const body = read();
  assert.match(body, /SECURITY\.md/, 'SECURITY.md referenced');
  assert.match(body, /Do not open a public GitHub issue/i,
    'explicit "do not open public issue" instruction present');
});

test('CONTRIBUTING.md documents the test + commit + push expectations', () => {
  const body = read();
  assert.match(body, /npm test/, 'npm test mentioned');
  assert.match(body, /(commit|conventional commits)/i, 'commit convention mentioned');
  assert.match(body, /(Push to `main` deploys|Vercel auto-deploy)/i,
    'push-to-main-deploys warning mentioned');
});

test('CONTRIBUTING.md carries an honest last-updated date', () => {
  // Honesty discipline (per docs/security/README.md) — every file dated.
  const body = read();
  assert.match(body, /Last updated:\s+\d{4}-\d{2}-\d{2}/,
    'YYYY-MM-DD last-updated date present');
});

test('CONTRIBUTING.md is honest about closed-source status', () => {
  // External contributions are not currently accepted. A clear "no" up
  // front saves a hopeful contributor's time + avoids legal awkwardness
  // (no CLA in place, IP assignment unclear).
  const body = read();
  assert.match(body, /(closed-source|not currently accepted|External contributions)/i,
    'closed-source / no-external-contributions statement present');
});
