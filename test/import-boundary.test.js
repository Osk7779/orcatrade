'use strict';

// Phase 0 task P0.5 of docs/execution-plan.md — Anthropic / LLM import boundary.
//
// The rule (CLAUDE.md hard rule #2 + the spirit of hard rule #1):
//
//   "The LLM never produces a number that drives a business decision.
//    Anthropic SDK imports only in lib/handlers/ or lib/ai/."
//
// The audit on 2026-05-30 confirmed the SDK-package check (zero
// `@anthropic-ai/sdk` requires outside the allowed zones) but missed the
// raw-fetch path: the project uses `fetch('https://api.anthropic.com/...')`
// directly, which is just as much an LLM call. Before this PR landed,
// lib/intelligence/model-runtime.js was making such a call from inside the
// calculator/intelligence layer — a real violation of the rule's spirit
// even though the SDK-package check would have passed it.
//
// This test enforces BOTH signals:
//
//   1. No `require('@anthropic-ai/sdk')` / `import ... from '@anthropic-ai/sdk'`
//      anywhere outside `lib/handlers/` and `lib/ai/`.
//
//   2. No `'https://api.anthropic.com/...'` string literal (the raw-fetch
//      call site shape) anywhere outside `lib/handlers/` and `lib/ai/`.
//
// Together they catch every reasonable way to reach the Anthropic API.
// A future PR introducing the official SDK (replacing raw fetch) will not
// loosen this contract — the package check catches the SDK path; the URL
// check catches the raw-fetch path; both have the same allowed zones.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

// Directories where LLM access is forbidden. lib/ is the production tree;
// scripts/ runs in CI and prod cron, so it gets the same rule.
const SCAN_DIRS = ['lib', 'scripts'];

// Allowed zones. Any file under these paths may talk to Anthropic.
// Trailing slash is important — `lib/aix/` should NOT count as `lib/ai/`.
const ALLOWED_PREFIXES = ['lib/handlers/', 'lib/ai/'];

// Forbidden patterns. Both look at the raw source text so they catch
// dynamic require/import too (`require('@anthropic-ai/sdk' + suffix)` etc.).
const SDK_IMPORT_PATTERN = /['"]@anthropic-ai\/sdk['"]/;
const ANTHROPIC_URL_PATTERN = /['"]https:\/\/api\.anthropic\.com/;

function listJsFiles(absDir) {
  const out = [];
  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch (_) { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && full.endsWith('.js')) out.push(full);
    }
  }
  walk(absDir);
  return out;
}

function isAllowed(relPath) {
  return ALLOWED_PREFIXES.some(prefix => relPath.startsWith(prefix));
}

function scanForViolations(pattern, label) {
  const violations = [];
  for (const dir of SCAN_DIRS) {
    const absDir = path.join(ROOT, dir);
    for (const abs of listJsFiles(absDir)) {
      const rel = path.relative(ROOT, abs);
      if (isAllowed(rel)) continue;
      const src = fs.readFileSync(abs, 'utf8');
      const lines = src.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        if (pattern.test(lines[i])) {
          violations.push(`${rel}:${i + 1}  ${lines[i].trim()}`);
        }
      }
    }
  }
  return { label, violations };
}

test('no `@anthropic-ai/sdk` imports outside lib/handlers/ or lib/ai/', () => {
  const { violations } = scanForViolations(SDK_IMPORT_PATTERN, 'sdk-import');
  assert.deepEqual(
    violations,
    [],
    `Anthropic SDK imported outside allowed zones (lib/handlers/, lib/ai/). The LLM-boundary rule requires SDK access to be funnelled through those layers only.\n  ${violations.join('\n  ')}`,
  );
});

test('no raw fetch to api.anthropic.com outside lib/handlers/ or lib/ai/', () => {
  const { violations } = scanForViolations(ANTHROPIC_URL_PATTERN, 'raw-fetch');
  assert.deepEqual(
    violations,
    [],
    `Raw Anthropic API URL referenced outside allowed zones (lib/handlers/, lib/ai/). This is the spirit of the LLM-boundary rule even if the SDK package isn't imported — calculators must not talk to the model.\n  ${violations.join('\n  ')}`,
  );
});

test('lib/ai/model-runtime.js exists at the expected post-move location', () => {
  // Belt-and-braces. The boundary test above fails loudly if model-runtime
  // ends up back in lib/intelligence/, but it would also fail silently-green
  // if the file simply vanished. This assertion catches the latter and gives
  // the next reader a clear pointer to where the LLM runtime actually lives.
  const expected = path.join(ROOT, 'lib/ai/model-runtime.js');
  assert.ok(fs.existsSync(expected), 'lib/ai/model-runtime.js must exist (moved from lib/intelligence/ in PR #8)');
  const old = path.join(ROOT, 'lib/intelligence/model-runtime.js');
  assert.ok(!fs.existsSync(old), 'lib/intelligence/model-runtime.js must NOT exist (moved to lib/ai/ in PR #8)');
});

test('allowed-zone paths are unambiguous (no neighbouring directory collisions)', () => {
  // Trailing-slash discipline: `lib/aix/` and `lib/handlersx/` would falsely
  // match the prefix without the slash. This test asserts the live tree
  // contains no such neighbour that could quietly bypass the boundary.
  const libDirs = fs.readdirSync(path.join(ROOT, 'lib'), { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);
  const collisions = libDirs.filter(name =>
    (name.startsWith('ai') && name !== 'ai') ||
    (name.startsWith('handlers') && name !== 'handlers'),
  );
  assert.deepEqual(
    collisions,
    [],
    `Found lib/ subdirectories that share a prefix with the allowed zones. Add an exact-match check or rename: ${collisions.join(', ')}`,
  );
});
