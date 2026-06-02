'use strict';

// Phase 0 task P0.15 of docs/execution-plan.md.
//
// Pins the shape of .github/workflows/eval-gate.yml so the design
// promised by ADR 0018 survives well-intentioned edits:
//
//   1. The gate fires on `push: main` (post-merge), NOT on
//      `pull_request` (cost — see ADR 0018)
//   2. Path filters scope the trigger to AI-relevant code (we don't
//      spend Anthropic budget on doc-only / SEO-rotation pushes)
//   3. The matrix covers all 5 specialist agents + orchestrator
//   4. fail-fast is disabled so one agent regression doesn't mask
//      another
//   5. The eval step invokes `scripts/agent-eval.js` with
//      `--threshold` (and the default threshold is 0.95 — the
//      "≥95% pass-rate" promise in P0.15)
//   6. A missing ANTHROPIC_API_KEY surfaces as a warning + exit 0
//      (so PR forks / staging environments without the secret
//      don't permanently fail the gate)

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function readWorkflow(name) {
  return fs.readFileSync(path.join(ROOT, '.github', 'workflows', name), 'utf8');
}

// ── trigger surface ─────────────────────────────────────────────────

test('eval-gate.yml fires on push to main', () => {
  const src = readWorkflow('eval-gate.yml');
  assert.match(src, /push:\s*\n\s*branches:\s*\[main\]/, 'must trigger on push: main');
});

test('eval-gate.yml does NOT fire on pull_request (cost rationale — see ADR 0018)', () => {
  const src = readWorkflow('eval-gate.yml');
  const match = src.match(/^on:\n([\s\S]*?)^[a-z]+:/m);
  assert.ok(match, 'eval-gate.yml must have an on: block');
  assert.doesNotMatch(
    match[1],
    /pull_request:/,
    'per-PR live eval would cost ~$5-7 per push (see ADR 0018 §"Why post-merge")',
  );
});

test('eval-gate.yml scopes the push trigger to AI-relevant paths', () => {
  const src = readWorkflow('eval-gate.yml');
  // The trigger MUST include a `paths:` filter; the budget rationale
  // depends on doc-only / SEO-rotation pushes not firing the gate.
  assert.match(src, /paths:\s*\n/, 'must declare a paths: filter under the push trigger');
  // Required path coverage — each named handler + the AI library
  // tree + the calculator tree + the runner script itself + the
  // workflow file (self-reference catches CI-only edits that
  // change the gate behaviour without touching code).
  const required = [
    'lib/handlers/agent.js',
    'lib/handlers/orchestrator.js',
    'lib/handlers/sourcing-agent.js',
    'lib/handlers/logistics-agent.js',
    'lib/handlers/finance-agent.js',
    'lib/ai/**',
    'lib/intelligence/**',
    'scripts/agent-eval.js',
    '.github/workflows/eval-gate.yml',
  ];
  for (const p of required) {
    assert.ok(src.includes(p), `paths: filter missing entry "${p}"`);
  }
});

// ── matrix / job shape ──────────────────────────────────────────────

test('eval-gate.yml runs all 5 agents in matrix', () => {
  const src = readWorkflow('eval-gate.yml');
  const match = src.match(/matrix:\s*\n\s*agent:\s*\[([^\]]+)\]/);
  assert.ok(match, 'must declare a matrix.agent list');
  const agents = match[1].split(',').map((s) => s.trim());
  for (const a of ['orchestrator', 'compliance', 'finance', 'logistics', 'sourcing']) {
    assert.ok(agents.includes(a), `matrix.agent list missing "${a}"`);
  }
});

test('eval-gate.yml uses fail-fast: false (one agent failure must not mask others)', () => {
  const src = readWorkflow('eval-gate.yml');
  assert.match(src, /fail-fast:\s*false/, 'fail-fast must be false to surface every agent regression');
});

// ── threshold + runner invocation ───────────────────────────────────

test('eval-gate.yml invokes scripts/agent-eval.js with --threshold', () => {
  const src = readWorkflow('eval-gate.yml');
  assert.match(
    src,
    /node\s+scripts\/agent-eval\.js\s+--agent[^\n]*--threshold/,
    'eval-gate step must call agent-eval.js with --threshold',
  );
});

test('eval-gate.yml default threshold is 0.95 (the P0.15 promise)', () => {
  const src = readWorkflow('eval-gate.yml');
  // The default appears as the workflow_dispatch input default AND
  // as the `|| '0.95'` fallback when no manual input is provided.
  // Both must say 0.95 — drift between them would let a hand-run
  // and a push-run apply different thresholds for the same commit.
  const inputDefault = src.match(/threshold:[\s\S]*?default:\s*'(0\.[0-9]+)'/);
  assert.ok(inputDefault, 'workflow_dispatch threshold input must have a numeric default');
  assert.equal(inputDefault[1], '0.95', 'workflow_dispatch threshold default must be 0.95');

  const fallback = src.match(/github\.event\.inputs\.threshold\s*\|\|\s*'(0\.[0-9]+)'/);
  assert.ok(fallback, 'env block must fall back to a numeric default');
  assert.equal(fallback[1], '0.95', 'push-trigger threshold fallback must also be 0.95');
});

// ── ANTHROPIC_API_KEY graceful skip ─────────────────────────────────

test('eval-gate.yml warns + exits 0 when ANTHROPIC_API_KEY is missing', () => {
  const src = readWorkflow('eval-gate.yml');
  assert.match(
    src,
    /if\s+\[\s+-z\s+"\$ANTHROPIC_API_KEY"\s+\]/,
    'must guard the eval step on ANTHROPIC_API_KEY presence',
  );
  assert.match(src, /::warning::/, 'must emit a ::warning:: annotation when skipped');
});
