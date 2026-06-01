// Runtime-dependency allowlist — enforcement of the CLAUDE.md hard rule:
//
//   "Zero npm deps in API routes. The only runtime deps are
//   @anthropic-ai/sdk and @neondatabase/serverless (see package.json).
//   Don't add deps without a reason that maps to the apex plan."
//
// pdf-lib was added in the Quote Studio sprint (2026-05-28) and is the
// third + final permitted runtime dep — anything else needs an explicit
// allowlist entry here AND a justification comment, OR the test fails CI.
//
// Why this matters (per the "promise = enforcement" directive): the
// allowlist was prose until today. The single Vercel function dispatcher
// (api/[...path].js) ships with whatever's in `dependencies` — every
// added dep widens the supply-chain attack surface, fattens the cold-
// start, and burns hobby-tier function size budget. A rule that lives
// only in CLAUDE.md gets quietly bypassed by a `npm install some-helper`
// on a Friday.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const PACKAGE_JSON_PATH = path.join(ROOT, 'package.json');

// Single source of truth — adding a dep means adding a line HERE and in
// package.json, in the same commit, with a justification comment that
// maps to the apex plan.
const ALLOWED_RUNTIME_DEPS = Object.freeze({
  '@anthropic-ai/sdk': 'AI agent layer — required for every agent handler. The only path to Claude.',
  '@neondatabase/serverless': 'Postgres client — durable mirror for events/plans/portfolios (Sprint BG-2.2 + apex A2).',
  'pdf-lib': 'Quote Studio team-tool — supplier PDF → branded OrcaTrade quote (shipped 2026-05-28).',
});

function readPkg() {
  return JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf8'));
}

test('package.json runtime dependencies match the allowlist exactly', () => {
  const pkg = readPkg();
  const deps = pkg.dependencies || {};
  const declared = Object.keys(deps).sort();
  const allowed = Object.keys(ALLOWED_RUNTIME_DEPS).sort();

  const added = declared.filter(d => !ALLOWED_RUNTIME_DEPS[d]);
  const removed = allowed.filter(d => !deps[d]);

  if (added.length || removed.length) {
    const msg = [
      'Runtime dependency drift detected:',
      added.length ? `  ADDED (not in allowlist): ${added.join(', ')}` : null,
      added.length ? '    → add an entry to ALLOWED_RUNTIME_DEPS in this test, with the justification, in the SAME commit' : null,
      removed.length ? `  REMOVED (still in allowlist): ${removed.join(', ')}` : null,
      removed.length ? '    → if intentional, delete the allowlist entry; if accidental, restore the dep' : null,
    ].filter(Boolean).join('\n');
    assert.fail(msg);
  }
});

test('package.json declares NO devDependencies (the test rig is plain Node)', () => {
  const pkg = readPkg();
  const dev = pkg.devDependencies || {};
  // We run on node --test and node:assert — no jest, no mocha, no
  // typescript at test time. If a devDep sneaks in, surface it loudly
  // so the addition is a deliberate decision.
  assert.deepEqual(Object.keys(dev), [],
    `devDependencies should be empty (got: ${Object.keys(dev).join(', ')}). The test rig is pure-Node; adding a devDep means widening the toolchain.`);
});

test('package.json is private (cannot be published to npm by accident)', () => {
  const pkg = readPkg();
  assert.equal(pkg.private, true, 'package.json must set "private": true — this repo is not an npm package');
});

test('package-lock.json is checked in (reproducible installs)', () => {
  // CI + Vercel install from the lockfile when present. Without it,
  // every install resolves caret/tilde ranges fresh — supply-chain
  // surface widens silently. Lockfile presence is a CI prerequisite.
  assert.ok(fs.existsSync(path.join(ROOT, 'package-lock.json')),
    'package-lock.json must be checked in for reproducible installs');
});

test('every allowed dep carries a non-trivial justification in the allowlist', () => {
  for (const [dep, reason] of Object.entries(ALLOWED_RUNTIME_DEPS)) {
    assert.ok(typeof reason === 'string' && reason.length >= 30,
      `${dep}: justification must be ≥30 chars (got ${reason ? reason.length : 0}). A one-word "needed" is not a justification.`);
  }
});
