'use strict';

// Tamper-evident audit chain (Sprint audit-chain-v1).
//
// Given an array of ALREADY-REDACTED audit rows (lib/handlers/audit.js
// redactRow output — emailHash, never raw email), produce a hash chain where
// each row's hash covers the previous row's hash plus a canonical, PII-free
// projection of the row. Altering, inserting, deleting, or reordering any row
// breaks every downstream hash, so a hash-chained export is self-verifiable:
// hand it to an auditor, and verifyChain() flags any change made afterwards.
//
// GDPR-compatible by construction: the projection is built only from the
// redacted fields (no raw email), so the chain doesn't re-expose PII, and the
// genesis is a fixed constant.
//
// Scope (v1): this is a VERIFIABLE EXPORT — it proves an exported artifact
// wasn't altered after generation. Write-time hash storage (to also detect
// in-place DB tampering by a privileged actor) is a deliberate follow-up.

const crypto = require('node:crypto');

const GENESIS = 'orcatrade-audit-genesis-v1';

// Deterministic, PII-free projection of a redacted row. Stable key order so
// the serialisation is reproducible regardless of input key order.
function canonicalProjection(row) {
  const r = row || {};
  const payload = (r.payload && typeof r.payload === 'object') ? r.payload : null;
  const projection = {
    at: r.at || r.ts || null,
    type: r.type || null,
    emailHash: r.emailHash || null,
    planId: r.planId || null,
    orgId: r.orgId || null,
    ip: r.ip || null,
    payload: payload ? stableStringify(payload) : (r.payload != null ? String(r.payload) : null),
  };
  return stableStringify(projection);
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
}

function hashLink(prevHash, row) {
  return crypto.createHash('sha256').update(prevHash + '\n' + canonicalProjection(row)).digest('hex');
}

// Returns the rows each annotated with { _seq, _prevHash, _hash }. Order is
// preserved — the chain pins it, so reordering is detectable.
function buildChain(rows, { genesis = GENESIS } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  let prev = genesis;
  return list.map((row, i) => {
    const hash = hashLink(prev, row);
    const linked = { ...row, _seq: i, _prevHash: prev, _hash: hash };
    prev = hash;
    return linked;
  });
}

// Recompute the chain over the carried rows and flag the first break. Returns
// { ok, length, brokenAt, reason }. brokenAt is the _seq of the first row whose
// recomputed hash (or prevHash linkage) doesn't match.
function verifyChain(chainedRows, { genesis = GENESIS } = {}) {
  const list = Array.isArray(chainedRows) ? chainedRows : [];
  let prev = genesis;
  for (let i = 0; i < list.length; i += 1) {
    const row = list[i];
    if (row._prevHash !== prev) {
      return { ok: false, length: list.length, brokenAt: i, reason: 'prevHash mismatch (row inserted/removed/reordered)' };
    }
    const expected = hashLink(prev, stripChainFields(row));
    if (row._hash !== expected) {
      return { ok: false, length: list.length, brokenAt: i, reason: 'hash mismatch (row content altered)' };
    }
    prev = row._hash;
  }
  return { ok: true, length: list.length, brokenAt: null, headHash: prev };
}

function stripChainFields(row) {
  const out = {};
  for (const k of Object.keys(row || {})) {
    if (k === '_seq' || k === '_prevHash' || k === '_hash') continue;
    out[k] = row[k];
  }
  return out;
}

module.exports = {
  GENESIS,
  canonicalProjection,
  stableStringify,
  buildChain,
  verifyChain,
  stripChainFields,
};
