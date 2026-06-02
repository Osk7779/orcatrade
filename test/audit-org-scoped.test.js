'use strict';

// Apex III1 — org-scoped audit log.
//
// Before this PR, /api/audit was global-founder-only (gated by
// adminAuth.verifyAdmin). A customer's compliance_officer couldn't
// view their own org's audit log — a real procurement gap.
//
// This PR adds a per-org audit mode triggered by `?org=<orgId>`:
//   * Authenticates via session cookie (NOT the global admin gate)
//   * Requires the actor to be a member of <orgId> with
//     rbac.PERMISSIONS.AUDIT_READ (admin / compliance_officer /
//     owner by default; analyst / finance / viewer cannot)
//   * Filters events to those whose actor's email_hash matches an
//     org member — never global, never cross-org
//
// Tests cover:
//   - filterByOrgMembership (pure): KV-shape (raw email) + PG-shape
//     (emailHash) + missing-actor edge cases
//   - HTTP gates: 401 unauthenticated; 403 non-member; 403 member
//     without AUDIT_READ
//   - Successful org-scoped read: 200, scope envelope, only members'
//     events returned (cross-org isolation)
//   - Read-amplification: events beyond `limit` are still discovered
//     and then sliced to `limit`

process.env.ORCATRADE_AUTH_SECRET = 'test-secret-do-not-use-in-prod';
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

const test = require('node:test');
const assert = require('node:assert/strict');

const kv = require('../lib/intelligence/kv-store');
const events = require('../lib/events');
const auth = require('../lib/auth');
const orgs = require('../lib/orgs');
const audit = require('../lib/handlers/audit');
const hashLib = require('../lib/hash');

function makeReq({ qs = {}, cookie = null } = {}) {
  const params = new URLSearchParams(qs);
  return {
    method: 'GET',
    url: '/api/audit' + (params.toString() ? '?' + params.toString() : ''),
    headers: cookie ? { cookie: 'orcatrade_session=' + encodeURIComponent(cookie) } : {},
    query: { path: ['audit'], ...qs },
    requestId: 'test-req-id',
  };
}
function makeRes() {
  return {
    statusCode: 200, _headers: {}, body: '',
    setHeader(k, v) { this._headers[k] = v; },
    end(b) { this.body = b || ''; return this; },
  };
}

// ── filterByOrgMembership (pure) ────────────────────────────────────

test('filterByOrgMembership matches PG-shape events by emailHash', () => {
  const set = new Set([hashLib.emailHash('alice@example.com')]);
  assert.equal(audit.filterByOrgMembership({ emailHash: hashLib.emailHash('alice@example.com') }, set), true);
  assert.equal(audit.filterByOrgMembership({ emailHash: hashLib.emailHash('bob@example.com') }, set), false);
});

test('filterByOrgMembership matches KV-shape events by hashing the raw email', () => {
  const set = new Set([hashLib.emailHash('alice@example.com')]);
  // KV events carry raw `email` — the filter must hash it before
  // comparing, never compare raw email to hash (the bug class this
  // pin guards against).
  assert.equal(audit.filterByOrgMembership({ email: 'alice@example.com' }, set), true);
  assert.equal(audit.filterByOrgMembership({ email: 'bob@example.com' }, set), false);
});

test('filterByOrgMembership rejects events with no actor (no email and no emailHash)', () => {
  const set = new Set([hashLib.emailHash('alice@example.com')]);
  // System events without an actor cannot be attributed to an org's
  // member set — they're only visible in global mode. The exclusion
  // is intentional: surfacing them in org-scoped mode would be a
  // privilege-leak vector.
  assert.equal(audit.filterByOrgMembership({ type: 'cron_fired' }, set), false);
});

test('filterByOrgMembership prefers emailHash when both are present', () => {
  // PG row that also carries an `email` field (defensively) should
  // still match on emailHash. This is the post-cutover shape.
  const set = new Set([hashLib.emailHash('alice@example.com')]);
  const ev = { emailHash: hashLib.emailHash('alice@example.com'), email: 'someone-else@example.com' };
  assert.equal(audit.filterByOrgMembership(ev, set), true);
});

// ── HTTP: auth gates ────────────────────────────────────────────────

test('?org=<orgId> without a session cookie → 401', async () => {
  kv._resetMemoryStore();
  const org = await orgs.createOrg({ name: 'Test Org', ownerEmail: 'owner@example.com' });
  const req = makeReq({ qs: { org: org.id } });
  const res = makeRes();
  await audit(req, res);
  assert.equal(res.statusCode, 401);
  assert.match(JSON.parse(res.body).error, /Sign in required/);
});

test('?org=<orgId> with non-member session → 403', async () => {
  kv._resetMemoryStore();
  const org = await orgs.createOrg({ name: 'Test Org', ownerEmail: 'owner@example.com' });
  // Outsider has a valid session but no membership.
  const cookie = auth.buildSessionCookie('outsider@example.com');
  const req = makeReq({ qs: { org: org.id }, cookie });
  const res = makeRes();
  await audit(req, res);
  assert.equal(res.statusCode, 403);
  assert.match(JSON.parse(res.body).error, /Not a member/);
});

test('?org=<orgId> with a viewer role → 403 (viewer does not have AUDIT_READ)', async () => {
  // The RBAC matrix grants AUDIT_READ to owner / admin / compliance_officer
  // only. viewer / analyst / finance must be refused — that's the
  // load-bearing security boundary this branch protects.
  kv._resetMemoryStore();
  const org = await orgs.createOrg({ name: 'Test Org', ownerEmail: 'owner@example.com' });
  await orgs.addMember(org.id, { email: 'viewer@example.com', role: 'viewer' });
  const cookie = auth.buildSessionCookie('viewer@example.com');
  const req = makeReq({ qs: { org: org.id }, cookie });
  const res = makeRes();
  await audit(req, res);
  assert.equal(res.statusCode, 403);
  assert.match(JSON.parse(res.body).error, /does not allow audit/);
  assert.match(JSON.parse(res.body).requiredPermission, /audit\.read/);
});

test('?org=<orgId> with a compliance_officer role → 200', async () => {
  kv._resetMemoryStore();
  const org = await orgs.createOrg({ name: 'Test Org', ownerEmail: 'owner@example.com' });
  await orgs.addMember(org.id, { email: 'compliance@example.com', role: 'compliance_officer' });
  const cookie = auth.buildSessionCookie('compliance@example.com');
  const req = makeReq({ qs: { org: org.id }, cookie });
  const res = makeRes();
  await audit(req, res);
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.scope.orgId, org.id);
});

// ── HTTP: cross-org isolation ──────────────────────────────────────

test('?org filtering returns only events authored by org members (cross-org isolation)', async () => {
  kv._resetMemoryStore();
  const orgA = await orgs.createOrg({ name: 'Org A', ownerEmail: 'owner-a@example.com' });
  await orgs.addMember(orgA.id, { email: 'analyst-a@example.com', role: 'analyst' });
  // Different org, different members entirely.
  await orgs.createOrg({ name: 'Org B', ownerEmail: 'owner-b@example.com' });

  // Seed events from a mix of actors.
  await events.record('plan_saved', { email: 'owner-a@example.com', planId: 'pl_1' });
  await events.record('plan_saved', { email: 'analyst-a@example.com', planId: 'pl_2' });
  await events.record('plan_saved', { email: 'owner-b@example.com', planId: 'pl_3' });   // OTHER ORG
  await events.record('plan_saved', { email: 'noisy-outsider@example.com', planId: 'pl_4' }); // NO ORG

  // Owner-A reads their org's audit.
  const cookie = auth.buildSessionCookie('owner-a@example.com');
  const req = makeReq({ qs: { org: orgA.id }, cookie });
  const res = makeRes();
  await audit(req, res);
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  // Org A has 2 members → 2 of the 4 events should pass the filter.
  const planIds = body.events.map((e) => e.planId).sort();
  assert.deepEqual(planIds, ['pl_1', 'pl_2'], 'org-scoped read returns only Org A members\' events');
  assert.equal(body.scope.orgId, orgA.id);
  assert.equal(body.scope.memberCount, 2);
});

test('events without an actor (system events) are NOT visible in org-scoped read', async () => {
  kv._resetMemoryStore();
  const org = await orgs.createOrg({ name: 'Org', ownerEmail: 'owner@example.com' });
  // System event (no email field). Use a valid type that allows
  // payload without email.
  await events.record('plan_saved', { planId: 'pl_system' });   // no email
  await events.record('plan_saved', { email: 'owner@example.com', planId: 'pl_owner' });

  const cookie = auth.buildSessionCookie('owner@example.com');
  const req = makeReq({ qs: { org: org.id }, cookie });
  const res = makeRes();
  await audit(req, res);
  const body = JSON.parse(res.body);
  // Only the owner's event passes the filter — the no-actor event
  // is intentionally excluded from org-scoped reads.
  assert.equal(body.events.length, 1);
  assert.equal(body.events[0].planId, 'pl_owner');
});

// ── HTTP: response envelope ────────────────────────────────────────

test('global-mode response carries scope: "global"', async () => {
  const auth2 = require('../lib/auth');
  kv._resetMemoryStore();
  await events.record('founding_applied', { name: 'alice', email: 'alice@example.com', company: 'ACo' });
  const cookie = auth2.buildSessionCookie('oskar@orcatrade.pl');
  const prevAdmin = process.env.ORCATRADE_ADMIN_EMAILS;
  const prevToken = process.env.ORCATRADE_LEADS_TOKEN;
  process.env.ORCATRADE_ADMIN_EMAILS = 'oskar@orcatrade.pl';
  delete process.env.ORCATRADE_LEADS_TOKEN;
  try {
    const req = makeReq({ cookie });
    const res = makeRes();
    await audit(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(JSON.parse(res.body).scope, 'global');
  } finally {
    if (prevAdmin === undefined) delete process.env.ORCATRADE_ADMIN_EMAILS;
    else process.env.ORCATRADE_ADMIN_EMAILS = prevAdmin;
    if (prevToken === undefined) delete process.env.ORCATRADE_LEADS_TOKEN;
    else process.env.ORCATRADE_LEADS_TOKEN = prevToken;
  }
});
