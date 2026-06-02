// SECURITY.md vulnerability-disclosure policy contract.
//
// GitHub's security advisory flow + most enterprise procurement audits
// look for SECURITY.md at the repo root. This test pins the load-bearing
// sections so a well-meaning edit can't quietly strip:
//   - the reporting address
//   - the response-time SLAs
//   - the scope (in / out)
//   - the no-legal-action guarantee for good-faith researchers
//   - the link to the deeper docs/security/ set
//
// If a section needs to change, update the assertion deliberately — the
// test is the gate, not a description of "whatever's in the file now".

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SECURITY_MD_PATH = path.join(__dirname, '..', 'SECURITY.md');

function read() {
  return fs.readFileSync(SECURITY_MD_PATH, 'utf8');
}

test('SECURITY.md exists at the repo root (GitHub community-standards hook)', () => {
  assert.ok(fs.existsSync(SECURITY_MD_PATH), 'SECURITY.md must exist at the repo root');
});

test('SECURITY.md exposes a reporting address', () => {
  const body = read();
  // The reporting address must be findable without ambiguity. We pin the
  // mailto channel; if the team adopts a different one, update both the
  // doc and this assertion in the same commit.
  assert.match(body, /security@orcatrade\.pl/, 'security@orcatrade.pl reporting mailbox listed');
});

test('SECURITY.md publishes response-time SLAs', () => {
  const body = read();
  assert.match(body, /Acknowledge receipt/i, 'acknowledge-receipt SLA row present');
  assert.match(body, /Initial triage/i, 'initial-triage SLA row present');
  assert.match(body, /Fix shipped/i, 'fix-shipped SLA row present');
  assert.match(body, /Public disclosure/i, 'public-disclosure stage present');
});

test('SECURITY.md defines scope (in + out)', () => {
  const body = read();
  assert.match(body, /In scope/i, '"In scope" section present');
  assert.match(body, /Out of scope/i, '"Out of scope" section present');
});

test('SECURITY.md commits to no legal action against good-faith researchers', () => {
  const body = read();
  // The promise is the load-bearing part — without it researchers will
  // skip the report and disclose publicly, which is the bad outcome.
  assert.match(body, /no.*legal\s+action|legal\s+action[^.]*against\s+good-faith/i,
    'no-legal-action promise present');
});

test('SECURITY.md links to docs/security/ deeper documentation', () => {
  const body = read();
  assert.match(body, /docs\/security\//, 'docs/security/ referenced');
  assert.match(body, /incident-response\.md/, 'incident-response.md linked');
  assert.match(body, /data-flow\.md/, 'data-flow.md linked');
});

test('SECURITY.md carries an honest "last updated" date', () => {
  const body = read();
  // Pin the YYYY-MM-DD shape; the value can move forward. Honesty
  // discipline (per docs/security/README.md) — every file dated.
  assert.match(body, /Last updated:\s+\d{4}-\d{2}-\d{2}/, 'last-updated date present in YYYY-MM-DD');
});

test('SECURITY.md does NOT embed PII or secrets', () => {
  const body = read();
  // The file ships publicly the moment main updates. Tripwires against
  // common slip-ups: hardcoded API keys, JWT tokens, real customer emails.
  assert.doesNotMatch(body, /sk-ant-[A-Za-z0-9_-]{8,}/, 'no Anthropic key embedded');
  assert.doesNotMatch(body, /AKIA[0-9A-Z]{16}/, 'no AWS access key embedded');
  assert.doesNotMatch(body, /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/, 'no JWT embedded');
});
