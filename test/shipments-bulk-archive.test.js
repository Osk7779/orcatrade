'use strict';

// Source-level drift-guard tests for the shipments bulk-archive
// action. Closes the SoR pattern at 3/3 — same three-state header
// checkbox, two-stage destructive confirmation, serial DELETE per
// row, per-row error surfacing as PRs #135 (goods) and #136
// (suppliers).
//
// Note on archive-eligibility: the data layer's archiveShipment
// (lib/db/shipments.js) has NO status constraint — any non-already-
// archived shipment can be archived regardless of status. We don't
// pre-filter selectable rows; the two-stage confirm dialog is the
// natural friction against accidental archive of in-progress
// shipments. A future PR can add per-status disabling if operator
// feedback demands it.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PAGE_PATH = path.join(ROOT, 'app-shell', 'app', '(authed)', 'shipments', 'page.tsx');
const SRC = fs.readFileSync(PAGE_PATH, 'utf8');

// ── Selection state ──────────────────────────────────────────────────

test('ShipmentList carries a Set<string> selectedIds state', () => {
  assert.match(SRC, /const \[selectedIds, setSelectedIds\] = useState<Set<string>>\(\(\) => new Set\(\)\)/);
});

test('toggleRow add/removes externalId via a fresh Set', () => {
  const fnBlock = SRC.match(/function toggleRow\(externalId: string\)[\s\S]*?\n  \}/);
  assert.ok(fnBlock, 'toggleRow not located');
  const block = fnBlock[0];
  assert.match(block, /const next = new Set\(prev\)/);
  assert.match(block, /next\.delete\(externalId\)/);
  assert.match(block, /next\.add\(externalId\)/);
});

test('toggleAll clears when everything visible is selected, otherwise selects all visible', () => {
  // Same three-state semantics as PR #135/#136. 'some' → all
  // visible (NOT none).
  const fnBlock = SRC.match(/function toggleAll\(\)[\s\S]*?\n  \}/);
  assert.ok(fnBlock, 'toggleAll not located');
  const block = fnBlock[0];
  assert.match(block, /prev\.size === visibleShipments\.length && visibleShipments\.length > 0/);
  assert.match(block, /return new Set\(\);/);
  assert.match(block, /return new Set\(visibleShipments\.map\(\(s\) => s\.externalId\)\);/);
});

test('Selection cleanup drops ids no longer matching a visible row', () => {
  // When the status filter is applied OR an archive succeeds, ids
  // for hidden rows must NOT linger in selectedIds.
  assert.match(SRC, /const visibleIds = new Set\(visibleShipments\.map\(\(s\) => s\.externalId\)\)/);
  assert.match(SRC, /for \(const id of prev\)/);
  assert.match(SRC, /if \(visibleIds\.has\(id\)\)/);
});

test('headerState memo derives "none" | "some" | "all"', () => {
  const memoBlock = SRC.match(/const headerState: 'none' \| 'some' \| 'all' = useMemo\(\(\) => \{[\s\S]*?\}, \[([^\]]+)\]\);/);
  assert.ok(memoBlock, 'headerState useMemo not located');
  const block = memoBlock[0];
  assert.match(block, /if \(selectedIds\.size === 0\) return 'none';/);
  assert.match(block, /if \(selectedIds\.size === visibleShipments\.length && visibleShipments\.length > 0\) return 'all';/);
  assert.match(block, /return 'some';/);
});

test('Header checkbox uses ref to set indeterminate', () => {
  assert.match(SRC, /ref=\{\(el\) => \{/);
  assert.match(SRC, /el\.indeterminate = headerState === 'some'/);
});

// ── Bulk-archive state machine ───────────────────────────────────────

test('BulkArchiveState is the same discriminated union as PR #135/#136', () => {
  assert.match(SRC, /type BulkArchiveState =\s*\|\s*\{ kind: 'idle' \}\s*\|\s*\{ kind: 'confirming' \}\s*\|\s*\{ kind: 'archiving' \}\s*\|\s*\{ kind: 'error'; failures: Map<string, string> \};/);
});

test('Two-stage destructive action: first click → confirming, second → archiving via runBulkArchive', () => {
  assert.match(SRC, /onArchiveClick=\{\(\) => setArchiveState\(\{ kind: 'confirming' \}\)\}/);
  assert.match(SRC, /onConfirm=\{runBulkArchive\}/);
});

test('Cancel exits the confirming state without firing any DELETE', () => {
  assert.match(SRC, /onCancel=\{\(\) => setArchiveState\(\{ kind: 'idle' \}\)\}/);
});

// ── DELETE flow ─────────────────────────────────────────────────────

test('runBulkArchive uses apiDelete on /shipments/<id>', () => {
  // The /api/shipments/<id> DELETE endpoint is the archive route
  // (lib/handlers/shipments.js + lib/db/shipments.js
  // archiveShipment).
  assert.match(SRC, /import \{[^}]*?apiDelete[^}]*?\} from '@\/lib\/api';/);
  assert.match(
    SRC,
    /await apiDelete<\{[\s\S]*?shipment: Shipment[\s\S]*?\}>\(\s*`\/shipments\/\$\{encodeURIComponent\(externalId\)\}`/,
  );
});

test('runBulkArchive iterates selectedIds SERIALLY (drift guard vs Promise.all)', () => {
  const fnBlock = SRC.match(/async function runBulkArchive\(\)[\s\S]*?\n  \}/);
  assert.ok(fnBlock, 'runBulkArchive not located');
  const block = fnBlock[0];
  assert.match(block, /for \(const externalId of selectedIds\)/);
  assert.doesNotMatch(block, /Promise\.all/);
});

test('Failed rows accumulate in a per-row Map (operator can fix and retry)', () => {
  const fnBlock = SRC.match(/async function runBulkArchive\(\)[\s\S]*?\n  \}/);
  assert.ok(fnBlock);
  const block = fnBlock[0];
  assert.match(block, /const failures = new Map<string, string>\(\)/);
  assert.match(block, /failures\.set\(externalId, err\.errors\[0\] \|\| err\.message\)/);
  assert.match(block, /failures\.set\(externalId, 'Sign in required'\)/);
});

test('Successful rows are reported via onArchived callback', () => {
  const fnBlock = SRC.match(/async function runBulkArchive\(\)[\s\S]*?\n  \}/);
  assert.ok(fnBlock);
  const block = fnBlock[0];
  assert.match(block, /const succeeded: string\[\] = \[\]/);
  assert.match(block, /succeeded\.push\(externalId\)/);
  assert.match(block, /if \(succeeded\.length > 0\) \{[\s\S]*?onArchived\(succeeded\)/);
});

test('Parent removes archived ids from BOTH shipments AND exception queue state', () => {
  // Unique to shipments: archiving a shipment with status='exception'
  // implicitly clears it from the exception queue. Both lists must
  // shrink atomically.
  assert.match(SRC, /const archivedSet = new Set\(externalIds\)/);
  assert.match(SRC, /setShipments\(\(prev\) => prev\.filter\(\(s\) => !archivedSet\.has\(s\.externalId\)\)\)/);
  assert.match(SRC, /setQueue\(\(prev\) => prev\.filter\(\(q\) => !archivedSet\.has\(q\.externalId\)\)\)/);
});

// ── Toolbar + confirmation UI ────────────────────────────────────────

test('Selection toolbar renders only when ≥1 row selected', () => {
  assert.match(SRC, /\{selectedIds\.size > 0 && \(\s*<BulkArchiveToolbar/);
});

test('Toolbar button label adapts to archiveState (3-way pin)', () => {
  assert.match(SRC, /archiving\s*\?\s*'Archiving…'\s*:\s*hasErrors\s*\?\s*'Retry archive'\s*:\s*`Archive \$\{selectedCount\}`/);
});

test('Confirm banner copy spells out the irreversibility', () => {
  assert.match(SRC, /Archive \{selectedCount\}\? This is irreversible\./);
});

test('Confirm button is critical-coloured', () => {
  assert.match(SRC, /onConfirm[\s\S]*?backgroundColor: 'var\(--color-critical\)'/);
});

test('Per-row error message renders inline beside the failed row', () => {
  assert.match(SRC, /const failure = archiveState\.kind === 'error' \? archiveState\.failures\.get\(s\.externalId\) : undefined/);
  assert.match(SRC, /\{failure && \(/);
  assert.match(SRC, /color: 'var\(--color-critical\)'/);
});

test('Toolbar carries a role="alert" summary when there are failures', () => {
  assert.match(SRC, /role="alert"/);
  assert.match(SRC, /\{archiveState\.failures\.size\} of \{selectedCount\} failed/);
});

// ── Accessibility ────────────────────────────────────────────────────

test('Header checkbox carries an aria-label ("Select all visible shipments")', () => {
  assert.match(SRC, /aria-label="Select all visible shipments"/);
});

test('Per-row checkbox aria-label references the shipment label', () => {
  // "Select <label>" reads clearer than "checkbox" for SR users.
  // Matches PR #135's "Select <SKU>" and PR #136's
  // "Select <entityName>" patterns.
  assert.match(SRC, /aria-label=\{`Select \$\{s\.label\}`\}/);
});

// ── Cross-PR pattern consistency: SoR triplet (goods + suppliers + shipments) ─

test('Shipments bulk-archive state machine matches goods (PR #135) and suppliers (PR #136) byte-for-byte', () => {
  // Three-way drift guard: closes the SoR pattern at 3/3. If a
  // future refactor diverges any one of the three, the eventual
  // BulkArchiveToolbar promotion to a shared component becomes
  // harder. Pin the three unions byte-identical now.
  const goodsSrc = fs.readFileSync(
    path.join(ROOT, 'app-shell', 'app', '(authed)', 'goods', 'page.tsx'),
    'utf8',
  );
  const supplierSrc = fs.readFileSync(
    path.join(ROOT, 'app-shell', 'app', '(authed)', 'suppliers', 'page.tsx'),
    'utf8',
  );
  const goodsUnion = goodsSrc.match(/type BulkArchiveState =[\s\S]*?\};/);
  const supplierUnion = supplierSrc.match(/type BulkArchiveState =[\s\S]*?\};/);
  const shipmentUnion = SRC.match(/type BulkArchiveState =[\s\S]*?\};/);
  assert.ok(goodsUnion && supplierUnion && shipmentUnion);
  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  assert.equal(
    norm(goodsUnion[0]),
    norm(shipmentUnion[0]),
    'BulkArchiveState union must stay identical across goods + shipments',
  );
  assert.equal(
    norm(supplierUnion[0]),
    norm(shipmentUnion[0]),
    'BulkArchiveState union must stay identical across suppliers + shipments',
  );
});

// ── Regression guards on PR #125 + #126 invariants ──────────────────

test('Status filter dropdown + URL state still wired (PR #125 invariant)', () => {
  assert.match(SRC, /readStatusFilter\(searchParams\.get\('status'\)\)/);
  assert.match(SRC, /aria-label="Filter shipments by status"/);
});

test('Selection cleanup runs on visibleShipments changes (filter applied = drop hidden selections)', () => {
  const effectBlock = SRC.match(/useEffect\(\(\) => \{[\s\S]*?\}, \[visibleShipments\]\)/);
  assert.ok(effectBlock, 'visibleShipments cleanup effect not located');
});

test('Exception queue card still renders before the list (PR #98 / dashboard order)', () => {
  // PR #125's regression guard kept this invariant; PR #137 must
  // preserve it too — operators rely on the exception queue as the
  // first thing they see.
  const queueIdx = SRC.indexOf('<ExceptionQueueCard');
  const listIdx = SRC.indexOf('<ShipmentList');
  assert.ok(queueIdx > 0 && listIdx > queueIdx,
    `Exception queue must render before ShipmentList — queue=${queueIdx} list=${listIdx}`);
});

test('Acknowledge-with-note flow preserved (PR #126 invariant)', () => {
  // PR #126 wired the note input into the exception queue's
  // ExceptionRow. The bulk-archive PR mustn't have touched it.
  assert.match(SRC, /const \[note, setNote\] = useState\(''\)/);
  assert.match(SRC, /Add a note \(optional\)/);
});

test('Top-level empty state preserved (no regression on plan-promotion CTA)', () => {
  assert.match(SRC, /shipments\.length === 0/);
  assert.match(SRC, /No shipments yet/);
  assert.match(SRC, /Promote a saved plan/);
});

test('Per-row Link to /shipments/<id> preserved (no regression on detail navigation)', () => {
  assert.match(
    SRC,
    /<Link href=\{`\/shipments\/\$\{encodeURIComponent\(s\.externalId\)\}`\}/,
  );
});

test('Status badge styling preserved (PR #125 regression)', () => {
  assert.match(SRC, /borderColor: statusTone\(s\.status\), color: statusTone\(s\.status\)/);
});
