// Saved-plans persistence — CRUD over KV keyed by user email.
//
// Storage layout:
//   plan:<planId>          → { id, email, inputs, label, savedAt }
//   user:<email>:plans     → array of planIds (most recent first, max 50)
//
// Ownership: every read/write checks that the requesting user (from
// auth cookie) matches the plan's email field. Plan IDs are short
// random hex slugs, not enumerable.

'use strict';

const crypto = require('node:crypto');
const kv = require('./intelligence/kv-store');
const planDiff = require('./plan-diff');

const PLAN_KEY_PREFIX = 'plan:';
const USER_PLANS_PREFIX = 'user:';
const USER_PLANS_SUFFIX = ':plans';
const MAX_PLANS_PER_USER = 50;
const PLAN_TTL_DAYS = 365;

function generatePlanId() {
  return 'pl_' + crypto.randomBytes(8).toString('hex'); // pl_ + 16 hex chars
}

function planKey(planId) {
  return PLAN_KEY_PREFIX + planId;
}

function userPlansKey(email) {
  return USER_PLANS_PREFIX + email + USER_PLANS_SUFFIX;
}

function normaliseEmail(email) {
  return String(email || '').toLowerCase().trim();
}

// ── Inputs sanitiser ──────────────────────────────────
// We only persist the wizard's share-codec keys + an optional label so
// stale or malicious fields can't pollute the saved record.

const ALLOWED_KEYS = [
  'productCategory', 'originCountry', 'destinationCountry',
  'customsValueEur', 'weightKg', 'linesCount', 'urgencyWeeks',
  'monthlyOrders', 'avgUnitsPerOrder', 'avgPalletsHeld', 'avgOrderWeightKg',
  'claimPreferential', 'hsCode', 'moq', 'targetFobUnitEur',
  'quoteCurrency', 'paymentTermsDays',
  'shipmentsPerYear', 'waccPct', 'daysInInventory', 'daysReceivable',
];

function sanitiseInputs(inputs) {
  const out = {};
  if (!inputs || typeof inputs !== 'object') return out;
  for (const k of ALLOWED_KEYS) {
    if (inputs[k] !== undefined && inputs[k] !== null && inputs[k] !== '') {
      out[k] = inputs[k];
    }
  }
  return out;
}

function sanitiseLabel(label) {
  if (!label || typeof label !== 'string') return '';
  return label.trim().slice(0, 100);
}

// ── CRUD operations ──────────────────────────────────

async function savePlan({ email, inputs, label = '', snapshot = null }) {
  const e = normaliseEmail(email);
  if (!e) throw new Error('savePlan: email required');
  const sanitised = sanitiseInputs(inputs);
  if (!sanitised.productCategory || !sanitised.originCountry || !sanitised.destinationCountry) {
    throw new Error('savePlan: minimum required inputs missing (productCategory, originCountry, destinationCountry)');
  }

  const planId = generatePlanId();
  const record = {
    id: planId,
    email: e,
    inputs: sanitised,
    label: sanitiseLabel(label) || autoLabel(sanitised),
    savedAt: new Date().toISOString(),
    snapshot: planDiff.sanitiseSnapshot(snapshot),
  };

  // Write the plan record (1-year TTL)
  await kv.set(planKey(planId), record, { ttlSeconds: PLAN_TTL_DAYS * 24 * 60 * 60 });

  // Prepend planId to user's list, cap at MAX_PLANS_PER_USER
  const existing = (await kv.get(userPlansKey(e))) || [];
  const updated = [planId, ...existing.filter(id => id !== planId)].slice(0, MAX_PLANS_PER_USER);
  await kv.set(userPlansKey(e), updated, { ttlSeconds: PLAN_TTL_DAYS * 24 * 60 * 60 });

  return record;
}

async function getPlan(planId, requestingEmail) {
  const record = await kv.get(planKey(planId));
  if (!record) return null;
  // Ownership check
  const requester = normaliseEmail(requestingEmail);
  if (record.email !== requester) return null;
  return record;
}

async function listPlans(email) {
  const e = normaliseEmail(email);
  if (!e) return [];
  const ids = (await kv.get(userPlansKey(e))) || [];
  if (!Array.isArray(ids) || ids.length === 0) return [];

  // Fetch each plan record, drop any missing (TTL'd out)
  const records = [];
  for (const id of ids) {
    const r = await kv.get(planKey(id));
    if (r && r.email === e) records.push(r);
  }
  return records;
}

async function deletePlan(planId, requestingEmail) {
  const e = normaliseEmail(requestingEmail);
  const record = await kv.get(planKey(planId));
  // Ownership check before delete
  if (!record || record.email !== e) return false;

  await kv.del(planKey(planId));

  const existing = (await kv.get(userPlansKey(e))) || [];
  const updated = existing.filter(id => id !== planId);
  await kv.set(userPlansKey(e), updated, { ttlSeconds: PLAN_TTL_DAYS * 24 * 60 * 60 });
  return true;
}

// ── Auto-label ────────────────────────────────────────

function autoLabel(inputs) {
  const cat = inputs.productCategory || 'plan';
  const origin = inputs.originCountry || '?';
  const dest = inputs.destinationCountry || '?';
  const value = inputs.customsValueEur ? `€${Math.round(inputs.customsValueEur).toLocaleString('en-IE')}` : '';
  return `${cat} ${origin}→${dest} ${value}`.trim();
}

module.exports = {
  PLAN_KEY_PREFIX,
  USER_PLANS_PREFIX,
  USER_PLANS_SUFFIX,
  MAX_PLANS_PER_USER,
  PLAN_TTL_DAYS,
  ALLOWED_KEYS,
  generatePlanId,
  planKey,
  userPlansKey,
  normaliseEmail,
  sanitiseInputs,
  sanitiseLabel,
  autoLabel,
  savePlan,
  getPlan,
  listPlans,
  deletePlan,
};
