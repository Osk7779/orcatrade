'use strict';

// Phase 0 task P0.J of docs/execution-plan.md. See ADR 0014.
//
// Enforces that docs/api/openapi.json is in sync with the source
// contracts at lib/contracts/v1/ + the metadata at
// lib/contracts/v1/openapi-metadata.js.
//
// If you change either source, run:
//   node scripts/generate-openapi.js
// and commit the regenerated docs/api/openapi.json in the same PR.
//
// This test runs the generator in-memory, byte-compares against the
// committed artefact. Drift fails CI loudly at the exact line of the
// first difference. Mutation-tested: edit the contract → test fails;
// regenerate → test passes.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { buildOpenApiDoc } = require('../scripts/generate-openapi');

const COMMITTED_PATH = path.resolve(__dirname, '..', 'docs', 'api', 'openapi.json');

test('docs/api/openapi.json is in sync with lib/contracts/v1/', () => {
  const generated = JSON.stringify(buildOpenApiDoc(), null, 2) + '\n';
  const committed = fs.readFileSync(COMMITTED_PATH, 'utf8');

  if (generated === committed) return; // ok

  // Find the first differing line for a useful error message.
  const generatedLines = generated.split('\n');
  const committedLines = committed.split('\n');
  const maxLen = Math.max(generatedLines.length, committedLines.length);

  for (let i = 0; i < maxLen; i++) {
    if (generatedLines[i] !== committedLines[i]) {
      assert.fail(
        `docs/api/openapi.json is stale at line ${i + 1}.\n` +
        `  Committed:  ${JSON.stringify(committedLines[i])}\n` +
        `  Generator:  ${JSON.stringify(generatedLines[i])}\n` +
        '\n' +
        'Regenerate via:\n' +
        '  node scripts/generate-openapi.js\n' +
        'and commit the result in the same PR as the contract change.',
      );
    }
  }

  // Line counts differ but every shared line matched (one is a prefix of
  // the other).
  assert.fail(
    `docs/api/openapi.json has the wrong line count.\n` +
    `  Committed:  ${committedLines.length} lines\n` +
    `  Generator:  ${generatedLines.length} lines\n` +
    '\n' +
    'Regenerate via:\n' +
    '  node scripts/generate-openapi.js\n' +
    'and commit the result in the same PR as the contract change.',
  );
});

test('every SCHEMAS entry has matching ENDPOINTS metadata (and vice versa)', () => {
  const { SCHEMAS } = require('../lib/contracts/v1');
  const { ENDPOINTS } = require('../lib/contracts/v1/openapi-metadata');

  const schemaKeys = new Set(Object.keys(SCHEMAS));
  const endpointKeys = new Set(Object.keys(ENDPOINTS));

  const missingMetadata = [...schemaKeys].filter((k) => !endpointKeys.has(k));
  assert.deepEqual(
    missingMetadata,
    [],
    `lib/contracts/v1/index.js has SCHEMAS entries with no matching ENDPOINTS metadata: ${missingMetadata.join(', ')}\n` +
    'Add an entry to lib/contracts/v1/openapi-metadata.js for each new schema.',
  );

  const orphanMetadata = [...endpointKeys].filter((k) => !schemaKeys.has(k));
  assert.deepEqual(
    orphanMetadata,
    [],
    `lib/contracts/v1/openapi-metadata.js has ENDPOINTS entries with no matching SCHEMAS contract: ${orphanMetadata.join(', ')}\n` +
    'Either add a SCHEMAS entry, or remove the orphaned metadata.',
  );
});
