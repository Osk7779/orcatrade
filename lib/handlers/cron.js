// /api/cron — token-gated job dispatcher.
//
// Vercel Hobby doesn't have Vercel Cron, so we drive scheduled work from
// GitHub Actions: GHA cron → POST /api/cron with X-Cron-Token → dispatch
// to a named job. Each job is idempotent within its expected cadence
// (the digest only runs Monday, the plan-revision loop dedupes against a
// weekly bucket key).
//
//   POST /api/cron
//   Header:   X-Cron-Token: <ORCATRADE_CRON_TOKEN>
//   Body:     { job: "founder-digest" | "plan-revision-emails" }
//
// Auth: header-only, constant-time compare against ORCATRADE_CRON_TOKEN.
// 503 if env var unset, 401 if missing/wrong, 400 if job unknown.

'use strict';

const crypto = require('node:crypto');
const events = require('../events');
const kv = require('../intelligence/kv-store');
const email = require('../email');
const savedPlans = require('../saved-plans');
const planDiff = require('../plan-diff');
const startHandler = require('./start');
const actuals = require('../actuals');
const calibration = require('../calibration');
const notificationPrefs = require('../notification-prefs');
const log = require('../log').withContext({ handler: 'cron' });

const SITE_ORIGIN = process.env.SITE_ORIGIN || 'https://orcatrade.pl';

function jsonResponse(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function tokensMatch(a, b) {
  if (!a || !b) return false;
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function readToken(req) {
  return (req.headers && (req.headers['x-cron-token'] || req.headers['X-Cron-Token'])) || '';
}

function founderInboxes() {
  const raw = process.env.ORCATRADE_FOUNDER_INBOXES || '';
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

function fmtEur(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return '€' + Math.round(Number(n)).toLocaleString('en-IE');
}

function fmtPct(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return Number(n).toFixed(1) + '%';
}

function isoDaysAgo(days) {
  const d = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return d.toISOString();
}

// ── Job 1: founder digest ─────────────────────────────
//
// Weekly summary of conversion-analytics events. Runs Mondays at 06:30 UTC
// from GHA. Body is plain-text markdown rendered by Resend.

async function runFounderDigest({ sinceDays = 7 } = {}) {
  const inboxes = founderInboxes();
  if (inboxes.length === 0) {
    return { ok: false, reason: 'ORCATRADE_FOUNDER_INBOXES not set' };
  }
  const since = isoDaysAgo(sinceDays);
  const log = await events.list({ since, limit: 5000 });
  const summary = events.aggregate(log);

  const periodLabel = `${since.slice(0, 10)} → ${new Date().toISOString().slice(0, 10)}`;
  const top = (rows, n = 5) => (rows || []).slice(0, n).map(r => `  · ${r.key} — ${r.count}`).join('\n') || '  · (none)';

  const text = [
    `OrcaTrade weekly digest — ${periodLabel}`,
    ``,
    `Total events (last ${sinceDays}d):  ${summary.total}`,
    `Email captured:                    ${summary.emailCaptured} (${fmtPct(summary.emailCaptureRate)} capture rate)`,
    `Mean landed cost / shipment:       ${fmtEur(summary.meanLandedEur)}`,
    `Distinct routes:                   ${summary.topRoutes.length}`,
    ``,
    `Top categories`,
    top(summary.byCategory),
    ``,
    `Top routes`,
    top(summary.topRoutes),
    ``,
    `Top origins`,
    top(summary.byOrigin),
    ``,
    `Top destinations`,
    top(summary.byDestination),
    ``,
    `Locales`,
    top(summary.byLocale),
    ``,
    `Recent events (newest 5)`,
    (summary.recent || []).slice(0, 5).map(e => {
      const ts = (e.at || '').replace('T', ' ').slice(0, 16);
      return `  · ${ts}  ${e.type}  ${e.route || '—'}  ${e.category || '—'}  ${fmtEur(e.landedTotal)}${e.emailProvided ? '  ✓email' : ''}`;
    }).join('\n') || '  · (none)',
    ``,
    `Full dashboard: ${SITE_ORIGIN}/dashboard/leads/`,
    ``,
    `— Sent automatically by /api/cron · job=founder-digest`,
  ].join('\n');

  const subject = `OrcaTrade digest · ${summary.total} events · ${summary.emailCaptured} captured · ${periodLabel}`;
  const results = await email.sendMany(inboxes, { subject, text });
  return {
    ok: true,
    recipients: inboxes.length,
    sent: results.filter(r => r.result && r.result.ok).length,
    failed: results.filter(r => r.result && !r.result.ok).length,
    eventsInPeriod: summary.total,
    summary: {
      total: summary.total,
      emailCaptured: summary.emailCaptured,
      meanLandedEur: summary.meanLandedEur,
      topCategory: (summary.byCategory[0] && summary.byCategory[0].key) || null,
      topRoute: (summary.topRoutes[0] && summary.topRoutes[0].key) || null,
    },
  };
}

// ── Job 2: plan-revision emails ───────────────────────
//
// Scan every saved plan, recompute against current pricing, send a
// "what's changed since you saved this" email when delta is significant
// (≥5%). Dedupe per plan per ISO-week so a customer who hasn't opened
// /account/plans/ in months gets at most one nudge per week.

const REVISION_DEDUPE_PREFIX = 'plan-revision-email:';
const REVISION_DEDUPE_TTL_DAYS = 14;

function isoWeek(date = new Date()) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

async function computeSnapshot(inputs) {
  try {
    const result = await startHandler.composePlan(inputs);
    if (!result || !result.ok) return null;
    return planDiff.extractSnapshot(result);
  } catch (_err) {
    return null;
  }
}

async function runPlanRevisionEmails({ dryRun = false, maxPlans = 500 } = {}) {
  if (!email.isConfigured()) {
    return { ok: false, reason: 'RESEND_API_KEY not set' };
  }
  // Discover every user-plans list. KV listKeys takes a prefix.
  const userListKeys = await kv.listKeys(savedPlans.USER_PLANS_PREFIX);
  let scanned = 0;
  let significant = 0;
  let sent = 0;
  let skippedDedupe = 0;
  let skippedNoEmail = 0;
  let skippedOptOut = 0;
  const week = isoWeek();

  outer:
  for (const userKey of userListKeys) {
    // user:<email>:plans → strip the prefix and suffix to recover the email.
    if (!userKey.startsWith(savedPlans.USER_PLANS_PREFIX) || !userKey.endsWith(savedPlans.USER_PLANS_SUFFIX)) continue;
    const userEmail = userKey.slice(savedPlans.USER_PLANS_PREFIX.length, userKey.length - savedPlans.USER_PLANS_SUFFIX.length);
    if (!userEmail) continue;
    const planIds = (await kv.get(userKey)) || [];
    if (!Array.isArray(planIds)) continue;

    for (const planId of planIds) {
      scanned++;
      if (scanned > maxPlans) break outer;
      const record = await kv.get(savedPlans.planKey(planId));
      if (!record || !record.snapshot || !record.inputs) continue;

      const current = await computeSnapshot(record.inputs);
      if (!current) continue;
      const delta = planDiff.diffSnapshots(record.snapshot, current, record.savedAt);
      if (!delta || !delta.significant) continue;
      significant++;

      const dedupeKey = REVISION_DEDUPE_PREFIX + planId + ':' + week;
      const alreadySent = await kv.get(dedupeKey);
      if (alreadySent) { skippedDedupe++; continue; }

      if (!record.email) { skippedNoEmail++; continue; }

      // Sprint prefs-v1 — respect the user's opt-out. Default is true
      // (backwards-compat with the pre-prefs behaviour), so a user
      // who has never touched /account/preferences/ keeps getting the
      // emails they've been getting. setting planRevisionEmails:false
      // there OR clicking the one-click unsubscribe link in any past
      // email flips this to false.
      const optedIn = await notificationPrefs.isEnabled(record.email, 'planRevisionEmails');
      if (!optedIn) { skippedOptOut++; continue; }

      if (dryRun) {
        sent++;
        continue;
      }

      const direction = delta.landedDeltaEur > 0 ? 'up' : 'down';
      const sign = delta.landedDeltaEur > 0 ? '+' : '';
      const pctSign = delta.landedDeltaPct > 0 ? '+' : '';
      const driver = ({ duty: 'duty rates', vat: 'VAT', transport: 'freight', brokerage: 'brokerage' }[delta.primaryDriver]) || 'pricing';
      const planUrl = `${SITE_ORIGIN}/account/plans/`;
      // Sprint prefs-v1 — one-click unsubscribe link. Token is HMAC-
      // signed (lib/notification-prefs.js); /api/unsubscribe verifies
      // + flips the pref. Per-email-forever — no expiry.
      const unsubToken = notificationPrefs.generateUnsubscribeToken(record.email);
      const unsubUrl = `${SITE_ORIGIN}/api/unsubscribe?token=${unsubToken}`;
      const prefsUrl = `${SITE_ORIGIN}/account/preferences/`;

      const text = [
        `Your saved plan has shifted.`,
        ``,
        `Plan: ${record.label || planId}`,
        `Saved: ${(record.savedAt || '').slice(0, 10)}  (${delta.daysSinceSaved} days ago)`,
        ``,
        `Landed cost is ${direction} ${sign}${fmtEur(delta.landedDeltaEur)} (${pctSign}${delta.landedDeltaPct}% vs your snapshot).`,
        `Driver: ${driver} moved the most in absolute EUR.`,
        ``,
        `Open your saved plans to see the full breakdown:`,
        planUrl,
        ``,
        `— OrcaTrade · automated revision check`,
        ``,
        `Not interested? One-click unsubscribe: ${unsubUrl}`,
        `Or manage all your email preferences at ${prefsUrl}`,
      ].join('\n');

      const subject = `Plan revision · ${direction === 'up' ? 'cost up' : 'cost down'} ${sign}${fmtEur(delta.landedDeltaEur)} on ${record.label || planId}`;
      const result = await email.send({ to: record.email, subject, text });
      if (result.ok) {
        sent++;
        await kv.set(dedupeKey, { sentAt: new Date().toISOString() }, { ttlSeconds: REVISION_DEDUPE_TTL_DAYS * 24 * 60 * 60 });
      }
    }
  }

  return {
    ok: true,
    scanned,
    significant,
    sent,
    skippedDedupe,
    skippedNoEmail,
    skippedOptOut,
    week,
    dryRun,
  };
}

// ── Job 3: EUR-Lex regime change detection ────────────
//
// Fetches each tracked EU-regulation page, hashes the response body, and
// alerts founders when any hash changes vs the last snapshot stored in
// KV. Useful early-warning when CBAM rates, EUDR scope, or REACH SVHC
// listings move — the compliance overlay accuracy depends on these
// pages staying current.
//
// The HTML on eur-lex.europa.eu is verbose (cookie banners, breadcrumbs,
// translation menus). We hash a "stable subset" — the inner content
// region only — to avoid false positives from layout changes.
// If EUR-Lex is unreachable we noop rather than alerting.

const REGIME_HASH_PREFIX = 'regime-hash:';
const REGIME_HASH_TTL_DAYS = 90;

// Curated list of regulation source URLs. Each entry is a celex code +
// the human-readable name the founders will see in the alert email.
// Add to this list (not delete from it) — KV-stored hashes persist.
const REGIME_SOURCES = [
  { id: 'cbam',     name: 'CBAM (Regulation 2023/956)',          url: 'https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32023R0956' },
  { id: 'eudr',     name: 'EUDR — Deforestation (2023/1115)',    url: 'https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32023R1115' },
  { id: 'reach',    name: 'REACH — Annex XVII restrictions',     url: 'https://echa.europa.eu/substances-restricted-under-reach' },
  { id: 'gpsr',     name: 'GPSR (Regulation 2023/988)',          url: 'https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32023R0988' },
  { id: 'battery',  name: 'EU Battery Regulation (2023/1542)',   url: 'https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32023R1542' },
  { id: 'ppwr',     name: 'PPWR — Packaging Waste (2025/40)',    url: 'https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32025R0040' },
];

function hashContent(text) {
  // Strip whitespace and case so trivial reformatting doesn't fire alerts.
  return crypto
    .createHash('sha256')
    .update(String(text).replace(/\s+/g, ' ').trim().toLowerCase())
    .digest('hex');
}

function extractMainContent(html) {
  // Best-effort: pull the <article>...</article> or <main>...</main> region.
  // Falls back to the full body if neither exists. EUR-Lex pages have an
  // `<article>` wrapping the legal text; ECHA wraps in `<main>`.
  const articleMatch = html.match(/<article[\s\S]*?<\/article>/i);
  if (articleMatch) return articleMatch[0];
  const mainMatch = html.match(/<main[\s\S]*?<\/main>/i);
  if (mainMatch) return mainMatch[0];
  const bodyMatch = html.match(/<body[\s\S]*?<\/body>/i);
  return bodyMatch ? bodyMatch[0] : html;
}

async function fetchRegimeHash(url) {
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'OrcaTrade-RegimeMonitor/1.0 (https://orcatrade.pl)' },
    });
    if (!response.ok) return { ok: false, status: response.status, reason: 'http' };
    const text = await response.text();
    const content = extractMainContent(text);
    return { ok: true, hash: hashContent(content), bytes: content.length };
  } catch (err) {
    return { ok: false, reason: err.message || 'fetch failed' };
  }
}

async function runRegimeChangeCheck({ alert = true } = {}) {
  const inboxes = founderInboxes();
  const checked = [];
  const changed = [];
  const failed = [];

  for (const regime of REGIME_SOURCES) {
    const result = await fetchRegimeHash(regime.url);
    if (!result.ok) {
      failed.push({ id: regime.id, name: regime.name, reason: result.reason });
      continue;
    }
    const key = REGIME_HASH_PREFIX + regime.id;
    const stored = await kv.get(key);
    const previousHash = stored && stored.hash;
    const previousAt = stored && stored.at;
    if (previousHash && previousHash !== result.hash) {
      changed.push({
        id: regime.id,
        name: regime.name,
        url: regime.url,
        previousHash,
        currentHash: result.hash,
        previousAt,
      });
    }
    await kv.set(key, { hash: result.hash, at: new Date().toISOString(), bytes: result.bytes }, {
      ttlSeconds: REGIME_HASH_TTL_DAYS * 24 * 60 * 60,
    });
    checked.push({ id: regime.id, name: regime.name, hash: result.hash, changed: previousHash && previousHash !== result.hash });
  }

  let sent = 0;
  if (alert && changed.length > 0 && inboxes.length > 0 && email.isConfigured()) {
    const text = [
      `Regulatory regime drift detected on ${changed.length} of ${REGIME_SOURCES.length} tracked sources.`,
      ``,
      `Changed since last check:`,
      ``,
      ...changed.map(c => [
        `  · ${c.name}`,
        `      ${c.url}`,
        `      previous snapshot: ${c.previousAt || '(unknown)'}`,
        ``,
      ].join('\n')),
      `Action: open each source URL, compare against the compliance overlay`,
      `(lib/intelligence/data/eu-compliance.js) + the corresponding guide page`,
      `(/guides/compliance/<regime>/). Update both if the regime text has`,
      `moved substantively.`,
      ``,
      `${failed.length > 0 ? `Failed to fetch ${failed.length} sources — re-run after the next scheduled check.\n` : ''}`,
      `— Sent automatically by /api/cron · job=regime-change-check`,
    ].join('\n');
    const subject = `Regime drift · ${changed.length} source${changed.length === 1 ? '' : 's'} changed`;
    const results = await email.sendMany(inboxes, { subject, text });
    sent = results.filter(r => r.result && r.result.ok).length;
  }

  return {
    ok: true,
    checked: checked.length,
    changed: changed.length,
    failed: failed.length,
    alertSent: sent,
    detail: { changed, failed: failed.map(f => ({ id: f.id, reason: f.reason })) },
  };
}

// ── Job 4: TARIC cache warmer ─────────────────────────
//
// Pre-populates KV with sub-chapter MFN rates for the curated set of
// HS×origin combos in taric-warm-list. Three uses:
//
//   1. Real users with 8+ digit HS codes see a cache HIT on common
//      products (no upstream fetch latency on their first visit).
//   2. Smoke-tests the entire live-lookup path end-to-end — if a
//      deploy breaks something in taric-client, this job surfaces it
//      via the per-entry success/failure list.
//   3. Provides a "blast radius" answer: if UK Trade Tariff goes
//      down, the founder can see how stale the cache is by checking
//      when the warmer last ran successfully.
//
// Run from the same GHA cron entrypoint as the other jobs. Recommended
// cadence: nightly. Idempotent — overwrites the existing KV entry
// with a fresh savedAt timestamp, which extends the staleness window.

async function runTaricWarm({ dryRun = false, max = null } = {}) {
  const taric = require('../intelligence/taric-client');
  const kv = require('../intelligence/kv-store');
  const { WARM_LIST } = require('../intelligence/data/taric-warm-list');
  const list = max ? WARM_LIST.slice(0, max) : WARM_LIST;

  const startedAt = Date.now();
  let hit = 0;
  let miss = 0;
  let cached = 0;       // upstream returned a usable rate
  let unchanged = 0;    // had a fresh cache entry already — no upstream call needed
  let written = 0;
  const details = [];

  for (const entry of list) {
    const t0 = Date.now();
    // skipUpstream=true first lets us count how many are already fresh
    // in cache without spending the network round-trip.
    const existing = await taric.lookupHsRate(entry.hs, entry.origin, { skipUpstream: true });
    if (existing && !existing.stale && existing.fromCache) {
      unchanged++;
      details.push({ hs: entry.hs, origin: entry.origin, status: 'already-fresh', ratePct: +(existing.rate * 100).toFixed(2), durationMs: Date.now() - t0 });
      continue;
    }

    if (dryRun) {
      details.push({ hs: entry.hs, origin: entry.origin, status: 'would-fetch', durationMs: Date.now() - t0 });
      continue;
    }

    // Hit the upstream + write to KV in one call via the normal lookup.
    const r = await taric.lookupHsRate(entry.hs, entry.origin);
    if (r) {
      cached++;
      written += r.fromCache ? 0 : 1;
      details.push({ hs: entry.hs, origin: entry.origin, status: r.fromCache ? 'cache-refresh' : 'fetched', ratePct: +(r.rate * 100).toFixed(2), durationMs: Date.now() - t0, source: r.source });
      hit++;
    } else {
      miss++;
      details.push({ hs: entry.hs, origin: entry.origin, status: 'upstream-failed', durationMs: Date.now() - t0 });
    }
  }

  // Sprint BG-4.3: record last successful warm so /api/health can flag
  // staleness when nightly cron silently fails. Only write on non-dry-run
  // and when at least one entry succeeded (so a totally-broken run doesn't
  // mark itself "fresh").
  if (!dryRun && hit + unchanged > 0) {
    try {
      await kv.set('taric:warm:lastRun', new Date().toISOString(), { ttlSeconds: 60 * 60 * 24 * 7 });
    } catch (_) { /* health probe gracefully degrades on read failure */ }
  }

  return {
    ok: true,
    dryRun,
    attempted: list.length,
    hit,
    miss,
    cached,
    unchanged,
    written,
    durationMs: Date.now() - startedAt,
    details,
  };
}

// ── Dispatcher ─────────────────────────────────────────

// Sprint BG-2.1: Postgres migration runner exposed as a cron job so GHA
// can apply schema changes via the existing CRON_TOKEN auth — no separate
// CI deploy step needed. Idempotent: re-runs are no-ops thanks to
// schema_versions tracking.
async function runDbMigrate(params = {}) {
  const { runMigrations } = require('../../scripts/db-migrate');
  return await runMigrations({ dryRun: params.dryRun === true });
}

// ── Calibration drift check (Sprint BG-1.7) ────────────────
//
// Reads the actuals corpus from Postgres, summarises, and emits one
// structured warn per group whose drift crosses the alert thresholds
// (≥5% drift on ≥5 samples — see lib/calibration.ALERT_MIN_*). The
// warn flows through lib/log.js → BG-4.2 Sentry drain → operator
// notification, so we get a page before customer quotes start
// drifting.
//
// Persists the run summary to KV at `calibration:lastAlerts` so the
// /dashboard/calibration/ page can surface a "current alerts" pill
// without needing to re-run the aggregator client-side.
//
// Idempotent in the sense that running twice in a day will simply
// re-emit the same alerts. Sentry dedupes on fingerprint (handler +
// dimension + key), so the second run does not double-page.
const CALIBRATION_ALERT_KEY = 'calibration:lastAlerts';
const CALIBRATION_ALERT_TTL_DAYS = 14;

async function runCalibrationDriftCheck(params = {}) {
  const reqLog = log.withContext({ action: 'calibration_drift_check' });
  const limit = Math.max(100, Math.min(10000, Number(params.limit) || 5000));
  const rows = await actuals.listFromPg({ limit });
  const summary = calibration.summarise(rows);
  const alerts = calibration.findAlerts(summary, {
    minDriftPct: params.minDriftPct,
    minSamples: params.minSamples,
  });

  // Emit one warn per alert. BG-4.2's lib/log.js forwards warn+error
  // to Sentry; the tags below land on the Sentry envelope so the ops
  // team can filter / group on them.
  for (const a of alerts) {
    reqLog.warn('calibration drift detected', {
      dimension: a.dimension,
      groupKey: a.key,
      sampleSize: a.sampleSize,
      driftPct: a.avgVariancePct,
      direction: a.direction,
      totalEstimateEur: a.totalEstimateEur,
      totalActualEur: a.totalActualEur,
    });
  }

  const stamp = new Date().toISOString();
  // Persist the snapshot for the dashboard pill.
  try {
    await kv.set(CALIBRATION_ALERT_KEY, {
      runAt: stamp,
      rowsScanned: rows.length,
      totalSampleSize: summary.total.sampleSize,
      totalAvgVariancePct: summary.total.avgVariancePct,
      alerts,
    }, { ttlSeconds: CALIBRATION_ALERT_TTL_DAYS * 24 * 60 * 60 });
  } catch (err) {
    reqLog.error('failed to persist calibration alert snapshot', { err: err.message });
  }

  return {
    runAt: stamp,
    rowsScanned: rows.length,
    totalSampleSize: summary.total.sampleSize,
    totalAvgVariancePct: summary.total.avgVariancePct,
    alertCount: alerts.length,
    alerts,
  };
}

const JOBS = {
  'founder-digest': runFounderDigest,
  'plan-revision-emails': runPlanRevisionEmails,
  'regime-change-check': runRegimeChangeCheck,
  'taric-warm': runTaricWarm,
  'db-migrate': runDbMigrate,
  'calibration-drift-check': runCalibrationDriftCheck,
};

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Cron-Token');

  if (req.method === 'OPTIONS') { res.statusCode = 200; return res.end(); }
  if (req.method !== 'POST') return jsonResponse(res, 405, { error: 'Method not allowed' });

  const expected = process.env.ORCATRADE_CRON_TOKEN;
  if (!expected) return jsonResponse(res, 503, { error: 'Cron not configured (ORCATRADE_CRON_TOKEN missing)' });
  if (!tokensMatch(readToken(req), expected)) return jsonResponse(res, 401, { error: 'Unauthorized' });

  const body = req.body || {};
  const jobName = String(body.job || (req.query && req.query.job) || '').toLowerCase();
  const fn = JOBS[jobName];
  if (!fn) return jsonResponse(res, 400, { error: 'Unknown job', knownJobs: Object.keys(JOBS) });

  const startedAt = new Date().toISOString();
  try {
    const result = await fn(body.params || {});
    return jsonResponse(res, 200, { ok: true, job: jobName, startedAt, completedAt: new Date().toISOString(), result });
  } catch (err) {
    return jsonResponse(res, 500, { error: err.message || 'Job failed', job: jobName });
  }
};

module.exports.runFounderDigest = runFounderDigest;
module.exports.runPlanRevisionEmails = runPlanRevisionEmails;
module.exports.runRegimeChangeCheck = runRegimeChangeCheck;
module.exports.runTaricWarm = runTaricWarm;
module.exports.runCalibrationDriftCheck = runCalibrationDriftCheck;
module.exports.CALIBRATION_ALERT_KEY = CALIBRATION_ALERT_KEY;
module.exports.JOBS = JOBS;
module.exports.isoWeek = isoWeek;
module.exports.REGIME_SOURCES = REGIME_SOURCES;
module.exports.REGIME_HASH_PREFIX = REGIME_HASH_PREFIX;
module.exports.hashContent = hashContent;
module.exports.extractMainContent = extractMainContent;
