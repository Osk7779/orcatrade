'use strict';

// Phase 0 task P0.6 of docs/execution-plan.md — model-registry enforcement.
//
// The rule: every Anthropic SDK call must take its model ID from the central
// registry at lib/ai/models.js (`MODELS.AGENT` / `MODELS.TRIAGE` /
// `MODELS.BULK`). Hardcoded `model: 'claude-…'` strings are forbidden in
// production handlers and intelligence modules — they drift, they fragment
// the apex-plan "Opus-first" posture (docs/billion-dollar-plan.md §Pillar I,
// I1), and they make a model bump a search-and-replace job instead of a
// one-line registry edit.
//
// This test scans every `.js` file under `lib/handlers/`, `lib/intelligence/`,
// and `scripts/` for the pattern `model:\s*['"]claude-` (lowercase `model`
// followed by optional whitespace, a string literal opener, and `claude-`).
// That pattern matches Anthropic API call sites without false-positiving the
// documentation header comments (which use `// Model: claude-…`, capital `M`,
// no quote) or the pricing table in `lib/ai/cost-telemetry.js` (which uses
// `claude-…` as object KEYS, never as a `model:` field value).
//
// Exemptions are explicit and small:
//   • `lib/ai/`                  — registry + cost telemetry pricing table
//   • `lib/handlers/factory-score.js` — TEMPORARY. File is ESM-syntax under
//     a CJS dispatcher and importing the registry needs a separate scope-
//     bounded fix (PR #7 follow-up: convert to CJS, adopt MODELS).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

const SCAN_DIRS = [
  'lib/handlers',
  'lib/intelligence',
  'scripts',
];

// Exact files exempted. Keep this list small and well-justified — every
// addition is debt. Empty set means the rule is fully enforced.
const EXEMPT_FILES = new Set([]);

// The forbidden pattern. Lowercase `model:` (the Anthropic API field name)
// followed by optional whitespace and a string literal opener.
const FORBIDDEN = /model:\s*['"]claude-/;

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

test('no hardcoded `model: "claude-…"` strings outside the central registry', () => {
  const violations = [];
  for (const dir of SCAN_DIRS) {
    const absDir = path.join(ROOT, dir);
    for (const abs of listJsFiles(absDir)) {
      const rel = path.relative(ROOT, abs);
      if (EXEMPT_FILES.has(rel)) continue;
      const src = fs.readFileSync(abs, 'utf8');
      const lines = src.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        if (FORBIDDEN.test(lines[i])) {
          violations.push(`${rel}:${i + 1}  ${lines[i].trim()}`);
        }
      }
    }
  }
  assert.deepEqual(
    violations,
    [],
    `Hardcoded model strings detected. Use MODELS.AGENT / MODELS.TRIAGE / MODELS.BULK from lib/ai/models.js instead.\n  ${violations.join('\n  ')}`,
  );
});

test('the three previously-drifted handlers now import MODELS from the registry', () => {
  // Belt-and-braces. The grep test above is the load-bearing rule, but the
  // intent of P0.6 was *also* to ensure these specific files actually adopt
  // the registry (not just remove the string somehow). Verifies the
  // require()/import is present.
  const supplyChain = fs.readFileSync(path.join(ROOT, 'lib/handlers/supply-chain.js'), 'utf8');
  assert.match(supplyChain, /require\(['"]\.\.\/ai\/models['"]\)/, 'supply-chain.js must import MODELS');

  const quickCheck = fs.readFileSync(path.join(ROOT, 'lib/handlers/quick-check.js'), 'utf8');
  assert.match(quickCheck, /require\(['"]\.\.\/ai\/models['"]\)/, 'quick-check.js must import MODELS');

  // factory-score.js was previously exempted because its ESM-syntax under a
  // CJS dispatcher made `require('../ai/models')` unsafe. PR #10 converted
  // the file to CJS + adopted MODELS.TRIAGE; the exemption is now removed
  // and the import is mandatory like every other handler.
  const factoryScore = fs.readFileSync(path.join(ROOT, 'lib/handlers/factory-score.js'), 'utf8');
  assert.match(factoryScore, /require\(['"]\.\.\/ai\/models['"]\)/, 'factory-score.js must import MODELS (post-CJS-conversion)');
  assert.match(factoryScore, /model: MODELS\.TRIAGE/, 'factory-score.js must select the TRIAGE tier via MODELS.TRIAGE');
});

test('lib/ai/models.js exports the expected MODELS shape', () => {
  // If this fails, the registry itself was renamed/reshaped — the grep test
  // above would still pass, but every consumer of MODELS.* would break.
  const { MODELS } = require('../lib/ai/models');
  assert.equal(typeof MODELS, 'object');
  assert.ok(MODELS.AGENT, 'MODELS.AGENT must be set');
  assert.ok(MODELS.TRIAGE, 'MODELS.TRIAGE must be set');
  assert.ok(MODELS.BULK, 'MODELS.BULK must be set');
  // The TRIAGE value is what factory-score.js currently mirrors verbatim.
  // If the registry value drifts, the factory-score mirror comment is no
  // longer accurate and the file must be updated in the same PR.
  assert.equal(MODELS.TRIAGE, 'claude-haiku-4-5', 'TRIAGE value must match the factory-score.js mirror');
});
