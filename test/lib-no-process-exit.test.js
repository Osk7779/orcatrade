// Handlers must never call process.exit / abort / kill.
//
// The entire API surface (~50 endpoints) lives behind a single Vercel
// serverless function: api/[...path].js → lib/handlers/<x>.js. Vercel
// reuses the same Node.js process across concurrent requests (Fluid
// Compute). A process.exit() inside ANY handler kills the function for
// EVERY concurrent request — including unrelated traffic from other
// users. Same for process.abort() and process.kill(process.pid).
//
// Pattern violations would be:
//   - A "fail fast" reflex in a recovery path
//   - An over-aggressive env-var validator inside a request handler
//   - An LLM-suggested "graceful shutdown" added to a route
//
// CLI scripts (scripts/*.js) legitimately need process.exit() to bubble
// up an exit code — they're explicitly out of scope. The test scans
// lib/ only.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const LIB_DIR = path.join(ROOT, 'lib');

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && full.endsWith('.js')) out.push(full);
  }
  return out;
}

function stripCommentsAndStrings(src) {
  let out = src.replace(/\/\*[\s\S]*?\*\//g, '');
  out = out.split('\n').map(line => {
    const idx = line.indexOf('//');
    return idx === -1 ? line : line.slice(0, idx);
  }).join('\n');
  out = out.replace(/'([^'\\]|\\.)*'/g, "''");
  out = out.replace(/"([^"\\]|\\.)*"/g, '""');
  out = out.replace(/`([^`\\]|\\.)*`/g, '``');
  return out;
}

// Patterns forbidden inside any lib/ file. Each kills the whole serverless
// function for every concurrent request.
const FORBIDDEN_PATTERNS = Object.freeze([
  { name: 'process.exit',  re: /\bprocess\.exit\s*\(/g },
  { name: 'process.abort', re: /\bprocess\.abort\s*\(/g },
  { name: 'process.kill',  re: /\bprocess\.kill\s*\(/g },
]);

// Per-file allowlist — empty today; adding one is a deliberate decision
// requiring a justification comment in the same commit.
const PER_FILE_ALLOWLIST = Object.freeze({
  // 'lib/some/legitimate-cli-helper.js': ['process.exit'],
});

function scan(filePath) {
  const src = stripCommentsAndStrings(fs.readFileSync(filePath, 'utf8'));
  const findings = [];
  for (const pat of FORBIDDEN_PATTERNS) {
    pat.re.lastIndex = 0;
    let m;
    while ((m = pat.re.exec(src)) !== null) {
      const lineNum = src.slice(0, m.index).split('\n').length;
      findings.push({ primitive: pat.name, line: lineNum });
    }
  }
  return findings;
}

test('no lib/ file calls process.exit / abort / kill', () => {
  const files = walk(LIB_DIR);
  assert.ok(files.length >= 50,
    `Expected ≥50 files under lib/, found ${files.length}. ` +
    'If the layout moved, update the walker.');

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
    `Forbidden process-termination calls in lib/:\n  ${offenders.join('\n  ')}\n\n` +
    'lib/ files run inside the shared Vercel serverless function. A process.exit() here ' +
    'kills the function for EVERY concurrent request — including unrelated traffic. ' +
    'Throw an error instead, log it, and let the handler return 500.');
});

test('scripts/ legitimately uses process.exit (sanity — wrong-scope detection)', () => {
  // If a future refactor moves CLI helpers into lib/, this guard catches
  // it. We expect scripts/ to still own the exit-code surface — confirm
  // the assumption hasn't quietly flipped.
  const scriptsDir = path.join(ROOT, 'scripts');
  if (!fs.existsSync(scriptsDir)) {
    // No scripts/ dir — that's an unusual state but not this test's job.
    return;
  }
  const scripts = walk(scriptsDir);
  const callers = scripts.filter(f => /\bprocess\.exit\s*\(/.test(fs.readFileSync(f, 'utf8')));
  assert.ok(callers.length >= 1,
    'At least one scripts/ file should call process.exit (CLI exit codes). ' +
    'If 0 callers, either the CLI surface moved or the test scope shifted — investigate.');
});

test('comment + string stripping does not produce false negatives', () => {
  const fakeReal = `process.exit(1);`;
  const fakeComment = `// process.exit(1);`;
  const fakeBlock = `/* process.exit(1); */`;
  const fakeString = `throw new Error("don't call process.exit() here");`;
  assert.match(stripCommentsAndStrings(fakeReal), /\bprocess\.exit\s*\(/);
  assert.doesNotMatch(stripCommentsAndStrings(fakeComment), /\bprocess\.exit\s*\(/);
  assert.doesNotMatch(stripCommentsAndStrings(fakeBlock), /\bprocess\.exit\s*\(/);
  assert.doesNotMatch(stripCommentsAndStrings(fakeString), /\bprocess\.exit\s*\(/);
});
