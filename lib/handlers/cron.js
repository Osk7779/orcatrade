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
const digest = require('../digest');
const originSuggest = require('../origin-suggest');
const savedPortfolios = require('../saved-portfolios');
const portfolioHandler = require('./portfolio');
const { comparePortfolioSnapshots } = require('../intelligence/portfolio-aggregate');
const portfolioRevision = require('../portfolio-revision');
const { aggregateObligations } = require('../intelligence/compliance-calendar');
const monitoring = require('../intelligence/monitoring');
const alertStore = require('../alert-store');
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

// Sprint compliance-calendar-v1 phase 3 — proactive deadline reminders.
// Per-user (not per-plan) aggregation + a 6-day dedupe bucket, mirroring the
// portfolio-revision cadence so a user gets at most one reminder a week.
const DEADLINE_REMINDER_DEDUPE_PREFIX = 'compliance-deadline-sent:';
const DEADLINE_REMINDER_MIN_INTERVAL_DAYS = 6;
// Only remind on obligations landing within this window — far-future statutory
// dates aren't actionable yet and would just be noise.
const DEADLINE_REMINDER_HORIZON_DAYS = 45;

// Sprint monitoring-v1 — the proactive-monitoring digest email cadence. Same
// 6-day dedupe bucket as the deadline reminder so a user gets at most one
// monitoring digest a week regardless of how often the scan runs.
const MONITORING_DIGEST_DEDUPE_PREFIX = 'monitoring-digest-sent:';
const MONITORING_DIGEST_MIN_INTERVAL_DAYS = 6;
const MONITORING_MAX_PLANS_PER_USER = 50;

// Sprint email-locale-v1 — plan-revision email body in EN/PL/DE. The
// caller supplies a ctx object with all interpolated values pre-formatted
// (we don't do EUR/percent localisation per-locale here — those go
// through fmtEur which is locale-agnostic 'en-IE'-style grouping).
// Driver labels per locale are inline because they're short and
// translating them via a separate i18n module would be overkill.
const REVISION_TEMPLATES = {
  en: {
    driverWord: { duty: 'duty rates', vat: 'VAT', transport: 'freight', brokerage: 'brokerage' },
    fallbackDriver: 'pricing',
    subject: (ctx) => `Plan revision · ${ctx.direction === 'up' ? 'cost up' : 'cost down'} ${ctx.sign}${ctx.landedDeltaEurFmt} on ${ctx.planTitle}`,
    body: (ctx) => [
      `Your saved plan has shifted.`,
      ``,
      `Plan: ${ctx.planTitle}`,
      `Saved: ${ctx.savedDate}  (${ctx.daysSinceSaved} days ago)`,
      ``,
      `Landed cost is ${ctx.direction} ${ctx.sign}${ctx.landedDeltaEurFmt} (${ctx.pctSign}${ctx.landedDeltaPct}% vs your snapshot).`,
      `Driver: ${ctx.driver} moved the most in absolute EUR.`,
      ...(ctx.altLine ? ['', ctx.altLine] : []),
      ``,
      `Open your saved plans to see the full breakdown:`,
      ctx.planUrl,
      ``,
      `— OrcaTrade · automated revision check`,
      ``,
      `Not interested? One-click unsubscribe: ${ctx.unsubUrl}`,
      `Or manage all your email preferences at ${ctx.prefsUrl}`,
    ].join('\n'),
  },
  pl: {
    driverWord: { duty: 'stawki celne', vat: 'VAT', transport: 'fracht', brokerage: 'odprawa celna' },
    fallbackDriver: 'cennik',
    subject: (ctx) => `Rewizja planu · koszt ${ctx.direction === 'up' ? 'wzrósł' : 'spadł'} ${ctx.sign}${ctx.landedDeltaEurFmt} dla ${ctx.planTitle}`,
    body: (ctx) => [
      `Twój zapisany plan się zmienił.`,
      ``,
      `Plan: ${ctx.planTitle}`,
      `Zapisany: ${ctx.savedDate}  (${ctx.daysSinceSaved} dni temu)`,
      ``,
      `Koszt landed jest ${ctx.direction === 'up' ? 'wyżej' : 'niżej'} o ${ctx.sign}${ctx.landedDeltaEurFmt} (${ctx.pctSign}${ctx.landedDeltaPct}% vs Twój snapshot).`,
      `Czynnik: ${ctx.driver} przesunął się najmocniej w EUR.`,
      ...(ctx.altLine ? ['', ctx.altLine] : []),
      ``,
      `Otwórz zapisane plany, aby zobaczyć pełne rozbicie:`,
      ctx.planUrl,
      ``,
      `— OrcaTrade · automatyczna weryfikacja rewizji`,
      ``,
      `Nie interesuje Cię? Wypisz się jednym kliknięciem: ${ctx.unsubUrl}`,
      `Lub zarządzaj preferencjami e-mail pod ${ctx.prefsUrl}`,
    ].join('\n'),
  },
  de: {
    driverWord: { duty: 'Zollsätze', vat: 'EUSt', transport: 'Fracht', brokerage: 'Verzollung' },
    fallbackDriver: 'Preisgestaltung',
    subject: (ctx) => `Plan-Revision · Kosten ${ctx.direction === 'up' ? 'gestiegen' : 'gesunken'} ${ctx.sign}${ctx.landedDeltaEurFmt} bei ${ctx.planTitle}`,
    body: (ctx) => [
      `Ihr gespeicherter Plan hat sich bewegt.`,
      ``,
      `Plan: ${ctx.planTitle}`,
      `Gespeichert: ${ctx.savedDate}  (vor ${ctx.daysSinceSaved} Tagen)`,
      ``,
      `Landed Cost ist ${ctx.direction === 'up' ? 'um' : 'um'} ${ctx.sign}${ctx.landedDeltaEurFmt} ${ctx.direction === 'up' ? 'höher' : 'niedriger'} (${ctx.pctSign}${ctx.landedDeltaPct}% vs. Ihr Snapshot).`,
      `Treiber: ${ctx.driver} bewegte sich am stärksten in EUR.`,
      ...(ctx.altLine ? ['', ctx.altLine] : []),
      ``,
      `Öffnen Sie Ihre gespeicherten Pläne für die vollständige Aufschlüsselung:`,
      ctx.planUrl,
      ``,
      `— OrcaTrade · automatische Revisionsprüfung`,
      ``,
      `Nicht interessiert? Mit einem Klick abmelden: ${ctx.unsubUrl}`,
      `Oder E-Mail-Einstellungen verwalten unter ${ctx.prefsUrl}`,
    ].join('\n'),
  },
};

function buildRevisionEmail(locale, ctx) {
  const tpl = REVISION_TEMPLATES[locale] || REVISION_TEMPLATES.en;
  const driver = tpl.driverWord[ctx.primaryDriver] || tpl.fallbackDriver;
  const resolved = { ...ctx, driver };
  return {
    subject: tpl.subject(resolved),
    text: tpl.body(resolved),
  };
}

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

// Sprint richer-revision-v1 — same composePlan call as computeSnapshot
// but also returns the alternative-origin suggestion so the
// plan-revision email can recommend a cheaper origin in the same body.
// Kept separate from computeSnapshot so weekly-user-digest (which calls
// composePlan many times and only needs the snapshot half) stays cheap.
async function computeRevisionContext(inputs) {
  try {
    const result = await startHandler.composePlan(inputs);
    if (!result || !result.ok) return null;
    return {
      snapshot: planDiff.extractSnapshot(result),
      suggestion: originSuggest.suggestAlternativeOrigin(result),
    };
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

      const ctx = await computeRevisionContext(record.inputs);
      if (!ctx) continue;
      const current = ctx.snapshot;
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

      // Sprint email-locale-v1 — every recipient gets the body in
      // their persisted locale (written on first plan save, mutable
      // via /account/preferences/). Falls back to EN for users who
      // existed before email-locale-v1 shipped.
      const userLocale = await notificationPrefs.getLocale(record.email);
      const direction = delta.landedDeltaEur > 0 ? 'up' : 'down';
      const sign = delta.landedDeltaEur > 0 ? '+' : '';
      const pctSign = delta.landedDeltaPct > 0 ? '+' : '';
      const planUrl = `${SITE_ORIGIN}/account/plans/`;
      const unsubToken = notificationPrefs.generateUnsubscribeToken(record.email);
      const unsubUrl = `${SITE_ORIGIN}/api/unsubscribe?token=${unsubToken}`;
      const prefsUrl = `${SITE_ORIGIN}/account/preferences/`;

      // Sprint richer-revision-v1 — append a "cheaper-origin" hint
      // when one exists. originSuggest.formatLine() returns '' when
      // the user is already on the cheapest origin or the saving is
      // below the dual-floor threshold (5% AND €500/shipment), so a
      // stable plan stays a quiet single-paragraph notification.
      // Sprint email-locale-v1 — pass locale through so the line
      // renders in PL/DE too.
      const altLine = originSuggest.formatLine(ctx.suggestion, { locale: userLocale });

      const { subject, text } = buildRevisionEmail(userLocale, {
        planTitle: record.label || planId,
        savedDate: (record.savedAt || '').slice(0, 10),
        daysSinceSaved: delta.daysSinceSaved,
        direction,
        sign,
        pctSign,
        landedDeltaEurFmt: fmtEur(delta.landedDeltaEur),
        landedDeltaPct: delta.landedDeltaPct,
        primaryDriver: delta.primaryDriver,
        altLine,
        planUrl,
        unsubUrl,
        prefsUrl,
      });
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

// ── Job: weekly user digest (Sprint weekly-digest-v1) ───
//
// Calendar-triggered. Once a week the GitHub Actions cron fires us with
// job=weekly-user-digest; we scan every user with saved plans, compute
// their digest payload, respect the prefs-v1 opt-out, and send one email
// per user. Idempotency via a per-user 'digest:lastSent:<email>' key
// with a 6-day TTL — a same-day re-run is a no-op.
//
// We deliberately do NOT use the plan-revision dedupe namespace: that
// one's keyed per-plan-per-week (rev emails fire only on drift).
// The digest is keyed per-user-per-run because every user with plans
// gets exactly one email regardless of which plans moved.
//
// Failure of the per-user email send doesn't break the loop — the next
// run picks up where this one left off, modulo the idempotency window.

const DIGEST_LAST_SENT_PREFIX = 'digest:lastSent:';
const DIGEST_MIN_INTERVAL_DAYS = 6; // safety net for a same-day re-run

async function runWeeklyUserDigest({ dryRun = false, maxUsers = 5000 } = {}) {
  if (!email.isConfigured()) {
    return { ok: false, reason: 'RESEND_API_KEY not set' };
  }
  const userListKeys = await kv.listKeys(savedPlans.USER_PLANS_PREFIX);
  let scannedUsers = 0;
  let eligibleUsers = 0; // users with ≥1 plan that survived plan-load
  let sent = 0;
  let skippedRecent = 0;
  let skippedOptOut = 0;
  let skippedNoPlans = 0;
  let failedSend = 0;
  const nowMs = Date.now();
  const minIntervalMs = DIGEST_MIN_INTERVAL_DAYS * 24 * 60 * 60 * 1000;

  for (const userKey of userListKeys) {
    if (!userKey.startsWith(savedPlans.USER_PLANS_PREFIX) || !userKey.endsWith(savedPlans.USER_PLANS_SUFFIX)) continue;
    const userEmail = userKey.slice(savedPlans.USER_PLANS_PREFIX.length, userKey.length - savedPlans.USER_PLANS_SUFFIX.length);
    if (!userEmail) continue;
    scannedUsers++;
    if (scannedUsers > maxUsers) break;

    // Idempotency — skip users we emailed in the last 6 days, regardless
    // of whether the cron is firing on its weekly cadence or an ad-hoc
    // replay. Stored as ISO string for greppability in KV.
    const dedupeKey = DIGEST_LAST_SENT_PREFIX + userEmail;
    try {
      const last = await kv.get(dedupeKey);
      if (last && typeof last === 'object' && last.sentAt) {
        const lastMs = Date.parse(last.sentAt);
        if (Number.isFinite(lastMs) && (nowMs - lastMs) < minIntervalMs) {
          skippedRecent++;
          continue;
        }
      }
    } catch (_) { /* dedupe read failure → still try to send */ }

    // Opt-out check BEFORE doing any composePlan work — saves cron budget
    // for users who don't want the email.
    const optedIn = await notificationPrefs.isEnabled(userEmail, 'weeklyDigestEmails');
    if (!optedIn) { skippedOptOut++; continue; }

    const planIds = (await kv.get(userKey)) || [];
    if (!Array.isArray(planIds) || planIds.length === 0) { skippedNoPlans++; continue; }

    // Load every plan record + recompute its current snapshot.
    // Bounded by the user's own saved-plan cap (50, per BG-J era).
    const records = [];
    for (const planId of planIds) {
      const record = await kv.get(savedPlans.planKey(planId));
      if (!record) continue;
      // Attach the current snapshot for plan-diff to chew on.
      let currentSnapshot = null;
      if (record.inputs && record.snapshot) {
        currentSnapshot = await computeSnapshot(record.inputs);
      }
      records.push({
        id: planId,
        label: record.label,
        savedAt: record.savedAt,
        snapshot: record.snapshot || null,
        currentSnapshot,
        actual: record.actual || null,
        actualVariance: record.actualVariance || null,
      });
    }

    if (records.length === 0) { skippedNoPlans++; continue; }
    eligibleUsers++;

    const payload = digest.buildDigestPayload(records, { asOf: new Date().toISOString() });

    if (dryRun) { sent++; continue; }

    // Sprint email-locale-v1 — honour the user's persisted locale
    // (written through on first plan save by the welcome trigger).
    // notificationPrefs.getLocale falls back to 'en' on unknown / missing.
    const userLocale = await notificationPrefs.getLocale(userEmail);
    const unsubToken = notificationPrefs.generateUnsubscribeToken(userEmail);
    const unsubUrl = `${SITE_ORIGIN}/api/unsubscribe?token=${unsubToken}`;
    const text = digest.formatDigestText(payload, {
      locale: userLocale,
      planUrl: `${SITE_ORIGIN}/account/plans/`,
      prefsUrl: `${SITE_ORIGIN}/account/preferences/`,
      unsubUrl,
    });
    const subject = digest.formatDigestSubject(payload, { locale: userLocale });

    const result = await email.send({ to: userEmail, subject, text });
    if (result.ok) {
      sent++;
      try {
        await kv.set(dedupeKey, { sentAt: new Date().toISOString(), planCount: payload.planCount }, {
          ttlSeconds: (DIGEST_MIN_INTERVAL_DAYS + 1) * 24 * 60 * 60,
        });
      } catch (_) { /* dedupe write failure → next run may double-send; acceptable */ }
    } else {
      failedSend++;
    }
  }

  return {
    ok: true,
    scannedUsers,
    eligibleUsers,
    sent,
    skippedRecent,
    skippedOptOut,
    skippedNoPlans,
    failedSend,
    dryRun,
  };
}

// Sprint portfolio-revision-v1 — weekly cost-drift monitoring for saved
// portfolios, the portfolio analogue of plan-revision-emails. Scans every
// user's saved portfolios, recomputes each against today's data, and
// emails the user when ≥1 portfolio has moved materially since save.
// Reuses the planRevisionEmails opt-out (same "we alert you when your
// saved costs drift" category) and a 6-day dedupe bucket.
const PORTFOLIO_REVISION_DEDUPE_PREFIX = 'portfolio:revision-sent:';
const PORTFOLIO_REVISION_MIN_INTERVAL_DAYS = 6;

async function runPortfolioRevisionEmails({ dryRun = false, maxUsers = 5000 } = {}) {
  if (!email.isConfigured()) return { ok: false, reason: 'RESEND_API_KEY not set' };

  const prefix = savedPortfolios.USER_PORTFOLIOS_PREFIX;
  const suffix = savedPortfolios.USER_PORTFOLIOS_SUFFIX;
  const userListKeys = await kv.listKeys(prefix);
  let scannedUsers = 0;
  let usersWithMovers = 0;
  let portfoliosChecked = 0;
  let sent = 0;
  let skippedRecent = 0;
  let skippedOptOut = 0;
  let skippedNoMovers = 0;
  let failedSend = 0;
  const nowMs = Date.now();
  const minIntervalMs = PORTFOLIO_REVISION_MIN_INTERVAL_DAYS * 24 * 60 * 60 * 1000;

  for (const userKey of userListKeys) {
    // listKeys('user:') also matches ':plans' lists — only take ':portfolios'.
    if (!userKey.startsWith(prefix) || !userKey.endsWith(suffix)) continue;
    const userEmail = userKey.slice(prefix.length, userKey.length - suffix.length);
    if (!userEmail) continue;
    scannedUsers++;
    if (scannedUsers > maxUsers) break;

    // 6-day dedupe.
    const dedupeKey = PORTFOLIO_REVISION_DEDUPE_PREFIX + userEmail;
    try {
      const last = await kv.get(dedupeKey);
      if (last && typeof last === 'object' && last.sentAt) {
        const lastMs = Date.parse(last.sentAt);
        if (Number.isFinite(lastMs) && (nowMs - lastMs) < minIntervalMs) { skippedRecent++; continue; }
      }
    } catch (_) { /* dedupe read failure → still try */ }

    // Opt-out BEFORE recompute work (same pref as plan-revision).
    const optedIn = await notificationPrefs.isEnabled(userEmail, 'planRevisionEmails');
    if (!optedIn) { skippedOptOut++; continue; }

    const ids = (await kv.get(userKey)) || [];
    if (!Array.isArray(ids) || ids.length === 0) { skippedNoMovers++; continue; }

    // Recompute each saved portfolio + compare vs its saved snapshot.
    const movers = [];
    for (const id of ids) {
      const record = await kv.get(savedPortfolios.portfolioKey(id));
      if (!record || record.email !== userEmail || !record.snapshot || !Array.isArray(record.lines)) continue;
      portfoliosChecked++;
      const { aggregate } = await portfolioHandler.composeAndAggregate(record.lines);
      if (!aggregate) continue;
      const drift = comparePortfolioSnapshots(record.snapshot, aggregate);
      if (drift && drift.material) {
        movers.push({
          label: record.label || 'Portfolio',
          landedDeltaEur: drift.landedDeltaEur,
          landedDeltaPct: drift.landedDeltaPct,
          direction: drift.direction,
          savedAt: record.savedAt,
        });
      }
    }

    if (movers.length === 0) { skippedNoMovers++; continue; }
    usersWithMovers++;
    if (dryRun) { sent++; continue; }

    const userLocale = await notificationPrefs.getLocale(userEmail);
    const unsubToken = notificationPrefs.generateUnsubscribeToken(userEmail);
    const built = portfolioRevision.buildPortfolioRevisionEmail(userLocale, movers, {
      portfolioUrl: `${SITE_ORIGIN}/account/portfolios/`,
      prefsUrl: `${SITE_ORIGIN}/account/preferences/`,
      unsubUrl: `${SITE_ORIGIN}/api/unsubscribe?token=${unsubToken}`,
    });
    if (!built) { skippedNoMovers++; continue; }

    const result = await email.send({ to: userEmail, subject: built.subject, text: built.text });
    if (result.ok) {
      sent++;
      try {
        await kv.set(dedupeKey, { sentAt: new Date().toISOString(), moverCount: movers.length }, {
          ttlSeconds: (PORTFOLIO_REVISION_MIN_INTERVAL_DAYS + 1) * 24 * 60 * 60,
        });
      } catch (_) { /* next run may double-send; acceptable */ }
    } else {
      failedSend++;
    }
  }

  return {
    ok: true,
    scannedUsers,
    portfoliosChecked,
    usersWithMovers,
    sent,
    skippedRecent,
    skippedOptOut,
    skippedNoMovers,
    failedSend,
    dryRun,
  };
}

// EN/PL/DE templates — mirrors REVISION_TEMPLATES. Severity tokens
// (critical/high/medium/low) stay as-is — they're machine tags, not prose.
// `dayWord` returns just "<n> <noun>"; the preposition (in / za) lives in the
// subject + line strings so each language reads naturally.
const DEADLINE_TEMPLATES = {
  en: {
    dayWord: n => `${n} day${n === 1 ? '' : 's'}`,
    subject: (ctx, dw) => `Compliance deadline${ctx.obligations.length === 1 ? '' : 's'}: ${ctx.soonest.regime.toUpperCase()} ${ctx.soonest.title} in ${dw(ctx.soonest.daysUntil)}`,
    intro: ctx => `You have ${ctx.obligations.length} upcoming trade-compliance ${ctx.obligations.length === 1 ? 'obligation' : 'obligations'} on your saved plans:`,
    line: (o, dw) => `• ${o.dueDate} (in ${dw(o.daysUntil)} · ${o.severity}) — ${o.regime.toUpperCase()}: ${o.title} [${o.citation}]`,
    statutory: 'These dates are statutory. Open your plans for the full breakdown and what to file:',
    signature: '— OrcaTrade · automated compliance calendar',
    unsub: url => `Not useful? Unsubscribe from deadline reminders: ${url}`,
    prefs: url => `Or manage all email preferences: ${url}`,
  },
  pl: {
    dayWord: n => (n === 1 ? '1 dzień' : `${n} dni`),
    subject: (ctx, dw) => `Termin zgodności: ${ctx.soonest.regime.toUpperCase()} ${ctx.soonest.title} za ${dw(ctx.soonest.daysUntil)}`,
    intro: ctx => `Masz ${ctx.obligations.length} nadchodzących obowiązków zgodności handlowej w zapisanych planach:`,
    line: (o, dw) => `• ${o.dueDate} (za ${dw(o.daysUntil)} · ${o.severity}) — ${o.regime.toUpperCase()}: ${o.title} [${o.citation}]`,
    statutory: 'Te terminy są ustawowe. Otwórz swoje plany, aby zobaczyć pełne zestawienie i co należy złożyć:',
    signature: '— OrcaTrade · automatyczny kalendarz zgodności',
    unsub: url => `Nieprzydatne? Wypisz się z przypomnień o terminach: ${url}`,
    prefs: url => `Lub zarządzaj preferencjami e-mail: ${url}`,
  },
  de: {
    dayWord: n => (n === 1 ? '1 Tag' : `${n} Tagen`),
    subject: (ctx, dw) => `Compliance-Frist: ${ctx.soonest.regime.toUpperCase()} ${ctx.soonest.title} in ${dw(ctx.soonest.daysUntil)}`,
    intro: ctx => `Sie haben ${ctx.obligations.length} anstehende Handels-Compliance-Pflichten in Ihren gespeicherten Plänen:`,
    line: (o, dw) => `• ${o.dueDate} (in ${dw(o.daysUntil)} · ${o.severity}) — ${o.regime.toUpperCase()}: ${o.title} [${o.citation}]`,
    statutory: 'Diese Fristen sind gesetzlich. Öffnen Sie Ihre Pläne für die vollständige Aufschlüsselung und was einzureichen ist:',
    signature: '— OrcaTrade · automatischer Compliance-Kalender',
    unsub: url => `Nicht nützlich? Von Fristerinnerungen abmelden: ${url}`,
    prefs: url => `Oder E-Mail-Einstellungen verwalten: ${url}`,
  },
};

function buildDeadlineEmail(locale, { obligations, planUrl, unsubUrl, prefsUrl }) {
  const tpl = DEADLINE_TEMPLATES[locale] || DEADLINE_TEMPLATES.en;
  const ctx = { obligations, soonest: obligations[0] };
  const text = [
    tpl.intro(ctx),
    ``,
    ...obligations.map(o => tpl.line(o, tpl.dayWord)),
    ``,
    tpl.statutory,
    planUrl,
    ``,
    tpl.signature,
    ``,
    tpl.unsub(unsubUrl),
    tpl.prefs(prefsUrl),
  ].join('\n');
  return { subject: tpl.subject(ctx, tpl.dayWord), text };
}

// Scan every user's saved plans, aggregate the statutory obligations that fall
// within the reminder horizon (deduped across plans by regime+date), and email
// one digest per user — the proactive half of the obligations tracker (II6).
async function runComplianceDeadlineReminders({ dryRun = false, maxUsers = 5000, asOf } = {}) {
  if (!email.isConfigured()) {
    return { ok: false, reason: 'RESEND_API_KEY not set' };
  }
  const userListKeys = await kv.listKeys(savedPlans.USER_PLANS_PREFIX);
  let scannedUsers = 0;
  let scannedPlans = 0;
  let usersWithDeadlines = 0;
  let sent = 0;
  let skippedDedupe = 0;
  let skippedOptOut = 0;
  let failedSend = 0;

  for (const userKey of userListKeys) {
    if (scannedUsers >= maxUsers) break;
    if (!userKey.startsWith(savedPlans.USER_PLANS_PREFIX) || !userKey.endsWith(savedPlans.USER_PLANS_SUFFIX)) continue;
    const userEmail = userKey.slice(savedPlans.USER_PLANS_PREFIX.length, userKey.length - savedPlans.USER_PLANS_SUFFIX.length);
    if (!userEmail || !userEmail.includes('@')) continue;
    scannedUsers++;

    const planIds = (await kv.get(userKey)) || [];
    if (!Array.isArray(planIds) || !planIds.length) continue;

    // Collect the user's plan inputs, then aggregate obligations across them
    // (deduped by regime+dueDate so the same date on two plans is one line).
    const planInputs = [];
    for (const planId of planIds) {
      const record = await kv.get(savedPlans.planKey(planId));
      if (!record || !record.inputs) continue;
      scannedPlans++;
      planInputs.push(record.inputs);
    }

    const due = aggregateObligations(planInputs, { asOf, horizonDays: DEADLINE_REMINDER_HORIZON_DAYS });
    if (!due.length) continue;
    usersWithDeadlines++;

    const optedIn = await notificationPrefs.isEnabled(userEmail, 'complianceDeadlineEmails');
    if (!optedIn) { skippedOptOut++; continue; }

    // 6-day dedupe so re-firing the job never spams the same user.
    const dedupeKey = DEADLINE_REMINDER_DEDUPE_PREFIX + userEmail;
    try {
      const last = await kv.get(dedupeKey);
      if (last && last.sentAt && (Date.now() - new Date(last.sentAt).getTime()) < DEADLINE_REMINDER_MIN_INTERVAL_DAYS * 24 * 60 * 60 * 1000) {
        skippedDedupe++;
        continue;
      }
    } catch (_) { /* dedupe read failure → still try to send */ }

    if (dryRun) { sent++; continue; }

    const userLocale = await notificationPrefs.getLocale(userEmail);
    const unsubUrl = `${SITE_ORIGIN}/api/unsubscribe?token=${notificationPrefs.generateUnsubscribeToken(userEmail)}&stream=complianceDeadlineEmails`;
    const prefsUrl = `${SITE_ORIGIN}/account/preferences/`;
    const planUrl = `${SITE_ORIGIN}/account/plans/`;
    const { subject, text } = buildDeadlineEmail(userLocale, { obligations: due, planUrl, unsubUrl, prefsUrl });
    const result = await email.send({ to: userEmail, subject, text });
    if (result.ok) {
      sent++;
      try {
        await kv.set(dedupeKey, { sentAt: new Date().toISOString(), deadlineCount: due.length }, { ttlSeconds: DEADLINE_REMINDER_MIN_INTERVAL_DAYS * 24 * 60 * 60 });
      } catch (_) { /* next run may double-send; acceptable */ }
    } else {
      failedSend++;
    }
  }

  return {
    ok: true,
    scannedUsers,
    scannedPlans,
    usersWithDeadlines,
    sent,
    skippedDedupe,
    skippedOptOut,
    failedSend,
    dryRun,
  };
}

// ── Job: proactive monitoring scan (Sprint monitoring-v1 / Pillar I3) ──
//
// The flagship monitoring agent's engine, run as a scheduled scan. For every
// user with saved plans/portfolios it runs the calculator-grounded rules
// engine (lib/intelligence/monitoring.js) — plan/portfolio cost drift, FX
// exposure, compliance deadlines, sanctions-list deltas — and upserts the
// resulting alerts into the durable inbox (lib/alert-store.js). Where the user
// has opted into `monitoringAlerts` and there are NEW emailable alerts, it
// sends one consolidated digest (6-day dedupe). Deadlines are inbox-only here
// — they own the compliance-deadline-reminders email stream.
//
// Idempotent: alerts dedupe by (user, signal); the email dedupes on a weekly
// bucket. Safe to re-run.
function buildMonitoringDigestEmail({ alerts, alertsUrl, unsubUrl, prefsUrl }) {
  const lines = alerts.slice(0, 12).map((a) => `• [${String(a.severity).toUpperCase()}] ${a.title}\n  ${a.body}`);
  const subject = `OrcaTrade monitoring: ${alerts.length} update${alerts.length === 1 ? '' : 's'} on your plans`;
  const text = [
    'Your OrcaTrade monitoring agent flagged the following on your saved plans and portfolios:',
    '',
    lines.join('\n\n'),
    '',
    `See all alerts and mark them read: ${alertsUrl}`,
    '',
    'Every figure above comes from OrcaTrade\'s calculators, recomputed against today\'s tariff, freight and FX data — not an AI guess.',
    '',
    `Manage these emails: ${prefsUrl}`,
    `Unsubscribe from monitoring alerts: ${unsubUrl}`,
  ].join('\n');
  return { subject, text };
}

async function runMonitoringScan({ dryRun = false, maxUsers = 5000, asOf } = {}) {
  // Build the recompute closures here (in a handler), so the engine itself
  // never has to require a handler / pull in the SDK import graph.
  const recomputePlan = (inputs) => startHandler.composePlan(inputs || {});
  const recomputePortfolio = async (lines) => {
    const { aggregate } = await portfolioHandler.composeAndAggregate(lines || []);
    return aggregate;
  };

  const shared = await monitoring.buildSharedContext();

  const userListKeys = await kv.listKeys(savedPlans.USER_PLANS_PREFIX);
  let scannedUsers = 0;
  let alertsCreated = 0;
  let alertsRefreshed = 0;
  let digestsSent = 0;
  let skippedOptOut = 0;
  let skippedDedupe = 0;
  let failedSend = 0;

  for (const userKey of userListKeys) {
    if (scannedUsers >= maxUsers) break;
    if (!userKey.startsWith(savedPlans.USER_PLANS_PREFIX) || !userKey.endsWith(savedPlans.USER_PLANS_SUFFIX)) continue;
    const userEmail = userKey.slice(savedPlans.USER_PLANS_PREFIX.length, userKey.length - savedPlans.USER_PLANS_SUFFIX.length);
    if (!userEmail || !userEmail.includes('@')) continue;
    scannedUsers++;

    const plans = (await savedPlans.listPlans(userEmail)).slice(0, MONITORING_MAX_PLANS_PER_USER);
    let portfolios = [];
    try { portfolios = await savedPortfolios.listPortfolios(userEmail); } catch (_) { portfolios = []; }

    let candidates;
    try {
      candidates = await monitoring.evaluateUser({ plans, portfolios }, shared, { recomputePlan, recomputePortfolio, asOf });
    } catch (err) {
      log.error('monitoring evaluateUser failed', { err: err.message });
      continue;
    }
    if (!candidates.length) continue;

    // Persist (upsert) each alert. Track which are newly created + emailable
    // so we only email when there's genuinely something new to say.
    const freshEmailable = [];
    if (!dryRun) {
      for (const c of candidates) {
        try {
          const { created } = await alertStore.recordAlert({ email: userEmail, ...c });
          if (created) alertsCreated++; else alertsRefreshed++;
          if (created && monitoring.EMAILABLE_TYPES.has(c.type)) freshEmailable.push(c);
        } catch (_) { /* one bad alert never aborts the scan */ }
      }
    } else {
      for (const c of candidates) {
        if (monitoring.EMAILABLE_TYPES.has(c.type)) freshEmailable.push(c);
      }
      alertsCreated += candidates.length;
    }

    // Email digest — only for NEW emailable alerts, only if opted in + not
    // already emailed this week.
    if (!freshEmailable.length) continue;
    if (!email.isConfigured()) continue;

    const optedIn = await notificationPrefs.isEnabled(userEmail, 'monitoringAlerts');
    if (!optedIn) { skippedOptOut++; continue; }

    const dedupeKey = MONITORING_DIGEST_DEDUPE_PREFIX + userEmail;
    try {
      const last = await kv.get(dedupeKey);
      if (last && last.sentAt && (Date.now() - new Date(last.sentAt).getTime()) < MONITORING_DIGEST_MIN_INTERVAL_DAYS * 24 * 60 * 60 * 1000) {
        skippedDedupe++;
        continue;
      }
    } catch (_) { /* dedupe read failure → still try to send */ }

    if (dryRun) { digestsSent++; continue; }

    const unsubUrl = `${SITE_ORIGIN}/api/unsubscribe?token=${notificationPrefs.generateUnsubscribeToken(userEmail)}&stream=monitoringAlerts`;
    const { subject, text } = buildMonitoringDigestEmail({
      alerts: freshEmailable,
      alertsUrl: `${SITE_ORIGIN}/account/alerts/`,
      unsubUrl,
      prefsUrl: `${SITE_ORIGIN}/account/preferences/`,
    });
    const result = await email.send({ to: userEmail, subject, text });
    if (result.ok) {
      digestsSent++;
      try { await kv.set(dedupeKey, { sentAt: new Date().toISOString(), alertCount: freshEmailable.length }, { ttlSeconds: MONITORING_DIGEST_MIN_INTERVAL_DAYS * 24 * 60 * 60 }); } catch (_) {}
    } else {
      failedSend++;
    }
  }

  // Record the sanctions fingerprint so the NEXT scan can diff against it.
  if (!dryRun && shared && typeof shared._persistSeen === 'function') {
    await shared._persistSeen();
  }

  return {
    ok: true,
    scannedUsers,
    alertsCreated,
    alertsRefreshed,
    digestsSent,
    skippedOptOut,
    skippedDedupe,
    failedSend,
    sanctionsChanged: !!shared.sanctionsChanged,
    dryRun,
  };
}

// Parse a sanctions-list file into entries and (unless dryRun) replace that
// source's rows in Postgres. Extracted from the fetch so it's unit-testable
// with a fixture (Sprint sanctions-lists-v1).
async function ingestSanctions({ source = 'OFAC-SDN', text, format = 'ofac-sdn', dryRun = false, maxEntries = 30000 } = {}) {
  const parse = require('../intelligence/sanctions-parse');
  const store = require('../intelligence/sanctions-list-store');
  const parsed = format === 'simple' ? parse.parseSimpleCsv(text, { source })
    : format === 'ofsi' ? parse.parseOfsiCsv(text)
      : format === 'un' ? parse.parseUnXml(text)
        : format === 'eu' ? parse.parseEuXml(text)
          : parse.parseOfacSdnCsv(text);
  const entries = parsed.entries.slice(0, maxEntries);
  if (dryRun) return { ok: true, source, parsed: parsed.entries.length, capped: entries.length, dryRun: true };
  if (!store.isAvailable()) return { ok: false, reason: 'DATABASE_URL not set', parsed: entries.length };
  const res = await store.replaceEntries(source, entries);
  return { ok: res.ok, source, imported: res.count, parsed: parsed.entries.length };
}

// Fetch the official consolidated list and refresh Postgres. Defaults to the
// OFAC SDN CSV; override via SANCTIONS_SDN_URL. The screening engine falls
// back to the bundled sample whenever this hasn't run / the table is empty,
// so a failed refresh never takes screening offline.
// The official sources refreshed by default. URLs are env-overridable and
// must be verified on first run (formats can shift); a bad source just logs a
// reason and the others still load. EU consolidated list can be added here as
// an adapter, or loaded via the 'simple' CSV path.
function defaultSanctionsSources() {
  return [
    { source: 'OFAC-SDN', format: 'ofac-sdn', url: process.env.SANCTIONS_SDN_URL || 'https://www.treasury.gov/ofac/downloads/sdn.csv' },
    { source: 'UK-OFSI', format: 'ofsi', url: process.env.SANCTIONS_OFSI_URL || 'https://ofsistorage.blob.core.windows.net/publishlive/2022format/ConList.csv' },
    { source: 'UN', format: 'un', url: process.env.SANCTIONS_UN_URL || 'https://scsanctions.un.org/resources/xml/en/consolidated.xml' },
    { source: 'EU', format: 'eu', url: process.env.SANCTIONS_EU_URL || 'https://webgate.ec.europa.eu/fsd/fsf/public/files/xmlFullSanctionsList_1_1/content?token=dG9rZW4tMjAxNw' },
  ];
}

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
  try {
    const resp = await fetch(url, { signal: controller.signal });
    if (!resp.ok) return { ok: false, reason: `fetch ${resp.status}` };
    return { ok: true, text: await resp.text() };
  } catch (err) {
    return { ok: false, reason: err.message };
  } finally {
    clearTimeout(timer);
  }
}

// Refresh one explicit source ({url, source, format}) or, by default, the full
// set (OFAC SDN + UK OFSI). Each source replaces only its own rows, so a
// partial failure leaves the others intact.
async function runSanctionsRefresh({ dryRun = false, url, source, format, maxEntries = 30000, sources } = {}) {
  const store = require('../intelligence/sanctions-list-store');
  if (!dryRun && !store.isAvailable()) return { ok: false, reason: 'DATABASE_URL not set' };

  let specs;
  if (url || source) {
    specs = [{ source: source || 'OFAC-SDN', format: format || 'ofac-sdn', url: url || defaultSanctionsSources()[0].url }];
  } else if (Array.isArray(sources) && sources.length) {
    specs = sources;
  } else {
    specs = defaultSanctionsSources();
  }

  const results = [];
  for (const spec of specs) {
    const fetched = await fetchText(spec.url);
    if (!fetched.ok) { results.push({ source: spec.source, ok: false, reason: fetched.reason }); continue; }
    const r = await ingestSanctions({ source: spec.source, text: fetched.text, format: spec.format, dryRun, maxEntries });
    results.push({ source: spec.source, ...r });
  }
  return { ok: results.some(r => r.ok), sources: results };
}

// Re-embed the regulation corpus into pgvector (Sprint rag-v1). Manual /
// on-corpus-change job — run after editing lib/intelligence/corpus/*.json or
// after first enabling pgvector + VOYAGE_API_KEY. dryRun builds the chunk set
// without embedding or writing.
async function runRagReindex({ dryRun = false } = {}) {
  return require('../intelligence/rag-index').reindex({ dryRun });
}

const JOBS = {
  'founder-digest': runFounderDigest,
  'plan-revision-emails': runPlanRevisionEmails,
  'portfolio-revision-emails': runPortfolioRevisionEmails,
  'compliance-deadline-reminders': runComplianceDeadlineReminders,
  'monitoring-scan': runMonitoringScan,
  'sanctions-refresh': runSanctionsRefresh,
  'rag-reindex': runRagReindex,
  'regime-change-check': runRegimeChangeCheck,
  'taric-warm': runTaricWarm,
  'db-migrate': runDbMigrate,
  'calibration-drift-check': runCalibrationDriftCheck,
  'weekly-user-digest': runWeeklyUserDigest,
};

// Sprint cron-observability-v1 — every dispatcher call now writes
// cron:lastRun:<job> (success path) OR cron:lastError:<job> (thrown).
// The dashboard at /dashboard/cron/ reads these keys to answer "did
// Monday's digest actually fire?"
//
// Storage shape (success):
//   { ranAt, completedAt, durationMs, ok, params, summary }
// Storage shape (error):
//   { ranAt, completedAt, durationMs, ok:false, error }
//
// We persist a SUMMARY of the job's return value rather than the full
// thing — taric-warm in particular can return a 30-entry details[]
// array. The summary keeps the cardinality bounded to a few dozen
// scalar fields, enough for the dashboard to render a status pill +
// "sent: 4 · skipped: 12" detail line.
const CRON_LAST_RUN_PREFIX = 'cron:lastRun:';
const CRON_LAST_ERROR_PREFIX = 'cron:lastError:';
// 30-day TTL — long enough that "the Monday digest hasn't fired in a
// week" is loudly visible on the dashboard even after weekend gaps.
const CRON_LAST_RUN_TTL_SECONDS = 30 * 24 * 60 * 60;

// Pure: summarise a job's return value to a bounded shape. Strip arrays
// and nested objects beyond depth 1 — the dashboard wants headline
// numbers, not full traces.
function summariseJobResult(result) {
  if (!result || typeof result !== 'object') return result === undefined ? null : result;
  const out = {};
  for (const k of Object.keys(result)) {
    const v = result[k];
    if (v === null || typeof v === 'undefined') { out[k] = null; continue; }
    const t = typeof v;
    if (t === 'string' || t === 'number' || t === 'boolean') { out[k] = v; continue; }
    if (Array.isArray(v)) { out[k] = { _len: v.length }; continue; }
    if (t === 'object') {
      // Shallow keys only — enough to surface { alerts: { _len: 3 } }.
      out[k] = { _keys: Object.keys(v).length };
      continue;
    }
  }
  return out;
}

async function recordCronRun(jobName, payload) {
  const kv = require('../intelligence/kv-store');
  try {
    await kv.set(CRON_LAST_RUN_PREFIX + jobName, payload, { ttlSeconds: CRON_LAST_RUN_TTL_SECONDS });
  } catch (_) { /* observability layer can't break the request */ }
}

async function recordCronError(jobName, payload) {
  const kv = require('../intelligence/kv-store');
  try {
    await kv.set(CRON_LAST_ERROR_PREFIX + jobName, payload, { ttlSeconds: CRON_LAST_RUN_TTL_SECONDS });
  } catch (_) { /* same */ }
}

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
  const startedMs = Date.now();
  try {
    const result = await fn(body.params || {});
    const completedAt = new Date().toISOString();
    // Record before responding so a slow KV doesn't double-block the
    // cron response, but DO await — we want the dashboard to be
    // consistent immediately after each run.
    await recordCronRun(jobName, {
      ranAt: startedAt,
      completedAt,
      durationMs: Date.now() - startedMs,
      ok: !!(result && result.ok !== false),
      params: body.params || null,
      summary: summariseJobResult(result),
    });
    return jsonResponse(res, 200, { ok: true, job: jobName, startedAt, completedAt, result });
  } catch (err) {
    const completedAt = new Date().toISOString();
    await recordCronError(jobName, {
      ranAt: startedAt,
      completedAt,
      durationMs: Date.now() - startedMs,
      ok: false,
      error: err.message || String(err),
    });
    return jsonResponse(res, 500, { error: err.message || 'Job failed', job: jobName });
  }
};

// Sprint cron-observability-v1 — admin-only status reader.
// GET /api/cron/status returns { ok, jobs: [{ name, lastRun, lastError }] }
// Gated by admin-auth (same allowlist + token fallback as the dashboards).
// Mounted at /api/cron-status to avoid colliding with the POST dispatcher
// (which is otherwise the entirety of /api/cron and is token-gated by
// ORCATRADE_CRON_TOKEN, not the admin allowlist).
async function handleStatus(req, res) {
  const adminAuth = require('../admin-auth');
  if (req.method !== 'GET') {
    return jsonResponse(res, 405, { error: 'Method not allowed' });
  }
  const verdict = await adminAuth.verifyAdmin(req);
  if (!verdict.ok) {
    return jsonResponse(res, verdict.statusCode, { error: verdict.error });
  }

  const kv = require('../intelligence/kv-store');
  const jobNames = Object.keys(JOBS).sort();
  const jobs = [];
  for (const name of jobNames) {
    const lastRun = await kv.get(CRON_LAST_RUN_PREFIX + name) || null;
    const lastError = await kv.get(CRON_LAST_ERROR_PREFIX + name) || null;
    jobs.push({ name, lastRun, lastError });
  }
  return jsonResponse(res, 200, {
    ok: true,
    asOf: new Date().toISOString(),
    jobs,
  });
}
module.exports.handleStatus = handleStatus;
module.exports.summariseJobResult = summariseJobResult;
module.exports.CRON_LAST_RUN_PREFIX = CRON_LAST_RUN_PREFIX;
module.exports.CRON_LAST_ERROR_PREFIX = CRON_LAST_ERROR_PREFIX;
module.exports.CRON_LAST_RUN_TTL_SECONDS = CRON_LAST_RUN_TTL_SECONDS;

module.exports.runFounderDigest = runFounderDigest;
module.exports.runPlanRevisionEmails = runPlanRevisionEmails;
module.exports.runRegimeChangeCheck = runRegimeChangeCheck;
module.exports.runTaricWarm = runTaricWarm;
module.exports.runCalibrationDriftCheck = runCalibrationDriftCheck;
module.exports.runWeeklyUserDigest = runWeeklyUserDigest;
module.exports.runPortfolioRevisionEmails = runPortfolioRevisionEmails;
module.exports.PORTFOLIO_REVISION_DEDUPE_PREFIX = PORTFOLIO_REVISION_DEDUPE_PREFIX;
module.exports.runComplianceDeadlineReminders = runComplianceDeadlineReminders;
module.exports.DEADLINE_REMINDER_DEDUPE_PREFIX = DEADLINE_REMINDER_DEDUPE_PREFIX;
module.exports.buildDeadlineEmail = buildDeadlineEmail;
module.exports.runMonitoringScan = runMonitoringScan;
module.exports.buildMonitoringDigestEmail = buildMonitoringDigestEmail;
module.exports.MONITORING_DIGEST_DEDUPE_PREFIX = MONITORING_DIGEST_DEDUPE_PREFIX;
module.exports.runSanctionsRefresh = runSanctionsRefresh;
module.exports.ingestSanctions = ingestSanctions;
module.exports.runRagReindex = runRagReindex;
module.exports.PORTFOLIO_REVISION_MIN_INTERVAL_DAYS = PORTFOLIO_REVISION_MIN_INTERVAL_DAYS;
module.exports.CALIBRATION_ALERT_KEY = CALIBRATION_ALERT_KEY;
module.exports.DIGEST_LAST_SENT_PREFIX = DIGEST_LAST_SENT_PREFIX;
module.exports.DIGEST_MIN_INTERVAL_DAYS = DIGEST_MIN_INTERVAL_DAYS;
module.exports.JOBS = JOBS;
module.exports.isoWeek = isoWeek;
module.exports.REGIME_SOURCES = REGIME_SOURCES;
module.exports.REGIME_HASH_PREFIX = REGIME_HASH_PREFIX;
module.exports.hashContent = hashContent;
module.exports.extractMainContent = extractMainContent;
