// Sprint richer-revision-v1 — pure helper that picks a cheaper origin
// suggestion from a composePlan() result.
//
// composePlan already runs the customs + routing math against every
// alternative origin in the user's category and surfaces:
//
//   originSensitivity = {
//     matrix: [{ origin, perShipmentLandedTotal, preferentialApplied, ... }],
//     cheapestOrigin: '<ISO>',
//     userOrigin:     '<ISO>',
//     savingEurVsUserOrigin: <int €>,
//     savingPctVsUserOrigin: <int %>,
//     shipmentsPerYear:      <int | null>,
//   }
//
// suggestAlternativeOrigin(plan) decides whether the alternative is
// material enough to interrupt a user with — only if the user isn't
// already on the cheapest origin AND the saving clears both an
// absolute floor (€500 / shipment) and a relative floor (5%). Both
// floors apply so that:
//
//   - A €10k plan that drops by 6% (~€600) clears both → nudge.
//   - A €100 plan that drops by 50% (€50) clears the % but not the EUR
//     floor → skip (operational cost of switching exceeds the saving).
//   - A €1M plan that drops by 2% (€20k) clears the EUR but not the %
//     floor → skip (the noise level on TARIC / freight quarterly drift
//     is comparable to 2%; we'd be crying wolf).
//
// formatLine(suggestion) produces the email-ready sentence. EN-only
// for v1 because the saved-plan record doesn't carry the user's locale
// yet — adding that is a separate sprint (the wizard knows the locale
// at save time but we never persisted it).

'use strict';

const MIN_SAVING_EUR = 500;
const MIN_SAVING_PCT = 5;

function safeNumber(n, fallback = 0) {
  const v = Number(n);
  return Number.isFinite(v) ? v : fallback;
}

// Pure. Returns a suggestion object or null. The plan argument is the
// composePlan() result — must carry .originSensitivity.
function suggestAlternativeOrigin(plan) {
  if (!plan || !plan.originSensitivity) return null;
  const os = plan.originSensitivity;
  if (!os.cheapestOrigin || !os.userOrigin) return null;
  if (String(os.cheapestOrigin) === String(os.userOrigin)) return null;

  const savingEur = Math.round(safeNumber(os.savingEurVsUserOrigin, 0));
  const savingPct = safeNumber(os.savingPctVsUserOrigin, 0);
  if (savingEur < MIN_SAVING_EUR) return null;
  if (savingPct < MIN_SAVING_PCT) return null;

  const matrix = Array.isArray(os.matrix) ? os.matrix : [];
  const entry = matrix.find((m) => m && m.origin === os.cheapestOrigin);
  if (!entry) return null;
  const landed = Math.round(safeNumber(entry.perShipmentLandedTotal, 0));
  if (landed <= 0) return null;

  return {
    origin: String(os.cheapestOrigin),
    userOrigin: String(os.userOrigin),
    savingEur,
    savingPct: Math.round(savingPct * 10) / 10, // 1 decimal
    preferential: entry.preferentialApplied || null,
    transportMode: entry.transportMode || null,
    perShipmentLandedTotal: landed,
    annualSavingEur: os.shipmentsPerYear
      ? savingEur * Math.max(1, Math.floor(Number(os.shipmentsPerYear)))
      : null,
  };
}

function fmtEur(n) {
  return '€' + Math.round(safeNumber(n, 0)).toLocaleString('en-IE');
}

// Email-body sentence. Caller composes it into the plan-revision text.
// Returns '' when the suggestion is null/missing so caller code can
// concatenate without null-guards.
function formatLine(suggestion) {
  if (!suggestion) return '';
  const pref = suggestion.preferential ? ` under ${suggestion.preferential}` : '';
  const annual = suggestion.annualSavingEur && suggestion.annualSavingEur > suggestion.savingEur
    ? ` (≈ ${fmtEur(suggestion.annualSavingEur)}/year at your current shipment volume)`
    : '';
  return (
    `By the way: routing this from ${suggestion.origin}${pref} instead of ${suggestion.userOrigin} ` +
    `would now land at ${fmtEur(suggestion.perShipmentLandedTotal)}/shipment — ` +
    `${fmtEur(suggestion.savingEur)} less (${suggestion.savingPct}%)${annual}. ` +
    `Open the plan to see the alternatives matrix.`
  );
}

module.exports = {
  MIN_SAVING_EUR,
  MIN_SAVING_PCT,
  suggestAlternativeOrigin,
  formatLine,
};
