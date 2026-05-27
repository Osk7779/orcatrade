// Per-org OIDC SSO configuration + flow state — Sprint sso-oidc-v1 (phase 2).
//
// Two KV namespaces:
//   sso:config:<orgId>  → the org's OIDC relying-party config (issuer,
//                          client id/secret, endpoints, optional domain
//                          allowlist). No TTL.
//   sso:flow:<state>     → per-sign-in flow data { orgId, nonce,
//                          codeVerifier } persisted across the IdP
//                          redirect. 10-min TTL, single-use (consumed on
//                          callback so a state can't be replayed).

'use strict';

const kv = require('./intelligence/kv-store');

const CONFIG_PREFIX = 'sso:config:';
const FLOW_PREFIX = 'sso:flow:';
const DOMAIN_PREFIX = 'sso:domain:';
const FLOW_TTL_SECONDS = 10 * 60;

function configKey(orgId) { return CONFIG_PREFIX + String(orgId).trim(); }
function flowKey(state) { return FLOW_PREFIX + String(state).trim(); }
function domainKey(domain) { return DOMAIN_PREFIX + String(domain).toLowerCase().trim(); }

// Fields we persist for a config. clientSecret is required for the
// confidential-client code exchange; everything else identifies the IdP.
function sanitiseConfig(cfg) {
  if (!cfg || typeof cfg !== 'object') return null;
  const out = {};
  for (const k of ['issuer', 'clientId', 'clientSecret', 'authorizationEndpoint', 'tokenEndpoint', 'jwksUri']) {
    if (typeof cfg[k] === 'string' && cfg[k].trim()) out[k] = cfg[k].trim();
  }
  // Optional defence-in-depth: only accept emails in these domains from
  // the IdP (lower-cased). Empty/absent → accept any verified email the
  // IdP asserts (we already trust the org-configured IdP).
  if (Array.isArray(cfg.allowedDomains)) {
    out.allowedDomains = cfg.allowedDomains
      .filter((d) => typeof d === 'string' && d.includes('.'))
      .map((d) => d.toLowerCase().trim());
  }
  // Enforced-SSO (apex III1): when true, members on this org's claimed
  // domain(s) cannot use magic-link sign-in — they must go through the IdP.
  // Only takes effect once the OIDC config is complete (see isEnforcedForEmail).
  if (cfg.enforceSso === true || cfg.enforceSso === 'true') out.enforceSso = true;
  return out;
}

function isComplete(cfg) {
  return !!(cfg && cfg.issuer && cfg.clientId && cfg.clientSecret
    && cfg.authorizationEndpoint && cfg.tokenEndpoint && cfg.jwksUri);
}

async function setConfig(orgId, cfg) {
  const id = String(orgId || '').trim();
  if (!id) return { ok: false, reason: 'no-org' };
  const clean = sanitiseConfig(cfg);
  if (!isComplete(clean)) return { ok: false, reason: 'incomplete' };
  // Reconcile the domain→org discovery index: drop the entries for this
  // org's PREVIOUS domains, then add the new ones (only entries that point
  // at THIS org, so we never clobber another org's claim on a domain).
  const prev = await getConfig(id);
  await reconcileDomainIndex(id, (prev && prev.allowedDomains) || [], clean.allowedDomains || []);
  await kv.set(configKey(id), clean);
  return { ok: true };
}

async function getConfig(orgId) {
  const id = String(orgId || '').trim();
  if (!id) return null;
  try { return (await kv.get(configKey(id))) || null; } catch (_) { return null; }
}

async function deleteConfig(orgId) {
  const id = String(orgId || '').trim();
  if (!id) return false;
  try {
    const prev = await getConfig(id);
    await reconcileDomainIndex(id, (prev && prev.allowedDomains) || [], []);
    await kv.del(configKey(id));
    return true;
  } catch (_) { return false; }
}

// Maintain sso:domain:<domain> → orgId. Only removes an entry when it
// still points at THIS org (so a domain re-claimed by another org isn't
// wiped). Used for email-domain SSO discovery.
async function reconcileDomainIndex(orgId, oldDomains, newDomains) {
  const id = String(orgId);
  const oldSet = new Set((oldDomains || []).map((d) => d.toLowerCase()));
  const newSet = new Set((newDomains || []).map((d) => d.toLowerCase()));
  for (const d of oldSet) {
    if (newSet.has(d)) continue;
    try { if ((await kv.get(domainKey(d))) === id) await kv.del(domainKey(d)); } catch (_) {}
  }
  for (const d of newSet) {
    try { await kv.set(domainKey(d), id); } catch (_) {}
  }
}

// Resolve an email domain to the org that has claimed it for SSO.
async function findOrgByDomain(emailOrDomain) {
  const raw = String(emailOrDomain || '').toLowerCase().trim();
  const domain = raw.includes('@') ? raw.slice(raw.lastIndexOf('@') + 1) : raw;
  if (!domain || !domain.includes('.')) return null;
  try { return (await kv.get(domainKey(domain))) || null; } catch (_) { return null; }
}

// Domain check (when allowedDomains is configured).
function emailDomainAllowed(cfg, email) {
  if (!cfg || !Array.isArray(cfg.allowedDomains) || cfg.allowedDomains.length === 0) return true;
  const at = String(email || '').lastIndexOf('@');
  if (at < 0) return false;
  const domain = String(email).slice(at + 1).toLowerCase();
  return cfg.allowedDomains.includes(domain);
}

// Enforced-SSO check (apex III1): is magic-link sign-in disallowed for this
// email because its domain belongs to an org with complete OIDC config AND
// enforceSso set? Returns { enforced, orgId }. Fails open (enforced:false) on
// any lookup error so an infra blip never locks everyone out of sign-in.
async function isEnforcedForEmail(email) {
  try {
    const orgId = await findOrgByDomain(email);
    if (!orgId) return { enforced: false, orgId: null };
    const cfg = await getConfig(orgId);
    const enforced = !!(cfg && isComplete(cfg) && cfg.enforceSso === true && emailDomainAllowed(cfg, email));
    return { enforced, orgId };
  } catch (_) {
    return { enforced: false, orgId: null };
  }
}

// ── Flow state (state → { orgId, nonce, codeVerifier }) ──

async function createFlow(state, data) {
  const s = String(state || '').trim();
  if (!s || !data || !data.orgId) return false;
  try {
    await kv.set(flowKey(s), {
      orgId: String(data.orgId),
      nonce: String(data.nonce || ''),
      codeVerifier: String(data.codeVerifier || ''),
      createdAt: new Date().toISOString(),
    }, { ttlSeconds: FLOW_TTL_SECONDS });
    return true;
  } catch (_) { return false; }
}

// Single-use: read AND delete, so a captured state can't be replayed.
async function consumeFlow(state) {
  const s = String(state || '').trim();
  if (!s) return null;
  const data = await kv.get(flowKey(s));
  if (!data) return null;
  try { await kv.del(flowKey(s)); } catch (_) { /* best effort */ }
  return data;
}

module.exports = {
  CONFIG_PREFIX,
  FLOW_PREFIX,
  DOMAIN_PREFIX,
  FLOW_TTL_SECONDS,
  configKey,
  flowKey,
  domainKey,
  sanitiseConfig,
  isComplete,
  isEnforcedForEmail,
  setConfig,
  getConfig,
  deleteConfig,
  emailDomainAllowed,
  findOrgByDomain,
  createFlow,
  consumeFlow,
};
