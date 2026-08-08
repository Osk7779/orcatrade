'use strict';

// Sprint 85 — public SLA attainment (Track D phase 1).
//
// "An SLA you can't verify is a slogan." GET /api/sla publishes
// platform-wide measured attainment for both commitments;
// /trust/sla renders it in the trust register. Same posture suite
// as /api/accuracy: PII-free by construction, KV-cached, cache
// fail-open, degrade-to-accruing (never 5xx), honest tiers.
//
// Also covers the sprint-85 dual-scoping of the two SLA readers:
// orgId omitted → platform-wide; integer → org slice. The
// unconfigured-DB runtime path must return [] in BOTH scopes.
//
// Test layers:
//   1. Readers: dual-scope pins + unconfigured runtime
//   2. Handler: GET-only, cache posture, parallel corpus reads,
//      degrade path, PII absence, /api/slo distinction
//   3. Router + rewrites + page/component pins

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const importRequestsDb = require('../lib/db/import-requests');

const ROOT = path.resolve(__dirname, '..');
const DB_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'db', 'import-requests.js'), 'utf8');
const HANDLER_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'handlers', 'sla-public.js'), 'utf8');
const ROUTER_SRC = fs.readFileSync(path.join(ROOT, 'api', '[...path].js'), 'utf8');
const VERCEL_JSON = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
const LIVE_TSX = fs.readFileSync(
  path.join(ROOT, 'marketing-shell', 'components', 'marketing', 'sla-attainment-live.tsx'),
  'utf8',
);
const PAGE_TSX = fs.readFileSync(
  path.join(ROOT, 'marketing-shell', 'app', 'trust', 'sla', 'page.tsx'),
  'utf8',
);

// ── Layer 1: dual-scope readers ───────────────────────────────────

test('both SLA readers are dual-scope: integer-gated org clause, omitted → platform-wide', () => {
  for (const fn of ['listQuoteTurnaroundsForSla', 'listFirstResponsesForSla']) {
    const block = DB_SRC.match(new RegExp(`async function ${fn}\\(\\{[\\s\\S]*?\\n\\}`));
    assert.ok(block, `${fn} not found`);
    const body = block[0];
    assert.match(body, /const orgScoped = Number\.isInteger\(orgId\);/, `${fn}: integer gate`);
    assert.match(body, /\$\{orgScoped \? 'AND org_id = \$2' : ''\}/, `${fn}: conditional org clause`);
    assert.match(body, /orgScoped \? \[String\(days\), orgId\] : \[String\(days\)\]/, `${fn}: param switch`);
    // The org-required early-return is GONE — platform-wide is legal.
    assert.ok(!/\|\| !Number\.isInteger\(orgId\)\) return \[\]/.test(body), `${fn}: platform-wide must not early-return`);
  }
});

test('unconfigured DB returns [] in both scopes (runtime)', async () => {
  assert.deepEqual(await importRequestsDb.listQuoteTurnaroundsForSla({}), []);
  assert.deepEqual(await importRequestsDb.listQuoteTurnaroundsForSla({ orgId: 7 }), []);
  assert.deepEqual(await importRequestsDb.listFirstResponsesForSla({}), []);
});

// ── Layer 2: handler ─────────────────────────────────────────────

test('handler is GET-only, KV-cached with TTL, fail-open on cache trouble', () => {
  assert.match(HANDLER_SRC, /if \(req\.method !== 'GET'\)/);
  assert.match(HANDLER_SRC, /const CACHE_KEY = 'sla:attainment:v1';/);
  assert.match(HANDLER_SRC, /const CACHE_TTL_SECONDS = 5 \* 60;/);
  assert.match(HANDLER_SRC, /catch \(_\) \{ \/\* cache read is best-effort \*\/ \}/);
  assert.match(HANDLER_SRC, /catch \(_\) \{ \/\* cache write is best-effort \*\/ \}/);
});

test('handler reads both cuts in PARALLEL, platform-wide (no orgId)', () => {
  // Sprint 98 generalised this pin: the Promise.all gained the
  // breach-ledger count as a third parallel read.
  assert.match(
    HANDLER_SRC,
    /const \[turnRows, frRows(?:, breachCount)?\] = await Promise\.all\(\[/,
  );
  assert.match(HANDLER_SRC, /importRequests\.listQuoteTurnaroundsForSla\(\{ windowDays: slaCalc\.SLA_WINDOW_DAYS \}\),/);
  assert.match(HANDLER_SRC, /importRequests\.listFirstResponsesForSla\(\{ windowDays: slaCalc\.SLA_WINDOW_DAYS \}\),/);
  // Comment-stripped: comments may explain the omission; code must
  // never pass an org scope.
  const codeOnly = HANDLER_SRC
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
  assert.ok(!/\borgId\b/.test(codeOnly), 'the public endpoint must never take an org scope');
});

test('handler degrades to the truthful accruing state — a trust surface never 5xxs', () => {
  assert.match(HANDLER_SRC, /quoteTurnaround: slaCalc\.computeSlaAttainment\(\[\], \{/);
  assert.match(HANDLER_SRC, /firstResponse: slaCalc\.computeSlaAttainment\(\[\], \{/);
  assert.ok(!/res, 5\d\d/.test(HANDLER_SRC));
});

test('response is PII-free by construction (comment-stripped code check)', () => {
  const codeOnly = HANDLER_SRC
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
  for (const forbidden of ['emailHash', 'externalId', 'label']) {
    assert.ok(
      !new RegExp(`\\b${forbidden}\\b`).test(codeOnly),
      `handler code must never touch row-level field: ${forbidden}`,
    );
  }
});

test('methodology names both clock definitions (rework-laundering + human-only)', () => {
  assert.match(HANDLER_SRC, /a rework never launders a slow first answer/);
  assert.match(HANDLER_SRC, /automated transitions never stop the clock/);
});

// ── Layer 3: router + surfaces ───────────────────────────────────

test('router registers /api/sla, distinct from /api/slo (commitments vs infrastructure)', () => {
  assert.match(ROUTER_SRC, /sla: require\('\.\.\/lib\/handlers\/sla-public'\),/);
  assert.match(ROUTER_SRC, /slo: require\('\.\.\/lib\/handlers\/slo'\),/);
  assert.match(ROUTER_SRC, /Distinct from\s*\n?\s*\/\/ \/api\/slo/);
});

test('vercel.json rewrites /trust/sla (bare + trailing + pl + de)', () => {
  const sources = VERCEL_JSON.rewrites.map((r) => r.source);
  for (const s of ['/trust/sla', '/trust/sla/', '/pl/trust/sla', '/de/trust/sla']) {
    assert.ok(sources.includes(s), `missing rewrite: ${s}`);
  }
});

test('live component fetches /api/sla and withholds honestly at the insufficient tier', () => {
  assert.match(LIVE_TSX, /fetch\('\/api\/sla', \{ credentials: 'omit' \}\)/);
  assert.match(LIVE_TSX, /const withheld = a\.tier === 'insufficient';/);
  assert.match(LIVE_TSX, /Nothing is back-filled or guessed\./);
  // Both commitments render with their definitional notes.
  assert.match(LIVE_TSX, /a rework never launders a slow first answer/);
  assert.match(LIVE_TSX, /Automated transitions never stop this clock/);
});

test('trust page mounts the live attainment + documents the four clock rules + raw endpoint', () => {
  assert.match(PAGE_TSX, /<SlaAttainmentLive \/>/);
  assert.match(PAGE_TSX, /Write-once stamps\./);
  assert.match(PAGE_TSX, /Humans only\./);
  assert.match(PAGE_TSX, /Shared sample gates\./);
  assert.match(PAGE_TSX, /Stateless recomputation\./);
  assert.match(PAGE_TSX, /GET \/api\/sla/);
  // Cross-links the accuracy ledger — the trust surfaces cohere.
  assert.match(PAGE_TSX, /href="\/trust\/accuracy\/"/);
});
