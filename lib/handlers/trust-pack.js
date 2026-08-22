// /api/trust-pack — the exportable due-diligence bundle (sprint 86,
// Track D phase 2).
//
// One artifact for the procurement inbox: every live trust
// instrument, aggregated. The assembly rule is SINGLE SOURCE OF
// TRUTH — each section is produced by the same computation that
// powers its live endpoint (accuracy.computeLedger,
// slaPublic.computeAttainment, the anchor history store), so the
// bundle can never disagree with what the website shows the day
// the reviewer checks.
//
// Contents:
//   auditChain   — latest anchor + rolling snapshot history
//                  (tamper-evidence; verify against
//                  /api/audit-anchor/history)
//   accuracy     — the Quote Accuracy Ledger + methodology
//   sla          — both measured commitments + methodology
//   security     — canonical pointers to the public security
//                  documentation corpus (policies live in git —
//                  versioned, diffable, not PDF attachments)
//   verification — the raw endpoints a reviewer can hit to
//                  recompute every number in this bundle
//
// PII-free by construction (aggregates + public links only).
// ?download=1 sets Content-Disposition so the bundle saves as a
// dated file. Same cache + degrade posture as the other trust
// endpoints — a due-diligence artifact must never 5xx.

'use strict';

const accuracyHandler = require('./accuracy');
const slaHandler = require('./sla-public');

const CACHE_KEY = 'trust-pack:v1';
const CACHE_TTL_SECONDS = 5 * 60;

const ENTITY = Object.freeze({
  legalName: 'OrcaTrade Group Ltd',
  offices: ['London', 'Warsaw', 'Hong Kong'],
});

const SECURITY_DOCS_BASE = 'https://github.com/Osk7779/orcatrade/blob/main/docs/security/';
const SECURITY_DOCS = Object.freeze([
  { name: 'SECURITY.md', url: 'https://github.com/Osk7779/orcatrade/blob/main/SECURITY.md' },
  { name: 'data-flow.md', url: `${SECURITY_DOCS_BASE}data-flow.md` },
  { name: 'retention-policy.md', url: `${SECURITY_DOCS_BASE}retention-policy.md` },
  { name: 'audit-trail.md', url: `${SECURITY_DOCS_BASE}audit-trail.md` },
  { name: 'subprocessors.md', url: `${SECURITY_DOCS_BASE}subprocessors.md` },
  { name: 'dpa-template.md', url: `${SECURITY_DOCS_BASE}dpa-template.md` },
  { name: 'soc2-readiness.md', url: `${SECURITY_DOCS_BASE}soc2-readiness.md` },
  { name: 'incident-response.md', url: `${SECURITY_DOCS_BASE}incident-response.md` },
]);

const VERIFICATION = Object.freeze({
  accuracy: 'GET https://orcatrade.pl/api/accuracy',
  sla: 'GET https://orcatrade.pl/api/sla',
  auditChain: 'GET https://orcatrade.pl/api/audit-anchor/history',
  status: 'GET https://orcatrade.pl/api/health',
  note: 'every figure in this bundle recomputes statelessly at these endpoints — compare at review time',
});

function json(res, status, body, { download = false } = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (download) {
    const day = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Disposition', `attachment; filename="orcatrade-trust-pack-${day}.json"`);
  }
  // Pretty-printed — this artifact is read by humans in review
  // meetings, not parsed by pipelines (those hit the raw endpoints).
  return res.end(JSON.stringify(body, null, 2));
}

async function assemblePack() {
  const history = require('../audit-anchor-history');
  // Each section fails open independently — a KV blip on anchors
  // must not empty the accuracy section, and vice versa.
  const [ledger, sla, snapshots] = await Promise.all([
    accuracyHandler.computeLedger().catch(() => null),
    slaHandler.computeAttainment().catch(() => null),
    history.listAnchorSnapshots({ limit: 90 }).catch(() => []),
  ]);
  return {
    entity: ENTITY,
    auditChain: {
      latest: snapshots.length > 0 ? snapshots[0] : null,
      snapshotCount: snapshots.length,
      snapshots,
    },
    accuracy: {
      ledger,
      methodology: accuracyHandler.METHODOLOGY,
    },
    sla: {
      attainment: sla,
      methodology: slaHandler.METHODOLOGY,
    },
    security: { documents: SECURITY_DOCS },
    verification: VERIFICATION,
  };
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 200;
    return res.end();
  }
  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET');
    return res.end();
  }
  const url = new URL(req.url || '/', 'https://orcatrade.local');
  const download = url.searchParams.get('download') === '1';

  const kv = require('../intelligence/kv-store');
  try {
    const cached = await kv.get(CACHE_KEY);
    if (cached && typeof cached === 'object' && cached.pack) {
      return json(res, 200, { ...cached, cached: true }, { download });
    }
  } catch (_) { /* cache read is best-effort */ }

  try {
    const pack = await assemblePack();
    const body = {
      ok: true,
      pack,
      generatedAt: new Date().toISOString(),
    };
    try {
      await kv.set(CACHE_KEY, body, { ttlSeconds: CACHE_TTL_SECONDS });
    } catch (_) { /* cache write is best-effort */ }
    return json(res, 200, body, { download });
  } catch (err) {
    // Even the degrade path ships the static sections — a reviewer
    // still gets entity + security corpus + verification endpoints.
    return json(res, 200, {
      ok: false,
      reason: 'live sections unavailable — static sections + verification endpoints included',
      pack: {
        entity: ENTITY,
        security: { documents: SECURITY_DOCS },
        verification: VERIFICATION,
      },
      generatedAt: new Date().toISOString(),
    }, { download });
  }
};
