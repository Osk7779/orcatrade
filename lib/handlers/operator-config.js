'use strict';

// Sprint 42 — per-org operator config (v1: stallThresholdDays).
//
// GET  /api/operator-config — returns the effective config (defaults
//                              + org overrides + 'default' meta so the
//                              UI can render "Platform default" vs
//                              "Customised").
// PATCH /api/operator-config — writes a validated partial. Strict
//                              validation: integer + range; merge-in
//                              semantics so a single-knob PATCH
//                              doesn't clobber other knobs the org
//                              has set.
//
// Both routes are ops-only — the knob shapes platform behaviour
// (cron alerts + dashboard cohort), so only admins/owners can read or
// write. requireOpsRole mirrors the sprint-17 insights endpoint.
//
// Audit-log discipline: every PATCH writes an operator_config_updated
// event before returning 200 so an org-wide policy change is
// recoverable from the audit trail. ADR-0005 enforced via
// events.record.

const crypto = require('crypto');
const auth = require('../auth');
const orgs = require('../orgs');
const rbac = require('../rbac');
const events = require('../events');
const log = require('../log');
const operatorConfig = require('../operator-config');

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

async function resolveOrgId(req, user) {
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

async function ensureAuthedOrgWithRole(req, res) {
  const user = await auth.getCurrentUser(req);
  if (!user) {
    jsonResponse(res, 401, { error: 'Sign in required' });
    return null;
  }
  const resolved = await resolveOrgId(req, user);
  if (!resolved.ok) {
    jsonResponse(res, resolved.status, { error: resolved.error });
    return null;
  }
  const orgIdNumeric = await numericOrgIdFor(resolved.org);
  if (!Number.isInteger(orgIdNumeric)) {
    jsonResponse(res, 503, { error: 'Organisation not yet mirrored to Postgres — please retry' });
    return null;
  }
  // RBAC — operator config gates on admin/owner (same surface as
  // ops insights + bulk review).
  const role = await orgs.getMemberRole(resolved.org.id, user.email).catch(() => null);
  const canonical = String(rbac.canonicalRole(role || ''));
  if (!OPS_REVIEW_ROLES.has(canonical)) {
    jsonResponse(res, 403, {
      error: 'Forbidden: only owner / admin members can read or change operator config',
      role: canonical || null,
    });
    return null;
  }
  return {
    user,
    emailHash: emailHash(user.email),
    orgIdNumeric,
    orgExternalId: resolved.org.id,
    role: canonical,
  };
}

// Project a stored partial config to a UI-friendly "effective config
// + per-knob source" shape. The source tells the UI whether the org
// has customised a knob ("custom") or is using the platform default
// ("default") — so the form can render the default value as the
// placeholder + show a "Reset" affordance only when needed.
function projectConfig(stored) {
  const defaults = operatorConfig.DEFAULT_OPERATOR_CONFIG;
  const effective = { ...defaults, ...(stored || {}) };
  /** @type {Record<string, 'default' | 'custom'>} */
  const source = {};
  for (const key of Object.keys(defaults)) {
    source[key] = stored && Object.prototype.hasOwnProperty.call(stored, key) ? 'custom' : 'default';
  }
  return { effective, source, defaults };
}

async function handleGet(req, res, ctx) {
  // Read the raw stored partial via the helper (which merges
  // defaults), but ALSO read directly so we can compute which knobs
  // are customised vs default. The helper does the merge; we need
  // the un-merged "what did the org set" view for the source map.
  let storedRaw = {};
  try {
    const kv = require('../intelligence/kv-store');
    const raw = await kv.get(operatorConfig.KEY_PREFIX + String(ctx.orgIdNumeric));
    if (raw && typeof raw === 'object') storedRaw = raw;
  } catch (_) {
    storedRaw = {};
  }
  const projection = projectConfig(storedRaw);
  return jsonResponse(res, 200, {
    ok: true,
    config: projection.effective,
    source: projection.source,
    defaults: projection.defaults,
  });
}

async function handlePatch(req, res, ctx) {
  const body = (req.body && typeof req.body === 'object') ? req.body : {};
  const result = await operatorConfig.setOperatorConfig(ctx.orgIdNumeric, body);
  if (!result.ok) {
    return jsonResponse(res, 400, { error: result.errors[0], errors: result.errors });
  }
  // Re-read the raw stored partial for the source map after the
  // write. Same dual-read pattern as handleGet.
  let storedRaw = {};
  try {
    const kv = require('../intelligence/kv-store');
    const raw = await kv.get(operatorConfig.KEY_PREFIX + String(ctx.orgIdNumeric));
    if (raw && typeof raw === 'object') storedRaw = raw;
  } catch (_) {
    storedRaw = {};
  }
  // Audit-log the change (ADR-0005 — write before returning success).
  // before/after lets a future revert path reconstruct prior state
  // without re-querying KV.
  try {
    await events.record('operator_config_updated', {
      orgId: ctx.orgIdNumeric,
      entityType: 'operator_config',
      entityId: String(ctx.orgExternalId || ctx.orgIdNumeric),
      actorEmailHash: ctx.emailHash,
      detail: { patched: body },
    });
  } catch (err) {
    log.warn('operator-config audit write failed', {
      orgIdNumeric: ctx.orgIdNumeric,
      err: err instanceof Error ? err.message : String(err),
    });
    // ADR-0005: audit failure surfaces as 5xx, NEVER silent.
    return jsonResponse(res, 500, { error: 'Could not record audit event for config update' });
  }
  const projection = projectConfig(storedRaw);
  return jsonResponse(res, 200, {
    ok: true,
    config: projection.effective,
    source: projection.source,
    defaults: projection.defaults,
  });
}

module.exports = async function (req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', `Content-Type, ${ORG_ID_HEADER}`);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }
  const ctx = await ensureAuthedOrgWithRole(req, res);
  if (!ctx) return;
  try {
    if (req.method === 'GET') return handleGet(req, res, ctx);
    if (req.method === 'PATCH') return handlePatch(req, res, ctx);
    return jsonResponse(res, 405, { error: 'Method not allowed on /api/operator-config' });
  } catch (err) {
    log.error('operator-config handler threw', {
      method: req.method,
      err: err instanceof Error ? err.message : String(err),
    });
    return jsonResponse(res, 500, { error: 'Internal error' });
  }
};
