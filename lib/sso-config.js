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
const FLOW_TTL_SECONDS = 10 * 60;

function configKey(orgId) { return CONFIG_PREFIX + String(orgId).trim(); }
function flowKey(state) { return FLOW_PREFIX + String(state).trim(); }

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
  try { await kv.del(configKey(id)); return true; } catch (_) { return false; }
}

// Domain check (when allowedDomains is configured).
function emailDomainAllowed(cfg, email) {
  if (!cfg || !Array.isArray(cfg.allowedDomains) || cfg.allowedDomains.length === 0) return true;
  const at = String(email || '').lastIndexOf('@');
  if (at < 0) return false;
  const domain = String(email).slice(at + 1).toLowerCase();
  return cfg.allowedDomains.includes(domain);
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
  FLOW_TTL_SECONDS,
  configKey,
  flowKey,
  sanitiseConfig,
  isComplete,
  setConfig,
  getConfig,
  deleteConfig,
  emailDomainAllowed,
  createFlow,
  consumeFlow,
};
