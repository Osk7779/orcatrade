// AI model card contract — apex plan P1.F.
//
// Each lib/ai/prompts/<agent>/ must have a matching
// docs/ai/model-cards/<agent>.md with the EU AI Act Art. 11 + Annex IV
// sections present:
//   1. Intended use
//   2. Out-of-scope use
//   3. Model and provider
//   4. Inputs and outputs
//   5. Calculator grounding contract
//   6. Evaluations
//   7. Known limitations
//   8. Human oversight
//   9. Revision history
//
// Plus an index README.md tying them together.
//
// If a future PR adds a sixth agent (prompt directory) without a model
// card, the gate fails — keeping the AI documentation surface in sync
// with the actual deployed agents.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const CARDS_DIR = path.join(ROOT, 'docs', 'ai', 'model-cards');
const PROMPTS_DIR = path.join(ROOT, 'lib', 'ai', 'prompts');

function listAgentDirs() {
  return fs.readdirSync(PROMPTS_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => e.name)
    .sort();
}

function readCard(agent) {
  return fs.readFileSync(path.join(CARDS_DIR, `${agent}.md`), 'utf8');
}

test('every agent prompt directory has a matching model card', () => {
  const agents = listAgentDirs();
  const missing = agents.filter(a => !fs.existsSync(path.join(CARDS_DIR, `${a}.md`)));
  assert.deepEqual(missing, [],
    `Agents without a model card:\n  ${missing.join('\n  ')}\n\n` +
    'Every agent must have a docs/ai/model-cards/<agent>.md per the EU AI Act Art. 11 + ' +
    'Annex IV technical documentation requirement. Use docs/ai/model-cards/compliance.md ' +
    'as the template.');
});

test('docs/ai/model-cards/README.md exists as the index', () => {
  const indexPath = path.join(CARDS_DIR, 'README.md');
  assert.ok(fs.existsSync(indexPath), 'README.md index must exist');
  const body = fs.readFileSync(indexPath, 'utf8');
  // The index must list every agent.
  for (const agent of listAgentDirs()) {
    assert.match(body, new RegExp(`${agent}\\.md`, 'i'),
      `README index must reference ${agent}.md`);
  }
});

const REQUIRED_SECTIONS = Object.freeze([
  /## 1\. Intended use/i,
  /## 2\. Out-of-scope use/i,
  /## 3\. Model and provider/i,
  /## 4\. Inputs and outputs/i,
  /## 5\. Calculator grounding contract/i,
  /## 6\. Evaluations/i,
  /## 7\. Known limitations/i,
  /## 8\. Human oversight/i,
  /## 9\. Revision history/i,
]);

test('every model card carries the 9 required sections', () => {
  const agents = listAgentDirs();
  const failures = [];
  for (const agent of agents) {
    if (!fs.existsSync(path.join(CARDS_DIR, `${agent}.md`))) continue;
    const body = readCard(agent);
    for (const re of REQUIRED_SECTIONS) {
      if (!re.test(body)) failures.push(`${agent}.md missing section: ${re.source}`);
    }
  }
  assert.deepEqual(failures, [],
    `Model cards missing required sections:\n  ${failures.join('\n  ')}\n\n` +
    'Each card must carry all 9 sections per the EU AI Act Art. 11 + Annex IV template. ' +
    'Use docs/ai/model-cards/compliance.md as the reference.');
});

test('every model card states the EU AI Act classification', () => {
  // Art. 50 transparency obligation requires every AI system to disclose
  // its classification. Limited Risk is what we ship today; if a future
  // change moves an agent to High Risk, this assertion forces the card
  // to be updated in the same commit.
  const agents = listAgentDirs();
  const missing = [];
  for (const agent of agents) {
    if (!fs.existsSync(path.join(CARDS_DIR, `${agent}.md`))) continue;
    const body = readCard(agent);
    if (!/EU AI Act classification/i.test(body)) {
      missing.push(`${agent}.md does not state the EU AI Act classification`);
    }
  }
  assert.deepEqual(missing, [], missing.join('\n'));
});

test('every model card links to the calculator-grounding evidence', () => {
  // The grounding contract is the platform's core AI-safety claim. If
  // a card drops the contract section's specifics (checkGrounding,
  // checkNumericFidelity, calculator-determinism test) the AI-safety
  // claim is undocumented for that agent.
  const agents = listAgentDirs();
  const failures = [];
  for (const agent of agents) {
    if (!fs.existsSync(path.join(CARDS_DIR, `${agent}.md`))) continue;
    const body = readCard(agent);
    // Each card must reference either the grounding contract directly
    // or the standard one in the compliance card.
    const ok = /checkGrounding|grounding contract|calculator(?:-grounded| grounded)/i.test(body);
    if (!ok) failures.push(`${agent}.md does not document calculator grounding`);
  }
  assert.deepEqual(failures, [], failures.join('\n'));
});

test('every model card carries a versioned revision history', () => {
  const agents = listAgentDirs();
  const failures = [];
  for (const agent of agents) {
    if (!fs.existsSync(path.join(CARDS_DIR, `${agent}.md`))) continue;
    const body = readCard(agent);
    // Must have at least one row in the revision-history table.
    const m = body.match(/\| v\d+\s*\|\s*\d{4}-\d{2}-\d{2}\s*\|/);
    if (!m) failures.push(`${agent}.md has no revision-history row`);
  }
  assert.deepEqual(failures, [], failures.join('\n'));
});

test('the model-cards README documents the update process', () => {
  // A card without an update process gets stale silently. Pin that the
  // README spells out: bump version, add revision row, restate why.
  const body = fs.readFileSync(path.join(CARDS_DIR, 'README.md'), 'utf8');
  assert.match(body, /Updating a card|revision history|Bump.*version/i,
    'README must document the card-update process');
});
