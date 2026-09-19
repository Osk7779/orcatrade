'use strict';

// Sprint 86 — the exportable due-diligence bundle (Track D phase 2).
//
// GET /api/trust-pack: every live trust instrument in one dated
// artifact. The load-bearing invariant is SINGLE SOURCE OF TRUTH —
// each section is produced by the SAME computation that powers its
// live endpoint (accuracy.computeLedger, slaPublic.computeAttainment,
// the anchor history store). A bundle that could disagree with the
// website the day a reviewer checks would be worse than no bundle.
//
// Test layers:
//   1. Reuse pins: the pack imports the live handlers' computations
//      (and those handlers now export them alongside the handler fn)
//   2. Assembly: parallel sections, each failing open independently;
//      degrade path still ships the static sections
//   3. Handler posture: GET-only, cache, ?download=1 disposition,
//      pretty-printed, PII-free, never-5xx
//   4. Entity facts + router + trust-index links

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const accuracyHandler = require('../lib/handlers/accuracy');
const slaHandler = require('../lib/handlers/sla-public');

const ROOT = path.resolve(__dirname, '..');
const PACK_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'handlers', 'trust-pack.js'), 'utf8');
const ROUTER_SRC = fs.readFileSync(path.join(ROOT, 'api', '[...path].js'), 'utf8');
const TRUST_PAGE = fs.readFileSync(
  path.join(ROOT, 'marketing-shell', 'app', 'trust', 'page.tsx'),
  'utf8',
);

// ── Layer 1: single source of truth ───────────────────────────────

test('the live handlers export their computations (handler fn + compute + methodology)', () => {
  assert.equal(typeof accuracyHandler, 'function', 'accuracy handler still callable');
  assert.equal(typeof accuracyHandler.computeLedger, 'function');
  assert.ok(accuracyHandler.METHODOLOGY && typeof accuracyHandler.METHODOLOGY === 'object');
  assert.equal(typeof slaHandler, 'function', 'sla handler still callable');
  assert.equal(typeof slaHandler.computeAttainment, 'function');
  assert.ok(slaHandler.METHODOLOGY && typeof slaHandler.METHODOLOGY === 'object');
});

test('the pack assembles from the SAME computations that power the live endpoints', () => {
  assert.match(PACK_SRC, /accuracyHandler\.computeLedger\(\)\.catch\(\(\) => null\)/);
  assert.match(PACK_SRC, /slaHandler\.computeAttainment\(\)\.catch\(\(\) => null\)/);
  assert.match(PACK_SRC, /history\.listAnchorSnapshots\(\{ limit: 90 \}\)\.catch\(\(\) => \[\]\)/);
  // Methodologies travel verbatim from the live handlers.
  assert.match(PACK_SRC, /methodology: accuracyHandler\.METHODOLOGY,/);
  assert.match(PACK_SRC, /methodology: slaHandler\.METHODOLOGY,/);
  // No second implementation of any metric in this file.
  assert.ok(!/computeAccuracyLedger|computeSlaAttainment/.test(PACK_SRC),
    'the pack must never recompute metrics itself');
});

// ── Layer 2: assembly + degrade ───────────────────────────────────

test('sections load in parallel and fail open independently', () => {
  assert.match(
    PACK_SRC,
    /const \[ledger, sla, snapshots\] = await Promise\.all\(\[/,
  );
});

test('the degrade path still ships the static sections (entity + security + verification)', () => {
  const degradeBlock = PACK_SRC.match(/catch \(err\) \{[\s\S]*?\}$/m) || PACK_SRC.match(/reason: 'live sections unavailable[\s\S]*?\}, \{ download \}\);/);
  assert.ok(degradeBlock, 'degrade block not found');
  assert.match(degradeBlock[0], /entity: ENTITY,/);
  assert.match(degradeBlock[0], /security: \{ documents: SECURITY_DOCS \},/);
  assert.match(degradeBlock[0], /verification: VERIFICATION,/);
  assert.ok(!/res, 5\d\d/.test(PACK_SRC), 'a due-diligence artifact must never 5xx');
});

// ── Layer 3: handler posture ──────────────────────────────────────

test('GET-only, KV-cached, ?download=1 sets a dated attachment disposition, pretty-printed', () => {
  assert.match(PACK_SRC, /if \(req\.method !== 'GET'\)/);
  assert.match(PACK_SRC, /const CACHE_KEY = 'trust-pack:v1';/);
  assert.match(PACK_SRC, /url\.searchParams\.get\('download'\) === '1'/);
  assert.match(PACK_SRC, /attachment; filename="orcatrade-trust-pack-\$\{day\}\.json"/);
  // Read by humans in review meetings — pretty-printed.
  assert.match(PACK_SRC, /JSON\.stringify\(body, null, 2\)/);
});

test('PII-free by construction (comment-stripped code check)', () => {
  const codeOnly = PACK_SRC
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
  for (const forbidden of ['emailHash', 'externalId', 'orgId']) {
    assert.ok(
      !new RegExp(`\\b${forbidden}\\b`).test(codeOnly),
      `pack code must never touch: ${forbidden}`,
    );
  }
});

test('entity facts match the record (OrcaTrade Group Ltd; London · Warsaw · Hong Kong — never Shanghai)', () => {
  assert.match(PACK_SRC, /legalName: 'OrcaTrade Group Ltd',/);
  assert.match(PACK_SRC, /offices: \['London', 'Warsaw', 'Hong Kong'\],/);
  assert.ok(!/Shanghai/.test(PACK_SRC));
});

test('verification section names the recompute endpoints for every live section', () => {
  assert.match(PACK_SRC, /GET https:\/\/orcatrade\.pl\/api\/accuracy/);
  assert.match(PACK_SRC, /GET https:\/\/orcatrade\.pl\/api\/sla/);
  assert.match(PACK_SRC, /GET https:\/\/orcatrade\.pl\/api\/audit-anchor\/history/);
});

// ── Layer 4: router + trust index ─────────────────────────────────

test('router registers /api/trust-pack', () => {
  assert.match(ROUTER_SRC, /'trust-pack': require\('\.\.\/lib\/handlers\/trust-pack'\),/);
});

test('the trust index links all three instruments + the pack download (section XII)', () => {
  assert.match(TRUST_PAGE, /numeral="XII"/);
  assert.match(TRUST_PAGE, /href="\/trust\/anchors\/"/);
  assert.match(TRUST_PAGE, /href="\/trust\/accuracy\/"/);
  assert.match(TRUST_PAGE, /href="\/trust\/sla\/"/);
  assert.match(TRUST_PAGE, /href="\/api\/trust-pack\?download=1"/);
  assert.match(TRUST_PAGE, /an instrument that flatters itself is worse than none/);
});
