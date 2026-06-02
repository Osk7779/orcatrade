'use strict';

// Phase 0 task P0.9 of docs/execution-plan.md.
//
// Pins the branch-protection policy and the CI workflows that feed
// it in lock-step:
//
//   1. The required-status-checks list in
//      docs/runbooks/repo-settings-branch-protection.md
//   2. The required-checks table in docs/adr/0012-branch-protection-policy.md
//   3. The shape of .github/workflows/pr-smoke.yml (the P0.9 gate)
//
// Drift between any of these silently breaks the merge gate: the
// runbook says one check name, the workflow reports another, branch
// protection waits forever on a context that never resolves, PRs
// merge unguarded. Catching it as a unit test means the corp-grade
// "promise = enforcement" rule survives renames + reorganisations.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

// The single source-of-truth list. Mirrored in the runbook's gh-api
// payload AND in the runbook's web-UI procedure AND (one row per
// entry) in ADR 0012's table. Changes to this list must update all
// three; the tests below assert that.
const REQUIRED_CONTEXTS = Object.freeze([
  'test (20)',
  'test (22)',
  'typecheck',
  'commitlint',
  'evals (offline)',
  'pr-smoke',
  'codeql / analyse (javascript-typescript)',
  'gitleaks / scan',
]);

// ── runbook ──────────────────────────────────────────────────────────

test('branch-protection runbook gh-api block lists exactly the canonical contexts', () => {
  const src = read('docs/runbooks/repo-settings-branch-protection.md');
  // Extract the JSON block inside the gh-api payload.
  const match = src.match(/"contexts":\s*\[([^\]]+)\]/);
  assert.ok(match, 'runbook must contain a contexts array');
  const listed = match[1]
    .split('\n')
    .map((l) => l.trim().replace(/[",]/g, ''))
    .filter(Boolean);
  assert.deepEqual(
    listed,
    [...REQUIRED_CONTEXTS],
    'runbook gh-api contexts array drifted from the canonical list',
  );
});

test('branch-protection runbook web-UI procedure lists every required context', () => {
  const src = read('docs/runbooks/repo-settings-branch-protection.md');
  // The web-UI section spells each context as `<name>` (markdown
  // backticks). Assert each canonical entry appears at least once.
  for (const ctx of REQUIRED_CONTEXTS) {
    const needle = '`' + ctx + '`';
    assert.ok(
      src.includes(needle),
      `runbook web-UI procedure missing context ${ctx}`,
    );
  }
});

test('branch-protection runbook does NOT still list the bare `smoke` as a required context', () => {
  // Defensive: `smoke` was the broken pre-P0.9 entry (post-deploy
  // workflow that never reports against a PR head SHA → blocks all
  // merges with a permanent "Expected" pending). It MUST stay
  // removed; the explanatory section below the contexts list keeps
  // the word for documentation purposes, so we only check the
  // JSON contexts block.
  const src = read('docs/runbooks/repo-settings-branch-protection.md');
  const jsonBlock = src.match(/"contexts":\s*\[([^\]]+)\]/)[1];
  assert.doesNotMatch(
    jsonBlock,
    /"smoke"/,
    'bare "smoke" reintroduced into required contexts — see ADR 0017 for why this breaks the merge gate',
  );
});

// ── ADR 0012 table ───────────────────────────────────────────────────

test('ADR 0012 required-checks table covers every canonical context', () => {
  const src = read('docs/adr/0012-branch-protection-policy.md');
  for (const ctx of REQUIRED_CONTEXTS) {
    const needle = '`' + ctx + '`';
    assert.ok(
      src.includes(needle),
      `ADR 0012 required-checks table missing context ${ctx}`,
    );
  }
});

// ── workflow shape: pr-smoke.yml ─────────────────────────────────────

test('pr-smoke workflow exists, triggers on pull_request, and exposes job key `pr-smoke`', () => {
  const src = read('.github/workflows/pr-smoke.yml');
  // Triggers
  assert.match(src, /^on:\s*$/m, 'pr-smoke.yml must declare an `on:` block');
  assert.match(src, /pull_request:/, 'pr-smoke.yml must trigger on pull_request');
  // Job key — this is the GitHub-reported context name; must equal
  // the runbook's required context.
  assert.match(
    src,
    /^\s{2}pr-smoke:\s*$/m,
    'pr-smoke.yml must declare a top-level job named `pr-smoke` so the GitHub context matches the runbook',
  );
});

test('pr-smoke workflow invokes scripts/smoke.js against the resolved preview URL', () => {
  const src = read('.github/workflows/pr-smoke.yml');
  assert.match(
    src,
    /node\s+scripts\/smoke\.js\s+--base/,
    'pr-smoke.yml must call scripts/smoke.js with --base <preview-url>',
  );
});

test('pr-smoke workflow polls GitHub Deployments API for Vercel preview success status', () => {
  const src = read('.github/workflows/pr-smoke.yml');
  // Two anchors: the deployments-listing endpoint and the success-state filter.
  assert.match(src, /commits\/\$SHA\/deployments/, 'must query the commit-deployments endpoint');
  assert.match(src, /select\(\.state == "success"\)/, 'must filter for state=success statuses');
});

// ── workflow shape: existing smoke.yml stays post-deploy only ───────

test('post-deploy smoke.yml still fires on push to main (kept as a tripwire)', () => {
  const src = read('.github/workflows/smoke.yml');
  assert.match(src, /on:\s*\n\s*push:\s*\n\s*branches:\s*\[main\]/);
});

test('post-deploy smoke.yml does NOT fire on pull_request (would conflict with pr-smoke)', () => {
  const src = read('.github/workflows/smoke.yml');
  // Capture the entire `on:` block (everything up to the next non-indented key).
  const match = src.match(/^on:\n([\s\S]*?)^[a-z]+:/m);
  assert.ok(match, 'smoke.yml must have an on: block');
  assert.doesNotMatch(
    match[1],
    /pull_request/,
    'smoke.yml triggering on pull_request would compete with pr-smoke.yml for the gate role',
  );
});
