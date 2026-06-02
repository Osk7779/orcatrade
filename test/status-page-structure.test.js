// /status/ page structure contract — Wave 4 upgrade.
//
// Pins the three new panels: session uptime bar, incidents list (with
// honest "no incidents" current state), audit-chain anchor display.
// Plus the existing /api/health polling behaviour.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const STATUS_PATH = path.join(__dirname, '..', 'status', 'legacy', 'index.html');
function read() { return fs.readFileSync(STATUS_PATH, 'utf8'); }

test('/status/ has the session-uptime panel', () => {
  const body = read();
  assert.match(body, /id="uptimeSection"/, 'uptime section element present');
  assert.match(body, /id="uptimeBar"/, 'uptime bar element present');
  assert.match(body, /id="uptimeStat"/, 'uptime stat element present');
});

test('/status/ is HONEST about per-visitor uptime scope', () => {
  // The uptime bar is browser-local. Procurement reviewers must not
  // mistake it for a cross-visitor uptime guarantee. The blurb must
  // explain that AND point to the audit-chain history as the cross-
  // visitor signal.
  const body = read();
  assert.match(body, /per-visitor view|this browser/i,
    'must clarify the uptime bar is per-visitor');
  assert.match(body, /\/trust\/anchors\//,
    'must link to /trust/anchors/ as the cross-visitor evidence');
});

test('/status/ has the incidents panel with an honest no-incidents default', () => {
  const body = read();
  assert.match(body, /id="incidentsList"/, 'incidents list element present');
  // The empty-list state must be EXPLICIT — not just an empty div.
  // A procurement reviewer should see a positive statement that
  // confirms "we publish; there\'s nothing to publish right now".
  assert.match(body, /No incidents recorded/i, 'positive empty-state statement');
  assert.match(body, /incident-response\.md/i, 'links to incident-response SLA');
});

test('/status/ has the audit-anchor panel', () => {
  const body = read();
  assert.match(body, /id="anchorDisplay"/, 'anchor display element present');
  assert.match(body, /\/api\/audit-anchor/, 'reads from the audit-anchor endpoint');
});

test('/status/ persists uptime samples to sessionStorage (not localStorage)', () => {
  // sessionStorage scoped to tab — clears on tab close. localStorage
  // would persist forever, which would be misleading ("days of uptime
  // history!") when really the samples are per-tab. Pin the choice.
  const body = read();
  assert.match(body, /sessionStorage/, 'uses sessionStorage');
  assert.doesNotMatch(body, /localStorage\.setItem.*UPTIME/i,
    'must not persist to localStorage (would mislead about scope)');
});

test('/status/ keeps the /api/health polling cadence at 30 seconds', () => {
  // The existing 30s cadence is documented in the page copy AND
  // matches the cron uptime probe interval. Don\'t silently drift.
  const body = read();
  assert.match(body, /setInterval\(refresh,\s*30_000\)/);
});

test('/status/ still renders subsystem cards from /api/health', () => {
  // Defensive — the existing functionality must survive the upgrade.
  const body = read();
  assert.match(body, /SUBSYSTEM_LABELS\s*=/);
  assert.match(body, /renderSubsystem/);
  assert.match(body, /Subsystem badges showing "circuit open"/);
});

test('/status/ refreshes the anchor on a slower cadence (5 minutes)', () => {
  // The anchor only changes when events fire; polling at the same
  // 30s as /api/health would be wasteful. 5 min is the documented
  // balance.
  const body = read();
  assert.match(body, /setInterval\(refreshAnchor,\s*5\s*\*\s*60_000\)/);
});

test('/status/ uptime bar is bounded (no unbounded sample growth)', () => {
  // sessionStorage has a quota; an unbounded array would silently
  // fail to persist. The implementation should cap the sample buffer.
  const body = read();
  assert.match(body, /UPTIME_MAX_SAMPLES/, 'cap constant defined');
  assert.match(body, /samples\.shift\(\)/, 'samples shifted off the front');
});
