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
  // Sprint 75 — org-level alert cadence. Fail-open read (a KV blip
  // resolves to the 'daily' default inside getAlertCadence) so the
  // panel always renders a definite state.
  const alertCadence = await operatorConfig.getAlertCadence(ctx.orgIdNumeric);
  // Sprint 65 — read-only audit surface. Newest-first, cap at 10.
  // Never throws — a KV read failure resolves to an empty history
  // so the panel still renders the current values above it.
  let history = [];
  try {
    history = await events.listOperatorConfigHistory({
      orgId: ctx.orgIdNumeric,
      limit: 10,
    });
  } catch (err) {
    log.warn('operator-config history read failed', {
      orgIdNumeric: ctx.orgIdNumeric,
      err: err instanceof Error ? err.message : String(err),
    });
    history = [];
  }
  return jsonResponse(res, 200, {
    ok: true,
    config: projection.effective,
    source: projection.source,
    defaults: projection.defaults,
    history,
    // Sprint 65 — surface the current viewer's own emailHash
    // so the UI can label "You" on entries the current session
    // authored WITHOUT resolving any other member's identity
    // back beyond the hash prefix (ADR-0008 posture).
    viewerEmailHash: ctx.emailHash,
    // Sprint 68 — SAP-GTS-style policy presets. Surfaces both
    // the preset DEFINITIONS (so the UI can render tooltips /
    // hover states without a second endpoint) and the
    // CURRENTLY-ACTIVE preset (or 'custom' when the effective
    // config doesn't match any). identifyPreset does a float-
    // tolerant comparison so IEEE-754 doesn't put a well-set
    // config in the 'custom' bucket accidentally.
    presets: operatorConfig.PRESETS,
    currentPreset: operatorConfig.identifyPreset(projection.effective),
    // Sprint 75 — org-level alert cadence ('daily' | 'weekly').
    // Drives the cadence toggle in the panel; the cron fan-outs
    // read the same value server-side so the UI can never drift
    // from what the alert gate actually enforces.
    alertCadence,
  });
}

// Sprint 66 — optional SAP-GTS-style change reason attached to a
// PATCH. Trimmed, capped at 200 chars. Missing / empty-string
// reasons resolve to `{ ok: true, value: null }` so the caller
// can cleanly skip inclusion in the audit event. Non-string
// inputs return an error the handler surfaces as 400.
//
// The cap is intentional: reasons ride along in KV audit events
// with a 5000-event cap for the whole org, so a 10KB explanation
// on one PATCH would evict other org history. 200 chars is
// enough for "tightening stall to match new 3-day SLA" without
// letting one row bloat the log.
const REASON_MAX = 200;

function sanitiseReason(raw) {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (typeof raw !== 'string') {
    return { ok: false, error: 'reason must be a string' };
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { ok: true, value: null };
  if (trimmed.length > REASON_MAX) {
    return { ok: false, error: `reason must be at most ${REASON_MAX} characters` };
  }
  return { ok: true, value: trimmed };
}

// Sprint 67 — extract + validate reset[] BEFORE any KV mutation
// so an out-of-date client that sends an unknown knob name 400s
// cheap. Returns { ok, keys, error } — keys is the deduped list
// on success, error is the 400 message on failure.
function extractResetKeys(raw) {
  if (raw === undefined) return { ok: true, keys: [] };
  if (!Array.isArray(raw)) {
    return { ok: false, error: 'reset must be an array of knob keys' };
  }
  const known = new Set(operatorConfig.KNOB_KEYS);
  const seen = new Set();
  const out = [];
  for (const k of raw) {
    if (typeof k !== 'string' || !known.has(k)) {
      return { ok: false, error: `unknown reset knob: ${String(k)}` };
    }
    if (!seen.has(k)) {
      seen.add(k);
      out.push(k);
    }
  }
  return { ok: true, keys: out };
}

async function handlePatch(req, res, ctx) {
  const body = (req.body && typeof req.body === 'object') ? req.body : {};
  // Sprint 66 — extract the optional change reason BEFORE the
  // knob validation so an invalid reason 400s before we mutate
  // any KV state, and so the reason itself never lands in the
  // `patched` audit projection (which is typed as knob=value
  // pairs and rendered by the UI as such).
  const reasonResult = sanitiseReason(body.reason);
  if (!reasonResult.ok) {
    return jsonResponse(res, 400, { error: reasonResult.error });
  }
  // Sprint 67 — extract reset[] BEFORE the knob validation for
  // the same reason: an unknown knob name should 400 cheap
  // without touching KV. Also caught before overlap-detection
  // below so an out-of-date client hitting BOTH set + reset on
  // the same knob 400s deterministically.
  const resetResult = extractResetKeys(body.reset);
  if (!resetResult.ok) {
    return jsonResponse(res, 400, { error: resetResult.error });
  }
  // Sprint 68 — preset expansion. A preset PATCH snaps all four
  // knobs to the named preset values; a mixed PATCH (preset +
  // any knob field OR preset + reset) 400s because the intent
  // is ambiguous. The expansion happens server-side so the
  // preset values are canonical (the client can't drift them).
  // Auto-reason is set below so the audit history reads
  // "Applied preset: <name>" even without a client-provided
  // reason.
  const rawPreset = body.preset;
  /** @type {'strict' | 'balanced' | 'tolerant' | null} */
  let presetName = null;
  if (rawPreset !== undefined) {
    if (typeof rawPreset !== 'string' || !operatorConfig.PRESET_NAMES.includes(rawPreset)) {
      return jsonResponse(res, 400, {
        error: `unknown preset: ${String(rawPreset)} (expected ${operatorConfig.PRESET_NAMES.join(' | ')})`,
      });
    }
    presetName = rawPreset;
  }
  // Sprint 73 — undo shape validation BEFORE any KV mutation
  // (same cheap-400 posture as reason/reset/preset above). The
  // client names the entry it believes is the latest via its
  // `at` timestamp — the optimistic-concurrency token. Expansion
  // happens further down (it needs the history read).
  const rawUndo = body.undo;
  /** @type {string | null} */
  let undoAt = null;
  if (rawUndo !== undefined) {
    if (!rawUndo || typeof rawUndo !== 'object' || Array.isArray(rawUndo)
      || typeof rawUndo.at !== 'string' || rawUndo.at.length === 0) {
      return jsonResponse(res, 400, {
        error: 'undo must be { at: <timestamp of the change to revert> }',
      });
    }
    undoAt = rawUndo.at;
  }
  // Sprint 75 — org-level alert cadence. Shape-validated cheap
  // (400 before any KV mutation, same posture as reason/reset/
  // preset/undo above). The from-value is read here — a READ, not
  // a mutation — so the audit event can carry { from, to } and an
  // idempotent re-submit of the current value falls through to
  // the no-op guard instead of writing a meaningless event.
  const rawCadence = body.alertCadence;
  /** @type {{ from: string, to: string } | null} */
  let cadenceChange = null;
  if (rawCadence !== undefined) {
    if (typeof rawCadence !== 'string' || !operatorConfig.ALERT_CADENCES.includes(rawCadence)) {
      return jsonResponse(res, 400, {
        error: `alertCadence must be one of: ${operatorConfig.ALERT_CADENCES.join(' | ')}`,
      });
    }
    const currentCadence = await operatorConfig.getAlertCadence(ctx.orgIdNumeric);
    if (currentCadence !== rawCadence) {
      cadenceChange = { from: currentCadence, to: rawCadence };
    }
  }
  const knobPatch = { ...body };
  delete knobPatch.reason;
  delete knobPatch.reset;
  delete knobPatch.preset;
  delete knobPatch.undo;
  delete knobPatch.alertCadence;
  if (presetName !== null) {
    if (Object.keys(knobPatch).length > 0) {
      return jsonResponse(res, 400, {
        error: 'preset cannot be combined with individual knob fields',
      });
    }
    if (resetResult.keys.length > 0) {
      return jsonResponse(res, 400, {
        error: 'preset cannot be combined with reset[]',
      });
    }
    // Sprint 75 — presets are one-click knob operations; a cadence
    // rider would muddy the "Applied preset: X" audit entry. Two
    // PATCHes, two truthful entries.
    if (rawCadence !== undefined) {
      return jsonResponse(res, 400, {
        error: 'preset cannot be combined with alertCadence',
      });
    }
    // Server-side expansion. Deep-copy the preset to a plain
    // object so setOperatorConfig doesn't inherit the frozen
    // reference (it wouldn't mutate it, but plain objects
    // ship cleaner JSON in the audit event).
    Object.assign(knobPatch, operatorConfig.PRESETS[presetName]);
  }
  // Sprint 73 — undo expansion. The SAP-GTS reversal-document
  // pattern: an undo is a NEW change that restores the prior
  // values through the same mutation + audit path — history is
  // append-only, never rewritten. Server-side expansion (like
  // presets) so the client can never drift the restored values.
  // Because the sprint-72 `previous` capture below runs for THIS
  // PATCH too, an undo is itself undoable (redo comes free).
  /** @type {string | null} */
  let undoOf = null;
  if (undoAt !== null) {
    // Mutually exclusive with every other change form — a mixed
    // PATCH has ambiguous intent, same posture as preset.
    if (presetName !== null) {
      return jsonResponse(res, 400, { error: 'undo cannot be combined with preset' });
    }
    if (Object.keys(knobPatch).length > 0) {
      return jsonResponse(res, 400, {
        error: 'undo cannot be combined with individual knob fields',
      });
    }
    if (resetResult.keys.length > 0) {
      return jsonResponse(res, 400, { error: 'undo cannot be combined with reset[]' });
    }
    // Sprint 75 — the reversal document restores knob state only;
    // a cadence rider would blur what the undo entry asserts.
    if (rawCadence !== undefined) {
      return jsonResponse(res, 400, { error: 'undo cannot be combined with alertCadence' });
    }
    // Read the LATEST history entry. Fail-closed: if we cannot
    // read history we cannot verify what we would be reverting,
    // so refuse rather than guess (unlike the fail-open GET
    // history read — this one gates a mutation).
    let latest = null;
    try {
      const entries = await events.listOperatorConfigHistory({
        orgId: ctx.orgIdNumeric,
        limit: 1,
      });
      latest = entries[0] || null;
    } catch (err) {
      log.warn('operator-config undo history read failed', {
        orgIdNumeric: ctx.orgIdNumeric,
        err: err instanceof Error ? err.message : String(err),
      });
      return jsonResponse(res, 500, { error: 'could not read config history to verify undo' });
    }
    if (!latest) {
      return jsonResponse(res, 400, { error: 'nothing to undo — no config changes recorded' });
    }
    // Optimistic-concurrency gate: the client undoes the entry it
    // SAW. If another actor changed the config since, 409 so the
    // client refreshes instead of silently reverting the wrong
    // change. latestAt ships in the body so the UI can re-sync.
    if (latest.at !== undoAt) {
      return jsonResponse(res, 409, {
        error: 'config has changed since you loaded it — refresh and retry',
        latestAt: latest.at,
      });
    }
    const plan = operatorConfig.buildUndoPlan(latest);
    if (!plan.ok) {
      return jsonResponse(res, 400, { error: plan.error });
    }
    Object.assign(knobPatch, plan.set);
    resetResult.keys.push(...plan.reset);
    undoOf = latest.at;
  }
  // Sprint 68 — auto-reason for preset PATCHes. Client-provided
  // reason wins if present (they may want to note WHY they're
  // switching profiles); otherwise the audit history reads
  // "Applied preset: <name>" so a future reader can tell a
  // preset change from a manual four-knob PATCH.
  /** @type {string | null} */
  let finalReason = reasonResult.value;
  if (finalReason === null && presetName !== null) {
    finalReason = `Applied preset: ${presetName}`;
  }
  // Sprint 73 — auto-reason for undo PATCHes, same client-reason-
  // wins precedence as presets. The referenced timestamp makes
  // the history self-describing even without the undoOf marker.
  if (finalReason === null && undoOf !== null) {
    finalReason = `Undid change from ${undoOf}`;
  }
  // Sprint 67 — a knob cannot be BOTH set and reset in the same
  // PATCH. The intent would be ambiguous (set-then-reset? reset-
  // then-set?) and the audit trail would carry contradictory
  // signals. 400 with a specific error so the UI can surface it.
  const overlap = resetResult.keys.filter(
    (k) => Object.prototype.hasOwnProperty.call(knobPatch, k),
  );
  if (overlap.length > 0) {
    return jsonResponse(res, 400, {
      error: `knob cannot be both set and reset in the same PATCH: ${overlap.join(', ')}`,
    });
  }
  // Sprint 67 — no-op guard. If the PATCH has neither a knob
  // change nor a reset (sprint 75: nor a REAL cadence change —
  // re-submitting the current cadence value lands here too),
  // refuse — the audit event would carry nothing meaningful and
  // the reason (if any) would attach to an empty operation.
  if (Object.keys(knobPatch).length === 0 && resetResult.keys.length === 0
    && cadenceChange === null) {
    return jsonResponse(res, 400, {
      error: 'PATCH must include at least one knob change, reset, or cadence change',
    });
  }
  // Sprint 72 — capture the pre-mutation stored partial so the
  // audit event (and its webhook projection) carries before-values
  // for every knob this PATCH touches. `null` = the knob was at
  // platform default before this PATCH (a kv.get MISS — key absent
  // — is NOT a failure: it genuinely means "nothing stored, all
  // knobs at defaults"). If the pre-read THROWS, `previous` stays
  // null and is omitted from the audit detail entirely — the audit
  // trail must never assert state it didn't observe, so absence
  // means "unknown", never a fabricated "was default".
  // MUST run BEFORE setOperatorConfig/unsetKnobs below — a
  // post-mutation read would see the new values, not the old ones.
  /** @type {Record<string, number | null> | null} */
  let previous = null;
  try {
    const kvPre = require('../intelligence/kv-store');
    const rawPre = await kvPre.get(operatorConfig.KEY_PREFIX + String(ctx.orgIdNumeric));
    const storedPre = (rawPre && typeof rawPre === 'object') ? rawPre : {};
    previous = {};
    for (const k of [...Object.keys(knobPatch), ...resetResult.keys]) {
      previous[k] = Object.prototype.hasOwnProperty.call(storedPre, k)
        ? storedPre[k]
        : null;
    }
    // Sprint 75 — a cadence-only PATCH touches no knobs, so an
    // empty snapshot collapses to null. Otherwise the entry would
    // carry previous: {} — the UI would offer an undo pill the
    // server must refuse (buildUndoPlan has no before-values to
    // restore). Absence keeps the affordance truthful.
    if (Object.keys(previous).length === 0) previous = null;
  } catch (_) {
    previous = null;
  }
  // Sprint 67 — run knob writes first (they may fail on
  // validation), then resets. A failure in either half aborts
  // BEFORE the audit event, so the audit trail is truthful.
  if (Object.keys(knobPatch).length > 0) {
    const result = await operatorConfig.setOperatorConfig(ctx.orgIdNumeric, knobPatch);
    if (!result.ok) {
      return jsonResponse(res, 400, { error: result.errors[0], errors: result.errors });
    }
  }
  if (resetResult.keys.length > 0) {
    const resetOutcome = await operatorConfig.unsetKnobs(ctx.orgIdNumeric, resetResult.keys);
    if (!resetOutcome.ok) {
      return jsonResponse(res, 400, {
        error: resetOutcome.errors[0],
        errors: resetOutcome.errors,
      });
    }
  }
  // Sprint 75 — persist the cadence change. Runs after the knob
  // mutations (validation already passed above, so a failure here
  // is a KV write fault → 500) and BEFORE the audit event, so the
  // audit trail never records a change that didn't land.
  if (cadenceChange !== null) {
    const cadenceOutcome = await operatorConfig.setAlertCadence(
      ctx.orgIdNumeric,
      cadenceChange.to,
    );
    if (!cadenceOutcome.ok) {
      return jsonResponse(res, 500, { error: 'could not persist alert cadence' });
    }
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
      detail: {
        patched: knobPatch,
        // Sprint 72 — before-values for every knob this PATCH
        // touched (set OR reset). `null` = the knob was at platform
        // default before the change. Omitted entirely when the
        // pre-mutation read failed — absence means "unknown", never
        // a fabricated default (audit truthfulness). Powers the
        // history "(was …)" rendering, gives webhook subscribers
        // (SIEM/GRC) the full old→new diff without a query-back,
        // and is the raw material for a future undo affordance.
        ...(previous !== null ? { previous } : {}),
        // Sprint 67 — reset[] only present when the actor named at
        // least one knob to unset. Distinct from `patched` so the
        // renderer can label it as a "↻ reset" action (vs "set
        // X=Y"). Same conditional-spread posture as reason —
        // absence is the "no resets" signal.
        ...(resetResult.keys.length > 0 ? { reset: resetResult.keys } : {}),
        // Sprint 66 — reason only present when the actor provided
        // one; the history projection reads `null` when absent.
        // The conditional-spread keeps the JSON compact (a missing
        // key IS the "no reason" signal, not `reason: null`).
        // Sprint 68 — finalReason folds in the auto-reason for
        // preset PATCHes (client reason wins if present).
        ...(finalReason !== null ? { reason: finalReason } : {}),
        // Sprint 68 — preset name only present when the actor
        // applied a preset. Distinct from reason so the history
        // renderer can label the entry as a preset switch even
        // when the client provided their own reason.
        ...(presetName !== null ? { preset: presetName } : {}),
        // Sprint 73 — the `at` of the entry this PATCH reverted.
        // Only present on undo PATCHes; the history renderer uses
        // it to label the entry as a reversal ("⎌ undo") distinct
        // from a manual dial or preset switch.
        ...(undoOf !== null ? { undoOf } : {}),
        // Sprint 75 — org-level cadence change as { from, to }.
        // Only present when the PATCH actually flipped the value
        // (idempotent re-submits fall to the no-op guard). Carried
        // distinctly from `patched` — cadence is an enum policy,
        // not a numeric knob.
        ...(cadenceChange !== null ? { alertCadence: cadenceChange } : {}),
      },
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
    // Sprint 75 — echo the effective cadence so the PATCH response
    // carries the same contract as GET (no client-side guessing).
    alertCadence: cadenceChange !== null
      ? cadenceChange.to
      : await operatorConfig.getAlertCadence(ctx.orgIdNumeric),
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
