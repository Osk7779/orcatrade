// Calculator-determinism contract.
//
// CLAUDE.md hard rule + ADR 0002 (calculator-grounded):
//   "The LLM never produces a number that drives a business decision.
//    Demand forecasts, anomaly thresholds, restock priorities, revenue
//    share calculations, inventory levels — all deterministic, computed
//    from data in code."
//
// Apex Pillar III3 (reproducibility verdict): every euro in a saved plan
// must be reproducible from the inputs. A `Date.now()` or `Math.random()`
// inside a calculator would silently break that — a re-run hours later
// would produce a different number, and the III3 verdict can't be honoured.
//
// This test pins the contract: each `lib/intelligence/*-quote.js` file
// is scanned and must contain no non-deterministic primitives. Comments
// and block-comments are stripped before the scan so a doc that says
// "we used to call Date.now() here" doesn't trigger false positives.
//
// What counts as non-deterministic:
//   - Math.random         (any reading of the entropy pool)
//   - Date.now            (reads the wall clock)
//   - new Date()          (no-arg form reads the wall clock)
//   - performance.now     (high-res clock)
//   - crypto.randomBytes / crypto.randomUUID
//
// Allowed forms:
//   - new Date(input)     (deterministic if input is from calculator inputs)
//   - typeof Date.now     (introspection, not a call)
//
// If a quote file genuinely needs the wall clock (rare — typically only
// for snapshot ASOFs which should be inputs anyway), add an explicit
// allowlist entry with a justification.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const INTEL_DIR = path.join(ROOT, 'lib', 'intelligence');

function listQuoteFiles() {
  return fs.readdirSync(INTEL_DIR)
    .filter(name => name.endsWith('-quote.js'))
    .map(name => path.join(INTEL_DIR, name))
    .sort();
}

// Strip line + block comments so doc text doesn't trip the scan.
function stripComments(src) {
  // Remove block comments first (greedy stops on first */ — \S\s instead
  // of . so newlines are matched).
  let out = src.replace(/\/\*[\s\S]*?\*\//g, '');
  // Remove line comments. Be lenient — we don't need to perfectly handle
  // string literals containing //, our calculator files are constants
  // + pure functions, no URL strings of interest.
  out = out.split('\n').map(line => {
    const idx = line.indexOf('//');
    return idx === -1 ? line : line.slice(0, idx);
  }).join('\n');
  return out;
}

// Per-file: explicit allowlist of acceptable findings. Empty for every
// calculator today. To opt out, add a key here with a Reason: comment
// in the same commit.
const PER_FILE_ALLOWLIST = Object.freeze({
  // 'lib/intelligence/something-quote.js': ['Math.random'],  // example
});

// Non-deterministic primitive detectors. Order matters for which fails
// first surfaces in the error message; we sort by file then by primitive.
const FORBIDDEN_PATTERNS = Object.freeze([
  { name: 'Math.random',         re: /\bMath\.random\s*\(/g },
  { name: 'Date.now',            re: /\bDate\.now\s*\(/g },
  { name: 'new Date() (no-arg)', re: /\bnew\s+Date\s*\(\s*\)/g },
  { name: 'performance.now',     re: /\bperformance\.now\s*\(/g },
  { name: 'crypto.randomBytes',  re: /\bcrypto\.randomBytes\s*\(/g },
  { name: 'crypto.randomUUID',   re: /\bcrypto\.randomUUID\s*\(/g },
]);

function scan(filePath) {
  const src = stripComments(fs.readFileSync(filePath, 'utf8'));
  const findings = [];
  for (const pat of FORBIDDEN_PATTERNS) {
    pat.re.lastIndex = 0;
    let m;
    while ((m = pat.re.exec(src)) !== null) {
      // Reconstruct the line number from the original (unstripped) source
      // so the error message points to a real line. We use stripped src
      // for detection (so comments don't trigger), but the line number
      // approximates well enough because newlines aren't removed.
      const lineNum = src.slice(0, m.index).split('\n').length;
      findings.push({ primitive: pat.name, line: lineNum });
    }
  }
  return findings;
}

test('every lib/intelligence/*-quote.js calculator is deterministic', () => {
  const files = listQuoteFiles();
  assert.ok(files.length >= 5,
    `Expected ≥5 quote files in lib/intelligence/, found ${files.length}. ` +
    'If you renamed the calculator suffix, update this test.');

  const offenders = [];
  for (const file of files) {
    const rel = path.relative(ROOT, file);
    const allowed = new Set(PER_FILE_ALLOWLIST[rel] || []);
    const findings = scan(file);
    for (const f of findings) {
      if (allowed.has(f.primitive)) continue;
      offenders.push(`${rel}:${f.line}: ${f.primitive}`);
    }
  }
  assert.deepEqual(offenders, [],
    `Calculator-determinism violations:\n  ${offenders.join('\n  ')}\n\n` +
    'Each *-quote.js file MUST be deterministic — same inputs → same outputs forever — ' +
    'because apex Pillar III3 (reproducibility verdict) re-runs every saved plan and ' +
    'compares the new output to the stored one. A clock-read here would silently break that. ' +
    'If the call is genuinely needed (e.g. a snapshot timestamp that should be an input), ' +
    'pass the value in as a parameter instead and update the caller.');
});

test('quote-file discovery actually finds the calculators', () => {
  // Sanity: if someone moves the *-quote.js files, this test would
  // silently pass with 0 files scanned. Pin a baseline so a rename
  // is loudly detected.
  const files = listQuoteFiles();
  const names = files.map(f => path.basename(f));
  for (const expected of [
    'customs-quote.js',
    'finance-quote.js',
    'routing-quote.js',
    'tco-quote.js',
  ]) {
    assert.ok(names.includes(expected),
      `Expected ${expected} in lib/intelligence/ — if renamed, update this baseline list`);
  }
});

test('comment stripping does not produce false negatives', () => {
  // Defensive: a file that contains `Date.now()` ONLY inside a comment
  // should not trigger the gate, but a real call should. Pin both
  // behaviours so a future "be smart about strings" change doesn't
  // accidentally over-strip.
  const fakeWithRealCall = `
    function timeStamp() {
      return Date.now();   // returns current time — REAL call, must be caught
    }
  `;
  const fakeWithOnlyComment = `
    // Note: we used to call Date.now() here, removed for determinism.
    /* Date.now() was here — see ADR 0002. */
    function pure(x) { return x + 1; }
  `;
  // Mimic scan() inline.
  const findReal = stripComments(fakeWithRealCall).match(/\bDate\.now\s*\(/g);
  const findComment = stripComments(fakeWithOnlyComment).match(/\bDate\.now\s*\(/g);
  assert.equal(findReal && findReal.length, 1, 'real Date.now() call must be detected');
  assert.equal(findComment, null, 'Date.now() inside comments must be stripped');
});
