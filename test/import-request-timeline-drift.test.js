'use strict';

// Drift-guard: ImportRequest audit timeline event types are pinned
// across three sides — the JS data layer's events.record() callers,
// the TS mirror in app-shell/lib/api.ts, and the polymorphic
// TransitionHistory component's per-entity-kind lookup table.
//
// If a handler starts emitting a NEW event type, the TS mirror has to
// grow to type it AND the component has to render a headline for it,
// otherwise the timeline silently falls through to the default
// "String(e.type)" branch — which surfaces ugly raw strings like
// "import_request_status_transition" to customers.
//
// This test reads the JS source (lib/db/import-requests.js +
// lib/ai/import-request-orchestrator.js) for every events.record()
// call site that names an import_request_* type, then asserts the TS
// + component sources mention each one.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const API_TS_PATH = path.join(ROOT, 'app-shell', 'lib', 'api.ts');
const COMPONENT_TS_PATH = path.join(ROOT, 'app-shell', 'components', 'TransitionHistory.tsx');

const DB_JS_SRC = fs.readFileSync(
  path.join(ROOT, 'lib', 'db', 'import-requests.js'),
  'utf8',
);
const HANDLER_JS_SRC = fs.readFileSync(
  path.join(ROOT, 'lib', 'handlers', 'imports.js'),
  'utf8',
);
const API_TS_SRC = fs.readFileSync(API_TS_PATH, 'utf8');
const COMPONENT_TS_SRC = fs.readFileSync(COMPONENT_TS_PATH, 'utf8');

// Collect import_request_* event-type strings emitted by the data
// layer + the handler. Match the events.record('foo', ...) call
// signature and pull the first string literal arg.
function collectEmittedTypes(src) {
  const re = /events\.record\(\s*['"]([a-z_]+)['"]/g;
  const found = new Set();
  let m;
  while ((m = re.exec(src))) {
    if (m[1].startsWith('import_request_')) found.add(m[1]);
  }
  return found;
}

const emittedTypes = new Set([
  ...collectEmittedTypes(DB_JS_SRC),
  ...collectEmittedTypes(HANDLER_JS_SRC),
]);

test('JS data layer + handler emit at least the v1 import_request audit types', () => {
  // Sanity: at least the four documented event types must be present.
  // If a future PR collapses one of these, the timeline UI will lose
  // a headline branch — surface the regression here.
  for (const t of ['import_request_created', 'import_request_status_transition', 'import_request_archived']) {
    assert.ok(
      emittedTypes.has(t),
      `${t} must be emitted by lib/db/import-requests.js or lib/handlers/imports.js`,
    );
  }
});

test('every emitted import_request_* type appears in the TS mirror union', () => {
  // The ImportRequestTimelineEventType union in app-shell/lib/api.ts
  // must list every type the backend can emit. Otherwise app-shell
  // typecheck stays green (the union narrows away) but the timeline
  // component never registers the new type and silently falls
  // through to the default branch.
  const block = API_TS_SRC.match(
    /export type ImportRequestTimelineEventType =([\s\S]*?);\n/,
  );
  assert.ok(block, 'ImportRequestTimelineEventType union not located in TS mirror');
  const tsTypes = new Set(
    [...block[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]),
  );
  for (const emitted of emittedTypes) {
    assert.ok(
      tsTypes.has(emitted),
      `${emitted} emitted by JS but missing from ImportRequestTimelineEventType in app-shell/lib/api.ts`,
    );
  }
});

test('every emitted import_request_* type has a headline branch in TransitionHistory', () => {
  // The component renders a headline per event type via a switch in
  // LOOKUP_BY_KIND.import_request.headline. Every emitted type must
  // have a `case '<type>':` branch — otherwise the row falls through
  // to `String(e.type)` and the customer sees the raw event name.
  for (const emitted of emittedTypes) {
    const escaped = emitted.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`case\\s+'${escaped}'`);
    assert.ok(
      re.test(COMPONENT_TS_SRC),
      `${emitted} emitted by JS but no \`case '${emitted}':\` in TransitionHistory.tsx`,
    );
  }
});

test('AuditTimelineEvent + AuditTimelineEventType unions include ImportRequestTimelineEvent', () => {
  // Without this, the polymorphic component can't take an
  // import_request event without widening its prop union — the
  // call site on /imports/[externalId] would not typecheck.
  const eventUnion = API_TS_SRC.match(
    /export type AuditTimelineEvent =([\s\S]*?);\n/,
  );
  assert.ok(eventUnion, 'AuditTimelineEvent union not located');
  assert.match(eventUnion[1], /\bImportRequestTimelineEvent\b/);

  const typeUnion = API_TS_SRC.match(
    /export type AuditTimelineEventType =([\s\S]*?);\n/,
  );
  assert.ok(typeUnion, 'AuditTimelineEventType union not located');
  assert.match(typeUnion[1], /\bImportRequestTimelineEventType\b/);
});

test('TransitionHistory EntityKind union includes import_request', () => {
  // Without this, the call site `<TransitionHistory entityKind="import_request" />`
  // wouldn't typecheck.
  assert.match(
    COMPONENT_TS_SRC,
    /export type EntityKind = 'shipment' \| 'goods' \| 'supplier' \| 'import_request';/,
  );
});

test('TransitionHistory lookup for import_request maps to the /api/imports/<id>/history URL', () => {
  // Verify the urlPath is correct — the component fetches
  // `/api/${urlPath}/${externalId}/history`. If a future refactor
  // renames the API path or changes the urlPath, this catches it.
  const block = COMPONENT_TS_SRC.match(
    /import_request:\s*\{([\s\S]*?)\n  \}/,
  );
  assert.ok(block, 'import_request lookup block not located in TransitionHistory');
  assert.match(block[1], /urlPath:\s*['"]imports['"]/);
});
