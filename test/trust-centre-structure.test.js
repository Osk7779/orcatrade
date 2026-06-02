// /trust/ landing-page structure contract — apex Wave 3 upgrade.
//
// Procurement reviewers open /trust/ first. The page is now structured
// around 11 sections, each anchor-addressable, plus a published
// "Documents we publish" grid that links to every load-bearing
// security/compliance doc in the repo. This test pins:
//   - The on-page nav exists + lists every section anchor
//   - Every documented section has its <section id="…">
//   - The doc grid links to the critical docs (so a casual edit
//     can't strip a procurement-relevant link)
//   - The certifications table acknowledges current state honestly
//     (no SOC 2 Type II claim, no ISO certification claim)
//   - The AI-use section cites no-training + EU AI Act + threat-models

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const TRUST_PATH = path.join(__dirname, '..', 'trust', 'legacy', 'index.html');
function read() { return fs.readFileSync(TRUST_PATH, 'utf8'); }

const REQUIRED_SECTION_IDS = Object.freeze([
  'gdpr',
  'auth',
  'audit',
  'reproducibility',
  'ai',
  'appsec',
  'reliability',
  'subprocessors',
  'certifications',
  'documents',
  'disclosure',
]);

test('trust/ has the on-page nav block', () => {
  const body = read();
  assert.match(body, /<nav class="trust-nav"/, 'trust-nav block must exist');
});

test('trust/ defines every required section anchor', () => {
  const body = read();
  const missing = REQUIRED_SECTION_IDS.filter(id =>
    !new RegExp(`<section id="${id}"`, 'i').test(body)
  );
  assert.deepEqual(missing, [],
    `Missing section anchors:\n  ${missing.join('\n  ')}`);
});

test('trust/ nav references every section anchor', () => {
  const body = read();
  const navMatch = body.match(/<nav class="trust-nav"[\s\S]*?<\/nav>/);
  assert.ok(navMatch, 'nav block must be parseable');
  const nav = navMatch[0];
  const missing = REQUIRED_SECTION_IDS.filter(id => !nav.includes(`href="#${id}"`));
  assert.deepEqual(missing, [],
    `Nav missing anchors:\n  ${missing.join('\n  ')}`);
});

test('trust/ certifications table reflects honest current state', () => {
  // SOC 2 Type II is NOT live; ISO 27001 is NOT live. Surface them
  // as queued. A future PR that silently promotes them to "Live"
  // without an actual certification trips this gate.
  const body = read();
  // Must contain certifications table with a SOC 2 Type II row.
  assert.match(body, /<table class="cert-table"/, 'cert-table must exist');
  assert.match(body, /SOC 2 Type II/, 'SOC 2 Type II row present');
  // The Type II row must NOT carry the "ok" badge (would imply Live).
  const typeIIRowRe = /<tr>[^<]*<td>SOC 2 Type II<\/td>[\s\S]*?<\/tr>/;
  const typeIIRow = body.match(typeIIRowRe);
  assert.ok(typeIIRow, 'Type II row must be matchable');
  assert.doesNotMatch(typeIIRow[0], /cert-badge\s+ok/,
    'SOC 2 Type II must NOT be marked Live — no certification held');
  // Same for ISO 27001.
  const iso27001RowRe = /<tr>[^<]*<td>ISO 27001<\/td>[\s\S]*?<\/tr>/;
  const iso27001Row = body.match(iso27001RowRe);
  assert.ok(iso27001Row, 'ISO 27001 row must be matchable');
  assert.doesNotMatch(iso27001Row[0], /cert-badge\s+ok/,
    'ISO 27001 must NOT be marked Live — no certification held');
});

test('trust/ Documents section links to every critical doc', () => {
  const body = read();
  // Each doc-grid entry's substantive presence — checking by the
  // filename in the link target. If a doc gets renamed in the repo,
  // this test forces the trust page to be updated in the same commit.
  for (const docRef of [
    'SECURITY.md',
    'docs/security/data-flow.md',
    'docs/security/retention-policy.md',
    'docs/security/audit-trail.md',
    'docs/security/subprocessors.md',
    'docs/security/vendor-tprm.md',
    'docs/security/dpa-template.md',
    'docs/security/soc2-readiness.md',
    'docs/security/incident-response.md',
    'docs/security/threat-models',
    'docs/security/pentest-scope.md',
    'docs/ai/model-cards',
    'docs/ai/eu-ai-act-conformance.md',
    'CONTRIBUTING.md',
  ]) {
    assert.match(body, new RegExp(docRef.replace(/\./g, '\\.').replace(/\//g, '\\/')),
      `Documents section must link to ${docRef}`);
  }
});

test('trust/ AI section cites the load-bearing AI-safety claims', () => {
  const body = read();
  // Each phrase is a procurement-relevant claim. Removing any of them
  // weakens the trust position; the test prevents silent drift.
  const aiSection = body.match(/<section id="ai"[\s\S]*?<\/section>/);
  assert.ok(aiSection, 'AI section must be parseable');
  for (const phrase of [
    /No decision-driving numbers from the LLM/i,
    /EU AI Act/i,
    /Limited Risk/i,
    /No training on customer data/i,
    /requestHumanReview/,
    /spend cap/i,
    /Threat models/i,
  ]) {
    assert.match(aiSection[0], phrase,
      `AI section must address: ${phrase.source}`);
  }
});

test('trust/ Reproducibility section mentions TARIC duty pinning (apex P1.1)', () => {
  // Wave 2 just shipped TARIC pinning; the trust page promised
  // "every euro reproducible" — must now actually mention TARIC.
  const body = read();
  const reproSection = body.match(/<section id="reproducibility"[\s\S]*?<\/section>/);
  assert.ok(reproSection, 'Reproducibility section must exist');
  assert.match(reproSection[0], /TARIC/, 'reproducibility section must cite TARIC pinning');
});

test('trust/ does NOT promise certifications we do not hold', () => {
  const body = read();
  // Tripwire against marketing-shine drift. We can SAY "queued" / "in
  // progress"; we cannot say we ARE certified / compliant / accredited.
  // The regex looks for the phrase pattern that would constitute an
  // overclaim — careful not to fire on legitimate uses.
  // Allowed: "SOC 2 readiness", "ISO 27001 queued", "EU AI Act conformance"
  //          (EU AI Act self-declares Limited Risk — that IS our position).
  // Forbidden: "SOC 2 certified", "ISO 27001 certified", "we are SOC 2 Type II"
  assert.doesNotMatch(body, /\bSOC 2 (Type [I]+ )?certified\b/i,
    'must not claim SOC 2 certification');
  assert.doesNotMatch(body, /\bISO 27001 certified\b/i,
    'must not claim ISO 27001 certification');
  assert.doesNotMatch(body, /\bISO 27701 certified\b/i,
    'must not claim ISO 27701 certification');
});
