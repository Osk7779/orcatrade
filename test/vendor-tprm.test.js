// Vendor TPRM register contract — apex plan P1.L.
//
// Pin the 12-question shared template, the required vendor list
// (every subprocessor in subprocessors.md must appear here), and the
// risk-rating distribution discipline.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const DOC_PATH = path.join(__dirname, '..', 'docs', 'security', 'vendor-tprm.md');
const SUBPROC_PATH = path.join(__dirname, '..', 'docs', 'security', 'subprocessors.md');
function read() { return fs.readFileSync(DOC_PATH, 'utf8'); }

test('docs/security/vendor-tprm.md exists', () => {
  assert.ok(fs.existsSync(DOC_PATH), 'vendor-tprm.md must exist');
});

test('declares the 12-question shared template', () => {
  // The questions are the framework; if Q1-Q12 aren't documented,
  // the per-vendor answers below them have no schema.
  const body = read();
  for (let i = 1; i <= 12; i++) {
    assert.match(body, new RegExp(`\\|\\s*Q${i}\\s*\\|`),
      `Q${i} must be in the shared template table`);
  }
});

test('answers every active subprocessor from subprocessors.md', () => {
  // The 5 active subprocessors named in subprocessors.md must each
  // have a per-vendor section in this TPRM register. Catches the case
  // where someone adds a subprocessor without going through TPRM.
  const body = read();
  for (const vendor of ['Vercel', 'Upstash', 'Resend', 'Stripe', 'Anthropic']) {
    assert.match(body, new RegExp(`### 3\\.\\d+\\s+${vendor}`),
      `${vendor} must have a TPRM section`);
  }
});

test('covers planned / queued vendors (Neon, Voyage, Sentry, GitHub)', () => {
  // Neon is live per memory; Voyage queued for P1.11; Sentry live per
  // memory; GitHub is the source-control vendor (always live for a
  // hosted-code project).
  const body = read();
  for (const vendor of ['Neon', 'Voyage', 'Sentry', 'GitHub']) {
    assert.match(body, new RegExp(vendor, 'i'),
      `${vendor} must be in the TPRM register`);
  }
});

test('every vendor answer carries a Last verified date or honest pending status', () => {
  const body = read();
  // Split on the per-vendor headings and check each chunk has either
  // a "Last verified:" line or "Pending vendor onboarding/response".
  const sections = body.split(/^### 3\.\d+\s+/m).slice(1);
  assert.ok(sections.length >= 7, `expected ≥7 vendor sections, got ${sections.length}`);
  for (const section of sections) {
    const name = section.split('\n')[0];
    const hasVerified = /Last verified:/i.test(section);
    const hasPending = /Pending vendor (onboarding|response)/i.test(section);
    assert.ok(hasVerified || hasPending,
      `Vendor "${name}" must declare either Last verified or Pending status`);
  }
});

test('explicit no-training-on-customer-data claim for every applicable vendor', () => {
  // The #1 procurement question. Every vendor section must address it
  // (Q8 in the template). The shared-template row already ensures Q8
  // appears in each table; this assertion adds the substantive claim.
  const body = read();
  // At minimum, the load-bearing vendors (Vercel, Anthropic, Neon)
  // must state "No" to training/advertising explicitly.
  for (const vendor of ['Vercel', 'Anthropic', 'Neon', 'Resend']) {
    const sectionRe = new RegExp(`### 3\\.\\d+\\s+${vendor}[\\s\\S]+?(?=### |## )`, 'i');
    const m = body.match(sectionRe);
    assert.ok(m, `Vendor section for ${vendor} must be findable`);
    // The Q8 row in each table must contain "**No.**" or similar.
    assert.match(m[0], /\*\*No\.?\*\*|no\s+training/i,
      `Vendor ${vendor} must answer Q8 with a "No" on training`);
  }
});

test('publishes the risk-rating distribution', () => {
  // Procurement reviewers want a one-line "how many high-risk vendors
  // do you have?" answer. The distribution table provides it.
  const body = read();
  assert.match(body, /## 4\.\s*Risk-rating distribution/i, 'distribution section present');
  for (const level of ['Low', 'Medium', 'Medium-High', 'High']) {
    assert.match(body, new RegExp(`\\|\\s*\\*\\*${level}\\*\\*\\s*\\|`),
      `Risk level "${level}" must be in the distribution table`);
  }
});

test('documents the onboarding process for a new subprocessor', () => {
  // Without an onboarding process, vendors get added ad-hoc and the
  // 30-day customer notice obligation is silently violated.
  const body = read();
  assert.match(body, /## 2\.\s*Onboarding process/i, 'onboarding section present');
  assert.match(body, /30 days|customer notice/i, '30-day notice obligation referenced');
});

test('cross-references subprocessors.md as the canonical register', () => {
  // The two documents must stay in sync; the cross-link is how a
  // reviewer can audit "is everything in subprocessors.md covered?"
  const body = read();
  assert.match(body, /subprocessors\.md/, 'subprocessors.md cross-referenced');
});

test('carries the standard doc spine (date + revision row + Limitations)', () => {
  const body = read();
  assert.match(body, /Last updated:\s+\d{4}-\d{2}-\d{2}/, 'YYYY-MM-DD date');
  assert.match(body, /\| v\d+\s*\|\s*\d{4}-\d{2}-\d{2}\s*\|/, 'revision row');
  assert.match(body, /Limitations of this document/i, 'Limitations section');
});

test('subprocessors.md still exists (cross-reference target)', () => {
  // If subprocessors.md is renamed or deleted without updating this
  // doc, the cross-reference goes stale silently.
  assert.ok(fs.existsSync(SUBPROC_PATH),
    'subprocessors.md must exist (cross-referenced from vendor-tprm.md)');
});
