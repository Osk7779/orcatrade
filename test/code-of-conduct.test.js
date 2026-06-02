// CODE_OF_CONDUCT.md contract.
//
// Closes the last GitHub Community-Standards gap. The file is mostly
// cosmetic for a closed-source repo today, but enterprise procurement
// audits check for its presence. Pinning the load-bearing sections so
// a casual rewrite can't strip the reporting channel or the
// enforcement-honesty disclaimer.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const COC_PATH = path.join(__dirname, '..', 'CODE_OF_CONDUCT.md');
function read() { return fs.readFileSync(COC_PATH, 'utf8'); }

test('CODE_OF_CONDUCT.md exists at repo root', () => {
  assert.ok(fs.existsSync(COC_PATH), 'CODE_OF_CONDUCT.md must exist at repo root');
});

test('CODE_OF_CONDUCT.md exposes a reporting channel', () => {
  // Without a reporting channel the file is decoration. The channel
  // doesn't have to be conduct@ specifically, but SOME contact must
  // be findable.
  const body = read();
  assert.match(body, /@orcatrade\.pl|@orcatradegroup\.com/i, 'a corporate reporting address is listed');
});

test('CODE_OF_CONDUCT.md redirects security issues to SECURITY.md', () => {
  // A conduct channel must not become a backdoor for vulnerability
  // disclosure (different SLA, different process, different audience).
  const body = read();
  assert.match(body, /SECURITY\.md/, 'SECURITY.md referenced');
});

test('CODE_OF_CONDUCT.md is honest about closed-source status', () => {
  // Avoids implying external contributions are welcome (legal/IP gap).
  const body = read();
  assert.match(body, /(closed-source|not currently accepted|External contributions)/i,
    'closed-source statement present');
});

test('CODE_OF_CONDUCT.md is honest about single-founder enforcement', () => {
  // The honest gap: there's no panel, no formal HR. We say so rather
  // than implying a process we don't have. This is the line-item that
  // would be embarrassing during an audit if it shipped as fiction.
  const body = read();
  assert.match(body, /(founder|single|sole)/i,
    'enforcement-state honesty present (single-founder / no panel yet)');
});

test('CODE_OF_CONDUCT.md carries a YYYY-MM-DD last-updated date', () => {
  const body = read();
  assert.match(body, /Last updated:\s+\d{4}-\d{2}-\d{2}/,
    'last-updated date present in YYYY-MM-DD');
});

test('CODE_OF_CONDUCT.md does NOT promise an SLA we can\'t meet', () => {
  // Tripwire against future "we respond within 1 hour 24/7" copy that
  // sounds great in a CoC but is a lie for a small team. If a future
  // revision adds an SLA, this assertion forces it to be considered.
  const body = read();
  assert.doesNotMatch(body, /24\/7|round-the-clock|guaranteed response/i,
    'must not promise an SLA the team cannot honour');
});
