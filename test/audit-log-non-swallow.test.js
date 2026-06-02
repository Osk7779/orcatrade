'use strict';

// Phase 0 task P0.4 of docs/execution-plan.md.
//
// Enforces ADR 0005 ("Audit-log writes precede success responses on
// every mutation") for the five mutation-handler files the 2026-05-30
// audit named. Fails CI loudly if any of them swallows an
// `events.record(...)` failure with the empty-catch pattern.
//
// What this test catches:
//
//   try {
//     await events.record(...);
//   } catch (_) {}             ← BANNED — empty catch with `_` discard
//
//   try { await events.record(...); } catch (_e) {}    ← BANNED
//   try { await events.record(...); } catch (e) {}     ← BANNED — empty body
//
//   events.record(...).catch(() => {});                ← BANNED — promise swallow
//   events.record(...).catch(() => {/* anything */});  ← BANNED — same shape
//
// What this test allows:
//
//   await events.record(...);    ← good — propagates to the dispatcher's
//                                   try/catch at api/[...path].js:197,
//                                   which returns 500 to the client
//
//   try {
//     await events.record(...);
//   } catch (err) {
//     log.error('audit write failed', { eventName, err });
//     return res.status(503).json({ error: '...' });
//   }                            ← good — non-empty handler
//
// Today (PR #21) the migration is the SMALLER form: remove the
// swallows so the dispatcher's outer try/catch handles the audit
// failure as a 5xx. The ADR-0005-canonical form (audit FIRST, then
// mutation; explicit 503 from the handler) requires reordering the
// state-mutation vs audit-write calls in each handler — a larger
// refactor scheduled for Phase 1. This test prevents regression to
// silent swallow either way.
//
// Scope: deliberately limited to the 5 handler files the execution
// plan named for P0.4 (plus a defensive check that all 5 files
// exist). Auth + billing + other handlers have their own swallow
// patterns that are a separate triage (auth_signin failure tolerance
// is a deliberate judgement call, not a bug).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

const SCOPED_FILES = [
  'lib/handlers/plans.js',
  'lib/handlers/portfolio.js',
  'lib/handlers/account.js',
  'lib/handlers/orgs.js',
  'lib/handlers/scim.js',
];

// Line-based detector. Operates one line at a time + uses small look-back
// for the multi-line case. Regex-on-the-whole-source fails on nested
// braces inside `events.record({ ... })` payloads; the per-line approach
// is robust.

// Single-line swallow: whole `try { ... events.record(...) ...} catch (...) {}`
// fits on one line. Matches any `events.record(` on the line AND a trailing
// `} catch (...) {}` at the end of the same line. Nested braces inside the
// record payload are fine because we only check the END of the line.
const ENDS_WITH_EMPTY_CATCH = /\}\s*catch\s*\([^)]*\)\s*\{\s*\}\s*$/;

// Promise-chain swallow: `.catch(() => {})` or `.catch((_) => {})` etc.
// Allows an empty body or a body containing only a comment.
const PROMISE_CHAIN_SWALLOW = /\.catch\(\s*\([^)]*\)\s*=>\s*\{\s*(?:\/\*[^*]*\*\/\s*)?\}\s*\)/;

function scanFile(file) {
  const abs = path.join(ROOT, file);
  if (!fs.existsSync(abs)) return { fileMissing: true, violations: [] };
  const src = fs.readFileSync(abs, 'utf8');
  const lines = src.split(/\r?\n/);
  const violations = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/\bevents\.record\b/.test(line)) continue;

    // Pattern 1 (single-line): `try { ... events.record(...) ... } catch (...) {}`
    if (/\btry\s*\{/.test(line) && ENDS_WITH_EMPTY_CATCH.test(line)) {
      violations.push({
        kind: 'try-catch-empty (single-line)',
        line: i + 1,
        snippet: line.trim().slice(0, 120),
      });
      continue;
    }

    // Pattern 2 (promise-chain swallow): `events.record(...).catch(... => {})`
    // The .catch might be on the same line OR a few lines below.
    let combinedTail = line;
    for (let k = 1; k <= 4 && i + k < lines.length; k++) {
      combinedTail += ' ' + lines[i + k];
      if (lines[i + k].includes(';')) break;
    }
    if (PROMISE_CHAIN_SWALLOW.test(combinedTail)) {
      violations.push({
        kind: '.catch(() => {})',
        line: i + 1,
        snippet: line.trim().slice(0, 120),
      });
      continue;
    }

    // Pattern 3 (multi-line try / empty-catch):
    //   try {
    //     await events.record(...);   ← this line
    //   } catch (_) {}
    // Walk back 1-3 lines for `try {` + forward 1-5 lines for `} catch (...) {}`.
    let tryLine = -1;
    for (let j = i; j >= Math.max(0, i - 3); j--) {
      if (/^\s*try\s*\{/.test(lines[j])) { tryLine = j; break; }
    }
    if (tryLine === -1) continue;
    for (let k = i; k <= Math.min(lines.length - 1, i + 5); k++) {
      // Closing `} catch (...) {}` on one line:
      if (/^\s*\}\s*catch\s*\([^)]*\)\s*\{\s*\}\s*$/.test(lines[k])) {
        violations.push({
          kind: 'try-catch-empty (multi-line)',
          line: i + 1,
          snippet: `try (line ${tryLine + 1}) … events.record (line ${i + 1}) … catch {} (line ${k + 1})`,
        });
        break;
      }
      // `} catch (...) {` on one line then `}` on the next (empty body):
      if (/^\s*\}\s*catch\s*\([^)]*\)\s*\{\s*$/.test(lines[k]) && k + 1 < lines.length && /^\s*\}\s*$/.test(lines[k + 1])) {
        violations.push({
          kind: 'try-catch-empty (multi-line)',
          line: i + 1,
          snippet: `try (line ${tryLine + 1}) … events.record (line ${i + 1}) … catch {…} (lines ${k + 1}-${k + 2})`,
        });
        break;
      }
    }
  }

  return { fileMissing: false, violations };
}

test('every named mutation handler exists', () => {
  for (const file of SCOPED_FILES) {
    assert.ok(
      fs.existsSync(path.join(ROOT, file)),
      `${file} is in the P0.4 scope per docs/execution-plan.md but doesn't exist. ` +
      `If a handler was deleted, remove it from SCOPED_FILES + this test in the same PR.`,
    );
  }
});

test('no swallowed events.record() failures in P0.4-scoped mutation handlers', () => {
  const allViolations = [];
  for (const file of SCOPED_FILES) {
    const { violations } = scanFile(file);
    for (const v of violations) {
      allViolations.push({ file, ...v });
    }
  }

  if (allViolations.length === 0) return;

  const lines = allViolations.map(({ file, line, kind, snippet }) =>
    `  ${file}:${line} (${kind})\n      ${snippet}`,
  );

  assert.fail(
    `Audit-log writes swallowed in mutation handlers (violates ADR 0005):\n` +
    lines.join('\n') + '\n\n' +
    `Replace each swallow with one of:\n` +
    `  • \`await events.record(...);\` — propagates to dispatcher's try/catch → 500\n` +
    `  • \`try { await events.record(...); } catch (err) { log.error(...); return res.status(503).json({ error: '...' }); }\` — explicit 503\n` +
    `\n` +
    `The plan's longer-term shape (audit-FIRST, mutation-SECOND) is Phase 1 work; ` +
    `the smaller fix today is to stop swallowing so failure becomes visible.`,
  );
});

test('the swallow detectors catch the patterns they claim to', () => {
  // Self-pin via scanFile-equivalent on inline fixtures. Each fixture
  // gets written to /tmp + scanned; expected violation count asserted.

  function scanInline(src) {
    const lines = src.split(/\r?\n/);
    const violations = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!/\bevents\.record\b/.test(line)) continue;
      if (/\btry\s*\{/.test(line) && ENDS_WITH_EMPTY_CATCH.test(line)) {
        violations.push({ kind: 'single', line: i + 1 });
        continue;
      }
      let combinedTail = line;
      for (let k = 1; k <= 4 && i + k < lines.length; k++) {
        combinedTail += ' ' + lines[i + k];
        if (lines[i + k].includes(';')) break;
      }
      if (PROMISE_CHAIN_SWALLOW.test(combinedTail)) {
        violations.push({ kind: 'promise', line: i + 1 });
      }
    }
    return violations;
  }

  // Positive cases:
  assert.equal(scanInline(`try { await events.record('x', { foo: 1 }); } catch (_) {}`).length, 1,
    'single-line empty catch with nested braces in record payload must be caught');
  assert.equal(scanInline(`events.record('x', {}).catch(() => {});`).length, 1,
    'promise-chain swallow must be caught');
  assert.equal(scanInline(`events.record('x', {}).catch((_) => {});`).length, 1,
    'promise-chain swallow with named-discard param must be caught');

  // Negative cases:
  assert.equal(scanInline(`try { await events.record('x', {}); } catch (err) { log.error('audit', { err }); }`).length, 0,
    'non-empty catch must NOT be flagged');
  assert.equal(scanInline(`await events.record('x', {});`).length, 0,
    'simple await must NOT be flagged');
  assert.equal(scanInline(`events.record('x', {}).catch((err) => { log.error(err); });`).length, 0,
    '.catch with non-empty body must NOT be flagged');
});
