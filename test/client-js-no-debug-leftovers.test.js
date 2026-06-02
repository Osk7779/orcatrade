// Client-shipped JS: no debug leftovers.
//
// Every file under js/ and dashboard/*/app.js gets served verbatim to
// every visitor — they're not built, not minified, not tree-shaken. A
// stray `console.log({ sensitive: data })` ships straight to a customer's
// devtools. A `debugger;` halts execution mid-page-load on their machine
// if their devtools is open.
//
// Discipline: legitimate error reporting via console.warn / .error /
// .info stays allowed (we don't have a client-side telemetry pipe yet,
// and silent failure is worse than a warning). Pure-debug primitives
// (console.log / .debug / .trace / .table, debugger) are blocked.
//
// Comments are stripped before scanning so docs that mention these tokens
// don't trigger false positives.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && full.endsWith('.js')) out.push(full);
  }
  return out;
}

// Strip line + block comments before scanning. Strings can contain these
// tokens too, but in practice our client JS is short + readable and a
// future false-positive would just prompt the developer to refactor.
function stripCommentsAndStrings(src) {
  // Block comments first.
  let out = src.replace(/\/\*[\s\S]*?\*\//g, '');
  // Line comments.
  out = out.split('\n').map(line => {
    const idx = line.indexOf('//');
    return idx === -1 ? line : line.slice(0, idx);
  }).join('\n');
  // Single-quoted, double-quoted, and template-literal string contents
  // (best-effort — doesn't handle escaped quotes inside backticks
  // perfectly, but our client JS doesn't have nested template strings
  // with debug tokens).
  out = out.replace(/'([^'\\]|\\.)*'/g, "''");
  out = out.replace(/"([^"\\]|\\.)*"/g, '""');
  out = out.replace(/`([^`\\]|\\.)*`/g, '``');
  return out;
}

// Forbidden in shipped client JS. Each is a debug-only primitive — a
// leftover from local development, not error reporting.
const FORBIDDEN_PATTERNS = Object.freeze([
  { name: 'console.log',   re: /\bconsole\.log\s*\(/g },
  { name: 'console.debug', re: /\bconsole\.debug\s*\(/g },
  { name: 'console.trace', re: /\bconsole\.trace\s*\(/g },
  { name: 'console.table', re: /\bconsole\.table\s*\(/g },
  { name: 'debugger',      re: /\bdebugger\s*;/g },
  // alert() / confirm() / prompt() are also debug crutches in modern
  // apps — they block the UI thread and have no place in a shipped product.
  { name: 'alert(',        re: /(?<!window\.)\balert\s*\(/g },
]);

// Allowed: console.warn / .error / .info — legitimate error reporting
// until a client-side telemetry pipe lands.

// Per-file allowlist. Each entry needs a justification comment.
// Adding to this list is a deliberate "we know, refactor queued" signal.
const PER_FILE_ALLOWLIST = Object.freeze({
  // CSV-export error reporting on the (token-gated, admin-only) leads
  // dashboard. alert() is UI-blocking and looks unpolished on a B2B
  // admin tool — a toast/banner refactor is queued, but the failure
  // path must surface visibly until then.
  'dashboard/leads/app.js': ['alert('],
});

// Scope: files we ship raw to every visitor.
function listClientJsFiles() {
  return [
    ...walk(path.join(ROOT, 'js')),
    ...walk(path.join(ROOT, 'dashboard')),
  ].sort();
}

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

test('shipped client JS contains no debug leftovers', () => {
  const files = listClientJsFiles();
  assert.ok(files.length >= 10,
    `Expected ≥10 client JS files under js/ + dashboard/, found ${files.length}. ` +
    'If the layout moved, update listClientJsFiles().');

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
    `Debug leftovers in shipped client JS:\n  ${offenders.join('\n  ')}\n\n` +
    'Every file under js/ + dashboard/ is served raw to visitors — no minifier strips these. ' +
    'A stray console.log ships sensitive context to customer devtools; a `debugger;` halts ' +
    'page load if their devtools is open. Allowed for real error reporting: ' +
    'console.warn / .error / .info.');
});

test('the file-discovery actually finds the shipped JS', () => {
  const files = listClientJsFiles().map(f => path.relative(ROOT, f));
  // Pin a few well-known files so a future refactor that moves them
  // can't silently scan zero coverage.
  for (const expected of [
    'js/main.js',
    'js/chat.js',
    'dashboard/ai/app.js',
    'dashboard/audit/app.js',
  ]) {
    assert.ok(files.includes(expected),
      `Expected ${expected} to be discovered — if renamed, update the baseline list`);
  }
});

test('legitimate console.warn / .error stays allowed', () => {
  // Defensive: an over-aggressive future edit could block ALL console use.
  // This test pins that .warn and .error remain outside the forbidden set
  // so library-init failure reporting (e.g. js/main.js line 322) keeps
  // working without a per-file allowlist entry.
  const forbiddenNames = FORBIDDEN_PATTERNS.map(p => p.name);
  for (const allowed of ['console.warn', 'console.error', 'console.info']) {
    assert.ok(!forbiddenNames.includes(allowed),
      `${allowed} must remain allowed — legitimate error reporting until client telemetry ships`);
  }
});

test('comment + string stripping does not produce false negatives', () => {
  const fakeReal = `console.log('hello');`;
  const fakeComment = `// console.log('hello');`;
  const fakeBlockComment = `/* console.log('hello'); */`;
  const fakeString = `const s = "this code contains console.log() but is a string";`;

  const stripReal = stripCommentsAndStrings(fakeReal);
  const stripComment = stripCommentsAndStrings(fakeComment);
  const stripBlock = stripCommentsAndStrings(fakeBlockComment);
  const stripString = stripCommentsAndStrings(fakeString);

  assert.match(stripReal, /console\.log\s*\(/, 'real call must survive stripping');
  assert.doesNotMatch(stripComment, /console\.log\s*\(/, 'line comment must be removed');
  assert.doesNotMatch(stripBlock, /console\.log\s*\(/, 'block comment must be removed');
  assert.doesNotMatch(stripString, /console\.log\s*\(/, 'string literal must be neutralised');
});
