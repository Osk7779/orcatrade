'use strict';

// Sprint 93 — ADR catalogue integrity (the record is part of the
// product).
//
// The ADR catalogue is the binding policy surface (CLAUDE.md), and
// every ADR carries a ## Confirmation section naming the tests that
// enforce it. This guard makes the CATALOGUE itself un-driftable:
//
//   1. Every ADR file is indexed in docs/adr/README.md — an
//      unindexed ADR is invisible policy.
//   2. Every ADR has a ## Confirmation section — a rule without a
//      named enforcement test is a preference, not policy.
//   3. Every test file an ADR's Confirmation references EXISTS —
//      a Confirmation pointing at a deleted test is a silently
//      unenforced rule.
//   4. CLAUDE.md's advertised ADR range matches the catalogue —
//      the source-of-truth doc can't lag the record.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const ADR_DIR = path.join(ROOT, 'docs', 'adr');

const adrFiles = fs.readdirSync(ADR_DIR)
  .filter((f) => /^\d{4}-[a-z0-9-]+\.md$/.test(f))
  .sort();

test('the catalogue is non-trivial and includes 0021 (sprint-93 floor)', () => {
  assert.ok(adrFiles.length >= 21, `expected ≥21 ADRs, found ${adrFiles.length}`);
  assert.ok(adrFiles.some((f) => f.startsWith('0021-')), 'ADR 0021 must exist');
});

test('every ADR is indexed in docs/adr/README.md', () => {
  const index = fs.readFileSync(path.join(ADR_DIR, 'README.md'), 'utf8');
  for (const f of adrFiles) {
    const num = f.slice(0, 4);
    assert.ok(
      index.includes(`](${f})`) || index.includes(`[${num}]`),
      `ADR ${f} is not indexed — an unindexed ADR is invisible policy`,
    );
  }
});

test('every ADR carries a ## Confirmation section (a rule without a named test is a preference)', () => {
  for (const f of adrFiles) {
    const body = fs.readFileSync(path.join(ADR_DIR, f), 'utf8');
    assert.ok(
      /## Confirmation/.test(body),
      `ADR ${f} has no ## Confirmation section`,
    );
  }
});

test('every test file referenced by an ADR Confirmation EXISTS (no silently unenforced rules)', () => {
  for (const f of adrFiles) {
    const body = fs.readFileSync(path.join(ADR_DIR, f), 'utf8');
    const confirmation = body.split(/## Confirmation/)[1] || '';
    const refs = [...confirmation.matchAll(/test\/([a-z0-9-]+\.test\.js)/g)].map((m) => m[1]);
    for (const ref of refs) {
      assert.ok(
        fs.existsSync(path.join(ROOT, 'test', ref)),
        `ADR ${f} Confirmation references test/${ref}, which does not exist`,
      );
    }
  }
});

test('CLAUDE.md advertises the current catalogue range', () => {
  const claude = fs.readFileSync(path.join(ROOT, 'CLAUDE.md'), 'utf8');
  const last = adrFiles[adrFiles.length - 1].slice(0, 4);
  assert.ok(
    claude.includes(`ADRs 0001-${last}`),
    `CLAUDE.md must advertise ADRs 0001-${last} (found a stale range)`,
  );
});
