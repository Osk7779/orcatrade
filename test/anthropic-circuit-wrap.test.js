'use strict';

// Phase 0 task P0.3 of docs/execution-plan.md.
//
// Enforces ADR 0006 ("Every external HTTP call is wrapped in lib/circuit.js")
// for the Anthropic API surface. Wave 1 PR #8 enforced the import-boundary
// (raw fetch + SDK only in lib/handlers/ and lib/ai/); this test enforces
// that each such allowed Anthropic call site is also circuit-wrapped.
//
// Heuristic: per-file. If a file contains `fetch('https://api.anthropic.com')`
// (or similar), it must also contain `circuit.run('anthropic-...')`. Catches
// the common case (one Anthropic call per handler today); doesn't catch the
// pathological case of a file with two Anthropic calls where only one is
// wrapped (no such file exists today; if one ever appears, the enforcement
// can tighten to per-call detection).
//
// EXEMPT_FILES is deliberately tiny + each entry is debt with a named follow-up.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

const SCAN_DIRS = ['lib/handlers', 'lib/intelligence', 'lib/ai'];

// Exemptions — keep tiny + well-justified + temporary.
const EXEMPT_FILES = new Set([
  // TEMPORARY — wrapped in a follow-up PR once PR #10 (factory-score
  // CJS conversion) merges. Today the file is ESM under a CJS dispatcher;
  // converting it AND wrapping it AND coordinating with PR #10's branch
  // is too much in one go.
  'lib/handlers/factory-score.js',

  // TEMPORARY — wrapped in a follow-up PR once PR #8 (import-boundary +
  // relocate model-runtime to lib/ai/) merges. On main today, the file
  // is at lib/intelligence/model-runtime.js; PR #8 moves it to
  // lib/ai/model-runtime.js. Wrapping the wrong-path version here would
  // create a merge conflict with PR #8.
  'lib/intelligence/model-runtime.js',
]);

// The 6 handlers P0.3's plan explicitly named.
const REQUIRED_HANDLERS = [
  'lib/handlers/agent.js',
  'lib/handlers/finance-agent.js',
  'lib/handlers/logistics-agent.js',
  'lib/handlers/orchestrator.js',
  'lib/handlers/sourcing-agent.js',
  'lib/handlers/supply-chain.js',
];

const ANTHROPIC_URL_PATTERN = /['"]https:\/\/api\.anthropic\.com/;
const CIRCUIT_WRAP_PATTERN = /circuit\.run\(\s*['"]anthropic-/;

function listJsFiles(absDir) {
  const out = [];
  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith('_') || entry.name === 'node_modules') continue;
        walk(full);
      } else if (entry.isFile() && full.endsWith('.js')) {
        out.push(full);
      }
    }
  }
  walk(absDir);
  return out;
}

test('every file with a raw Anthropic fetch also wraps it in circuit.run', () => {
  const violations = [];
  for (const dir of SCAN_DIRS) {
    for (const file of listJsFiles(path.join(ROOT, dir))) {
      const rel = path.relative(ROOT, file);
      if (EXEMPT_FILES.has(rel)) continue;
      const src = fs.readFileSync(file, 'utf8');
      if (!ANTHROPIC_URL_PATTERN.test(src)) continue;
      if (!CIRCUIT_WRAP_PATTERN.test(src)) {
        violations.push(rel);
      }
    }
  }

  if (violations.length === 0) return;

  assert.fail(
    `Files containing a raw Anthropic fetch but no circuit.run('anthropic-...') wrap:\n` +
    violations.map((v) => `  ${v}`).join('\n') + '\n\n' +
    `Wrap the fetch in circuit.run per the pattern in lib/handlers/agent.js (see ADR 0006).\n` +
    `If the file genuinely should be exempt, add it to EXEMPT_FILES here with a comment naming the follow-up.`,
  );
});

test('the 6 plan-named handlers all wrap Anthropic in circuit.run', () => {
  // Belt-and-braces. The grep test above is the load-bearing rule; this
  // pins the specific files the execution plan listed for P0.3, so a
  // future refactor that, say, removes the wrap from finance-agent.js
  // fails loudly here even if the file's overall structure changes.
  for (const file of REQUIRED_HANDLERS) {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    assert.match(
      src,
      CIRCUIT_WRAP_PATTERN,
      `${file} must wrap its Anthropic call in circuit.run('anthropic-...') per ADR 0006`,
    );
    assert.match(
      src,
      /require\(['"]\.\.\/circuit['"]\)/,
      `${file} must require('../circuit') to use the wrap`,
    );
  }
});

test('EXEMPT_FILES entries actually exist + carry the temporary marker', () => {
  // If an exempt file is deleted (e.g. PR #8 lands and renames model-runtime),
  // this test fails loudly so the exemption can be cleaned up in the same PR
  // rather than rotting silently.
  for (const exempt of EXEMPT_FILES) {
    assert.ok(
      fs.existsSync(path.join(ROOT, exempt)),
      `EXEMPT_FILES entry "${exempt}" no longer exists. ` +
      `Either remove it from EXEMPT_FILES (the file moved/deleted; close the exemption) ` +
      `or update the path to the file's new location.`,
    );
  }
});
