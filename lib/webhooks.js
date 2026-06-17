// Sprint 47 — outbound webhooks (v1, management + test delivery).
//
// The natural counterpart to sprint-44 API keys: keys let customers
// PULL from us; webhooks PUSH to them when lifecycle events fire.
// Sprint 47 ships the management surface + HMAC signing + the
// /test endpoint. Sprint 48 will wire production firing into the
// recordEvent path.
//
// Subscription shape:
//   id          whk_<16 hex>          (distinct prefix from ot_)
//   secret      whsec_<64 hex>        (32 bytes = 256 bits)
//   url         https-only, no SSRF   (customer-controlled HTTPS endpoint)
//   label       free text [1, 120]    (human-readable)
//   eventTypes  string[]              (subset of WEBHOOK_EVENT_TYPES)
//   orgIdNumeric                       (binding — never reassignable)
//   createdAt, createdByEmailHash
//   active
//   lastDeliveryAt, lastDeliveryStatus (synthesised by the
//                                       /test endpoint + sprint-48
//                                       production delivery)
//
// KV namespaces:
//   webhook:sub:<id>   → subscription metadata + secret
//   webhook:org:<org>  → array of ids (per-org index)
//
// Discipline:
//   - Secret is RETURNED ONCE on create + ONCE on rotate (the
//     /test endpoint doesn't echo it). Stored at rest in plaintext
//     (HMAC, not lookup — bcrypt-style hashing would prevent the
//     server from signing future deliveries).
//   - URL validation is sprint-47's biggest security knot. v1
//     rejects http://, localhost, 127.0.0.0/8, 10.x, 172.16-31.x,
//     192.168.x, 169.254.x (link-local), and ::1. A future sprint
//     can add DNS rebinding mitigation (resolve + re-check at
//     delivery time) but for v1 the URL gate alone closes the
//     trivial SSRF cases.

'use strict';

const crypto = require('crypto');
const kv = require('./intelligence/kv-store');

const PREFIX = 'whk_';
const SECRET_PREFIX = 'whsec_';
const ID_BYTES = 8;       // 16 hex = 64 bits — uniqueness, NOT secrecy
const SECRET_BYTES = 32;  // 64 hex = 256 bits — the signing entropy
const SUB_PREFIX = 'webhook:sub:';
const ORG_INDEX_PREFIX = 'webhook:org:';

// Sprint 51 — auto-disable threshold. After N back-to-back
// abandoned deliveries (each = MAX_ATTEMPTS=5 failed attempts over
// ~9h35m) we flip the subscription to active:false so we stop
// hammering a clearly-dead endpoint.
//
// 5 abandonments × ~9h35m each ≈ 48h in the absolute worst case;
// in practice failures cluster (deploy-broke-the-receiver
// pattern), so auto-disable typically fires within a single
// business day. Tunable; pinned by drift-guard.
const AUTO_DISABLE_THRESHOLD = 5;

// Curated whitelist of event types customers can subscribe to. A
// subset of events.ALLOWED_TYPES filtered to the operator-wedge
// lifecycle — chain-stamp events, scim, sso, etc. stay internal.
// Sprint 48's production firing will dispatch ONLY these types.
const WEBHOOK_EVENT_TYPES = Object.freeze([
  'import_request_created',
  'import_request_updated',
  'import_request_status_transition',
  'import_request_archived',
  'import_request_message_posted',
  'import_request_evidence_attached',
  'import_request_supplier_picked',
  'import_request_rated',
]);

function generateId() {
  return PREFIX + crypto.randomBytes(ID_BYTES).toString('hex');
}
function generateSecret() {
  return SECRET_PREFIX + crypto.randomBytes(SECRET_BYTES).toString('hex');
}
function subKey(id) { return SUB_PREFIX + String(id); }
function orgIndexKey(orgIdNumeric) { return ORG_INDEX_PREFIX + String(orgIdNumeric); }

// HMAC-SHA256 of the JSON body using the subscription secret. The
// receiver verifies by computing the same HMAC over the raw body
// they received + comparing constant-time. We emit the hex form
// (Stripe-like convention) so the header value is grep-able.
//
// @param {string} secret
// @param {string} body
function signPayload(secret, body) {
  return crypto.createHmac('sha256', String(secret || '')).update(String(body || '')).digest('hex');
}

// URL validation. The SSRF gate is the biggest security knot —
// without it, a customer can register http://169.254.169.254/...
// (the cloud metadata service) and get us to leak instance creds.
// v1 rejects:
//   - non-HTTPS schemes
//   - missing/malformed host
//   - hostnames containing 'localhost' or matching loopback IPs
//   - private-network IP ranges (10.x, 172.16-31.x, 192.168.x)
//   - link-local (169.254.x.x, fe80::)
//   - IPv6 loopback (::1)
//
// Note: this does NOT mitigate DNS rebinding (resolve foo.attacker
// → 127.0.0.1 at delivery time). A follow-up sprint can add that.
function validateUrl(rawUrl) {
  if (typeof rawUrl !== 'string') return { ok: false, error: 'url must be a string' };
  const trimmed = rawUrl.trim();
  if (!trimmed) return { ok: false, error: 'url required' };
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch (_) {
    return { ok: false, error: 'url must be a valid URL' };
  }
  if (parsed.protocol !== 'https:') {
    return { ok: false, error: 'url must use https:// (http is not allowed)' };
  }
  // hostname may come back bracketed for IPv6 literals
  // (`new URL('https://[::1]/').hostname === '[::1]'`). Strip the
  // brackets for the literal comparisons so the loopback + link-
  // local guards bite either form.
  const rawHost = parsed.hostname.toLowerCase();
  const host = rawHost.replace(/^\[|\]$/g, '');
  if (!host) return { ok: false, error: 'url must have a hostname' };
  // String-form loopback + link-local rejections.
  if (host === 'localhost' || host.endsWith('.localhost')) {
    return { ok: false, error: 'localhost URLs are not allowed' };
  }
  if (host === '::1') return { ok: false, error: 'IPv6 loopback (::1) not allowed' };
  if (host.startsWith('fe80:')) {
    return { ok: false, error: 'IPv6 link-local addresses not allowed' };
  }
  // IPv4 octet parse — only treats hostnames that are pure dotted-
  // quad as IPs.
  const octets = host.split('.');
  if (octets.length === 4 && octets.every((o) => /^\d{1,3}$/.test(o))) {
    const nums = octets.map(Number);
    if (nums.some((n) => n < 0 || n > 255)) {
      return { ok: false, error: 'malformed IPv4 address' };
    }
    // 127.0.0.0/8 — loopback.
    if (nums[0] === 127) return { ok: false, error: 'loopback IPs are not allowed' };
    // 10.0.0.0/8 — private.
    if (nums[0] === 10) return { ok: false, error: 'private IP ranges are not allowed' };
    // 172.16.0.0/12 — private.
    if (nums[0] === 172 && nums[1] >= 16 && nums[1] <= 31) {
      return { ok: false, error: 'private IP ranges are not allowed' };
    }
    // 192.168.0.0/16 — private.
    if (nums[0] === 192 && nums[1] === 168) {
      return { ok: false, error: 'private IP ranges are not allowed' };
    }
    // 169.254.0.0/16 — link-local + cloud metadata (the AWS/GCP
    // metadata service lives at 169.254.169.254).
    if (nums[0] === 169 && nums[1] === 254) {
      return { ok: false, error: 'link-local IPs are not allowed' };
    }
    // 0.0.0.0/8 — bogus wildcard.
    if (nums[0] === 0) return { ok: false, error: 'invalid IP address' };
  }
  return { ok: true, value: trimmed };
}

function validateLabel(label) {
  if (typeof label !== 'string') return { ok: false, error: 'label must be a string' };
  const trimmed = label.trim();
  if (trimmed.length === 0) return { ok: false, error: 'label required' };
  if (trimmed.length > 120) return { ok: false, error: 'label must be at most 120 characters' };
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(trimmed)) {
    return { ok: false, error: 'label must not contain control characters' };
  }
  return { ok: true, value: trimmed };
}

function validateEventTypes(eventTypes) {
  if (!Array.isArray(eventTypes)) {
    return { ok: false, error: 'eventTypes must be an array' };
  }
  if (eventTypes.length === 0) {
    return { ok: false, error: 'eventTypes must include at least one entry' };
  }
  /** @type {string[]} */
  const valid = [];
  for (const t of eventTypes) {
    if (typeof t !== 'string') {
      return { ok: false, error: 'eventTypes entries must be strings' };
    }
    if (!WEBHOOK_EVENT_TYPES.includes(t)) {
      return { ok: false, error: `eventTypes contains unsupported type: ${t}` };
    }
    if (!valid.includes(t)) valid.push(t);
  }
  return { ok: true, value: valid };
}

// @param {{ orgIdNumeric: number, label: string, url: string, eventTypes: string[], actorEmailHash?: string }} input
async function createWebhook({ orgIdNumeric, label, url, eventTypes, actorEmailHash }) {
  if (!Number.isFinite(orgIdNumeric)) return { ok: false, errors: ['orgIdNumeric required'] };
  const labelCheck = validateLabel(label);
  if (!labelCheck.ok) return { ok: false, errors: [labelCheck.error] };
  const urlCheck = validateUrl(url);
  if (!urlCheck.ok) return { ok: false, errors: [urlCheck.error] };
  const eventCheck = validateEventTypes(eventTypes);
  if (!eventCheck.ok) return { ok: false, errors: [eventCheck.error] };

  const id = generateId();
  const secret = generateSecret();
  const meta = {
    id,
    orgIdNumeric,
    label: labelCheck.value,
    url: urlCheck.value,
    eventTypes: eventCheck.value,
    secret,
    createdAt: new Date().toISOString(),
    createdByEmailHash: actorEmailHash || null,
    active: true,
    lastDeliveryAt: null,
    lastDeliveryStatus: null,
    // Sprint 51 — auto-disable bookkeeping.
    consecutiveAbandonments: 0,
    autoDisabledAt: null,
    autoDisabledReason: null,
  };
  try {
    await kv.set(subKey(id), meta);
  } catch (err) {
    return { ok: false, errors: [`kv write failed: ${err instanceof Error ? err.message : String(err)}`] };
  }
  try {
    const existing = (await kv.get(orgIndexKey(orgIdNumeric))) || [];
    const arr = Array.isArray(existing) ? existing : [];
    if (!arr.includes(id)) arr.push(id);
    await kv.set(orgIndexKey(orgIdNumeric), arr);
  } catch (err) {
    return { ok: false, errors: [`org index write failed: ${err instanceof Error ? err.message : String(err)}`] };
  }
  return { ok: true, subscription: meta };
}

// List subscriptions for the org. Secret stripped from the response
// (the create endpoint is the only path that returns it).
// @param {number} orgIdNumeric
async function listWebhooksForOrg(orgIdNumeric) {
  if (!Number.isFinite(orgIdNumeric)) return [];
  let ids = [];
  try {
    ids = (await kv.get(orgIndexKey(orgIdNumeric))) || [];
    if (!Array.isArray(ids)) ids = [];
  } catch (_) {
    ids = [];
  }
  /** @type {Array<any>} */
  const out = [];
  for (const id of ids) {
    try {
      const meta = await kv.get(subKey(id));
      if (!meta || typeof meta !== 'object') continue;
      const { secret: _omit, ...safe } = meta;
      out.push(safe);
    } catch (_) {
      continue;
    }
  }
  out.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  return out;
}

// Delete (hard) a subscription. Cross-org isolated like sprint-44
// revokeApiKey. Hard delete (not just `active: false`) so the
// secret is removed from KV — a deactivated subscription's secret
// staying in KV is a needless attack surface.
//
// @param {{ orgIdNumeric: number, id: string, actorEmailHash?: string }} input
async function deleteWebhook({ orgIdNumeric, id, actorEmailHash }) {
  if (!Number.isFinite(orgIdNumeric)) return { ok: false, errors: ['orgIdNumeric required'] };
  if (typeof id !== 'string' || !id) return { ok: false, errors: ['id required'] };
  let meta = null;
  try {
    meta = await kv.get(subKey(id));
  } catch (_) {
    return { ok: false, errors: ['kv read failed'] };
  }
  if (!meta || typeof meta !== 'object') {
    return { ok: false, errors: ['subscription not found'], notFound: true };
  }
  if (meta.orgIdNumeric !== orgIdNumeric) {
    // Same 404 shape as not-found — never "this exists but isn't
    // yours" (sprint 18 security lesson).
    return { ok: false, errors: ['subscription not found'], notFound: true };
  }
  try {
    await kv.del(subKey(id));
  } catch (err) {
    return { ok: false, errors: [`kv delete failed: ${err instanceof Error ? err.message : String(err)}`] };
  }
  try {
    const existing = (await kv.get(orgIndexKey(orgIdNumeric))) || [];
    const arr = (Array.isArray(existing) ? existing : []).filter((x) => x !== id);
    await kv.set(orgIndexKey(orgIdNumeric), arr);
  } catch (_) {
    /* index write best-effort */
  }
  return { ok: true, deletedLabel: meta.label, actorEmailHash };
}

// One-shot test delivery. Signs the canned payload, POSTs to the
// subscription URL, records the result on the subscription
// metadata. Used by the /test endpoint so the customer can verify
// their endpoint receives + verifies signatures before production
// firing lands.
//
// Returns { ok, status, durationMs, error?, timedOut? }. Network
// failures (DNS, connect timeout, TLS error) surface as
// { ok: false, error }; non-2xx HTTP responses surface as
// { ok: false, status }.
//
// Timeout is hard at 10 seconds — a customer endpoint that takes
// longer than that to respond can't sustain real-time delivery
// anyway. Logged + reflected in the response.
//
// @param {{ subscription: any, payload?: any }} input
async function deliverTestPayload({ subscription, payload }) {
  if (!subscription || typeof subscription !== 'object') {
    return { ok: false, error: 'subscription required' };
  }
  const body = JSON.stringify(payload || {
    type: 'webhook.test',
    deliveredAt: new Date().toISOString(),
    subscriptionId: subscription.id,
    note: 'This is a test delivery — your endpoint correctly received + verified the signature.',
  });
  const signature = signPayload(subscription.secret, body);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);
  const startMs = Date.now();
  let status = 0;
  let ok = false;
  let error = null;
  let timedOut = false;
  try {
    const response = await fetch(subscription.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'OrcaTrade-Webhook/1.0',
        'X-OrcaTrade-Signature': signature,
        'X-OrcaTrade-Event': 'webhook.test',
        'X-OrcaTrade-Subscription': subscription.id,
      },
      body,
      signal: controller.signal,
    });
    status = response.status;
    ok = response.ok;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      timedOut = true;
      error = 'timeout (>10s)';
    } else {
      error = err instanceof Error ? err.message : String(err);
    }
  } finally {
    clearTimeout(timeoutId);
  }
  const durationMs = Date.now() - startMs;
  // Update lastDelivery* on the subscription so the UI can render
  // status without a manual refresh.
  try {
    const fresh = await kv.get(subKey(subscription.id));
    if (fresh && typeof fresh === 'object') {
      const updated = {
        ...fresh,
        lastDeliveryAt: new Date().toISOString(),
        lastDeliveryStatus: ok ? `200 (${status})` : error ? `error: ${error}` : `non-2xx: ${status}`,
      };
      await kv.set(subKey(subscription.id), updated);
    }
  } catch (_) {
    /* best-effort */
  }
  return { ok, status, durationMs, error, timedOut };
}

// Sprint 51 — increment consecutiveAbandonments on the subscription.
// When the counter crosses AUTO_DISABLE_THRESHOLD, flip active=false
// + record autoDisabledAt + reason. Idempotent — calling after a
// sub is already auto-disabled is a no-op.
//
// Returns { ok, subscription, autoDisabled: boolean } so the
// caller can audit the transition + skip future retry queueing.
//
// @param {{ subId: string, lastError?: string | null }} input
async function bumpAbandonmentCounter({ subId, lastError }) {
  if (typeof subId !== 'string' || !subId) {
    return { ok: false, errors: ['subId required'] };
  }
  let stored = null;
  try {
    stored = await kv.get(SUB_PREFIX + subId);
  } catch (_) {
    return { ok: false, errors: ['kv read failed'] };
  }
  if (!stored || typeof stored !== 'object') {
    return { ok: false, errors: ['subscription not found'], notFound: true };
  }
  // Already auto-disabled → no-op. The counter stays at its
  // tripped value so a manual investigation can see how it failed.
  if (stored.autoDisabledAt) {
    return { ok: true, subscription: stored, autoDisabled: true, noOp: true };
  }
  const nextCount = Number(stored.consecutiveAbandonments || 0) + 1;
  const shouldDisable = nextCount >= AUTO_DISABLE_THRESHOLD;
  const updated = {
    ...stored,
    consecutiveAbandonments: nextCount,
    active: shouldDisable ? false : stored.active,
    autoDisabledAt: shouldDisable ? new Date().toISOString() : null,
    autoDisabledReason: shouldDisable
      ? `${AUTO_DISABLE_THRESHOLD} consecutive abandonments (last error: ${lastError || 'unknown'})`
      : null,
  };
  try {
    await kv.set(SUB_PREFIX + subId, updated);
  } catch (err) {
    return { ok: false, errors: [`kv write failed: ${err instanceof Error ? err.message : String(err)}`] };
  }
  return { ok: true, subscription: updated, autoDisabled: shouldDisable };
}

// Reset consecutiveAbandonments to 0 on a successful delivery.
// Idempotent. Called from the dispatch's success path.
async function resetAbandonmentCounter(subId) {
  if (typeof subId !== 'string' || !subId) return { ok: false };
  try {
    const stored = await kv.get(SUB_PREFIX + subId);
    if (!stored || typeof stored !== 'object') return { ok: false, notFound: true };
    if (!stored.consecutiveAbandonments && !stored.autoDisabledAt) {
      // Already at 0, not disabled — no write needed.
      return { ok: true, noOp: true };
    }
    // Soft reset — counter back to 0, but DON'T un-disable a
    // currently auto-disabled subscription (that requires explicit
    // reactivation by an admin, so an investigation can complete).
    const updated = {
      ...stored,
      consecutiveAbandonments: 0,
    };
    await kv.set(SUB_PREFIX + subId, updated);
    return { ok: true };
  } catch (_) {
    return { ok: false };
  }
}

// Reactivate an auto-disabled subscription. Admin-only; clears the
// auto-disable bookkeeping + flips active back to true. Cross-org
// isolated (same notFound posture as deleteWebhook).
//
// @param {{ orgIdNumeric: number, id: string, actorEmailHash?: string }} input
async function reactivateWebhook({ orgIdNumeric, id, actorEmailHash }) {
  if (!Number.isFinite(orgIdNumeric)) return { ok: false, errors: ['orgIdNumeric required'] };
  if (typeof id !== 'string' || !id) return { ok: false, errors: ['id required'] };
  let stored = null;
  try {
    stored = await kv.get(SUB_PREFIX + id);
  } catch (_) {
    return { ok: false, errors: ['kv read failed'] };
  }
  if (!stored || typeof stored !== 'object') {
    return { ok: false, errors: ['subscription not found'], notFound: true };
  }
  if (stored.orgIdNumeric !== orgIdNumeric) {
    return { ok: false, errors: ['subscription not found'], notFound: true };
  }
  if (stored.active && !stored.autoDisabledAt) {
    // Already active — return early so the caller can decide
    // whether to audit-log a no-op. Idempotent for retry safety.
    return { ok: true, subscription: stored, noOp: true };
  }
  const updated = {
    ...stored,
    active: true,
    consecutiveAbandonments: 0,
    autoDisabledAt: null,
    autoDisabledReason: null,
    reactivatedAt: new Date().toISOString(),
    reactivatedByEmailHash: actorEmailHash || null,
  };
  try {
    await kv.set(SUB_PREFIX + id, updated);
  } catch (err) {
    return { ok: false, errors: [`kv write failed: ${err instanceof Error ? err.message : String(err)}`] };
  }
  return { ok: true, subscription: updated };
}

module.exports = {
  PREFIX,
  SECRET_PREFIX,
  SUB_PREFIX,
  ORG_INDEX_PREFIX,
  WEBHOOK_EVENT_TYPES,
  AUTO_DISABLE_THRESHOLD,
  generateId,
  generateSecret,
  signPayload,
  validateUrl,
  validateLabel,
  validateEventTypes,
  createWebhook,
  listWebhooksForOrg,
  deleteWebhook,
  deliverTestPayload,
  bumpAbandonmentCounter,
  resetAbandonmentCounter,
  reactivateWebhook,
};
