'use strict';

// Source-level drift-guard tests for the supplier re-screen UI:
//   - SanctionsPanel "Re-screen" button + apiPost wire-up + error
//     surfacing (mirrors goods-edit-form patterns)
//   - TransitionHistory.tsx LOOKUP_BY_KIND.supplier.headline +
//     tone branch for the new supplier_master_rescreened event
//   - apiPost now surfaces ApiError on 4xx (parity with apiPatch
//     from PR #122)

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PAGE_PATH = path.join(ROOT, 'app-shell', 'app', '(authed)', 'suppliers', '[externalId]', 'page.tsx');
const TIMELINE_PATH = path.join(ROOT, 'app-shell', 'components', 'TransitionHistory.tsx');
const API_PATH = path.join(ROOT, 'app-shell', 'lib', 'api.ts');
const PAGE_SRC = fs.readFileSync(PAGE_PATH, 'utf8');
const TIMELINE_SRC = fs.readFileSync(TIMELINE_PATH, 'utf8');
const API_SRC = fs.readFileSync(API_PATH, 'utf8');

// ── SanctionsPanel re-screen wiring ──────────────────────────────────

test('SanctionsPanel takes an onRescreened callback and lifts updates to the parent', () => {
  // Pattern mirrors EditForm's onSaved: self-contained operation,
  // parent receives the updated supplier and re-renders.
  assert.match(PAGE_SRC, /function SanctionsPanel\(\{[\s\S]*?onRescreened: \(updated: Supplier\) => void;/);
  // The page wires it to setSupplier.
  assert.match(PAGE_SRC, /onRescreened=\{\(updated\) => setSupplier\(updated\)\}/);
});

test('Re-screen button calls apiPost to /suppliers/<encoded-id>/screen with empty body', () => {
  // Empty body is deliberate — the supplier identity is the URL,
  // not the body. Sending a name would be a forge-proof violation
  // (handler test pins the absence of body.name).
  assert.match(
    PAGE_SRC,
    /apiPost<\{[^}]*?supplier: Supplier[^}]*?\}>\(\s*`\/suppliers\/\$\{encodeURIComponent\(supplier\.externalId\)\}\/screen`,\s*\{\}/,
  );
});

test('Re-screen button is hidden on archived suppliers (symmetric with the Edit button rule)', () => {
  // Same enterprise-bar rule as PR #122/#123: archived records
  // don't expose mutation affordances.
  assert.match(PAGE_SRC, /const archived = Boolean\(supplier\.archivedAt\)/);
  assert.match(PAGE_SRC, /\{!archived && \(\s*<button/);
});

test('Re-screen button has loading + disabled state while the request is in flight', () => {
  assert.match(PAGE_SRC, /const \[rescreening, setRescreening\] = useState\(false\)/);
  assert.match(PAGE_SRC, /disabled=\{rescreening\}/);
  assert.match(PAGE_SRC, /\{rescreening \? 'Re-screening…' : 'Re-screen'\}/);
});

test('Re-screen button surfaces errors inline with role="alert" + critical-coloured', () => {
  // Same surface as the EditForm error path. ApiError → first
  // bag.errors entry; AuthError → "Sign in required"; generic
  // Error → err.message.
  assert.match(PAGE_SRC, /if \(err instanceof ApiError\)/);
  assert.match(PAGE_SRC, /setRescreenError\(err\.errors\[0\] \|\| err\.message\)/);
  assert.match(PAGE_SRC, /else if \(err instanceof AuthError\)/);
  assert.match(PAGE_SRC, /Sign in required to re-screen/);
  assert.match(PAGE_SRC, /role="alert"/);
  assert.match(PAGE_SRC, /color: 'var\(--color-critical\)'/);
});

test('Re-screen state machine clears prior errors before each attempt', () => {
  // Stale-error guard: a successful retry after a transient 503
  // shouldn't leave the previous error message on screen.
  const fnBlock = PAGE_SRC.match(/async function runRescreen\(\)[\s\S]*?\n  \}/);
  assert.ok(fnBlock, 'runRescreen fn not located');
  const block = fnBlock[0];
  assert.match(block, /setRescreening\(true\)/);
  assert.match(block, /setRescreenError\(''\)/);
});

test('Re-screen reentry guard: ignores click while already rescreening', () => {
  // Doubled clicks are common — guard early to avoid duplicate
  // audit events.
  assert.match(PAGE_SRC, /if \(rescreening\) return;/);
});

// ── apiPost now surfaces ApiError on 4xx (parity with apiPatch) ──────

test('apiPost surfaces ApiError on 4xx (parity with apiPatch from PR #122)', () => {
  // Before this PR, apiPost threw a generic Error for any non-401,
  // non-2xx. The re-screen flow needs structured errors (409 for
  // archived, 404 for ownership) so apiPost matches apiPatch's
  // contract. Drift guard: pin the 4xx branch.
  const fn = API_SRC.match(/export async function apiPost[\s\S]*?\n\}/);
  assert.ok(fn, 'apiPost fn block not located');
  const block = fn[0];
  assert.match(block, /res\.status >= 400 && res\.status < 500/);
  assert.match(block, /throw new ApiError\(res\.status, summary, errors\)/);
});

test('apiPost still throws AuthError on 401 + generic Error on 5xx (no regression)', () => {
  const fn = API_SRC.match(/export async function apiPost[\s\S]*?\n\}/);
  assert.ok(fn);
  const block = fn[0];
  assert.match(block, /res\.status === 401[\s\S]*?throw new AuthError/);
  // Non-4xx, non-2xx still falls through to the generic Error.
  assert.match(block, /throw new Error\(`API \$\{path\} failed: HTTP \$\{res\.status\}`\)/);
});

// ── TransitionHistory headline + tone for the new event type ─────────

test('LOOKUP_BY_KIND.supplier.headline reads supplier_master_rescreened with the new sanctions status', () => {
  // The audit timeline must show "Re-screened → potential match"
  // (or "→ clear") so the operator can scan the timeline without
  // expanding each row.
  const supplierBlock = TIMELINE_SRC.match(/supplier:\s*\{[\s\S]*?headline:[\s\S]*?\},\s*tone:/);
  assert.ok(supplierBlock, 'supplier headline block not located');
  const block = supplierBlock[0];
  assert.match(block, /case 'supplier_master_rescreened':/);
  // Reads after.sanctionsLastStatus from the diff (recordScreeningResult
  // writes exactly that slice — handler test pins it).
  assert.match(block, /sanctionsLastStatus\?: string/);
  assert.match(block, /Re-screened → \$\{to\.replace/);
});

test('LOOKUP_BY_KIND.supplier.tone uses var(--color-warning) for rescreened (deliberately ambiguous)', () => {
  // Re-screen can land EITHER "clear" OR "potential_match" —
  // operators must READ the headline rather than tone-glance,
  // so the tone signals "check this" (warning amber) not
  // success (positive green) or failure (critical red).
  const supplierBlock = TIMELINE_SRC.match(/supplier:\s*\{[\s\S]*?tone:[\s\S]*?\},\s*\},\s*\};/);
  assert.ok(supplierBlock, 'supplier tone block not located');
  const block = supplierBlock[0];
  assert.match(block, /'supplier_master_rescreened'\) return 'var\(--color-warning\)'/);
});

// ── Regression guards on previously-shipped behaviour ────────────────

test('SanctionsPanel still renders match-summary <details> when flagged (no regression on existing behaviour)', () => {
  // The flagged + summary branch was present before this PR.
  // Confirm the re-screen wiring didn't accidentally remove it.
  assert.match(PAGE_SRC, /flagged && supplier\.sanctionsLastMatchSummary/);
  assert.match(PAGE_SRC, /Match summary/);
});

test('SanctionsPanel borderColor still reflects flagged status (UX-glance regression)', () => {
  assert.match(PAGE_SRC, /borderColor: flagged \? 'var\(--color-critical\)' : 'var\(--color-navy-line\)'/);
});

test('SUPPLIER_LEGAL_FORMS still mirrors the data layer (PR #123 regression)', () => {
  // Re-screen wiring touched the suppliers handler heavily; the
  // PR #123 cross-stack mirror must remain intact.
  const dbSrc = fs.readFileSync(path.join(ROOT, 'lib', 'db', 'suppliers.js'), 'utf8');
  const apiBlock = API_SRC.match(/SUPPLIER_LEGAL_FORMS:[\s\S]*?Object\.freeze\(\[([\s\S]*?)\]\)/);
  const dbBlock = dbSrc.match(/LEGAL_FORMS = Object\.freeze\(\[([\s\S]*?)\]\)/);
  assert.ok(apiBlock && dbBlock);
  const apiValues = (apiBlock[1].match(/'([a-z_]+)'/g) || []).map((s) => s.replace(/'/g, '')).sort();
  const dbValues = (dbBlock[1].match(/'([a-z_]+)'/g) || []).map((s) => s.replace(/'/g, '')).sort();
  assert.deepEqual(apiValues, dbValues);
});
