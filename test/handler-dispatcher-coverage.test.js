// Handler ↔ dispatcher coverage contract.
//
// The single Vercel serverless function (api/[...path].js) routes every
// /api/<name> request to a handler in lib/handlers/. Two failure modes
// are silent until they bite:
//
//   1. Orphan handler. A new lib/handlers/foo.js shipped without the
//      matching `foo: require('../lib/handlers/foo')` line in the
//      dispatcher. The handler is dead code — never reachable, never
//      tested by integration paths. CI never flags it.
//
//   2. Ghost require. The dispatcher requires a path that doesn't exist
//      on disk (typo, file moved). The require throws at cold-start, so
//      the FIRST request hitting that container crashes; subsequent
//      requests get a fresh container that also crashes. Outage.
//
// This test pins:
//   - Every non-helper handler file in lib/handlers/ is wired into the
//     dispatcher's require graph.
//   - Every require() target in the dispatcher resolves to a file on disk.
//
// Helpers (modules that are required by handlers but not exposed at a URL)
// are explicitly allowlisted with a justification.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const HANDLERS_DIR = path.join(ROOT, 'lib', 'handlers');
const DISPATCHER_PATH = path.join(ROOT, 'api', '[...path].js');

// Helpers — modules in lib/handlers/ that are NOT exposed at a URL.
// Each entry is a deliberate "this is a sub-module of another handler"
// statement, with the reason captured here so a future developer doesn't
// "fix" the orphan by wiring it up.
const HANDLER_HELPERS = Object.freeze({
  'orchestrator-personal.js': 'Sub-module of orchestrator.js (buildPersonalImpls) — not its own URL surface.',
});

function listHandlerFiles() {
  return fs.readdirSync(HANDLERS_DIR)
    .filter(f => f.endsWith('.js'))
    .sort();
}

function readDispatcher() {
  return fs.readFileSync(DISPATCHER_PATH, 'utf8');
}

// Pull the set of handler basenames referenced by the dispatcher's
// require lines. The pattern is `require('../lib/handlers/<name>')`.
function dispatcherReferencedHandlers() {
  const src = readDispatcher();
  const re = /require\(['"]\.\.\/lib\/handlers\/([a-z0-9-]+)['"]\)/g;
  const out = new Set();
  let m;
  while ((m = re.exec(src)) !== null) out.add(m[1] + '.js');
  return out;
}

test('every non-helper handler file is wired into the dispatcher', () => {
  const referenced = dispatcherReferencedHandlers();
  const onDisk = listHandlerFiles();

  // Sanity: the dispatcher must require at least 40 handlers — if it
  // drops sharply, something structural has changed.
  assert.ok(referenced.size >= 40,
    `Dispatcher references ${referenced.size} handlers — expected ≥40. ` +
    'If the dispatcher restructured (e.g. dynamic require), update this test.');

  const orphans = [];
  for (const file of onDisk) {
    if (HANDLER_HELPERS[file]) continue;
    if (!referenced.has(file)) orphans.push(file);
  }
  assert.deepEqual(orphans, [],
    `Orphan handler files (in lib/handlers/ but NOT required by the dispatcher):\n  ${orphans.join('\n  ')}\n\n` +
    'Either wire them into api/[...path].js, or — if intentionally a sub-module of another handler — ' +
    'add an entry to HANDLER_HELPERS in this test with a justification comment.');
});

test('every dispatcher-required handler exists on disk (no ghost requires)', () => {
  const referenced = dispatcherReferencedHandlers();
  const ghosts = [];
  for (const file of referenced) {
    if (!fs.existsSync(path.join(HANDLERS_DIR, file))) ghosts.push(file);
  }
  assert.deepEqual(ghosts, [],
    `Ghost requires (dispatcher references files that don't exist):\n  ${ghosts.join('\n  ')}\n\n` +
    'These would throw at cold-start and crash every request that hits the container until ' +
    'Vercel rotates it (which it does on every crash → cascading outage). Fix the typo or ' +
    'restore the missing file.');
});

test('HANDLER_HELPERS entries actually exist on disk (allowlist hygiene)', () => {
  // An allowlist that names a non-existent file is silently broken —
  // it'd suppress an orphan check for a file that wasn't an orphan in
  // the first place. Pin the allowlist to current reality.
  const missing = [];
  for (const file of Object.keys(HANDLER_HELPERS)) {
    if (!fs.existsSync(path.join(HANDLERS_DIR, file))) missing.push(file);
  }
  assert.deepEqual(missing, [],
    `HANDLER_HELPERS contains entries that don't exist on disk:\n  ${missing.join('\n  ')}\n\n` +
    'If the file was deleted, also remove its allowlist entry — keeping a stale entry can ' +
    'mask a future orphan with the same name.');
});

test('every helper is actually required by SOME other handler (no orphan helpers)', () => {
  // A helper that no handler uses is just an orphan with a different label.
  // Confirm each HANDLER_HELPERS entry is imported by at least one of the
  // other handler files.
  const orphans = [];
  for (const helper of Object.keys(HANDLER_HELPERS)) {
    const stem = helper.replace(/\.js$/, '');
    const re = new RegExp(`require\\(['"]\\.\\/${stem}['"]\\)|require\\(['"]\\.\\.\\/handlers\\/${stem}['"]\\)`);
    let usedBy = null;
    for (const f of listHandlerFiles()) {
      if (f === helper) continue;
      if (re.test(fs.readFileSync(path.join(HANDLERS_DIR, f), 'utf8'))) {
        usedBy = f;
        break;
      }
    }
    if (!usedBy) orphans.push(helper);
  }
  assert.deepEqual(orphans, [],
    `Helper modules declared in HANDLER_HELPERS but not actually required by another handler:\n  ${orphans.join('\n  ')}\n\n` +
    'A "helper" with no caller is just an orphan. Either wire it up, delete it, or remove the allowlist entry.');
});
