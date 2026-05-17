// Offline structural scorer for AI eval cases — Sprint BG-6.2 phase 1.
//
// The shipped scripts/agent-eval.js runs cases end-to-end against the
// live Anthropic API and asserts tools-called + citations + keywords.
// That's a real integration test that requires an API key + costs money,
// so it runs nightly in cron, not on every push.
//
// This module is the COMPLEMENT: a pure-function scorer that runs offline
// in <50ms and validates the shape of the response against the case spec.
// `npm test` runs this layer; `scripts/agent-eval.js` runs the LLM layer.
//
// Layered contract:
//   - load(agent)           → cases array for that agent, asserts shape on read
//   - score(case, response) → { pass, failures[], score } pure function over text
//   - validateAll()         → walks every shipped cases file and asserts:
//                             • prompt_version refs map to a registry version
//                             • every regex compiles
//                             • required fields present
//                             Used by the test suite to fail CI if a case file
//                             drifts from the registry.
//
// Case shape:
//   {
//     id: 'cn-bicycles-ad',                       // unique within the agent
//     name: 'Bicycles ex-CN: anti-dumping stack',
//     promptVersion: 'v1',                        // which prompt this case targets
//     input: '…',                                 // single user message
//     mustContain: ['/Anti-dumping|AD/i', '48.5%'], // regex-or-substring patterns
//     mustNotContain: ['/^I cannot help/i'],
//     expectedTools: ['searchRegulations'],       // optional, scored if present
//     description: 'Why this case exists',        // human-readable
//   }
//
// Patterns starting + ending with `/` are parsed as regex; everything
// else is treated as a substring.

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const EVALS_DIR = __dirname;

// ── Case-file loading ────────────────────────────────────────

function casesPath(agent) {
  if (!/^[a-z][a-z0-9_-]{0,40}$/.test(agent)) {
    throw new Error(`scorer.load: invalid agent "${agent}"`);
  }
  return path.join(EVALS_DIR, agent, 'cases.v1.json');
}

function load(agent) {
  const file = casesPath(agent);
  if (!fs.existsSync(file)) {
    throw new Error(`scorer.load: no cases file for "${agent}" at ${file}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`scorer.load: ${file} is not valid JSON: ${err.message}`);
  }
  if (!parsed || !Array.isArray(parsed.cases)) {
    throw new Error(`scorer.load: ${file} must export { cases: [...] }`);
  }
  return parsed.cases;
}

function listAgents() {
  return fs.readdirSync(EVALS_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => e.name)
    .filter(name => fs.existsSync(casesPath(name)))
    .sort();
}

// ── Pattern parsing ─────────────────────────────────────────

function parsePattern(p) {
  if (typeof p !== 'string') {
    throw new TypeError(`scorer: pattern must be a string, got ${typeof p}`);
  }
  // Regex shorthand: starts AND ends with /, optional flags after the trailing /.
  const m = p.match(/^\/(.+)\/([gimsuy]*)$/);
  if (m) {
    return { kind: 'regex', value: new RegExp(m[1], m[2]) };
  }
  return { kind: 'substring', value: p };
}

function patternMatches(parsed, text) {
  if (parsed.kind === 'regex') return parsed.value.test(text);
  return text.includes(parsed.value);
}

// ── Scoring ─────────────────────────────────────────────────

function score(caseSpec, response) {
  if (!caseSpec || typeof caseSpec !== 'object') {
    throw new TypeError('scorer.score: caseSpec object required');
  }
  if (typeof response !== 'string') {
    throw new TypeError('scorer.score: response string required');
  }

  const failures = [];
  let checks = 0;
  let passed = 0;

  for (const raw of (caseSpec.mustContain || [])) {
    checks++;
    const p = parsePattern(raw);
    if (patternMatches(p, response)) passed++;
    else failures.push({ kind: 'missing', pattern: raw });
  }

  for (const raw of (caseSpec.mustNotContain || [])) {
    checks++;
    const p = parsePattern(raw);
    if (!patternMatches(p, response)) passed++;
    else failures.push({ kind: 'forbidden', pattern: raw });
  }

  // expectedTools is asserted by the live runner (scripts/agent-eval.js)
  // since the offline scorer only has the response text. We carry it forward
  // for completeness so a case spec doesn't lose data.

  return {
    pass: failures.length === 0,
    score: checks === 0 ? 1 : passed / checks,
    checks,
    passed,
    failures,
  };
}

// ── Full structural validation across every shipped cases file ──

function validateCase(caseSpec, agent, idx) {
  const errors = [];
  if (!caseSpec || typeof caseSpec !== 'object') {
    errors.push(`case #${idx}: not an object`);
    return errors;
  }
  if (!caseSpec.id || !/^[a-z0-9][a-z0-9_-]{0,80}$/.test(caseSpec.id)) {
    errors.push(`case #${idx}: invalid id "${caseSpec.id}"`);
  }
  if (!caseSpec.promptVersion || !/^v\d{1,3}$/.test(caseSpec.promptVersion)) {
    errors.push(`case "${caseSpec.id}": invalid promptVersion "${caseSpec.promptVersion}"`);
  }
  if (typeof caseSpec.input !== 'string' || caseSpec.input.length < 5) {
    errors.push(`case "${caseSpec.id}": input must be a string of ≥5 chars`);
  }
  // mustContain + mustNotContain must be arrays of strings; regex patterns
  // must compile. We compile each one to surface a clean error here rather
  // than at score-time.
  for (const field of ['mustContain', 'mustNotContain']) {
    if (!caseSpec[field]) continue;
    if (!Array.isArray(caseSpec[field])) {
      errors.push(`case "${caseSpec.id}": ${field} must be an array`);
      continue;
    }
    for (let i = 0; i < caseSpec[field].length; i++) {
      try { parsePattern(caseSpec[field][i]); }
      catch (err) {
        errors.push(`case "${caseSpec.id}" ${field}[${i}]: ${err.message}`);
      }
    }
  }
  return errors;
}

// Walks every <agent>/cases.v1.json and returns aggregated errors. The
// test suite calls this once and fails if anything's returned.
function validateAll(prompts /* registry */) {
  const errors = [];
  for (const agent of listAgents()) {
    let cases;
    try { cases = load(agent); }
    catch (err) { errors.push(err.message); continue; }

    if (cases.length === 0) {
      errors.push(`${agent}: cases.v1.json has 0 cases — write at least one`);
      continue;
    }

    // Duplicate id detection.
    const seen = new Set();
    for (let i = 0; i < cases.length; i++) {
      const c = cases[i];
      const caseErrors = validateCase(c, agent, i);
      for (const e of caseErrors) errors.push(`${agent}: ${e}`);
      if (c && c.id) {
        if (seen.has(c.id)) errors.push(`${agent}: duplicate case id "${c.id}"`);
        seen.add(c.id);
      }
    }

    // Cross-check: every promptVersion referenced must exist in the registry.
    if (prompts) {
      const available = new Set(prompts.listVersions(agent));
      if (available.size === 0) {
        errors.push(`${agent}: no prompt versions in registry but cases exist — ship lib/ai/prompts/${agent}/v1.txt`);
      } else {
        for (const c of cases) {
          if (c && c.promptVersion && !available.has(c.promptVersion)) {
            errors.push(`${agent}: case "${c.id}" references promptVersion ${c.promptVersion}, not in registry (have: ${[...available].join(', ')})`);
          }
        }
      }
    }
  }
  return errors;
}

module.exports = {
  load,
  listAgents,
  score,
  parsePattern,
  validateCase,
  validateAll,
  casesPath,
  EVALS_DIR,
};
