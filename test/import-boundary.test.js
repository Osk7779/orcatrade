'use strict';

// Anthropic SDK import boundary — the enforcement test that ADR 0002
// and ADR 0003 name in their Confirmation sections.
//
// RESTORED in sprint 93: the ADRs referenced this file but it was
// absent from the tree — the two most load-bearing rules in the
// codebase (LLM never produces decision numbers; SDK imports only in
// lib/handlers/ + lib/ai/) were running on prose alone. The sprint-93
// ADR-catalogue integrity guard (test/adr-catalogue-integrity.test.js)
// caught the dangling reference; this restoration makes the record
// true again. That guard now prevents the same silent loss forever.
//
// The scan: every .js/.ts under lib/ and scripts/ is checked for
//   1. the SDK package import  — '@anthropic-ai/sdk'
//   2. the raw-fetch bypass    — 'https://api.anthropic.com'
// Both are permitted ONLY under lib/handlers/ and lib/ai/. The
// calculator layer (lib/intelligence/), the data layer (lib/db/),
// and everything else stay LLM-free — that wall is what makes
// "the LLM never produces a number that drives a decision"
// structurally true rather than aspirational.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

const SDK_PATTERN = /['"]@anthropic-ai\/sdk['"]/;
const RAW_FETCH_PATTERN = /['"]https:\/\/api\.anthropic\.com/;

// The ONLY directories where the SDK (or a raw API call) may appear
// (ADR 0003). Paths are relative to repo root, forward-slashed.
const ALLOWED_PREFIXES = Object.freeze([
  'lib/handlers/',
  'lib/ai/',
]);

/** @param {string} dir @param {string[]} out */
function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(js|ts)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function relOf(full) {
  return path.relative(ROOT, full).split(path.sep).join('/');
}

function isAllowed(rel) {
  return ALLOWED_PREFIXES.some((p) => rel.startsWith(p));
}

const scanned = [
  ...walk(path.join(ROOT, 'lib'), []),
  ...walk(path.join(ROOT, 'scripts'), []),
];

test('the scan sees a real tree (floor guard against a silently empty walk)', () => {
  assert.ok(scanned.length >= 100, `expected ≥100 files under lib/ + scripts/, saw ${scanned.length}`);
  // And the patterns are exercised — the Anthropic TRANSPORT (the
  // raw-fetch runtime; the platform never actually imports the SDK
  // package — zero-dep posture) genuinely exists in an allowed
  // location, so a broken pattern can't pass vacuously.
  const legalCallSites = scanned.filter((f) => {
    const rel = relOf(f);
    const body = fs.readFileSync(f, 'utf8');
    return isAllowed(rel) && (SDK_PATTERN.test(body) || RAW_FETCH_PATTERN.test(body));
  });
  assert.ok(legalCallSites.length >= 1, 'the Anthropic transport must live in an allowed location (lib/ai/model-runtime.js)');
});

test('ADR 0003: the Anthropic SDK is imported ONLY under lib/handlers/ and lib/ai/', () => {
  const violations = [];
  for (const f of scanned) {
    const rel = relOf(f);
    if (isAllowed(rel)) continue;
    if (SDK_PATTERN.test(fs.readFileSync(f, 'utf8'))) violations.push(rel);
  }
  assert.deepEqual(
    violations,
    [],
    `SDK import outside the boundary: ${violations.join(', ')} — calculators stay LLM-free (ADR 0002/0003)`,
  );
});

test('ADR 0003: no raw fetch to api.anthropic.com outside the boundary (the bypass is banned too)', () => {
  const violations = [];
  for (const f of scanned) {
    const rel = relOf(f);
    if (isAllowed(rel)) continue;
    if (RAW_FETCH_PATTERN.test(fs.readFileSync(f, 'utf8'))) violations.push(rel);
  }
  assert.deepEqual(violations, [], `raw Anthropic API call outside the boundary: ${violations.join(', ')}`);
});

test('the calculator layer specifically is LLM-free (the ADR 0002 wall, stated directly)', () => {
  const calcFiles = scanned.filter((f) => relOf(f).startsWith('lib/intelligence/'));
  assert.ok(calcFiles.length >= 20, 'expected a real calculator layer');
  for (const f of calcFiles) {
    const body = fs.readFileSync(f, 'utf8');
    assert.ok(!SDK_PATTERN.test(body) && !RAW_FETCH_PATTERN.test(body),
      `${relOf(f)} must never touch the LLM — numbers that drive decisions are deterministic`);
  }
});
