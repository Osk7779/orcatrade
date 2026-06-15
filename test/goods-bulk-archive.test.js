'use strict';

// Source-level drift-guard tests for the goods bulk-archive action.
// First bulk-action surface; sets the pattern for the follow-up
// PRs that will mirror this on suppliers + shipments lists.
//
// Operators deprecating a SKU line commonly need to archive 5-50
// records at once; clicking Archive in each detail view (PR #122
// path) is operationally expensive at scale. The bulk-archive flow:
//   1. Per-row checkbox + header "select all visible" toggle
//   2. Selection toolbar appears when ≥1 row selected
//   3. Two-stage destructive action: first click → confirming
//      state with Confirm/Cancel banner; second click → fires
//      DELETE per row serially
//   4. Per-row errors surface inline; successful archives drop
//      from the goods state immediately

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PAGE_PATH = path.join(ROOT, 'app-shell', 'app', '(authed)', 'goods', 'page.tsx');
const API_PATH = path.join(ROOT, 'app-shell', 'lib', 'api.ts');
const SRC = fs.readFileSync(PAGE_PATH, 'utf8');
const API_SRC = fs.readFileSync(API_PATH, 'utf8');

// ── Selection state ──────────────────────────────────────────────────

test('GoodsList carries a Set<string> selectedIds state (stable identity-based selection)', () => {
  // Why a Set: insertion order doesn't matter, but membership-check
  // is hot (every row asks "am I selected?" on render). Set.has is
  // O(1) vs Array.includes O(n).
  assert.match(SRC, /const \[selectedIds, setSelectedIds\] = useState<Set<string>>\(\(\) => new Set\(\)\)/);
});

test('toggleRow add/removes externalId via a fresh Set (immutable update)', () => {
  // React's reconciliation needs a new reference to detect the
  // change. Mutating the old Set in place would silently drop the
  // re-render.
  const fnBlock = SRC.match(/function toggleRow\(externalId: string\)[\s\S]*?\n  \}/);
  assert.ok(fnBlock, 'toggleRow not located');
  const block = fnBlock[0];
  assert.match(block, /const next = new Set\(prev\)/);
  assert.match(block, /next\.delete\(externalId\)/);
  assert.match(block, /next\.add\(externalId\)/);
});

test('toggleAll clears when everything visible is selected, otherwise selects all visible', () => {
  // Three-state checkbox semantics:
  //   none → all visible
  //   some → all visible (NOT none)
  //   all  → none
  // The "some → all" branch is what most users expect: clicking
  // the header from indeterminate-state should select everything,
  // not deselect.
  const fnBlock = SRC.match(/function toggleAll\(\)[\s\S]*?\n  \}/);
  assert.ok(fnBlock, 'toggleAll not located');
  const block = fnBlock[0];
  assert.match(block, /prev\.size === visibleGoods\.length && visibleGoods\.length > 0/);
  // The "all → none" branch returns an empty Set.
  assert.match(block, /return new Set\(\);/);
  // The "none/some → all" branch maps visibleGoods.
  assert.match(block, /return new Set\(visibleGoods\.map\(\(g\) => g\.externalId\)\);/);
});

test('Selection cleans up to drop ids that no longer match a visible row', () => {
  // When a row gets archived (or the filter hides it), its
  // externalId must NOT linger in selectedIds — otherwise the
  // header-checkbox "all visible" math drifts and the user sees
  // stale "N selected" counts.
  assert.match(SRC, /const visibleIds = new Set\(visibleGoods\.map\(\(g\) => g\.externalId\)\)/);
  assert.match(SRC, /for \(const id of prev\)/);
  assert.match(SRC, /if \(visibleIds\.has\(id\)\)/);
});

test('headerState memo derives "none" | "some" | "all" from selection size + visible length', () => {
  // Three-state output drives both the checkbox checked attribute
  // AND the indeterminate flag (set via ref). Decoupling the
  // derivation from the rendering keeps the logic testable.
  const memoBlock = SRC.match(/const headerState: 'none' \| 'some' \| 'all' = useMemo\(\(\) => \{[\s\S]*?\}, \[([^\]]+)\]\);/);
  assert.ok(memoBlock, 'headerState useMemo not located');
  const block = memoBlock[0];
  assert.match(block, /if \(selectedIds\.size === 0\) return 'none';/);
  assert.match(block, /if \(selectedIds\.size === visibleGoods\.length && visibleGoods\.length > 0\) return 'all';/);
  assert.match(block, /return 'some';/);
});

test('Header checkbox uses ref to set indeterminate (DOM-only property)', () => {
  // React's controlled-input rendering doesn't expose indeterminate
  // — it's a DOM property that lives outside the value/checked
  // contract. Setting via ref on every render is the canonical
  // workaround.
  assert.match(SRC, /ref=\{\(el\) => \{/);
  assert.match(SRC, /el\.indeterminate = headerState === 'some'/);
});

// ── Bulk-archive state machine ───────────────────────────────────────

test('BulkArchiveState is imported from the shared @/components/BulkArchiveToolbar (PR #138)', () => {
  // PR #138 promoted the BulkArchiveToolbar component (and its
  // BulkArchiveState union) from three byte-identical inline copies
  // on the goods, suppliers, and shipments pages to a single shared
  // module. The page no longer carries a local type definition.
  assert.match(
    SRC,
    /import \{ BulkArchiveToolbar, type BulkArchiveState \} from '@\/components\/BulkArchiveToolbar';/,
  );
  // And the local type alias is gone — drift guard against
  // re-introducing it.
  assert.doesNotMatch(SRC, /type BulkArchiveState =\s*\|\s*\{ kind: 'idle' \}/);
});

test('Two-stage destructive action: first click → confirming, second click → archiving', () => {
  // Drift guard against silent regression to one-click destructive
  // flow. The Archive button transitions kind:'idle' → 'confirming';
  // the Confirm button (only rendered when confirming) transitions
  // 'confirming' → 'archiving' via runBulkArchive.
  assert.match(SRC, /onArchiveClick=\{\(\) => setArchiveState\(\{ kind: 'confirming' \}\)\}/);
  assert.match(SRC, /onConfirm=\{runBulkArchive\}/);
});

test('Cancel exits the confirming state without firing any DELETE', () => {
  assert.match(SRC, /onCancel=\{\(\) => setArchiveState\(\{ kind: 'idle' \}\)\}/);
});

// ── DELETE flow ─────────────────────────────────────────────────────

test('runBulkArchive uses apiDelete (the documented archive path)', () => {
  // The /api/goods/<id> DELETE endpoint is the archive route
  // (lib/handlers/goods.js + lib/db/goods.js:archiveGoods).
  // Drift guard against accidentally swapping to PATCH or POST.
  assert.match(SRC, /import \{[^}]*?apiDelete[^}]*?\} from '@\/lib\/api';/);
  assert.match(
    SRC,
    /await apiDelete<\{[\s\S]*?goods: Goods[\s\S]*?\}>\(\s*`\/goods\/\$\{encodeURIComponent\(externalId\)\}`/,
  );
});

test('runBulkArchive iterates selectedIds SERIALLY (for...of, not Promise.all)', () => {
  // Serial issuance keeps the audit log readable (one
  // goods_master_archived event per record, in order) AND avoids
  // pile-on on the org rate-limit when the operator selects 50+
  // rows. Drift guard against an accidental refactor to Promise.all.
  const fnBlock = SRC.match(/async function runBulkArchive\(\)[\s\S]*?\n  \}/);
  assert.ok(fnBlock, 'runBulkArchive not located');
  const block = fnBlock[0];
  assert.match(block, /for \(const externalId of selectedIds\)/);
  assert.doesNotMatch(block, /Promise\.all/);
});

test('Failed rows accumulate in a per-row failures Map (operator can fix and retry)', () => {
  const fnBlock = SRC.match(/async function runBulkArchive\(\)[\s\S]*?\n  \}/);
  assert.ok(fnBlock);
  const block = fnBlock[0];
  assert.match(block, /const failures = new Map<string, string>\(\)/);
  assert.match(block, /failures\.set\(externalId, err\.errors\[0\] \|\| err\.message\)/);
  // ApiError → first error message; AuthError → "Sign in required";
  // generic → err.message.
  assert.match(block, /failures\.set\(externalId, 'Sign in required'\)/);
});

test('Successful rows are reported via onArchived callback (parent removes from list)', () => {
  // Optimistic update — the parent goods state shrinks immediately.
  // No second GET round-trip required.
  const fnBlock = SRC.match(/async function runBulkArchive\(\)[\s\S]*?\n  \}/);
  assert.ok(fnBlock);
  const block = fnBlock[0];
  assert.match(block, /const succeeded: string\[\] = \[\]/);
  assert.match(block, /succeeded\.push\(externalId\)/);
  assert.match(block, /if \(succeeded\.length > 0\) \{[\s\S]*?onArchived\(succeeded\)/);
});

test('Parent removes archived ids from goods state via Set-based filter', () => {
  // Same invariant as PR #122's onSaved pattern on the detail page:
  // the parent owns the list state and applies the mutation
  // immediately so the UI stays in sync without a re-fetch.
  assert.match(SRC, /const archivedSet = new Set\(externalIds\)/);
  assert.match(SRC, /setGoods\(\(prev\) => prev\.filter\(\(g\) => !archivedSet\.has\(g\.externalId\)\)\)/);
});

// ── Toolbar + confirmation UI ────────────────────────────────────────

test('Selection toolbar renders only when ≥1 row selected (no clutter when no selection)', () => {
  assert.match(SRC, /\{selectedIds\.size > 0 && \(\s*<BulkArchiveToolbar/);
});

// Toolbar copy + button label + Confirm colour + role="alert" summary
// moved to test/bulk-archive-toolbar.test.js (PR #138) — the toolbar
// is no longer per-page.

test('Per-row error message renders inline beside the failed row', () => {
  // Operators triaging failures need to see which row failed AND
  // why. The error message renders in the typical-value cell
  // (right-most) with critical colour.
  assert.match(SRC, /const failure = archiveState\.kind === 'error' \? archiveState\.failures\.get\(g\.externalId\) : undefined/);
  assert.match(SRC, /\{failure && \(/);
  assert.match(SRC, /color: 'var\(--color-critical\)'/);
});

// role="alert" toolbar summary moved to test/bulk-archive-toolbar.test.js
// (PR #138) — the toolbar is no longer per-page.

// ── Accessibility ────────────────────────────────────────────────────

test('Header checkbox carries an aria-label ("Select all visible goods")', () => {
  assert.match(SRC, /aria-label="Select all visible goods"/);
});

test('Per-row checkbox aria-label references the SKU (screen-reader context)', () => {
  // "Select SKU-001" reads clearer than "checkbox" for SR users
  // scanning a long list.
  assert.match(SRC, /aria-label=\{`Select \$\{g\.sku\}`\}/);
});

// ── apiDelete contract ──────────────────────────────────────────────

test('apiDelete is still exported with method:DELETE + same-origin creds (no regression)', () => {
  const fn = API_SRC.match(/export async function apiDelete<T>[\s\S]*?\n\}/);
  assert.ok(fn);
  const block = fn[0];
  assert.match(block, /method:\s*'DELETE'/);
  assert.match(block, /credentials:\s*'same-origin'/);
});

// ── Regression guards on PR #122/#127 invariants ────────────────────

test('CBAM filter dropdown + URL state still wired (PR #127 invariant)', () => {
  assert.match(SRC, /readCbamFilter\(searchParams\.get\('cbam'\)\)/);
  assert.match(SRC, /aria-label="Filter goods by CBAM scope"/);
});

test('Selection cleanup runs on visibleGoods changes (filter applied = drop hidden selections)', () => {
  // When the user toggles the CBAM filter, rows that were selected
  // but no longer match must drop from selectedIds.
  const effectBlock = SRC.match(/useEffect\(\(\) => \{[\s\S]*?\}, \[visibleGoods\]\)/);
  assert.ok(effectBlock, 'visibleGoods cleanup effect not located');
  const block = effectBlock[0];
  assert.match(block, /const visibleIds = new Set\(visibleGoods\.map\(\(g\) => g\.externalId\)\)/);
});

test('Top-level empty state preserved (no regression on PR #127 wizard CTA)', () => {
  assert.match(SRC, /goods\.length === 0/);
  assert.match(SRC, /No goods saved yet/);
  assert.match(SRC, /Build your import plan in the/);
});

test('Per-row Link to /goods/<id> preserved (no regression on detail navigation)', () => {
  assert.match(
    SRC,
    /<Link href=\{`\/goods\/\$\{encodeURIComponent\(g\.externalId\)\}`\}/,
  );
});

test('CBAM "In scope" badge preserved (no regression on PR #127 styling)', () => {
  assert.match(SRC, /g\.cbamInScope && \(/);
  assert.match(SRC, /In scope/);
  assert.match(SRC, /borderColor: 'var\(--color-warning\)'/);
});
