'use strict';

// Sprint 47 — webhook subscription management + test delivery.
//
// URL shape:
//   GET    /api/webhooks               → list (secrets stripped)
//   POST   /api/webhooks               → create; secret returned ONCE
//   DELETE /api/webhooks/<id>          → delete
//   POST   /api/webhooks/<id>/test     → fire a signed test payload
//                                        to the subscription's URL
//   GET    /api/webhooks/event-types   → enumerate the curated
//                                        WEBHOOK_EVENT_TYPES list
//
// Admin-only — same gate as sprint-42 operator-config + sprint-44
// api-keys. Subscriptions are an org-wide outbound surface; only
// owner/admin can change them.

const crypto = require('crypto');
const auth = require('../auth');
const orgs = require('../orgs');
const rbac = require('../rbac');
const events = require('../events');
const log = require('../log');
const webhooks = require('../webhooks');

const OPS_REVIEW_ROLES = new Set(['admin', 'owner']);
const ORG_ID_HEADER = 'x-orcatrade-org';

function jsonResponse(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  return res.end(JSON.stringify(body));
}

function emailHash(email) {
  return crypto.createHash('sha256').update(String(email).toLowerCase().trim()).digest('hex').slice(0, 16);
}

function pathSegments(req) {
  if (req.query && req.query.path) {
    const arr = Array.isArray(req.query.path) ? req.query.path : String(req.query.path).split('/');
    return arr.map((s) => s.trim()).filter(Boolean);
  }
  const url = (req.url || '').split('?')[0];
  return url.replace(/^\/api\//, '').split('/').filter(Boolean);
}

async function numericOrgIdFor(org) {
  if (typeof org.dbId === 'number') return org.dbId;
  const dbClient = require('../db/client');
  if (!dbClient.isConfigured()) return null;
  const row = await dbClient.queryOne(
    `SELECT id FROM organisations WHERE external_id = $1`,
    [org.id],
  );
  return row ? Number(row.id) : null;
}

async function resolveOrg(req, user) {
  const explicit = String(req.headers[ORG_ID_HEADER] || '').trim();
  const userOrgs = await orgs.listOrgsForEmail(user.email);
  if (!Array.isArray(userOrgs) || userOrgs.length === 0) {
    return { ok: false, status: 403, error: 'No organisation found for this user' };
  }
  if (explicit) {
    const match = userOrgs.find((o) => String(o.id) === explicit);
    if (!match) return { ok: false, status: 403, error: `Not a member of org "${explicit}"` };
    return { ok: true, org: match };
  }
  return { ok: true, org: userOrgs[0] };
}

async function ensureAuthedAdmin(req, res) {
  const user = await auth.getCurrentUser(req);
  if (!user) {
    jsonResponse(res, 401, { error: 'Sign in required' });
    return null;
  }
  const resolved = await resolveOrg(req, user);
  if (!resolved.ok) {
    jsonResponse(res, resolved.status, { error: resolved.error });
    return null;
  }
  const orgIdNumeric = await numericOrgIdFor(resolved.org);
  if (!Number.isInteger(orgIdNumeric)) {
    jsonResponse(res, 503, { error: 'Organisation not yet mirrored to Postgres — please retry' });
    return null;
  }
  const role = await orgs.getMemberRole(resolved.org.id, user.email).catch(() => null);
  const canonical = String(rbac.canonicalRole(role || ''));
  if (!OPS_REVIEW_ROLES.has(canonical)) {
    jsonResponse(res, 403, {
      error: 'Forbidden: only owner / admin members can manage webhooks',
      role: canonical || null,
    });
    return null;
  }
  return {
    user,
    emailHash: emailHash(user.email),
    orgIdNumeric,
    orgExternalId: resolved.org.id,
  };
}

async function handleList(_req, res, ctx) {
  const subs = await webhooks.listWebhooksForOrg(ctx.orgIdNumeric);
  return jsonResponse(res, 200, { ok: true, webhooks: subs });
}

async function handleEventTypes(_req, res) {
  return jsonResponse(res, 200, {
    ok: true,
    eventTypes: webhooks.WEBHOOK_EVENT_TYPES,
  });
}

async function handleCreate(req, res, ctx) {
  const body = (req.body && typeof req.body === 'object') ? req.body : {};
  const result = await webhooks.createWebhook({
    orgIdNumeric: ctx.orgIdNumeric,
    label: typeof body.label === 'string' ? body.label : '',
    url: typeof body.url === 'string' ? body.url : '',
    eventTypes: Array.isArray(body.eventTypes) ? body.eventTypes : [],
    actorEmailHash: ctx.emailHash,
  });
  if (!result.ok) {
    const msg = result.errors[0] || 'create failed';
    const status = /required|must|at most|allowed|unsupported|valid URL/.test(msg) ? 400 : 500;
    return jsonResponse(res, status, { error: msg });
  }
  // Audit-log BEFORE returning 201 (ADR-0005). Detail intentionally
  // omits the secret — never in the chain.
  try {
    await events.record('webhook_subscription_created', {
      orgId: ctx.orgIdNumeric,
      entityType: 'webhook_subscription',
      entityId: result.subscription.id,
      actorEmailHash: ctx.emailHash,
      detail: {
        label: result.subscription.label,
        url: result.subscription.url,
        eventTypes: result.subscription.eventTypes,
      },
    });
  } catch (err) {
    log.warn('webhooks audit write failed (create)', {
      orgIdNumeric: ctx.orgIdNumeric,
      err: err instanceof Error ? err.message : String(err),
    });
    return jsonResponse(res, 500, { error: 'Could not record audit event for webhook create' });
  }
  // Response carries the FULL subscription (incl. secret) — this is
  // the only place the secret is ever returned. The list endpoint
  // strips it.
  return jsonResponse(res, 201, { ok: true, subscription: result.subscription });
}

async function handleDelete(req, res, ctx, id) {
  const result = await webhooks.deleteWebhook({
    orgIdNumeric: ctx.orgIdNumeric,
    id,
    actorEmailHash: ctx.emailHash,
  });
  if (!result.ok) {
    if (result.notFound) return jsonResponse(res, 404, { error: 'Not found' });
    return jsonResponse(res, 500, { error: result.errors[0] || 'delete failed' });
  }
  try {
    await events.record('webhook_subscription_deleted', {
      orgId: ctx.orgIdNumeric,
      entityType: 'webhook_subscription',
      entityId: id,
      actorEmailHash: ctx.emailHash,
      detail: { label: result.deletedLabel },
    });
  } catch (err) {
    log.warn('webhooks audit write failed (delete)', {
      orgIdNumeric: ctx.orgIdNumeric,
      id,
      err: err instanceof Error ? err.message : String(err),
    });
    return jsonResponse(res, 500, { error: 'Could not record audit event for webhook delete' });
  }
  return jsonResponse(res, 200, { ok: true });
}

async function handleReactivate(_req, res, ctx, id) {
  // Sprint 51 — reactivate an auto-disabled subscription.
  // Admin-only; cross-org isolated via reactivateWebhook's
  // orgIdNumeric check (returns notFound on mismatch).
  const result = await webhooks.reactivateWebhook({
    orgIdNumeric: ctx.orgIdNumeric,
    id,
    actorEmailHash: ctx.emailHash,
  });
  if (!result.ok) {
    if (result.notFound) return jsonResponse(res, 404, { error: 'Not found' });
    return jsonResponse(res, 500, { error: result.errors[0] || 'reactivate failed' });
  }
  if (!result.noOp) {
    // ADR-0005 — audit BEFORE returning success. Skip on no-op
    // (sub was already active); the absence of an event is the
    // correct chain state for that case.
    try {
      await events.record('webhook_subscription_reactivated', {
        orgId: ctx.orgIdNumeric,
        entityType: 'webhook_subscription',
        entityId: id,
        actorEmailHash: ctx.emailHash,
        detail: {
          label: result.subscription.label,
        },
      });
    } catch (err) {
      log.warn('webhooks audit write failed (reactivate)', {
        orgIdNumeric: ctx.orgIdNumeric, id,
        err: err instanceof Error ? err.message : String(err),
      });
      return jsonResponse(res, 500, { error: 'Could not record audit event for webhook reactivate' });
    }
  }
  // Strip the secret on the response — same posture as list.
  const { secret: _omit, ...safe } = result.subscription;
  return jsonResponse(res, 200, { ok: true, subscription: safe, noOp: !!result.noOp });
}

async function handleRotateSecret(_req, res, ctx, id) {
  // Sprint 59 — rotate the signing secret. Admin-only via the
  // outer handler gate; cross-org isolated via rotateSecret's
  // orgIdNumeric check (returns notFound on mismatch).
  const result = await webhooks.rotateSecret({
    orgIdNumeric: ctx.orgIdNumeric,
    id,
    actorEmailHash: ctx.emailHash,
  });
  if (!result.ok) {
    if (result.notFound) return jsonResponse(res, 404, { error: 'Not found' });
    return jsonResponse(res, 500, { error: result.errors[0] || 'rotate failed' });
  }
  // ADR-0005 — audit BEFORE returning success. Audit detail
  // records the rotator + label (NEVER the raw secret — same
  // posture as sprint 47 create + sprint 51 reactivate).
  try {
    await events.record('webhook_subscription_secret_rotated', {
      orgId: ctx.orgIdNumeric,
      entityType: 'webhook_subscription',
      entityId: id,
      actorEmailHash: ctx.emailHash,
      detail: {
        label: result.subscription.label,
      },
    });
  } catch (err) {
    log.warn('webhooks audit write failed (rotate)', {
      orgIdNumeric: ctx.orgIdNumeric, id,
      err: err instanceof Error ? err.message : String(err),
    });
    return jsonResponse(res, 500, { error: 'Could not record audit event for webhook secret rotate' });
  }
  // Strip the secret from the subscription projection BEFORE
  // adding it back as the top-level reveal-once field. Without
  // this strip, the secret would appear in BOTH places (the
  // subscription.secret AND the top-level secret), which would
  // surprise an auditor reading the response shape.
  const { secret: _omit, ...safeSub } = result.subscription;
  return jsonResponse(res, 200, {
    ok: true,
    subscription: safeSub,
    // Reveal-once raw secret. The UI must surface this in a
    // copy-and-warn banner; after the response leaves the
    // server it's never readable again.
    secret: result.secret,
  });
}

async function handleDeliveries(req, res, ctx, id) {
  // Cross-org isolation via the same fetch-first pattern as
  // handleTest + handleDelete. A leaked id from one org cannot
  // expose another org's delivery history.
  const kvm = require('../intelligence/kv-store');
  let sub = null;
  try {
    sub = await kvm.get(webhooks.SUB_PREFIX + id);
  } catch (_) {
    return jsonResponse(res, 500, { error: 'kv read failed' });
  }
  if (!sub || typeof sub !== 'object' || sub.orgIdNumeric !== ctx.orgIdNumeric) {
    return jsonResponse(res, 404, { error: 'Not found' });
  }
  // Limit parses ?limit=N; defaults to 25, clamped to the
  // helper's DELIVERY_INDEX_CAP (100).
  const url = new URL(req.url || '/', 'https://orcatrade.local');
  const limit = Number(url.searchParams.get('limit')) || 25;
  const dispatch = require('../webhooks-dispatch');
  const deliveries = await dispatch.listDeliveriesForSubscription({
    subscriptionId: id,
    limit,
  });
  return jsonResponse(res, 200, { ok: true, deliveries });
}

async function handleTest(_req, res, ctx, id) {
  // Cross-org isolation via the same lookup pattern as deleteWebhook
  // — fetch first, check ownership.
  const kv = require('../intelligence/kv-store');
  let sub = null;
  try {
    sub = await kv.get(webhooks.SUB_PREFIX + id);
  } catch (_) {
    return jsonResponse(res, 500, { error: 'kv read failed' });
  }
  if (!sub || typeof sub !== 'object' || sub.orgIdNumeric !== ctx.orgIdNumeric) {
    return jsonResponse(res, 404, { error: 'Not found' });
  }
  const result = await webhooks.deliverTestPayload({ subscription: sub });
  // Audit-log the test delivery (the response status surfaces in
  // detail). No 500 on audit failure here — test deliveries aren't
  // mutations of substantive state.
  try {
    await events.record('webhook_subscription_tested', {
      orgId: ctx.orgIdNumeric,
      entityType: 'webhook_subscription',
      entityId: id,
      actorEmailHash: ctx.emailHash,
      detail: {
        ok: result.ok,
        status: result.status,
        durationMs: result.durationMs,
        error: result.error || null,
        timedOut: !!result.timedOut,
      },
    });
  } catch (err) {
    log.warn('webhooks audit write failed (test)', {
      orgIdNumeric: ctx.orgIdNumeric, id,
      err: err instanceof Error ? err.message : String(err),
    });
  }
  return jsonResponse(res, 200, { ok: true, delivery: result });
}

module.exports = async function (req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', `Content-Type, ${ORG_ID_HEADER}`);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }
  const segments = pathSegments(req); // ['webhooks'] | ['webhooks', '<id>'] | ['webhooks', '<id>', 'test'] | ['webhooks', 'event-types']
  const first = segments[1] || '';
  const second = segments[2] || '';

  // event-types is a public read-only enumeration so the UI can build
  // the create-form checkboxes WITHOUT a session round-trip just to
  // discover what's available. Still admin-only via the gate below
  // — but a user can already see the list in the JS bundle anyway.
  if (first === 'event-types' && !second) {
    const ctx = await ensureAuthedAdmin(req, res);
    if (!ctx) return;
    if (req.method !== 'GET') return jsonResponse(res, 405, { error: 'event-types is GET-only' });
    return handleEventTypes(req, res);
  }

  const ctx = await ensureAuthedAdmin(req, res);
  if (!ctx) return;

  try {
    if (!first) {
      if (req.method === 'GET') return handleList(req, res, ctx);
      if (req.method === 'POST') return handleCreate(req, res, ctx);
      return jsonResponse(res, 405, { error: 'Method not allowed on /api/webhooks' });
    }
    if (first && !second) {
      if (req.method === 'DELETE') return handleDelete(req, res, ctx, first);
      return jsonResponse(res, 405, { error: 'Method not allowed on /api/webhooks/<id>' });
    }
    if (second === 'test') {
      if (req.method !== 'POST') return jsonResponse(res, 405, { error: 'test requires POST' });
      return handleTest(req, res, ctx, first);
    }
    if (second === 'deliveries') {
      // Sprint 49 — per-subscription recent-delivery history.
      // Reads back the per-sub index + log entries written by
      // dispatch.recordDeliveryLog. 7-day retention via TTL.
      if (req.method !== 'GET') return jsonResponse(res, 405, { error: 'deliveries requires GET' });
      return handleDeliveries(req, res, ctx, first);
    }
    if (second === 'reactivate') {
      // Sprint 51 — re-enable an auto-disabled subscription. Resets
      // the consecutiveAbandonments counter + clears
      // autoDisabledAt/Reason + flips active back to true.
      if (req.method !== 'POST') return jsonResponse(res, 405, { error: 'reactivate requires POST' });
      return handleReactivate(req, res, ctx, first);
    }
    if (second === 'rotate') {
      // Sprint 59 — rotate the signing secret. New secret returned
      // ONCE; from that moment all deliveries are signed with the
      // new value. The customer's receiver verification code must
      // update to match.
      if (req.method !== 'POST') return jsonResponse(res, 405, { error: 'rotate requires POST' });
      return handleRotateSecret(req, res, ctx, first);
    }
    return jsonResponse(res, 404, { error: `Unknown action: ${second}` });
  } catch (err) {
    log.error('webhooks handler threw', {
      method: req.method,
      err: err instanceof Error ? err.message : String(err),
    });
    return jsonResponse(res, 500, { error: 'Internal error' });
  }
};
