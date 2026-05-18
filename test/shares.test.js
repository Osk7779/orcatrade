// Sprint shares-v1 — public read-only saved-plan sharing.
//
// Four layers exercised:
//   1. lib/saved-plans share helpers — createShare / getByShareCode /
//      incrementShareViews / revokeShare.
//   2. /api/plans/<id>/share — owner-only POST/DELETE (BG-3.7 admin
//      gate doesn't apply here; this is user-session-gated).
//   3. /api/share/<code> public endpoint — no auth, rate-limited,
//      emits plan_share_opened, redirects to /start/?p=<base64>.
//   4. /account/plans/ UI markup contract for the share pane.

'use strict';

process.env.ORCATRADE_AUTH_SECRET = 'test-secret-do-not-use-in-prod';
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const auth = require('../lib/auth');
const savedPlans = require('../lib/saved-plans');
const events = require('../lib/events');
const kv = require('../lib/intelligence/kv-store');
const plansHandler = require('../lib/handlers/plans');
const shareHandler = require('../lib/handlers/share');

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(body) { this.body = body || ''; return this; },
  };
}

function reqWithCookie(method, email, extras = {}) {
  const cookie = auth.buildSessionCookie(email);
  return {
    method,
    headers: { cookie: `orcatrade_session=${encodeURIComponent(cookie)}` },
    body: {},
    ...extras,
  };
}

async function seedPlan(email = 'me@example.com', label = 'test') {
  return savedPlans.savePlan({
    email,
    inputs: {
      productCategory: 'apparel',
      originCountry: 'CN',
      destinationCountry: 'PL',
      customsValueEur: 25000,
    },
    label,
    snapshot: { perShipmentLandedTotal: 30000, schemaVersion: 1 },
  });
}

// ── ALLOWED_TYPES surface ─────────────────────────────

test('events.ALLOWED_TYPES includes plan_share_opened + plan_share_revoked', () => {
  assert.ok(events.ALLOWED_TYPES.has('plan_share_opened'));
  assert.ok(events.ALLOWED_TYPES.has('plan_share_revoked'));
});

// ── Share helpers (storage) ───────────────────────────

test('createShare: mints a 10-hex code + writes index + idempotent', async () => {
  kv._resetMemoryStore();
  const plan = await seedPlan();
  const share = await savedPlans.createShare(plan.id, 'me@example.com');
  assert.ok(share);
  assert.match(share.code, /^[a-f0-9]{10}$/);
  assert.equal(share.viewCount, 0);
  // Reverse index resolves the code → planId.
  const indexed = await kv.get(savedPlans.shareCodeKey(share.code));
  assert.equal(indexed, plan.id);
  // Re-calling returns the SAME code (idempotent).
  const share2 = await savedPlans.createShare(plan.id, 'me@example.com');
  assert.equal(share2.code, share.code);
});

test('createShare: ownership-checked — wrong user returns null', async () => {
  kv._resetMemoryStore();
  const plan = await seedPlan('owner@example.com');
  const r = await savedPlans.createShare(plan.id, 'attacker@example.com');
  assert.equal(r, null);
});

test('createShare: returns null for unknown plan', async () => {
  kv._resetMemoryStore();
  const r = await savedPlans.createShare('pl_does_not_exist', 'me@example.com');
  assert.equal(r, null);
});

test('getByShareCode: returns plan record with OWNER EMAIL STRIPPED', async () => {
  kv._resetMemoryStore();
  const plan = await seedPlan('private@example.com');
  const share = await savedPlans.createShare(plan.id, 'private@example.com');
  const record = await savedPlans.getByShareCode(share.code);
  assert.ok(record);
  assert.equal(record.id, plan.id);
  assert.equal(record.email, undefined,
    'owner email must NOT leak through getByShareCode (privacy)');
  // The serialised form also doesn't carry the email.
  assert.equal(JSON.stringify(record).indexOf('private@example.com'), -1);
});

test('getByShareCode: unknown code → null', async () => {
  kv._resetMemoryStore();
  const r = await savedPlans.getByShareCode('deadbeef00');
  assert.equal(r, null);
});

test('getByShareCode: stale index (code present, plan deleted) → null', async () => {
  kv._resetMemoryStore();
  const plan = await seedPlan();
  const share = await savedPlans.createShare(plan.id, 'me@example.com');
  // Hard-delete the plan record without going through deletePlan.
  await kv.del(savedPlans.planKey(plan.id));
  const r = await savedPlans.getByShareCode(share.code);
  assert.equal(r, null, 'orphan index entry must not return a stale record');
});

test('incrementShareViews: increments + writes lastViewedAt', async () => {
  kv._resetMemoryStore();
  const plan = await seedPlan();
  const share = await savedPlans.createShare(plan.id, 'me@example.com');
  const c1 = await savedPlans.incrementShareViews(share.code);
  const c2 = await savedPlans.incrementShareViews(share.code);
  assert.equal(c1, 1);
  assert.equal(c2, 2);
  const refetched = await savedPlans.getByShareCode(share.code);
  assert.equal(refetched.share.viewCount, 2);
  assert.match(refetched.share.lastViewedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('incrementShareViews: unknown code returns 0', async () => {
  kv._resetMemoryStore();
  assert.equal(await savedPlans.incrementShareViews('nope'), 0);
});

test('revokeShare: removes share field + deletes index + returns true', async () => {
  kv._resetMemoryStore();
  const plan = await seedPlan();
  const share = await savedPlans.createShare(plan.id, 'me@example.com');
  const ok = await savedPlans.revokeShare(plan.id, 'me@example.com');
  assert.equal(ok, true);
  // Plan record no longer has .share.
  const rec = await kv.get(savedPlans.planKey(plan.id));
  assert.equal(rec.share, undefined);
  // Reverse index gone.
  const indexed = await kv.get(savedPlans.shareCodeKey(share.code));
  assert.equal(indexed, null);
  // getByShareCode now returns null.
  assert.equal(await savedPlans.getByShareCode(share.code), null);
});

test('revokeShare: idempotent + ownership-checked', async () => {
  kv._resetMemoryStore();
  const plan = await seedPlan('owner@example.com');
  await savedPlans.createShare(plan.id, 'owner@example.com');
  assert.equal(await savedPlans.revokeShare(plan.id, 'attacker@example.com'), false);
  assert.equal(await savedPlans.revokeShare(plan.id, 'owner@example.com'), true);
  // Already revoked.
  assert.equal(await savedPlans.revokeShare(plan.id, 'owner@example.com'), false);
});

// ── /api/plans/<id>/share — owner-gated POST + DELETE ─

test('POST /api/plans/<id>/share: 401 without session', async () => {
  kv._resetMemoryStore();
  const plan = await seedPlan();
  const req = {
    method: 'POST', headers: {},
    query: { path: ['plans', plan.id, 'share'] },
    url: `/api/plans/${plan.id}/share`,
  };
  const res = mockRes();
  await plansHandler(req, res);
  assert.equal(res.statusCode, 401);
});

test('POST /api/plans/<id>/share: 404 on unknown plan', async () => {
  kv._resetMemoryStore();
  const req = reqWithCookie('POST', 'me@example.com', {
    query: { path: ['plans', 'pl_nope', 'share'] },
    url: '/api/plans/pl_nope/share',
  });
  const res = mockRes();
  await plansHandler(req, res);
  assert.equal(res.statusCode, 404);
});

test('POST /api/plans/<id>/share: happy + returns the code', async () => {
  kv._resetMemoryStore();
  const plan = await seedPlan('me@example.com');
  const req = reqWithCookie('POST', 'me@example.com', {
    query: { path: ['plans', plan.id, 'share'] },
    url: `/api/plans/${plan.id}/share`,
  });
  const res = mockRes();
  await plansHandler(req, res);
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.ok, true);
  assert.match(body.share.code, /^[a-f0-9]{10}$/);
  assert.equal(body.share.viewCount, 0);
});

test('POST /api/plans/<id>/share: ownership-enforced (different user → 404)', async () => {
  kv._resetMemoryStore();
  const plan = await seedPlan('owner@example.com');
  const req = reqWithCookie('POST', 'attacker@example.com', {
    query: { path: ['plans', plan.id, 'share'] },
    url: `/api/plans/${plan.id}/share`,
  });
  const res = mockRes();
  await plansHandler(req, res);
  // 404 not 403 — never leak whether the plan exists.
  assert.equal(res.statusCode, 404);
});

test('DELETE /api/plans/<id>/share: revokes + emits plan_share_revoked', async () => {
  kv._resetMemoryStore();
  const plan = await seedPlan('me@example.com');
  await savedPlans.createShare(plan.id, 'me@example.com');
  const req = reqWithCookie('DELETE', 'me@example.com', {
    query: { path: ['plans', plan.id, 'share'] },
    url: `/api/plans/${plan.id}/share`,
  });
  const res = mockRes();
  await plansHandler(req, res);
  assert.equal(res.statusCode, 200);
  const hits = (await events.list({})).filter((e) => e.type === 'plan_share_revoked');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].planId, plan.id);
});

test('DELETE /api/plans/<id>/share: 404 when no share exists', async () => {
  kv._resetMemoryStore();
  const plan = await seedPlan('me@example.com');
  const req = reqWithCookie('DELETE', 'me@example.com', {
    query: { path: ['plans', plan.id, 'share'] },
    url: `/api/plans/${plan.id}/share`,
  });
  const res = mockRes();
  await plansHandler(req, res);
  assert.equal(res.statusCode, 404);
});

// ── /api/share/<code> — public endpoint ───────────────

test('share handler: 405 on non-GET', async () => {
  const req = { method: 'POST', headers: {}, query: { path: ['share', 'abc123def0'] }, url: '/api/share/abc123def0' };
  const res = mockRes();
  await shareHandler(req, res);
  assert.equal(res.statusCode, 405);
});

test('share handler: 400 on malformed code', async () => {
  const req = { method: 'GET', headers: {}, query: { path: ['share', 'NOT_HEX'] }, url: '/api/share/NOT_HEX' };
  const res = mockRes();
  await shareHandler(req, res);
  assert.equal(res.statusCode, 400);
});

test('share handler: 404 on unknown code', async () => {
  kv._resetMemoryStore();
  const req = { method: 'GET', headers: {}, query: { path: ['share', 'deadbeef00'] }, url: '/api/share/deadbeef00' };
  const res = mockRes();
  await shareHandler(req, res);
  assert.equal(res.statusCode, 404);
});

test('share handler: 302 redirect to /start/?p=<base64>&from=share + audit + increment', async () => {
  kv._resetMemoryStore();
  const plan = await seedPlan('owner@example.com');
  const share = await savedPlans.createShare(plan.id, 'owner@example.com');
  const req = {
    method: 'GET', headers: {},
    query: { path: ['share', share.code] },
    url: `/api/share/${share.code}`,
  };
  const res = mockRes();
  await shareHandler(req, res);
  assert.equal(res.statusCode, 302);
  assert.match(res.headers['location'], /^\/start\/\?p=[A-Za-z0-9_-]+&from=share$/);
  // The audit row was emitted with the code + planId but NO email.
  // Wait a microtask so the fire-and-forget increment can complete.
  await new Promise((r) => setImmediate(r));
  const hits = (await events.list({})).filter((e) => e.type === 'plan_share_opened');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].code, share.code);
  assert.equal(hits[0].planId, plan.id);
  assert.equal(hits[0].email, undefined,
    'plan_share_opened must NOT carry the owner email');
  // View count incremented (fire-and-forget).
  const refetched = await savedPlans.getByShareCode(share.code);
  assert.equal(refetched.share.viewCount, 1);
});

test('share handler: encodeShareInputs round-trip matches the wizard codec', () => {
  // The /start/ page decodes ?p= via the same codec. We assert the
  // shape — a base64url string of a JSON object — so the redirect
  // produces a URL the wizard can actually read.
  const encoded = shareHandler.encodeShareInputs({
    productCategory: 'apparel',
    originCountry: 'CN',
    destinationCountry: 'PL',
    customsValueEur: 25000,
  });
  assert.match(encoded, /^[A-Za-z0-9_-]+$/);
  // Decode + verify.
  const padded = encoded.replace(/-/g, '+').replace(/_/g, '/') + '==';
  const json = Buffer.from(padded, 'base64').toString('utf8');
  const parsed = JSON.parse(json);
  assert.equal(parsed.productCategory, 'apparel');
  assert.equal(parsed.originCountry, 'CN');
});

test('share handler: strips falsy fields from encoded inputs', () => {
  const encoded = shareHandler.encodeShareInputs({
    productCategory: 'apparel',
    originCountry: '',          // should be stripped
    destinationCountry: null,   // should be stripped
    customsValueEur: 25000,
  });
  const padded = encoded.replace(/-/g, '+').replace(/_/g, '/') + '==';
  const parsed = JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
  assert.equal(parsed.originCountry, undefined);
  assert.equal(parsed.destinationCountry, undefined);
  assert.equal(parsed.productCategory, 'apparel');
});

// ── Routing surface ───────────────────────────────────

test('api/[...path].js dispatcher registers the share handler', () => {
  const dispatcher = fs.readFileSync(path.join(__dirname, '..', 'api/[...path].js'), 'utf8');
  assert.match(dispatcher, /share: require\('\.\.\/lib\/handlers\/share'\)/);
});

test('vercel.json rewrites /share/:code to /api/share/:code', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8'));
  const found = (cfg.rewrites || []).some((r) => r.source === '/share/:code' && r.destination === '/api/share/:code');
  assert.ok(found, 'vercel.json must rewrite /share/:code to /api/share/:code');
});

// ── /account/plans/ UI contract ───────────────────────

test('/account/plans/index.html declares the share-pane styles', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'account', 'plans', 'index.html'), 'utf8');
  assert.match(html, /\.share-pane\b/);
  assert.match(html, /\.share-toggle\b/);
  assert.match(html, /input\.share-url/);
});

test('/account/plans/app.js wires the share endpoints + Copy/Revoke', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'account', 'plans', 'app.js'), 'utf8');
  // POST and DELETE against /api/plans/<id>/share.
  assert.match(js, /\/api\/plans\/['"]?\s*\+\s*encodeURIComponent\([^)]+\)\s*\+\s*['"`]\/share/);
  // Three actions handled.
  assert.match(js, /share-create/);
  assert.match(js, /share-copy/);
  assert.match(js, /share-revoke/);
  // Copy uses navigator.clipboard with a select() fallback.
  assert.match(js, /navigator\.clipboard/);
  assert.match(js, /input\.select\(\)/);
  // Revoke confirms first.
  assert.match(js, /confirm\(['"`]Revoke this share/);
});
