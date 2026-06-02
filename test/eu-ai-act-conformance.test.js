// EU AI Act conformance document contract — apex plan P1.G.
//
// Pins the load-bearing sections so a casual edit can't strip:
//   - the scope + classification (Limited Risk) statement
//   - the transparency-obligation (Art. 50) evidence list
//   - the human-oversight (Art. 14) discipline (voluntary)
//   - the risk-management (Art. 9) table
//   - the limitations-of-this-document section (honesty discipline)

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const DOC_PATH = path.join(__dirname, '..', 'docs', 'ai', 'eu-ai-act-conformance.md');
function read() { return fs.readFileSync(DOC_PATH, 'utf8'); }

test('docs/ai/eu-ai-act-conformance.md exists', () => {
  assert.ok(fs.existsSync(DOC_PATH), 'EU AI Act conformance doc must exist');
});

test('declares Limited Risk classification explicitly', () => {
  // Without an explicit classification, the doc is decorative. The
  // classification IS the gate for which obligations apply. Pin the
  // current state; if we ever ship a High Risk agent this assertion
  // forces the doc to be updated in the same commit.
  const body = read();
  assert.match(body, /Limited Risk/, 'Limited Risk classification stated');
});

test('cites Art. 50 (transparency) and explains the evidence', () => {
  const body = read();
  assert.match(body, /Art\.\s*50/i, 'Art. 50 cited');
  assert.match(body, /transparency/i, 'transparency obligation framed');
});

test('lists the Annex III exclusions that justify Limited Risk', () => {
  // The classification rests on NOT being in Annex III. The doc must
  // state which Annex III activities the agent does not do, or the
  // classification is unsupported.
  const body = read();
  const exclusions = [
    /biometric\s+identification/i,
    /emotion\s+recognition/i,
    /social\s+scoring/i,
    /predictive\s+policing|law-enforcement/i,
    /deepfakes|synthetic\s+content/i,
  ];
  for (const re of exclusions) {
    assert.match(body, re, `Annex III exclusion missing: ${re.source}`);
  }
});

test('documents the voluntary Art. 14 human-oversight discipline', () => {
  // Limited Risk doesn't require Art. 14, but OrcaTrade applies it
  // voluntarily because of financial stakes. The doc must show the
  // five concrete mechanisms (requestHumanReview, confidence tiers,
  // audit trail, spend cap, eval gate).
  const body = read();
  const mechanisms = [
    /requestHumanReview/,
    /confidence/i,
    /audit trail|tamper-evident/i,
    /spend cap|P1\.7/i,
    /eval gate|P0\.15|≥\s*95%/i,
  ];
  for (const re of mechanisms) {
    assert.match(body, re, `Human-oversight mechanism missing: ${re.source}`);
  }
});

test('documents the risk-management table (Art. 9 voluntary)', () => {
  const body = read();
  // The table headers / key risks must be present.
  for (const re of [
    /fabrication/i,
    /omission/i,
    /prompt injection/i,
    /tool poisoning/i,
    /citation/i,
  ]) {
    assert.match(body, re, `Risk-management entry missing: ${re.source}`);
  }
});

test('states OrcaTrade does NOT train models (Art. 10 voluntary disclosure)', () => {
  // Procurement reviewers ALWAYS ask "do you train?". The doc must
  // state this clearly so the answer isn't ambiguous.
  const body = read();
  assert.match(body, /(does not|do not|not).*train|no.*fine-tun/i,
    'must explicitly state no training / no fine-tuning');
});

test('names a regulator contact + AI oversight owner', () => {
  // Without a named contact, the doc can't be acted on.
  const body = read();
  assert.match(body, /oskar@orcatrade\.pl|founder|AI oversight/i,
    'named AI oversight contact present');
});

test('carries a Limitations-of-this-document section (honesty discipline)', () => {
  const body = read();
  assert.match(body, /Limitations of this document|Not legal advice/i,
    'limitations section present (honesty discipline)');
});

test('carries a YYYY-MM-DD last-updated date + revision history row', () => {
  const body = read();
  assert.match(body, /Last updated:\s+\d{4}-\d{2}-\d{2}/,
    'last-updated date in YYYY-MM-DD');
  assert.match(body, /\| v\d+\s*\|\s*\d{4}-\d{2}-\d{2}\s*\|/,
    'revision-history row present');
});

test('links to the model cards (single source of truth for per-agent docs)', () => {
  const body = read();
  assert.match(body, /model-cards/, 'model cards referenced');
});
