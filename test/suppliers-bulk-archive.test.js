'use strict';

// Source-level drift-guard tests for the suppliers bulk-archive
// action. Mirrors PR #135's tests on goods — same three-state header
// checkbox, two-stage destructive confirmation, serial DELETE per
// row, per-row error surfacing.
//
// Operators offboarding a multi-entity supplier (a parent company
// with several legal entities) commonly need to archive a handful at
// once; clicking through detail pages doesn't scale.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PAGE_PATH = path.join(ROOT, 'app-shell', 'app', '(authed)', 'suppliers', 'page.tsx');
const SRC = fs.readFileSync(PAGE_PATH, 'utf8');

// ── Selection state ──────────────────────────────────────────────────

test('SuppliersList carries a Set<string> selectedIds state', () => {
  assert.match(SRC, /const \[selectedIds, setSelectedIds\] = useState<Set<string>>\(\(\) => new Set\(\)\)/);
});

test('toggleRow add/removes externalId via a fresh Set (immutable update)', () => {
  const fnBlock = SRC.match(/function toggleRow\(externalId: string\)[\s\S]*?\n  \}/);
  assert.ok(fnBlock, 'toggleRow not located');
  const block = fnBlock[0];
  assert.match(block, /const next = new Set\(prev\)/);
  assert.match(block, /next\.delete\(externalId\)/);
  assert.match(block, /next\.add\(externalId\)/);
});

test('toggleAll clears when everything visible is selected, otherwise selects all visible', () => {
  // Same three-state semantics as PR #135. 'some' → all visible
  // (NOT none — most users expect this).
  const fnBlock = SRC.match(/function toggleAll\(\)[\s\S]*?\n  \}/);
  assert.ok(fnBlock, 'toggleAll not located');
  const block = fnBlock[0];
  assert.match(block, /prev\.size === visibleSuppliers\.length && visibleSuppliers\.length > 0/);
  assert.match(block, /return new Set\(\);/);
  assert.match(block, /return new Set\(visibleSuppliers\.map\(\(s\) => s\.externalId\)\);/);
});

test('Selection cleanup drops ids no longer matching a visible row', () => {
  // When a row gets archived OR the sanctions filter hides it, its
  // externalId must NOT linger in selectedIds — would otherwise
  // confuse the header "all visible" math.
  assert.match(SRC, /const visibleIds = new Set\(visibleSuppliers\.map\(\(s\) => s\.externalId\)\)/);
  assert.match(SRC, /for \(const id of prev\)/);
  assert.match(SRC, /if \(visibleIds\.has\(id\)\)/);
});

test('headerState memo derives "none" | "some" | "all"', () => {
  const memoBlock = SRC.match(/const headerState: 'none' \| 'some' \| 'all' = useMemo\(\(\) => \{[\s\S]*?\}, \[([^\]]+)\]\);/);
  assert.ok(memoBlock, 'headerState useMemo not located');
  const block = memoBlock[0];
  assert.match(block, /if \(selectedIds\.size === 0\) return 'none';/);
  assert.match(block, /if \(selectedIds\.size === visibleSuppliers\.length && visibleSuppliers\.length > 0\) return 'all';/);
  assert.match(block, /return 'some';/);
});

test('Header checkbox uses ref to set indeterminate', () => {
  assert.match(SRC, /ref=\{\(el\) => \{/);
  assert.match(SRC, /el\.indeterminate = headerState === 'some'/);
});

// ── Bulk-archive state machine ───────────────────────────────────────

test('BulkArchiveState is the same discriminated union as PR #135', () => {
  assert.match(SRC, /type BulkArchiveState =\s*\|\s*\{ kind: 'idle' \}\s*\|\s*\{ kind: 'confirming' \}\s*\|\s*\{ kind: 'archiving' \}\s*\|\s*\{ kind: 'error'; failures: Map<string, string> \};/);
});

test('Two-stage destructive action: first click → confirming, second click → archiving', () => {
  assert.match(SRC, /onArchiveClick=\{\(\) => setArchiveState\(\{ kind: 'confirming' \}\)\}/);
  assert.match(SRC, /onConfirm=\{runBulkArchive\}/);
});

test('Cancel exits the confirming state without firing any DELETE', () => {
  assert.match(SRC, /onCancel=\{\(\) => setArchiveState\(\{ kind: 'idle' \}\)\}/);
});

// ── DELETE flow ─────────────────────────────────────────────────────

test('runBulkArchive uses apiDelete on /suppliers/<id>', () => {
  // The /api/suppliers/<id> DELETE endpoint is the archive route
  // (lib/handlers/suppliers.js handleArchive → lib/db/suppliers.js
  // archiveSupplier).
  assert.match(SRC, /import \{[^}]*?apiDelete[^}]*?\} from '@\/lib\/api';/);
  assert.match(
    SRC,
    /await apiDelete<\{[\s\S]*?supplier: Supplier[\s\S]*?\}>\(\s*`\/suppliers\/\$\{encodeURIComponent\(externalId\)\}`/,
  );
});

test('runBulkArchive iterates selectedIds SERIALLY (drift guard vs Promise.all)', () => {
  // Same rationale as PR #135: audit log readability + org rate-
  // limit safety.
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

test('Parent removes archived ids from suppliers state via Set-based filter', () => {
  assert.match(SRC, /const archivedSet = new Set\(externalIds\)/);
  assert.match(SRC, /setSuppliers\(\(prev\) => prev\.filter\(\(s\) => !archivedSet\.has\(s\.externalId\)\)\)/);
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

test('Confirm button is critical-coloured (destructive-action visual cue)', () => {
  assert.match(
    SRC,
    /onConfirm[\s\S]*?backgroundColor: 'var\(--color-critical\)'/,
  );
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

test('Header checkbox carries an aria-label ("Select all visible suppliers")', () => {
  assert.match(SRC, /aria-label="Select all visible suppliers"/);
});

test('Per-row checkbox aria-label references the entity name', () => {
  // "Select <entity name>" reads clearer than "checkbox" for SR
  // users scanning long lists. Matches PR #135's "Select <SKU>"
  // pattern on goods.
  assert.match(SRC, /aria-label=\{`Select \$\{s\.entityName\}`\}/);
});

// ── Cross-PR pattern consistency ─────────────────────────────────────

test('Suppliers bulk-archive uses the same state-machine shape as PR #135 goods', () => {
  // Drift guard: if a future refactor diverges the supplier state
  // machine from the goods one (extra states, renamed kinds), the
  // shipments PR will be harder to land. Pin BOTH editors' state
  // shape at the source level.
  const goodsSrc = fs.readFileSync(
    path.join(ROOT, 'app-shell', 'app', '(authed)', 'goods', 'page.tsx'),
    'utf8',
  );
  // Both files must carry the same BulkArchiveState union.
  const goodsUnion = goodsSrc.match(/type BulkArchiveState =[\s\S]*?\};/);
  const supplierUnion = SRC.match(/type BulkArchiveState =[\s\S]*?\};/);
  assert.ok(goodsUnion && supplierUnion);
  // Normalise whitespace so trivial formatting differences don't
  // false-fail the cross-stack check.
  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  assert.equal(
    norm(goodsUnion[0]),
    norm(supplierUnion[0]),
    'BulkArchiveState union must stay identical across the goods + suppliers bulk-archive editors',
  );
});

// ── Regression guards on PR #122/#123/#127 invariants ───────────────

test('Sanctions filter dropdown + URL state still wired (PR #127 invariant)', () => {
  assert.match(SRC, /readSanctionsFilter\(searchParams\.get\('sanctions'\)\)/);
  assert.match(SRC, /aria-label="Filter suppliers by sanctions status"/);
});

test('Selection cleanup runs on visibleSuppliers changes (filter applied = drop hidden selections)', () => {
  const effectBlock = SRC.match(/useEffect\(\(\) => \{[\s\S]*?\}, \[visibleSuppliers\]\)/);
  assert.ok(effectBlock, 'visibleSuppliers cleanup effect not located');
  const block = effectBlock[0];
  assert.match(block, /const visibleIds = new Set\(visibleSuppliers\.map\(\(s\) => s\.externalId\)\)/);
});

test('Top-level empty state preserved (no regression on creation copy)', () => {
  assert.match(SRC, /suppliers\.length === 0/);
  assert.match(SRC, /No suppliers saved yet/);
  assert.match(SRC, /Suppliers are created via POST/);
});

test('Per-row Link to /suppliers/<id> preserved (no regression on detail navigation)', () => {
  assert.match(
    SRC,
    /<Link href=\{`\/suppliers\/\$\{encodeURIComponent\(s\.externalId\)\}`\}/,
  );
});

test('Sanctions badge tone styling preserved (no regression on PR #127)', () => {
  assert.match(SRC, /borderColor: sanctionsTone\(s\.sanctionsLastStatus\)/);
  assert.match(SRC, /color: sanctionsTone\(s\.sanctionsLastStatus\)/);
});

test('Trust score colour styling preserved (no regression)', () => {
  assert.match(SRC, /style=\{\{ color: trustTone\(s\.trustScore\) \}\}/);
});
