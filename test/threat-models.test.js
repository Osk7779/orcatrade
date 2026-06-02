// Threat-model contract — apex plan P1.E.
//
// Three threat models required: AI agent, customer API, magic-link
// auth. Each must follow the STRIDE structure (Spoofing, Tampering,
// Repudiation, Information disclosure, Denial of service, Elevation
// of privilege) so a security reviewer can find the same shape in
// each document.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const TM_DIR = path.join(__dirname, '..', 'docs', 'security', 'threat-models');

const REQUIRED_MODELS = Object.freeze([
  'ai-agent.md',
  'customer-api.md',
  'magic-link-auth.md',
]);

function read(name) {
  return fs.readFileSync(path.join(TM_DIR, name), 'utf8');
}

test('threat-models folder exists with the 3 required documents', () => {
  assert.ok(fs.existsSync(TM_DIR), 'threat-models folder must exist');
  for (const name of REQUIRED_MODELS) {
    assert.ok(fs.existsSync(path.join(TM_DIR, name)), `${name} must exist`);
  }
});

test('threat-models README links every model', () => {
  const readme = path.join(TM_DIR, 'README.md');
  assert.ok(fs.existsSync(readme), 'README index must exist');
  const body = fs.readFileSync(readme, 'utf8');
  for (const name of REQUIRED_MODELS) {
    assert.match(body, new RegExp(name.replace('.', '\\.')),
      `README must link to ${name}`);
  }
});

const STRIDE_HEADERS = Object.freeze([
  /###\s+S\s*—\s*Spoofing/i,
  /###\s+T\s*—\s*Tampering/i,
  /###\s+R\s*—\s*Repudiation/i,
  /###\s+I\s*—\s*Information disclosure/i,
  /###\s+D\s*—\s*Denial of service/i,
  /###\s+E\s*—\s*Elevation of privilege/i,
]);

test('every threat model follows the STRIDE structure', () => {
  const failures = [];
  for (const name of REQUIRED_MODELS) {
    const body = read(name);
    for (const re of STRIDE_HEADERS) {
      if (!re.test(body)) failures.push(`${name} missing STRIDE section: ${re.source}`);
    }
  }
  assert.deepEqual(failures, [],
    `Threat models missing STRIDE sections:\n  ${failures.join('\n  ')}\n\n` +
    'Every model must carry all 6 STRIDE categories so a security reviewer can find the same shape ' +
    'across documents.');
});

const REQUIRED_SECTIONS = Object.freeze([
  /## 1\. Adversary objectives/i,
  /## 2\. Attack paths/i,
  /## 3\. Out-of-scope/i,
  /## 4\. Residual risk \+ gap log/i,
  /## 5\. Review checklist/i,
  /## 6\. Revision history/i,
]);

test('every threat model carries the 6 top-level sections', () => {
  const failures = [];
  for (const name of REQUIRED_MODELS) {
    const body = read(name);
    for (const re of REQUIRED_SECTIONS) {
      if (!re.test(body)) failures.push(`${name} missing section: ${re.source}`);
    }
  }
  assert.deepEqual(failures, [], failures.join('\n'));
});

test('every threat model carries an owner + last-reviewed date', () => {
  const failures = [];
  for (const name of REQUIRED_MODELS) {
    const body = read(name);
    if (!/\*\*Owner:\*\*/.test(body)) failures.push(`${name} missing **Owner:**`);
    if (!/\*\*Last reviewed:\*\*\s+\d{4}-\d{2}-\d{2}/.test(body)) {
      failures.push(`${name} missing **Last reviewed:** YYYY-MM-DD`);
    }
    if (!/\*\*Cadence:\*\*/.test(body)) failures.push(`${name} missing **Cadence:**`);
  }
  assert.deepEqual(failures, [], failures.join('\n'));
});

test('every threat model declares an explicit gap log (honesty discipline)', () => {
  // A threat model that claims "all mitigated, no gaps" is almost
  // certainly lying. Pin that each model surfaces residual risk —
  // even if just "Acceptable today" entries.
  const failures = [];
  for (const name of REQUIRED_MODELS) {
    const body = read(name);
    // Must mention either an explicit "Queued" gap, an "Acceptable
    // today" deferral, or a "Phase 2 / sprint queued" follow-up.
    if (!/Queued|Acceptable|queued/.test(body)) {
      failures.push(`${name}: no acknowledged gaps (every threat model should surface some residual risk or "acceptable today" trade-off)`);
    }
  }
  assert.deepEqual(failures, [], failures.join('\n'));
});

test('ai-agent.md covers the AI-specific risks (fabrication, omission, prompt injection)', () => {
  const body = read('ai-agent.md');
  // The AI-agent model would be deficient without these three. Pin
  // them as required content.
  for (const re of [
    /prompt injection/i,
    /tool poisoning/i,
    /requestHumanReview/,
    /grounding|fabrication/i,
  ]) {
    assert.match(body, re, `ai-agent.md must address: ${re.source}`);
  }
});

test('customer-api.md covers authz + rate-limit + repudiation paths', () => {
  const body = read('customer-api.md');
  for (const re of [
    /Authz bypass|ownership|cross-tenant/i,
    /Rate-limit|spend cap/i,
    /Repudiation|audit log/i,
  ]) {
    assert.match(body, re, `customer-api.md must address: ${re.source}`);
  }
});

test('magic-link-auth.md covers token reuse + enumeration + cookie theft', () => {
  const body = read('magic-link-auth.md');
  for (const re of [
    /token (?:reuse|replay)/i,
    /enumer/i,
    /HttpOnly|SameSite|HSTS/i,
  ]) {
    assert.match(body, re, `magic-link-auth.md must address: ${re.source}`);
  }
});
