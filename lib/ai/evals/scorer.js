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

// ── Calc-grounding enforcement (Sprint BG-6.3) ───────────────
//
// THE CORE AI MOAT GUARANTEE from CLAUDE.md:
//   "The LLM never produces a number that drives a business decision.
//    The LLM only produces natural-language summaries and explanations
//    on top of pre-computed numerics."
//
// Until this sprint, that rule was prompt discipline — the SYSTEM_PROMPT
// asked the model to cite the tool that produced each number. Now it is
// CODE: extractNumbers() parses every monetary / percentage / unit token
// out of the response text, and checkGrounding() asserts that each one
// matches a value from the calculator outputs available for the request
// (within a documented rounding tolerance).
//
// When a future model hallucinates "the duty rate is 14.2%" but the
// calculator returned 14.0%, this check catches it and the case fails.
// That's the difference between "we trust the LLM to follow instructions"
// and "we verify the LLM did follow instructions."

const MONEY_RE = /€\s?([0-9][0-9,.\s]*[0-9]|[0-9])/g;              // €1,234.56 / €1.234,56 / € 1234
const MONEY_TRAILING_RE = /([0-9][0-9,.\s]*[0-9]|[0-9])\s?(?:EUR|eur)\b/g; // 1,234.56 EUR
const PERCENT_RE = /([0-9]+(?:\.[0-9]+)?)\s?%/g;
const WEIGHT_RE = /([0-9][0-9,.\s]*[0-9]|[0-9])\s?(?:kg|tonnes?|tons?)\b/gi;
// Cubic metres / days / hours — captured but not currently grounded by default
// because they tend to come from inputs, not calculator outputs.

function parseEuropeanNumber(s) {
  // Strip whitespace and resolve ambiguous separators. The hard cases:
  //   "1,234.56"  → 1234.56  (US/UK: comma=thousands, dot=decimal)
  //   "1.234,56"  → 1234.56  (EU: dot=thousands, comma=decimal)
  //   "1,234"     → 1234     (US/UK thousands separator)
  //   "1,5"       → 1.5      (EU decimal)
  //   "12.34"     → 12.34    (US/UK decimal)
  //
  // Rule: a separator followed by EXACTLY 3 digits AND no other separator of the
  // same type before it is a thousands separator. Anything followed by 1-2 digits
  // is a decimal. With BOTH separator types present, the one appearing LATER in
  // the string is the decimal (the earlier one is then by definition thousands).
  let cleaned = String(s).replace(/\s/g, '');
  const commaCount = (cleaned.match(/,/g) || []).length;
  const dotCount = (cleaned.match(/\./g) || []).length;
  if (commaCount === 0 && dotCount === 0) return Number(cleaned);

  let decimalSep = null;
  let thousandsSep = null;

  if (commaCount >= 1 && dotCount >= 1) {
    // Both types present — later one is the decimal.
    if (cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.')) {
      decimalSep = ','; thousandsSep = '.';
    } else {
      decimalSep = '.'; thousandsSep = ',';
    }
  } else if (commaCount > 1) {
    thousandsSep = ',';     // multiple commas can only be thousands (e.g. "1,234,567")
  } else if (dotCount > 1) {
    thousandsSep = '.';     // multiple dots → thousands (e.g. "1.234.567")
  } else {
    // Exactly one separator of one kind present.
    const sep = commaCount === 1 ? ',' : '.';
    const idx = cleaned.lastIndexOf(sep);
    const digitsAfter = cleaned.length - idx - 1;
    if (digitsAfter === 3) {
      // Thousands separator (e.g. "1,234" or "1.234")
      thousandsSep = sep;
    } else {
      // Decimal separator (e.g. "1,5" or "12.34")
      decimalSep = sep;
    }
  }

  if (thousandsSep) {
    cleaned = cleaned.split(thousandsSep).join('');
  }
  if (decimalSep && decimalSep !== '.') {
    cleaned = cleaned.replace(decimalSep, '.');
  }
  return Number(cleaned);
}

// Returns the array of numeric tokens found in `text`, each as
// { value: number, kind: 'money'|'percent'|'weight', raw: '€1,234.56' }.
function extractNumbers(text) {
  if (typeof text !== 'string') return [];
  const found = [];
  for (const [re, kind] of [[MONEY_RE, 'money'], [MONEY_TRAILING_RE, 'money'], [PERCENT_RE, 'percent'], [WEIGHT_RE, 'weight']]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      const value = parseEuropeanNumber(m[1]);
      if (Number.isFinite(value)) {
        found.push({ value, kind, raw: m[0] });
      }
    }
  }
  return found;
}

// Default tolerance per token kind. Money: ±1% OR ±€1, whichever is larger
// (covers display rounding). Percent: ±0.5 percentage points. Weight: ±2%.
const DEFAULT_TOLERANCE = {
  money: (a, b) => Math.abs(a - b) <= Math.max(1, Math.abs(b) * 0.01),
  percent: (a, b) => Math.abs(a - b) <= 0.5,
  weight: (a, b) => Math.abs(a - b) <= Math.max(0.5, Math.abs(b) * 0.02),
};

// Numbers that are always-grounded regardless of calculator output — they're
// part of the citation language ("[chunk-12]") or year references that the
// model can legitimately quote without a calculator. Tunable per case.
const ALWAYS_GROUNDED_NUMBERS = new Set([
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10,                  // small counts / list indices
  100,                                                // "100% of X" rhetoric
  2024, 2025, 2026, 2027,                            // calendar years
  365,                                               // days per year
]);

// Given a response + a set of allowed (calculator-grounded) numbers, return
// the per-token verdict. opts.allowedNumbers may be a Map ({ value, kind })
// or a plain array (numbers); we normalise to an array of {value, kind?}.
function checkGrounding(response, allowedNumbers, opts = {}) {
  const tokens = extractNumbers(response);
  const tolerance = Object.assign({}, DEFAULT_TOLERANCE, opts.tolerance || {});
  const allowList = (allowedNumbers || []).map(x => {
    if (typeof x === 'number') return { value: x };
    return x;
  });

  const grounded = [];
  const ungrounded = [];

  for (const tok of tokens) {
    if (ALWAYS_GROUNDED_NUMBERS.has(tok.value)) {
      grounded.push({ ...tok, reason: 'always-grounded' });
      continue;
    }
    // Does any allowed value match within tolerance for this kind?
    const tol = tolerance[tok.kind] || ((a, b) => a === b);
    const match = allowList.find(a => {
      // If allow-list specifies a kind, it must match. Otherwise wildcard.
      if (a.kind && a.kind !== tok.kind) return false;
      return tol(tok.value, a.value);
    });
    if (match) {
      grounded.push({ ...tok, matchedAllowedValue: match.value });
    } else {
      ungrounded.push(tok);
    }
  }

  return { grounded, ungrounded, totalTokens: tokens.length };
}

// ── Numeric fidelity (apex P1.6) ────────────────────────────
//
// The COUNTERPART to checkGrounding. checkGrounding catches FABRICATION
// (a number in the prose that isn't in the calculator output);
// checkNumericFidelity catches OMISSION (a calculator output that the
// agent failed to surface in prose).
//
// Why both directions matter:
//   - Without anti-fabrication: the LLM can invent a duty rate.
//   - Without anti-omission:    the LLM can summarise away the actual
//     number ("the duty applies") and the user never sees the figure
//     they need to enter on a customs declaration.
//
// Given a set of REQUIRED numbers (typically the headline outputs of
// a calculator a case considers load-bearing), check that each appears
// in the response with the same tolerance band used for grounding.
function checkNumericFidelity(response, requiredNumbers, opts = {}) {
  if (!Array.isArray(requiredNumbers) || requiredNumbers.length === 0) {
    return { present: [], missing: [], totalRequired: 0 };
  }
  const tolerance = Object.assign({}, DEFAULT_TOLERANCE, opts.tolerance || {});
  const tokens = extractNumbers(response);
  const present = [];
  const missing = [];
  for (const req of requiredNumbers) {
    const spec = typeof req === 'number' ? { value: req } : req;
    const tol = tolerance[spec.kind] || ((a, b) => a === b);
    const match = tokens.find(t => {
      if (spec.kind && spec.kind !== t.kind) return false;
      return tol(t.value, spec.value);
    });
    if (match) present.push({ ...spec, matchedToken: match.raw });
    else missing.push(spec);
  }
  return { present, missing, totalRequired: requiredNumbers.length };
}

// ── Scoring ─────────────────────────────────────────────────

function score(caseSpec, response, opts = {}) {
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

  // Sprint BG-6.3 — calc-grounding check. Opt-in by passing
  // opts.groundedNumbers (or by setting caseSpec.requireGrounding = true).
  // When ON: every monetary/percent/weight token in the response must
  // either match a value in opts.groundedNumbers (with tolerance) or be in
  // the always-grounded set (small counts, years, 100, 365).
  if (opts.groundedNumbers || caseSpec.requireGrounding) {
    const allowList = opts.groundedNumbers || [];
    const groundingResult = checkGrounding(response, allowList, opts);
    checks++;
    if (groundingResult.ungrounded.length === 0) {
      passed++;
    } else {
      for (const tok of groundingResult.ungrounded) {
        failures.push({
          kind: 'ungrounded',
          token: tok.raw,
          value: tok.value,
          numKind: tok.kind,
        });
      }
    }
  }

  // Sprint P1.6 (apex) — numeric-fidelity check. Opt-in by setting
  // caseSpec.mustContainNumbers OR passing opts.requiredNumbers. Each
  // entry is { value, kind?, tolerance? } or a bare number. The check
  // fails the case if any required number is missing from the prose,
  // closing the "LLM omitted the figure the user needs" gap.
  const requiredNumbers = opts.requiredNumbers || caseSpec.mustContainNumbers;
  if (requiredNumbers && requiredNumbers.length) {
    const fidelity = checkNumericFidelity(response, requiredNumbers, opts);
    checks++;
    if (fidelity.missing.length === 0) {
      passed++;
    } else {
      for (const miss of fidelity.missing) {
        failures.push({
          kind: 'missing-number',
          value: miss.value,
          numKind: miss.kind || 'any',
        });
      }
    }
  }

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
  // P1.6 — mustContainNumbers: each entry must be a number or
  // { value: number, kind?: 'money'|'percent'|'weight' }.
  if (caseSpec.mustContainNumbers) {
    if (!Array.isArray(caseSpec.mustContainNumbers)) {
      errors.push(`case "${caseSpec.id}": mustContainNumbers must be an array`);
    } else {
      for (let i = 0; i < caseSpec.mustContainNumbers.length; i++) {
        const entry = caseSpec.mustContainNumbers[i];
        if (typeof entry === 'number') {
          if (!Number.isFinite(entry)) {
            errors.push(`case "${caseSpec.id}" mustContainNumbers[${i}]: non-finite number`);
          }
        } else if (entry && typeof entry === 'object') {
          if (typeof entry.value !== 'number' || !Number.isFinite(entry.value)) {
            errors.push(`case "${caseSpec.id}" mustContainNumbers[${i}]: { value } must be a finite number`);
          }
          if (entry.kind && !['money', 'percent', 'weight'].includes(entry.kind)) {
            errors.push(`case "${caseSpec.id}" mustContainNumbers[${i}]: kind must be money/percent/weight`);
          }
        } else {
          errors.push(`case "${caseSpec.id}" mustContainNumbers[${i}]: must be number or { value, kind? }`);
        }
      }
    }
  }
  return errors;
}

// Per-agent coverage matrix — for each agent in the registry, surface
// which prompt versions have at least one eval case. The reverse direction
// of validateAll's referenced-version check: catches "developer added
// prompts/<agent>/v2.txt but forgot to write cases."
//
// Returns { <agent>: { versions: { v1: { casesCount } }, untestedVersions: [...] } }
// for every agent present in the registry. Agents in the registry with no
// eval-cases file at all surface as { error: '<reason>' }.
function coverageMatrix(prompts /* registry */) {
  if (!prompts || typeof prompts.listVersions !== 'function') {
    throw new Error('coverageMatrix: prompts registry argument required');
  }
  const out = {};
  // Iterate registry-listed agents, not just scorer.listAgents(), so an
  // agent with prompts but no cases file shows up as untested rather
  // than being silently invisible.
  const agentsInRegistry = listAgents().filter(a => {
    try { return prompts.listVersions(a).length > 0; }
    catch (_) { return false; }
  });
  // Also include any agent that has prompts even if its cases file is missing.
  for (const agent of new Set([...agentsInRegistry, ...listAgents()])) {
    const versions = (function () {
      try { return prompts.listVersions(agent); } catch (_) { return []; }
    })();
    let cases = [];
    try { cases = load(agent); }
    catch (err) {
      out[agent] = { error: err.message, versions: {}, untestedVersions: versions };
      continue;
    }
    const perVersion = {};
    for (const v of versions) perVersion[v] = { casesCount: 0 };
    for (const c of cases) {
      if (c && c.promptVersion && perVersion[c.promptVersion]) {
        perVersion[c.promptVersion].casesCount += 1;
      }
    }
    const untested = versions.filter(v => perVersion[v].casesCount === 0);
    out[agent] = { versions: perVersion, untestedVersions: untested };
  }
  return out;
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
  coverageMatrix,
  casesPath,
  EVALS_DIR,
  // Sprint BG-6.3 — calc-grounding primitives
  extractNumbers,
  checkGrounding,
  // Apex P1.6 — numeric fidelity (counterpart to checkGrounding)
  checkNumericFidelity,
  parseEuropeanNumber,
  DEFAULT_TOLERANCE,
  ALWAYS_GROUNDED_NUMBERS,
};
