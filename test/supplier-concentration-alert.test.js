'use strict';

// Sprint 58 — weekly supplier-concentration alert email.
//
// Pairs with the sprint-57 fourth proactive cohort (cohort #9 +
// SupplierConcentrationCard on /imports/insights). Mirrors
// sprints 39 / 41 / 54's alert trifecta shape with the WEEKLY
// Thursday cadence — sourcing risk is more important than slow
// trends but not urgent like stalls.
//
// Tests cover four layers:
//   1. PREF_KEYS: importSupplierConcentrationAlertEmails added;
//      TS Prefs mirror carries the new key; /preferences page
//      surfaces the toggle
//   2. composeSupplierConcentrationAlert: subject + body name the
//      share + threshold + top country; strict-boolean fail-closed
//      on isConcentrated; defensive null-guards on
//      topCountry/topCountryShare; XSS-safe (no double-encoded
//      entities)
//   3. sendSupplierConcentrationAlert: short-circuits with
//      reason='not-concentrated' on healthy cohort; pref-gated
//      per-recipient via importSupplierConcentrationAlertEmails;
//      fail-soft posture matches sprint-54 pattern
//   4. Cron handler integration:
//      runImportRequestSupplierConcentrationAlert reuses
//      aggregateOpsInsights (cohort #9 source of truth); skips
//      healthy orgs (!isConcentrated); GHA Thu 09:00 UTC schedule
//      + workflow_dispatch entry registered

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

function buildConcentrationCohort(over = {}) {
  return {
    windowDays: 30,
    minCount: 5,
    threshold: 0.75,
    totalPicks: 20,
    topCountry: 'CN',
    topCountryCount: 18,
    topCountryShare: 0.9,
    isConcentrated: true,
    ...over,
  };
}

// ── PREF_KEYS surface ──────────────────────────────────────────────

test('PREF_KEYS includes importSupplierConcentrationAlertEmails (16th key)', () => {
  assert.ok(
    notificationPrefs.PREF_KEYS.includes('importSupplierConcentrationAlertEmails'),
    'new pref key not added to PREF_KEYS',
  );
});

test('TS Prefs mirror carries importSupplierConcentrationAlertEmails', () => {
  assert.match(API_TS, /importSupplierConcentrationAlertEmails\?: boolean;/);
});

test('Preferences page surfaces the supplier-concentration toggle in the Ops inbox group', () => {
  assert.match(
    PREFS_TSX,
    /\{ key: 'importSupplierConcentrationAlertEmails', label: 'Supplier-concentration weekly alert'/,
  );
});

// ── composeSupplierConcentrationAlert ──────────────────────────────

test('composeSupplierConcentrationAlert returns null when cohort is NOT concentrated (healthy short-circuit)', () => {
  const out = importsEmails.composeSupplierConcentrationAlert({
    orgName: 'Acme',
    supplierConcentration: buildConcentrationCohort({ isConcentrated: false }),
  });
  assert.equal(out, null);
});

test('composeSupplierConcentrationAlert returns null on a malformed cohort (defensive)', () => {
  // Strict-boolean guard (NOT truthy): sprint-54 lesson applied.
  assert.equal(importsEmails.composeSupplierConcentrationAlert({ supplierConcentration: null }), null);
  assert.equal(
    importsEmails.composeSupplierConcentrationAlert({
      supplierConcentration: { isConcentrated: 'truthy-but-not-bool' },
    }),
    null,
  );
});

test('composeSupplierConcentrationAlert returns null when isConcentrated:true but topCountry/share are null (upstream broken)', () => {
  // Defensive: isConcentrated=true should imply topCountry +
  // topCountryShare are non-null. If they're not, upstream is
  // broken; fail closed.
  assert.equal(
    importsEmails.composeSupplierConcentrationAlert({
      supplierConcentration: buildConcentrationCohort({ topCountry: null }),
    }),
    null,
  );
  assert.equal(
    importsEmails.composeSupplierConcentrationAlert({
      supplierConcentration: buildConcentrationCohort({ topCountryShare: null }),
    }),
    null,
  );
});

test('composeSupplierConcentrationAlert renders { subject, text, html } for a concentrated cohort', () => {
  const out = importsEmails.composeSupplierConcentrationAlert({
    orgName: 'Acme',
    supplierConcentration: buildConcentrationCohort(),
  });
  assert.ok(out && typeof out === 'object');
  assert.equal(typeof out.subject, 'string');
  assert.equal(typeof out.text, 'string');
  assert.equal(typeof out.html, 'string');
  // Subject names the share + country so the inbox preview tells
  // the story without opening.
  assert.match(out.subject, /\[Acme\] Supplier concentration 90% to CN — sourcing risk/);
  // Body opening explicitly states the window + share.
  assert.match(out.text, /Of the 20 supplier picks in the last 30 days, 90% \(18\) went to CN/);
});

test('composeSupplierConcentrationAlert surfaces the triple-gate explanation (threshold + min count)', () => {
  const out = importsEmails.composeSupplierConcentrationAlert({
    supplierConcentration: buildConcentrationCohort(),
  });
  assert.ok(out);
  assert.match(out.text, /crossed 75% of picks AND there were >= 5 picks/);
});

test('composeSupplierConcentrationAlert HTML does NOT double-encode entities (sprint 39 lesson)', () => {
  const out = importsEmails.composeSupplierConcentrationAlert({
    supplierConcentration: buildConcentrationCohort(),
  });
  assert.ok(out);
  assert.ok(!out.html.includes('&amp;times;'), 'double-encoded entity in HTML');
  assert.ok(!out.html.includes('&amp;#'), 'double-encoded numeric entity in HTML');
  assert.ok(!out.html.includes('&amp;ge;'), 'double-encoded &ge; in HTML');
});

// ── sendSupplierConcentrationAlert ────────────────────────────────

test('sendSupplierConcentrationAlert short-circuits with reason="not-concentrated" on healthy cohort', async () => {
  const out = await importsEmails.sendSupplierConcentrationAlert({
    orgIdNumeric: 1,
    supplierConcentration: buildConcentrationCohort({ isConcentrated: false }),
  });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'not-concentrated');
});

test('sendSupplierConcentrationAlert requires orgIdNumeric + supplierConcentration (defensive guards)', async () => {
  const noOrg = await importsEmails.sendSupplierConcentrationAlert({
    supplierConcentration: buildConcentrationCohort(),
  });
  assert.equal(noOrg.ok, false);
  assert.match(noOrg.reason, /orgIdNumeric required/);
  const noCohort = await importsEmails.sendSupplierConcentrationAlert({ orgIdNumeric: 1 });
  assert.equal(noCohort.ok, false);
  assert.match(noCohort.reason, /supplierConcentration required/);
});

test('sendSupplierConcentrationAlert uses the importSupplierConcentrationAlertEmails pref gate', () => {
  const block = EMAILS_SRC.match(/async function sendSupplierConcentrationAlert\([\s\S]*?\n\}/);
  assert.ok(block, 'sendSupplierConcentrationAlert body not located');
  assert.match(
    block[0],
    /filterMutedRecipients\(resolution\.recipients, 'importSupplierConcentrationAlertEmails'\)/,
  );
});

test('sendSupplierConcentrationAlert preserves the fail-soft posture (no-inbox + all-muted branches)', () => {
  const block = EMAILS_SRC.match(/async function sendSupplierConcentrationAlert\([\s\S]*?\n\}/);
  assert.ok(block);
  const body = block[0];
  assert.match(body, /return \{ ok: false, reason: 'no-inbox' \}/);
  assert.match(body, /return \{ ok: false, reason: 'all-muted' \}/);
  assert.match(body, /partial failure/);
  assert.match(body, /return \{ ok: sent > 0, sent, failed \}/);
});

// ── Cron handler integration ─────────────────────────────────────

test('Cron handler exposes runImportRequestSupplierConcentrationAlert + registers it as a job', () => {
  assert.equal(typeof cron.runImportRequestSupplierConcentrationAlert, 'function');
  assert.match(
    CRON_SRC,
    /'import-request-supplier-concentration-alert': runImportRequestSupplierConcentrationAlert/,
  );
});

test('runImportRequestSupplierConcentrationAlert reuses aggregateOpsInsights (cohort #9 source-of-truth)', () => {
  const block = CRON_SRC.match(/async function runImportRequestSupplierConcentrationAlert\([\s\S]*?\n\}/);
  assert.ok(block, 'runImportRequestSupplierConcentrationAlert body not located');
  const body = block[0];
  assert.match(body, /importRequests\.aggregateOpsInsights\(\{/);
  assert.match(body, /const supplierConcentration = agg\.insights && agg\.insights\.supplierConcentration/);
});

test('runImportRequestSupplierConcentrationAlert skips healthy orgs (!isConcentrated) silently', () => {
  const block = CRON_SRC.match(/async function runImportRequestSupplierConcentrationAlert\([\s\S]*?\n\}/);
  assert.ok(block);
  const body = block[0];
  assert.match(body, /if \(!supplierConcentration \|\| !supplierConcentration\.isConcentrated\)/);
  assert.match(body, /healthyByOrg \+= 1;[\s\S]*?continue;/);
});

test('runImportRequestSupplierConcentrationAlert per-org error isolation matches sprint-54 pattern', () => {
  const block = CRON_SRC.match(/async function runImportRequestSupplierConcentrationAlert\([\s\S]*?\n\}/);
  assert.ok(block);
  const body = block[0];
  assert.match(body, /for \(const org of allOrgs\) \{[\s\S]*?try \{/);
  assert.match(body, /errors\.push\(\{[\s\S]*?orgId: String\(org\.id \|\| '\?'\)/);
});

// ── GitHub Actions schedule ──────────────────────────────────────

test('GHA cron.yml registers the Thu 09:00 UTC schedule for the supplier-concentration alert', () => {
  // Thursday lands a day after the Wed quote-acceptance alert so
  // ops absorbs the two slow signals in sequence.
  assert.match(CRON_YAML, /- cron: '0 9 \* \* 4'/);
});

test('GHA cron.yml routes the Thu 09:00 schedule + workflow_dispatch to the right job', () => {
  assert.match(
    CRON_YAML,
    /elif \[ "\$\{\{ github\.event\.schedule \}\}" = "0 9 \* \* 4" \]; then\s+echo "job=import-request-supplier-concentration-alert"/,
  );
  assert.match(CRON_YAML, /- import-request-supplier-concentration-alert/);
});
