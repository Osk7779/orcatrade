'use strict';

// Source-level drift-guard tests for the audit-timeline batching
// (PR #151). The groupConsecutiveEvents helper collapses runs of
// consecutive same-type same-actor events to reduce visual clutter
// without hiding diversity.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const TIMELINE_PATH = path.join(ROOT, 'app-shell', 'components', 'TransitionHistory.tsx');
const SRC = fs.readFileSync(TIMELINE_PATH, 'utf8');

// ── Thresholds + helper exported ────────────────────────────────────

test('MIN_BATCH_SIZE and MAX_BATCH_GAP_MS are exported constants', () => {
  // Pin the threshold names so a refactor that inlines them surfaces
  // an explicit drift. Both are exported so consumers (and tests)
  // can reference them deterministically.
  assert.match(SRC, /export const MIN_BATCH_SIZE = 3;/);
  assert.match(SRC, /export const MAX_BATCH_GAP_MS = 60 \* 60 \* 1000;/);
});

test('groupConsecutiveEvents is exported (callable from tests + future consumers)', () => {
  assert.match(SRC, /export function groupConsecutiveEvents\(events: AuditTimelineEvent\[\]\): BatchedRow\[\] \{/);
});

test('BatchedRow union exports both "single" and "batch" kinds', () => {
  // The render branches on row.kind === 'single' / 'batch'. Pin the
  // union shape so a refactor can't silently drop a kind.
  assert.match(SRC, /export type BatchedRow =[\s\S]*?\| \{ kind: 'single'; event: AuditTimelineEvent \}/);
  assert.match(SRC, /\| \{\s*kind: 'batch';/);
});

// ── Grouping algorithm shape ────────────────────────────────────────

test('groupConsecutiveEvents returns [] for an empty input (no-events fast path)', () => {
  const fnBlock = SRC.match(/export function groupConsecutiveEvents[\s\S]*?\n\}/);
  assert.ok(fnBlock, 'groupConsecutiveEvents not located');
  assert.match(fnBlock[0], /if \(events\.length === 0\) return \[\];/);
});

test('Grouping iterates from index 1 and inspects prev=run\\[run.length-1\\] (consecutive-pair check)', () => {
  const fnBlock = SRC.match(/export function groupConsecutiveEvents[\s\S]*?\n\}/);
  assert.ok(fnBlock);
  const block = fnBlock[0];
  // Loop starts at i=1 (we seeded run with events[0]).
  assert.match(block, /for \(let i = 1; i < events\.length; i \+= 1\)/);
  // prev is the LAST element of the current run, not events[i-1].
  // This matters when the run grew across multiple iterations.
  assert.match(block, /const prev = run\[run\.length - 1\];/);
});

test('Batch-eligibility requires same type + same actor + within MAX_BATCH_GAP_MS', () => {
  const fnBlock = SRC.match(/export function groupConsecutiveEvents[\s\S]*?\n\}/);
  assert.ok(fnBlock);
  const block = fnBlock[0];
  assert.match(block, /const sameType = cur\.type === prev\.type;/);
  // actorEmailHash may be null/undefined — normalise via "|| null"
  // before comparing so two unknown-actor events compare equal.
  assert.match(block, /const sameActor = \(cur\.actorEmailHash \|\| null\) === \(prev\.actorEmailHash \|\| null\);/);
  // Time gap uses Math.abs so the algorithm works for both
  // chronological + reverse-chronological event lists.
  assert.match(block, /Math\.abs\(Date\.parse\(cur\.at\) - Date\.parse\(prev\.at\)\) <= MAX_BATCH_GAP_MS/);
});

test('Runs shorter than MIN_BATCH_SIZE flush as individual singles (no false collapsing)', () => {
  // The honesty discipline: collapsing a 2-event run would hide one
  // event behind an interaction step (expand to see) for negligible
  // gain. Pin the threshold check in the flush helper.
  const fnBlock = SRC.match(/export function groupConsecutiveEvents[\s\S]*?\n\}/);
  assert.ok(fnBlock);
  assert.match(fnBlock[0], /if \(run\.length >= MIN_BATCH_SIZE\) \{[\s\S]*?\} else \{[\s\S]*?out\.push\(\{ kind: 'single', event: e \}\);/);
});

test('Batch carries from/to timestamps normalised so from ≤ to (works for asc + desc lists)', () => {
  const fnBlock = SRC.match(/export function groupConsecutiveEvents[\s\S]*?\n\}/);
  assert.ok(fnBlock);
  const block = fnBlock[0];
  // Anchored: parse firstAt / lastAt timestamps, pick the smaller as
  // from. If the list is reverse-chronological, run[0] is the newest
  // and run[length-1] is the oldest — pick the older for "from".
  assert.match(block, /const fromAt = Date\.parse\(firstAt\) <= Date\.parse\(lastAt\) \? firstAt : lastAt;/);
});

// ── Render wiring ───────────────────────────────────────────────────

test('Render uses `rendered` (the grouped/batched array), not raw `visible`', () => {
  // Drift guard: a refactor that re-pointed map() at `visible.map`
  // would silently skip the batching.
  assert.match(SRC, /\{rendered\.map\(\(row, i\) => \{/);
  // The old direct visible.map call is no longer present.
  assert.doesNotMatch(SRC, /\{visible\.map\(\(e, i\) => \(\s*<TimelineRow/);
});

test('Render branches on row.kind to dispatch single vs batch rows', () => {
  assert.match(SRC, /if \(row\.kind === 'single'\)/);
  assert.match(SRC, /<BatchedTimelineRow/);
});

test('Batching is bypassed while a type filter is active (no double-collapsing)', () => {
  // A filter-by-type view by definition has only one type of event;
  // collapsing them would be confusing AND hide the per-event
  // detail the filter was designed to surface.
  const renderedBlock = SRC.match(/const rendered = useMemo<BatchedRow\[\]>\(\(\) => \{[\s\S]*?\}, \[visible, filterType\]\);/);
  assert.ok(renderedBlock, 'rendered useMemo not located');
  assert.match(renderedBlock[0], /if \(filterType\) return visible\.map\(\(e\) => \(\{ kind: 'single', event: e \}\)\);/);
});

// ── BatchedTimelineRow component ────────────────────────────────────

test('BatchedTimelineRow renders the collapsed count + type label + actor chip', () => {
  const fnBlock = SRC.match(/function BatchedTimelineRow\(\{[\s\S]*?\n\}\n/);
  assert.ok(fnBlock, 'BatchedTimelineRow not located');
  const block = fnBlock[0];
  // "5 × Updated (actor abc12345)"
  assert.match(block, /\{batch\.events\.length\} × \{typeLabel\}/);
  assert.match(block, /actor \$\{batch\.actorEmailHash\.slice\(0, 8\)\}/);
});

test('BatchedTimelineRow handles a null actorEmailHash by reading "system"', () => {
  // System-emitted events (cron, importers) have no operator. Don't
  // print "actor null" — print "system" so the timeline reads
  // honestly.
  const fnBlock = SRC.match(/function BatchedTimelineRow\(\{[\s\S]*?\n\}\n/);
  assert.ok(fnBlock);
  assert.match(fnBlock[0], /: 'system'/);
});

test('BatchedTimelineRow has an expandable <details> block listing each individual event', () => {
  // Operators need to verify every event in the batch was legitimate —
  // collapsing without an expand path would block the audit-trail
  // use case that the timeline exists to serve. Pin the expand UI.
  const fnBlock = SRC.match(/function BatchedTimelineRow\(\{[\s\S]*?\n\}\n/);
  assert.ok(fnBlock);
  const block = fnBlock[0];
  assert.match(block, /<details/);
  assert.match(block, /Show \{batch\.events\.length\} events/);
  // Inside the expand, each event renders as a full TimelineRow.
  assert.match(block, /<TimelineRow/);
});

test('BatchedTimelineRow renders "at <time>" when from === to (single-instant burst)', () => {
  // A burst at exactly one timestamp shouldn't render as "T → T" —
  // that's noise. Single-instant collapses to "at T".
  const fnBlock = SRC.match(/function BatchedTimelineRow\(\{[\s\S]*?\n\}\n/);
  assert.ok(fnBlock);
  const block = fnBlock[0];
  assert.match(block, /const sameInstant = batch\.from === batch\.to;/);
  assert.match(block, /at \{fmtDateTime\(batch\.from\)\}/);
});

// ── Preserves prior PR #134 invariants ──────────────────────────────

test('Filter dropdown + match-count chip from PR #134 still present', () => {
  assert.match(SRC, /aria-label="Filter audit events by type"/);
  assert.match(SRC, /\{filterType\}/);
  assert.match(SRC, /\$\{visible\.length\} of \$\{list\.length\}/);
});

test('Empty + filter-empty states from PR #134 preserved', () => {
  assert.match(SRC, /No audit events yet\. New transitions will appear here\./);
  assert.match(SRC, /No events of type/);
  assert.match(SRC, /Clear filter/);
});
