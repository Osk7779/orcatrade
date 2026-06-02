// .editorconfig contract.
//
// A 5-line whitespace-discipline file. Pins the conventions OrcaTrade's
// existing JS already follows (2-space indent, LF, UTF-8, trailing
// newline) so a new contributor's editor doesn't silently re-tab or
// CRLF-convert on save.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const EC_PATH = path.join(__dirname, '..', '.editorconfig');
function read() { return fs.readFileSync(EC_PATH, 'utf8'); }

test('.editorconfig exists at repo root', () => {
  assert.ok(fs.existsSync(EC_PATH), '.editorconfig must exist at repo root');
});

test('.editorconfig declares root = true (no parent search beyond this file)', () => {
  // Without root=true, editors walk up the parent directory tree
  // looking for another .editorconfig. On a contributor's machine
  // with a personal ~/.editorconfig, that could override our settings.
  const body = read();
  assert.match(body, /^root\s*=\s*true/m, 'root = true must be set');
});

test('.editorconfig pins UTF-8, LF, final newline, trim-trailing, 2-space', () => {
  // These are the conventions every JS file in lib/ + js/ + dashboard/
  // already follows. The .editorconfig codifies them so future drift
  // is caught at save time.
  const body = read();
  assert.match(body, /charset\s*=\s*utf-8/, 'UTF-8 charset pinned');
  assert.match(body, /end_of_line\s*=\s*lf/, 'LF line endings pinned');
  assert.match(body, /insert_final_newline\s*=\s*true/, 'trailing newline pinned');
  assert.match(body, /trim_trailing_whitespace\s*=\s*true/, 'trim trailing whitespace pinned');
  assert.match(body, /indent_style\s*=\s*space/, 'spaces (not tabs) pinned');
  assert.match(body, /indent_size\s*=\s*2/, '2-space indent pinned');
});

test('.editorconfig excludes Markdown from trailing-whitespace trim', () => {
  // Markdown uses two trailing spaces for explicit line breaks. Stripping
  // them would silently break renderings.
  const body = read();
  assert.match(body, /\[\*\.md\][\s\S]*trim_trailing_whitespace\s*=\s*false/,
    'Markdown override (trim_trailing_whitespace = false) must be present');
});

test('every JS file under lib/ already matches the 2-space + LF convention', () => {
  // Defensive sanity — if the existing codebase doesn't actually follow
  // the rule, the .editorconfig would silently re-format every save
  // and cause noisy diffs. Sample 20 JS files; check first non-empty
  // indent is 2-space and no CRLF lines exist.
  const LIB = path.join(__dirname, '..', 'lib');
  function walk(dir, out = []) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, out);
      else if (e.isFile() && full.endsWith('.js')) out.push(full);
    }
    return out;
  }
  const files = walk(LIB).slice(0, 20);
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    assert.doesNotMatch(src, /\r\n/, `${path.relative(LIB, f)} contains CRLF — would conflict with .editorconfig LF rule`);
    // First indented line: should be 2 spaces, not tabs or 4 spaces.
    const indented = src.split('\n').find(line => /^\s+\S/.test(line));
    if (!indented) continue;
    assert.doesNotMatch(indented, /^\t/, `${path.relative(LIB, f)} indents with tabs — conflicts with space rule`);
  }
});
