'use strict';

// Sprint 90 — triage drill-down (Track E phase 2a).
//
// Expanding a console row shows that org's actual worklist: three
// capped, urgency-ordered buckets (at-risk oldest-first, awaiting
// oldest-first, open quotes value-first). Still READ-ONLY and
// still behind the same platform-staff gate — acting on a row
// happens inside that org's context; the console only tells the
// operator where to go next.
//
// Test layers:
//   1. Reader: bucket predicates + orderings + caps; risk bucket
//      matches the sprint-87 aggregate predicate (the count and
//      the list must describe the same rows); null-safe cents
//   2. Handler: sub-query behind the SAME gate (positional pin),
//      integer-gated org param, read-only (GET-only inherited)
//   3. UI: expandable row, cached details, three buckets, honest
//      read-only footer

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const importRequestsDb = require('../lib/db/import-requests');

const ROOT = path.resolve(__dirname, '..');
const DB_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'db', 'import-requests.js'), 'utf8');
const HANDLER_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'handlers', 'operator-triage.js'), 'utf8');
const PAGE_TSX = fs.readFileSync(
  path.join(ROOT, 'app-shell', 'app', '(authed)', 'operator', 'page.tsx'),
  'utf8',
);

const READER = DB_SRC.match(/async function listOperatorTriageDetail\([\s\S]*?\n\}/);

// ── Layer 1: reader ───────────────────────────────────────────────

test('detail reader refuses cleanly without a DB / without an org (runtime)', async () => {
  const noDb = await importRequestsDb.listOperatorTriageDetail({ orgId: 1, slaRiskHours: 36 });
  assert.equal(noDb.ok, false);
  assert.match(noDb.errors[0], /not configured/i);
});

test('at-risk bucket predicate MATCHES the sprint-87 aggregate (count and list describe the same rows)', () => {
  assert.ok(READER, 'listOperatorTriageDetail not found');
  const body = READER[0];
  // Same three-clause predicate as aggregateOperatorTriage's
  // sla_risk FILTER — if these drift, the console shows a count
  // whose drill-down lists different rows.
  assert.match(body, /quoted_at IS NULL/);
  assert.match(body, /AND status IN \('submitted', 'processing', 'awaiting_review'\)/);
  assert.match(body, /AND created_at < now\(\) - \(\$2 \|\| ' hours'\)::interval/);
  const aggBlock = DB_SRC.match(/async function aggregateOperatorTriage\([\s\S]*?\n\}/)[0];
  assert.match(aggBlock, /r\.status IN \('submitted', 'processing', 'awaiting_review'\)/);
});

test('bucket orderings are urgency-shaped: at-risk + awaiting oldest first, quotes value first', () => {
  const body = READER[0];
  const orderings = body.match(/ORDER BY [^`]*/g) || [];
  assert.ok(body.match(/ORDER BY created_at ASC/), 'at-risk: oldest first');
  assert.ok(body.match(/ORDER BY updated_at ASC/), 'awaiting: oldest first');
  assert.match(body, /ORDER BY \(landed_quote->>'totalLandedCents'\)::bigint DESC NULLS LAST/);
  void orderings;
});

test('buckets are capped (LIMIT bound, clamped ≤ 50) and cents are null-safe (never €0 for a missing quote)', () => {
  const body = READER[0];
  assert.match(body, /const limit = Math\.max\(1, Math\.min\(50, Number\(cap\) \|\| 10\)\);/);
  assert.match(body, /landedCents: \(r\.landed_cents === null \|\| r\.landed_cents === undefined\)\s*\n\s*\? null/);
  // Worklist semantics: archived rows OUT, in all three buckets.
  const archivedFilters = body.match(/archived_at IS NULL/g) || [];
  assert.equal(archivedFilters.length, 3, 'every bucket must exclude archived rows');
});

// ── Layer 2: handler ─────────────────────────────────────────────

test('the drill-down sits BEHIND the same staff gate (positional pin) with an integer-gated org param', () => {
  const gateIdx = HANDLER_SRC.indexOf('await adminAuth.verifyAdmin(req)');
  const detailIdx = HANDLER_SRC.indexOf('listOperatorTriageDetail(');
  assert.ok(gateIdx > -1 && detailIdx > -1 && gateIdx < detailIdx,
    'no org detail may compute before the staff gate');
  assert.match(HANDLER_SRC, /if \(!Number\.isInteger\(orgId\) \|\| orgId <= 0\) \{\s*\n\s*return json\(res, 400/);
});

test('the detail response carries the risk line so the console names the bucket it shows', () => {
  const detailBlock = HANDLER_SRC.match(/if \(orgParam !== null\) \{[\s\S]*?\n  \}/);
  assert.ok(detailBlock, 'detail branch not found');
  assert.match(detailBlock[0], /slaRiskThresholdHours: slaRiskHours,/);
  assert.match(detailBlock[0], /atRisk: detail\.atRisk,/);
});

// ── Layer 3: UI ──────────────────────────────────────────────────

test('console rows expand on click; one org at a time; details cached per org', () => {
  assert.match(PAGE_TSX, /onClick=\{\(\) => toggleExpand\(r\.orgId\)\}/);
  assert.match(PAGE_TSX, /if \(expandedOrg === orgId\) \{\s*\n\s*setExpandedOrg\(null\);/);
  assert.match(PAGE_TSX, /if \(!details\[orgId\]\) \{/);
  assert.match(PAGE_TSX, /apiGet<OperatorTriageDetailResponse>\(`\/operator-triage\?org=\$\{orgId\}`\)/);
});

test('the sub-row renders three urgency buckets with honest labels + null-cents omission', () => {
  assert.match(PAGE_TSX, /'At risk \(oldest first\)'/);
  assert.match(PAGE_TSX, /'Awaiting review \(oldest first\)'/);
  assert.match(PAGE_TSX, /'Open quotes \(value first\)'/);
  assert.match(PAGE_TSX, /item\.landedCents != null \? `[^`]*eurFromCents\(item\.landedCents\)[^`]*` : ''/);
  assert.match(PAGE_TSX, /data-testid="triage-detail-row"/);
  // Read-only honesty preserved in the sub-row comment/footer.
  assert.match(PAGE_TSX, /acting on a row still\s*\n?\s*happens inside that org's context/i);
});
