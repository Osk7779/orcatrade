// HS-code lookup — calculator-grounded suggestion + (optional) live MFN
// rate enrichment. Phase 0 P0.11 of docs/execution-plan.md.
//
// Why this exists
// ──────────────
// Until P0.11 the agent tool `lookupHsCode` was a Potemkin endpoint:
// every call returned `{ suggestion: null, confidence: 0.0, message: …
// "not yet wired into the agent" … }`. The agent then either told the
// user we couldn't help, OR worse, hallucinated an HS6 in its prose
// answer (the audit found at least one case in eval logs). For a
// trade-compliance product, an unreliable HS-suggestion signal sitting
// inside a load-bearing tool is exactly the kind of "looks fine, fails
// silently" surface that destroys customer trust on first audit.
//
// What this does
// ──────────────
// 1. Deterministic suggestion — calls `data/hs-suggest.suggest(query)`
//    against the curated ~120-entry HS6 keyword map. No LLM in the loop
//    (per ADR 0002 + ADR 0003 — this module lives outside `lib/ai/`).
// 2. Confidence is computed from the suggestion-scorer's raw scores
//    using rules below. Returns a tier label too so the agent prompt
//    can reason about it without re-implementing the threshold logic.
// 3. (Optional, when `originCountry` provided) Enriches the top
//    candidate with a current MFN duty rate via `taric-client.lookupHsRate`,
//    KV-cached + circuit-protected per existing pattern. Best-effort —
//    network failures degrade the result but never throw.
// 4. Always returns a deep link to the TARIC consultation portal
//    (`taricVerifyUrl`) so the agent can hand the user a one-click
//    verification path. This is the safety net behind ADR 0002 — the
//    final binding number always comes from a human-verified TARIC
//    consultation, never from us.
//
// Contract returned to callers
// ────────────────────────────
//   {
//     suggestion:   { hs6, label, chapter } | null,
//     candidates:   [{ hs6, label, chapter, score }],   // up to 5, best-first
//     confidence:   number in [0, 1],                    // see scoring below
//     confidenceTier: 'high' | 'medium' | 'low' | 'none',
//     dutyEstimate: { rate, ratePercent, source, sourceLabel, asOf,
//                     fromCache, stale } | null,
//     verifyUrl:    string | null,                       // TARIC deep link
//     message:      string,                              // human-readable
//     productDescription, originCountry?, intendedUse?,  // echo of input
//   }
//
// Confidence scoring
// ──────────────────
// `hs-suggest.suggest(query)` returns candidates with raw `score`
// values (3 for an exact-token match, 1 for partial, +2 bonus for a
// multi-word phrase present in the raw query). Calibrated on the
// ~120-entry curated corpus, useful queries land like this:
//
//   "smartphone"       → 1 cand,  score 3
//   "lithium battery"  → 2 cands, top 6 / next 1
//   "cotton t-shirt"   → 3 cands, top 6 / next 4
//   "qwerty zzz"       → 0 cands
//
// We normalise to [0,1] with these rules — keeping "high" rare so the
// agent prompt treats it as "use as-is + ask the user to verify on TARIC"
// rather than "binding classification":
//
//   - No candidates                                → 0.00 (tier: none)
//   - Top ≥ 5 AND top ≥ 2× the runner-up         → 0.90 (tier: high)
//   - Top ≥ 5 but runner-up is close             → 0.65 (tier: medium)
//   - Top 3–4 (one exact match, weak runner-up)  → 0.50 (tier: medium)
//   - Top 1–2 (partial matches only)             → 0.25 (tier: low)
//
// Tuned against the corpus and tested in test/hs-code-lookup.test.js
// — change them there in lockstep.

'use strict';

const { suggest } = require('./data/hs-suggest');
const { lookupHsRate, taricVerifyUrl } = require('./taric-client');

const CANDIDATE_LIMIT = 5;

function computeConfidence(candidates) {
  if (!candidates.length) return { confidence: 0, tier: 'none' };
  const top = candidates[0].score || 0;
  const next = candidates[1] ? candidates[1].score || 0 : 0;

  // Top ≥ 5 needs at least two signals (exact + phrase bonus, or two
  // exact tokens). "Clearly ahead" = ≥ 2× runner-up → "this is the
  // one"; otherwise the runner-up is similar enough that the agent
  // should list both.
  if (top >= 5 && (next === 0 || top >= next * 2)) return { confidence: 0.9, tier: 'high' };
  if (top >= 5) return { confidence: 0.65, tier: 'medium' };
  // Top 3-4 = a single exact-token match. Useful as a pointer; the
  // agent should still list runner-ups and push verification.
  if (top >= 3) return { confidence: 0.5, tier: 'medium' };
  if (top >= 1) return { confidence: 0.25, tier: 'low' };
  return { confidence: 0, tier: 'none' };
}

function buildMessage({ tier, suggestion, candidates, dutyEstimate, productDescription }) {
  if (tier === 'none') {
    return `No HS6 candidate matched "${productDescription}" in our curated map. Suggest the user describe the product more specifically (material, function, use), or verify against EU TARIC (access2markets.ec.europa.eu) / their customs broker. Do NOT guess an HS code in your reply.`;
  }
  const head = `Top candidate ${suggestion.hs6} (${suggestion.label}). Confidence: ${tier}.`;
  const extra = candidates.length > 1
    ? ` Also consider: ${candidates.slice(1, 4).map((c) => `${c.hs6} (${c.label})`).join('; ')}.`
    : '';
  const duty = dutyEstimate
    ? ` MFN rate via ${dutyEstimate.sourceLabel}: ${dutyEstimate.ratePercent.toFixed(1)}%${dutyEstimate.stale ? ' (stale cache, upstream unavailable)' : ''}.`
    : '';
  const verify = ' Always confirm with the importer\'s customs broker before a declaration; the agent must not present this as a final classification.';
  return head + extra + duty + verify;
}

/**
 * Suggest one or more HS6 commodity codes for a plain-language product
 * description, optionally enriched with a current MFN duty rate.
 *
 * @param {object} input
 * @param {string} input.productDescription   — required free-text
 * @param {string} [input.originCountry]      — ISO-2; enables MFN enrichment
 * @param {string} [input.intendedUse]        — echoed back; reserved for
 *                                              future scorer refinement
 * @param {object} [opts]
 * @param {boolean} [opts.skipDutyLookup]     — disable MFN enrichment
 *                                              (used in tests to keep the
 *                                              suite hermetic)
 * @returns {Promise<object>} the lookup result described in the file header
 */
async function lookupHsCode(input = {}, opts = {}) {
  const productDescription = typeof input.productDescription === 'string' ? input.productDescription.trim() : '';
  const originCountry = typeof input.originCountry === 'string' && input.originCountry.length === 2
    ? input.originCountry.toUpperCase()
    : null;
  const intendedUse = typeof input.intendedUse === 'string' ? input.intendedUse : undefined;

  if (!productDescription) {
    return {
      suggestion: null,
      candidates: [],
      confidence: 0,
      confidenceTier: 'none',
      dutyEstimate: null,
      verifyUrl: null,
      message: 'productDescription is required to suggest an HS code.',
      productDescription,
      originCountry,
      intendedUse,
    };
  }

  const candidates = suggest(productDescription, { limit: CANDIDATE_LIMIT });
  const { confidence, tier } = computeConfidence(candidates);
  const suggestion = candidates.length
    ? { hs6: candidates[0].hs6, label: candidates[0].label, chapter: candidates[0].chapter }
    : null;

  // Optional MFN enrichment — only when origin given AND we have a
  // top candidate. Best-effort; failures degrade silently to null so
  // the agent still gets the suggestion + verify URL.
  let dutyEstimate = null;
  if (suggestion && originCountry && !opts.skipDutyLookup) {
    try {
      const rate = await lookupHsRate(suggestion.hs6, originCountry);
      if (rate && Number.isFinite(rate.rate)) {
        dutyEstimate = {
          rate: rate.rate,
          ratePercent: rate.rate * 100,
          source: rate.source,
          sourceLabel: rate.sourceLabel,
          asOf: rate.asOf,
          fromCache: !!rate.fromCache,
          stale: !!rate.stale,
        };
      }
    } catch (_err) {
      // Calculators don't surface upstream errors to the agent; the
      // null dutyEstimate is the signal. The taric-client logs the
      // failure on its own.
      dutyEstimate = null;
    }
  }

  const verifyUrl = suggestion ? taricVerifyUrl(suggestion.hs6, originCountry) : null;
  const message = buildMessage({ tier, suggestion, candidates, dutyEstimate, productDescription });

  return {
    suggestion,
    candidates,
    confidence,
    confidenceTier: tier,
    dutyEstimate,
    verifyUrl,
    message,
    productDescription,
    originCountry,
    intendedUse,
  };
}

module.exports = {
  lookupHsCode,
  computeConfidence,
  CANDIDATE_LIMIT,
};
