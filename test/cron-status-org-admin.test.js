'use strict';

// Sprint 52 — org-admin-facing cron observability.
//
// The cron-observability-v1 sprint writes cron:lastRun:<job> +
// cron:lastError:<job> on every cron tick; an existing
// /api/cron/status exposes them BUT gates on the platform-admin
// token (lib/admin-auth.js). Sprint 52 ships a SESSION-AUTHED,
// ORG-ADMIN-GATED mirror so any admin watching the platform stack
// their workflow depends on can self-serve.
//
// Tests cover four layers:
//   1. classifyHealth pure function: 'never' / 'error' / 'stale'
//      / 'ok' classifications + the "error wins over stale"
//      precedence (an active failure can't hide behind an age
//      check)
//   2. STALE_AFTER_MS exported + matches the documented 36h
//      window
//   3. Dispatcher + handler: route registered; same admin/owner
//      RBAC gate as operator-config + api-keys + webhooks; reads
//      the canonical JOBS keys from the cron handler (NOT a
//      hardcoded list — drift-guard against the keys getting out
//      of sync as new jobs land)
//   4. UI: <CronStatusPanel> mounts after WebhooksPanel; lazy
//      loads on first expand; renders per-job health pill with
//      the documented copy; the summary line shows OK/error/stale
//      counts

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const cronStatus = require('../lib/handlers/cron-status');

const ROOT = path.resolve(__dirname, '..');
const HANDLER_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'handlers', 'cron-status.js'), 'utf8');
const DISPATCH_SRC = fs.readFileSync(path.join(ROOT, 'api', '[...path].js'), 'utf8');
const API_TS = fs.readFileSync(path.join(ROOT, 'app-shell', 'lib', 'api.ts'), 'utf8');
const INSIGHTS_TSX = fs.readFileSync(
  path.join(ROOT, 'app-shell', 'app', '(authed)', 'imports', 'insights', 'page.tsx'),
  'utf8',
);

// ── Constants ──────────────────────────────────────────────────────

test('STALE_AFTER_MS = 36 hours (matches the documented window for daily/weekly jobs)', () => {
  // 36h is generous enough for daily cron jobs that can shift a
  // few hours, tight enough to surface a missed weekly run within
  // 1.5 days. Drift-guard pinned so a future re-tune is explicit.
  assert.equal(cronStatus.STALE_AFTER_MS, 36 * 60 * 60 * 1000);
});

// ── classifyHealth ─────────────────────────────────────────────────

test('classifyHealth returns "never" when neither lastRun nor lastError is present', () => {
  // A brand-new job that has never fired since observability was
  // wired — distinct from "stale" which means "ran successfully
  // long ago." The UI surfaces it differently.
  const r = cronStatus.classifyHealth({ lastRun: null, lastError: null, nowMs: Date.now() });
  assert.equal(r, 'never');
});

test('classifyHealth returns "error" when lastRun has ok:false', () => {
  // A failed run that DID write to KV (rare but possible if the
  // job returned a structured failure).
  const r = cronStatus.classifyHealth({
    lastRun: { ranAt: '2026-01-01T00:00:00Z', completedAt: '2026-01-01T00:00:05Z', ok: false },
    lastError: null,
    nowMs: Date.parse('2026-01-01T01:00:00Z'),
  });
  assert.equal(r, 'error');
});

test('classifyHealth returns "error" when lastError is newer than lastRun', () => {
  // The MOST RECENT attempt threw — error wins.
  const r = cronStatus.classifyHealth({
    lastRun: { ranAt: '2026-01-01T00:00:00Z', completedAt: '2026-01-01T00:00:05Z', ok: true },
    lastError: { ranAt: '2026-01-02T00:00:00Z', completedAt: '2026-01-02T00:00:05Z', error: 'boom' },
    nowMs: Date.parse('2026-01-02T01:00:00Z'),
  });
  assert.equal(r, 'error');
});

test('classifyHealth returns "ok" when lastRun is newer than lastError + within staleness window', () => {
  // The recovery path: last attempt succeeded, prior error is
  // history.
  const r = cronStatus.classifyHealth({
    lastRun: { ranAt: '2026-01-02T00:00:00Z', completedAt: '2026-01-02T00:00:05Z', ok: true },
    lastError: { ranAt: '2026-01-01T00:00:00Z', completedAt: '2026-01-01T00:00:05Z', error: 'past' },
    nowMs: Date.parse('2026-01-02T01:00:00Z'),
  });
  assert.equal(r, 'ok');
});

test('classifyHealth returns "stale" when lastRun is older than STALE_AFTER_MS + no recent error', () => {
  // A job that succeeded once a long time ago + hasn't fired
  // since. The cron may have been disabled, the schedule may
  // have drifted, or the job throw bypassed both KV writes.
  const longAgo = '2026-01-01T00:00:00Z';
  const r = cronStatus.classifyHealth({
    lastRun: { ranAt: longAgo, completedAt: longAgo, ok: true },
    lastError: null,
    nowMs: Date.parse(longAgo) + cronStatus.STALE_AFTER_MS + 1000,
  });
  assert.equal(r, 'stale');
});

test('classifyHealth "error" wins over "stale" (active failure NOT hidden behind age check)', () => {
  // Critical precedence: a recent error should NEVER be hidden
  // by an old-but-stale last-success record. The error is the
  // more urgent signal.
  const r = cronStatus.classifyHealth({
    lastRun: { ranAt: '2026-01-01T00:00:00Z', completedAt: '2026-01-01T00:00:05Z', ok: true },
    lastError: { ranAt: '2026-02-01T00:00:00Z', completedAt: '2026-02-01T00:00:05Z', error: 'still broken' },
    nowMs: Date.parse('2026-02-01T01:00:00Z'),
  });
  assert.equal(r, 'error');
});

// ── Dispatcher + handler ──────────────────────────────────────────

test('Dispatcher registers cron-status under /api/cron-status', () => {
  assert.match(DISPATCH_SRC, /['"]cron-status['"]: require\(['"]\.\.\/lib\/handlers\/cron-status['"]\)/);
});

test('Handler enforces admin/owner RBAC (same gate as operator-config + api-keys + webhooks)', () => {
  // Cron-status is platform-wide (NOT org-scoped) BUT the gate
  // still requires the caller be an admin/owner SOMEWHERE — not
  // every authenticated user gets to introspect the cron stack.
  assert.match(HANDLER_SRC, /OPS_REVIEW_ROLES = new Set\(\['admin', 'owner'\]\)/);
  assert.match(HANDLER_SRC, /only owner \/ admin members can view cron status/);
});

test('Handler is GET-only (other methods 405)', () => {
  assert.match(HANDLER_SRC, /Method not allowed on \/api\/cron-status/);
});

test('Handler reads the canonical JOBS map from cron handler (not a hardcoded job list)', () => {
  // Drift-guard against the cron status surface getting out of
  // sync with the real registered jobs as new ones land.
  assert.match(HANDLER_SRC, /Object\.keys\(cronHandler\.JOBS\)\.sort\(\)/);
});

test('Handler reads from cron:lastRun:<job> and cron:lastError:<job> via canonical prefix constants', () => {
  // Drift-guard against re-typing the prefixes by hand (a typo
  // would silently produce 0 records).
  assert.match(HANDLER_SRC, /cronHandler\.CRON_LAST_RUN_PREFIX \+ name/);
  assert.match(HANDLER_SRC, /cronHandler\.CRON_LAST_ERROR_PREFIX \+ name/);
});

test('Handler response includes asOf + staleAfterMs + per-job health + raw lastRun + lastError', () => {
  // Pin the response contract surfaced to the UI.
  assert.match(HANDLER_SRC, /asOf: new Date\(nowMs\)\.toISOString\(\)/);
  assert.match(HANDLER_SRC, /staleAfterMs: STALE_AFTER_MS/);
  assert.match(HANDLER_SRC, /health: classifyHealth/);
});

// ── TS mirror ──────────────────────────────────────────────────────

test('TS CronJobHealth type covers the 4 documented states', () => {
  // The type-level enum is the cross-layer contract — a JS
  // refactor adding a 5th state would surface here.
  assert.match(API_TS, /export type CronJobHealth = ['"]ok['"] \| ['"]error['"] \| ['"]stale['"] \| ['"]never['"]/);
});

test('TS CronJobStatus + CronStatusResponse interfaces defined', () => {
  assert.match(API_TS, /export interface CronJobStatus \{[\s\S]*?name: string;[\s\S]*?health: CronJobHealth;[\s\S]*?lastRun: CronJobLastRun \| null;[\s\S]*?lastError: CronJobLastError \| null;[\s\S]*?\}/);
  assert.match(API_TS, /export interface CronStatusResponse \{[\s\S]*?asOf: string;[\s\S]*?staleAfterMs: number;[\s\S]*?jobs: CronJobStatus\[\];[\s\S]*?\}/);
});

// ── UI ─────────────────────────────────────────────────────────────

test('Ops Insights page mounts <CronStatusPanel> after <WebhooksPanel>', () => {
  // Admin-only settings band order: config → keys → webhooks →
  // cron status. Pin the relative position.
  assert.match(INSIGHTS_TSX, /<CronStatusPanel \/>/);
  const whIdx = INSIGHTS_TSX.indexOf('<WebhooksPanel');
  const cronIdx = INSIGHTS_TSX.indexOf('<CronStatusPanel');
  assert.ok(whIdx >= 0 && cronIdx > whIdx,
    'CronStatusPanel must mount AFTER WebhooksPanel');
});

test('CronStatusPanel lazy-loads on first expand (apiGet to /api/cron-status)', () => {
  const block = INSIGHTS_TSX.match(/function CronStatusPanel\(\)[\s\S]*?\n\}\n\n\/\* /);
  assert.ok(block, 'CronStatusPanel body not located');
  const body = block[0];
  assert.match(body, /apiGet<CronStatusResponse>\(['"]\/api\/cron-status['"]\)/);
  assert.match(body, /jobs === null && !loading/);
});

test('CronStatusPanel renders per-job health pill with documented copy', () => {
  // The healthLabel mapping is what the user sees on the pills —
  // pin all 4 strings.
  for (const label of ['OK', 'ERROR', 'STALE', 'NEVER']) {
    assert.match(INSIGHTS_TSX, new RegExp(`return ['"]${label}['"]`));
  }
});

test('CronStatusPanel summary line surfaces OK / error / stale counts in the closed state', () => {
  // The collapsed eyebrow is the most-scanned surface — drift-
  // guard that the three categories all surface (the user can
  // tell whether to bother expanding at a glance).
  const block = INSIGHTS_TSX.match(/function CronStatusPanel\(\)[\s\S]*?\n\}\n\n\/\* /);
  assert.ok(block);
  const body = block[0];
  assert.match(body, /\{counts\.ok \|\| 0\} OK/);
  assert.match(body, /\(counts\.error \|\| 0\) > 0 && ` \· \$\{counts\.error\} error`/);
  assert.match(body, /\(counts\.stale \|\| 0\) > 0 && ` \· \$\{counts\.stale\} stale`/);
});
