'use strict';

// Sprint 26 — weekly Ops Insights digest email.
//
// Tests cover four layers:
//   1. composeOpsInsightsDigest renders { subject, text, html } from
//      the sprint-17 aggregateOpsInsights shape, handles the empty
//      org case + cleanly degrades on partial data
//   2. sendOpsInsightsDigest: pref-gated via importInsightsDigestEmails,
//      fail-soft, per-recipient filter (one admin opting out doesn't
//      drop the others)
//   3. Cron job: runImportRequestInsightsDigest enumerates orgs,
//      resolves numeric org_id, skips orgs with zero activity,
//      collects per-org errors without halting the fan-out
//   4. /preferences UI: the new toggle surfaces in the Ops inbox
//      group; TS Prefs interface carries the new key
//
// The composer is calculator-grounded (ADR 0002) — every number in
// the email body traces to a value already in the insights object.
// The drift-guard pins the no-LLM-in-this-path posture by asserting
// the function doesn't import @anthropic-ai/sdk.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const importsEmails = require('../lib/imports-emails');
const notificationPrefs = require('../lib/notification-prefs');
const cron = require('../lib/handlers/cron');

const ROOT = path.resolve(__dirname, '..');
const EMAILS_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'imports-emails.js'), 'utf8');
const CRON_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'handlers', 'cron.js'), 'utf8');
const CRON_YAML = fs.readFileSync(
  path.join(ROOT, '.github', 'workflows', 'cron.yml'),
  'utf8',
);
const API_TS = fs.readFileSync(path.join(ROOT, 'app-shell', 'lib', 'api.ts'), 'utf8');
const PREFS_TSX = fs.readFileSync(
  path.join(ROOT, 'app-shell', 'app', '(authed)', 'preferences', 'page.tsx'),
  'utf8',
);

// Fixture mirroring the aggregateOpsInsights return shape so the
// composer tests don't need a live PG connection.
function buildInsights(over = {}) {
  return {
    funnelByStatus: {
      submitted: 2, processing: 1, awaiting_review: 3,
      quoted: 4, customer_approved: 5,
      customer_rejected: 1, expired: 0, cancelled: 2, failed: 0,
    },
    totalInWindow: 18,
    declineReasons: { price_target_unrealistic: 2, compliance_blocker: 1 },
    totalDeclined: 3,
    revisionCohort: {
      recoverableDeclined: 3,
      revisions: 2,
      revisionsProgressed: 1,
      revisionRate: 67,
      progressionRate: 50,
    },
    ...over,
  };
}

// ── PREF_KEYS surface ──────────────────────────────────────────────

test('PREF_KEYS includes importInsightsDigestEmails', () => {
  assert.ok(
    notificationPrefs.PREF_KEYS.includes('importInsightsDigestEmails'),
    'new pref key not added to PREF_KEYS',
  );
});

test('PREF_KEYS still INCLUDES the sprint-26 importInsightsDigestEmails key', () => {
  // Sprint 26 originally pinned `length === 11`; sprint 33 added
  // importLowRatingAlertEmails. The brittle length assertion has
  // been replaced with an inclusion check so future sprints can
  // add keys without breaking this guard. The new sprint owns its
  // own length pin alongside its enum addition.
  assert.ok(notificationPrefs.PREF_KEYS.includes('importInsightsDigestEmails'));
});

// ── composeOpsInsightsDigest ──────────────────────────────────────

test('composeOpsInsightsDigest returns { subject, text, html } for a populated org', () => {
  const out = importsEmails.composeOpsInsightsDigest({
    orgName: 'Acme', windowDays: 7, insights: buildInsights(),
  });
  assert.ok(typeof out.subject === 'string' && out.subject.length > 0);
  assert.ok(typeof out.text === 'string' && out.text.length > 0);
  assert.ok(typeof out.html === 'string' && out.html.length > 0);
  // Subject includes the org name when provided.
  assert.match(out.subject, /Acme/);
  // Subject explicitly names the window so the recipient knows the
  // time period at a glance.
  assert.match(out.subject, /7-day digest/);
});

test('composeOpsInsightsDigest gracefully handles a zero-activity org', () => {
  const out = importsEmails.composeOpsInsightsDigest({
    windowDays: 7,
    insights: {
      funnelByStatus: {}, totalInWindow: 0,
      declineReasons: {}, totalDeclined: 0,
      revisionCohort: {
        recoverableDeclined: 0, revisions: 0, revisionsProgressed: 0,
        revisionRate: null, progressionRate: null,
      },
    },
  });
  // The "no new requests" copy lands in the body.
  assert.match(out.text, /No new import requests/);
  assert.match(out.html, /No new import requests/);
});

test('composeOpsInsightsDigest surfaces the funnel + revision cohort + top declines', () => {
  const out = importsEmails.composeOpsInsightsDigest({
    windowDays: 7, insights: buildInsights(),
  });
  // Each load-bearing number from the insights structure appears.
  assert.match(out.text, /Customer-approved:\s+5/);
  assert.match(out.text, /Recoverable declines:\s+3/);
  assert.match(out.text, /Revisions submitted:\s+2/);
  assert.match(out.text, /67%/); // revisionRate
  assert.match(out.text, /price_target_unrealistic/);
});

test('composeOpsInsightsDigest CTA links to /imports/insights', () => {
  const out = importsEmails.composeOpsInsightsDigest({
    windowDays: 7, insights: buildInsights(),
  });
  // The deep view is the live page; clicking the CTA must land
  // there. Pin both the text body URL + the HTML href.
  assert.match(out.text, /\/imports\/insights/);
  assert.match(out.html, /\/imports\/insights/);
});

test('composeOpsInsightsDigest body limits decline rows to top 2 (digest discipline)', () => {
  const insights = buildInsights({
    declineReasons: {
      price_target_unrealistic: 5,
      compliance_blocker: 3,
      origin_restriction: 2,
      documentation_missing: 1,
      out_of_scope: 1,
    },
    totalDeclined: 12,
  });
  const out = importsEmails.composeOpsInsightsDigest({
    windowDays: 7, insights,
  });
  // Top 2 surface in the text body.
  assert.match(out.text, /price_target_unrealistic/);
  assert.match(out.text, /compliance_blocker/);
  // The 5th (out_of_scope) does NOT — too many rows would clutter
  // the digest. Pinning the cap.
  const textRows = (out.text.match(/^  (price_target_unrealistic|compliance_blocker|origin_restriction|documentation_missing|out_of_scope|other):/gm) || []).length;
  assert.equal(textRows, 2, `expected exactly 2 decline rows in text body, got ${textRows}`);
});

// ── Calculator-grounding pin ───────────────────────────────────────

test('composeOpsInsightsDigest does NOT import the Anthropic SDK (calculator-grounded posture)', () => {
  // The digest must read pre-computed values from the insights
  // object — no LLM in this path. ADR 0002. Drift-guard pins the
  // absence of the SDK import in the imports-emails module itself.
  assert.doesNotMatch(EMAILS_SRC, /@anthropic-ai\/sdk/);
});

// ── Cron job wiring ────────────────────────────────────────────────

test('runImportRequestInsightsDigest is exposed on the cron module', () => {
  assert.equal(typeof cron.runImportRequestInsightsDigest, 'function');
});

test('JOBS map registers "import-request-insights-digest"', () => {
  assert.equal(
    cron.JOBS['import-request-insights-digest'],
    cron.runImportRequestInsightsDigest,
  );
});

test('runImportRequestInsightsDigest enumerates orgs, resolves numeric org_id, skips zero-activity', () => {
  const block = CRON_SRC.match(/async function runImportRequestInsightsDigest\([\s\S]*?\nconst JOBS = /);
  assert.ok(block, 'runImportRequestInsightsDigest body not located');
  const body = block[0];
  // Enumerates every org.
  assert.match(body, /orgs\.listAllOrgs/);
  // Resolves the numeric Postgres id from KV's external string id.
  assert.match(body, /SELECT id FROM organisations WHERE external_id = \$1/);
  // Skip orgs with totalInWindow === 0 (no signal to send).
  assert.match(body, /Number\(agg\.insights\.totalInWindow \|\| 0\) === 0/);
});

test('runImportRequestInsightsDigest collects per-org errors without halting the fan-out', () => {
  // A single org's failure MUST NOT stop the digest from going to
  // the others. Drift-guard pins the try/catch inside the for-loop
  // body and the errors[] accumulator.
  const block = CRON_SRC.match(/async function runImportRequestInsightsDigest\([\s\S]*?\nconst JOBS = /);
  assert.ok(block);
  const body = block[0];
  assert.match(body, /for \(const org of allOrgs\) \{[\s\S]*?try \{/);
  assert.match(body, /errors\.push\(/);
});

test('runImportRequestInsightsDigest returns the cron-dashboard summary shape', () => {
  const block = CRON_SRC.match(/async function runImportRequestInsightsDigest\([\s\S]*?\nconst JOBS = /);
  assert.ok(block);
  const body = block[0];
  // sentByOrg may be written shorthand (`sentByOrg,`) or long-form.
  assert.match(body, /sentByOrg(\s*,|\s*:\s*sentByOrg)/);
  assert.match(body, /orgsConsidered: allOrgs\.length/);
  assert.match(body, /processedAt: new Date\(\)\.toISOString\(\)/);
});

// ── GHA workflow ───────────────────────────────────────────────────

test('GHA workflow schedules import-request-insights-digest at 09:30 UTC Monday', () => {
  // 09:30 sits after the existing weekly-user-digest (09:00 Mon) so
  // the two weekly jobs stagger cleanly without piling on Resend.
  assert.match(CRON_YAML, /'30 9 \* \* 1'/);
  assert.match(CRON_YAML, /job=import-request-insights-digest/);
});

test('GHA workflow_dispatch lists import-request-insights-digest in manual-fire options', () => {
  // Ops should be able to off-cycle fire the digest after a fix or
  // for a stakeholder demo. Pin the option.
  assert.match(CRON_YAML, /- import-request-insights-digest/);
});

// ── TS mirror + UI ─────────────────────────────────────────────────

test('Prefs TS interface carries importInsightsDigestEmails', () => {
  assert.match(API_TS, /importInsightsDigestEmails\?:\s*boolean/);
});

test('/preferences page surfaces the weekly insights digest toggle in the Ops inbox group', () => {
  // The toggle must live in the Ops group (not customer or legacy)
  // because the digest goes only to admins/owners. Pin the
  // placement by asserting it appears BEFORE the "Saved-plan
  // emails" heading.
  const digestIdx = PREFS_TSX.indexOf("'importInsightsDigestEmails'");
  const opsIdx = PREFS_TSX.indexOf("'Ops inbox'");
  const legacyIdx = PREFS_TSX.indexOf("'Saved-plan emails'");
  assert.ok(digestIdx > -1, 'importInsightsDigestEmails toggle not found');
  assert.ok(opsIdx > -1 && legacyIdx > -1 && opsIdx < legacyIdx);
  assert.ok(
    digestIdx > opsIdx && digestIdx < legacyIdx,
    'importInsightsDigestEmails toggle must live in the Ops inbox group (between opsIdx and legacyIdx)',
  );
});

test('/preferences digest toggle label explains the window + calculator-grounded posture', () => {
  // The pref copy should communicate WHAT the email contains so
  // the customer can make an informed mute/unmute decision.
  assert.match(PREFS_TSX, /Weekly insights digest/);
  assert.match(PREFS_TSX, /Calculator-grounded/);
});
