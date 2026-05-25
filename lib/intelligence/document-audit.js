'use strict';

// Document intelligence — deterministic audit of a customer's own trade document
// against their import plan (Sprint document-intel-v1 / Pillar I4).
//
// The customer pastes (or the AI extracts) the fields of a commercial invoice,
// packing list, or certificate of origin. This module audits those fields
// against the saved plan + the calculators and returns structured findings:
// HS/origin/value/currency mismatches, arithmetic errors, undervaluation risk,
// missing preference evidence, and missing CBAM/EUDR documentation.
//
// CALCULATOR-GROUNDED, LLM-FREE. All money/consistency maths use integer-cents.
// The AI layer reads the document into fields and narrates the findings; the
// findings themselves (what passes, what's wrong) are decided here, in code.

const M = require('./money');
const roo = require('./rules-of-origin');

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'info'];

function finding(severity, code, message, extra = {}) {
  return { severity, code, message, ...extra };
}

function up(s) { return String(s == null ? '' : s).trim().toUpperCase(); }
function isPlaceholder(name) {
  const s = String(name || '').trim();
  return !s || /\[.*(before use|complete|exporter|consignee|seller|buyer).*\]/i.test(s) || /^\[.*\]$/.test(s);
}

// Same HS line at the HS6 (international subheading) level?
function sameHs6(a, b) {
  const da = roo.decomposeHs(a);
  const db = roo.decomposeHs(b);
  return da.subheading && db.subheading && da.subheading === db.subheading;
}

// Money tolerance: equal within 1% or €1, whichever is larger (display rounding).
function moneyClose(aEur, bEur) {
  const a = M.fromEuro(aEur);
  const b = M.fromEuro(bEur);
  return Math.abs(a - b) <= Math.max(100, Math.round(Math.abs(b) * 0.01));
}

// ── Commercial invoice ──────────────────────────────────

function auditCommercialInvoice(fields, plan) {
  const f = fields || {};
  const p = plan || {};
  const out = [];
  const lineItems = Array.isArray(f.lineItems) ? f.lineItems : [];

  // Parties.
  if (isPlaceholder(f.exporter && f.exporter.companyName)) out.push(finding('high', 'missing_exporter', 'Exporter / seller is missing or still a placeholder — a commercial invoice must name the exporter.'));
  if (isPlaceholder(f.consignee && f.consignee.companyName)) out.push(finding('high', 'missing_consignee', 'Consignee / buyer is missing or still a placeholder.'));

  // Currency.
  const cur = up(f.currency);
  if (!cur) out.push(finding('high', 'missing_currency', 'No currency stated. Every invoice value must specify a currency.'));
  else if (p.quoteCurrency && up(p.quoteCurrency) !== cur) out.push(finding('medium', 'currency_mismatch', `Invoice currency (${cur}) differs from your plan's quote currency (${up(p.quoteCurrency)}).`, { expected: up(p.quoteCurrency), actual: cur }));

  // Incoterm.
  if (!String(f.incoterm || '').trim()) out.push(finding('medium', 'missing_incoterm', 'No Incoterm stated. Customs and your freight quote depend on the delivery term (FOB, CIF, …).'));

  // HS code vs plan.
  const invHs = f.hsCode || (lineItems[0] && lineItems[0].hsCode);
  if (!invHs) out.push(finding('medium', 'missing_hs', 'No HS / commodity code on the invoice. Customs will classify it for you — usually conservatively.'));
  else if (p.hsCode && !sameHs6(invHs, p.hsCode)) out.push(finding('high', 'hs_mismatch', `Invoice HS code (${roo.decomposeHs(invHs).normalized || invHs}) doesn't match your plan's HS code (${roo.decomposeHs(p.hsCode).normalized || p.hsCode}) at the 6-digit level — the duty rate you planned for may not apply.`, { expected: p.hsCode, actual: invHs }));

  // Origin vs plan.
  const invOrigin = up(f.countryOfOrigin || (lineItems[0] && lineItems[0].countryOfOrigin));
  if (!invOrigin) out.push(finding('high', 'missing_origin', 'No country of origin stated. Origin drives the duty rate and any preferential claim.'));
  else if (p.originCountry && up(p.originCountry) !== invOrigin) out.push(finding('high', 'origin_mismatch', `Invoice origin (${invOrigin}) differs from your plan's origin (${up(p.originCountry)}) — this changes duty, anti-dumping exposure, and preference eligibility.`, { expected: up(p.originCountry), actual: invOrigin }));

  // Destination vs plan.
  const invDest = up(f.countryOfDestination);
  if (invDest && p.destinationCountry && up(p.destinationCountry) !== invDest) out.push(finding('medium', 'destination_mismatch', `Invoice destination (${invDest}) differs from your plan (${up(p.destinationCountry)}).`, { expected: up(p.destinationCountry), actual: invDest }));

  // Line-item arithmetic: sum(qty × unitPrice) vs stated invoice total.
  let computedTotal = null;
  if (lineItems.length) {
    let cents = 0;
    let ok = true;
    for (const li of lineItems) {
      const q = Number(li.quantity);
      const up_ = Number(li.unitPrice);
      if (!Number.isFinite(q) || !Number.isFinite(up_)) { ok = false; break; }
      cents = M.add(cents, M.fromEuro(q * up_));
    }
    if (ok) computedTotal = M.toEuro(cents);
  }
  const statedTotal = Number(f.invoiceTotal != null ? f.invoiceTotal : f.totalValue);
  if (computedTotal != null && Number.isFinite(statedTotal) && statedTotal > 0 && !moneyClose(statedTotal, computedTotal)) {
    out.push(finding('high', 'total_arithmetic', `Stated invoice total (${cur || '€'}${statedTotal}) doesn't equal the sum of the line items (${computedTotal.toFixed(2)}). Customs will spot this.`, { expected: Number(computedTotal.toFixed(2)), actual: statedTotal }));
  }

  // Value vs plan + undervaluation risk.
  const declared = Number.isFinite(statedTotal) && statedTotal > 0 ? statedTotal : computedTotal;
  const planValue = Number(p.customsValueEur);
  if (Number.isFinite(declared) && Number.isFinite(planValue) && planValue > 0) {
    if (!moneyClose(declared, planValue)) {
      const ratio = declared / planValue;
      if (ratio < 0.7) out.push(finding('critical', 'undervaluation_risk', `Declared value (≈€${Math.round(declared)}) is ${Math.round((1 - ratio) * 100)}% below your planned customs value (≈€${Math.round(planValue)}). Material undervaluation is a customs offence — confirm the figure is correct and defensible.`, { expected: Math.round(planValue), actual: Math.round(declared) }));
      else out.push(finding('medium', 'value_divergence', `Declared value (≈€${Math.round(declared)}) differs from your planned customs value (≈€${Math.round(planValue)}). Duty and import VAT scale with this figure.`, { expected: Math.round(planValue), actual: Math.round(declared) }));
    }
  }

  // Preference evidence.
  if (p.claimPreferential) {
    const hasStatement = !!(String(f.originStatement || '').trim() || String(f.rexNumber || '').trim() || String(f.eur1Number || '').trim());
    if (!hasStatement) {
      const rule = roo.determineOriginRule({ hsCode: invHs || p.hsCode });
      out.push(finding('high', 'missing_preference_evidence', `Your plan claims a preferential (reduced/zero) duty rate, but the invoice carries no statement on origin / REX number / EUR.1 reference. Without it the border will charge the full MFN duty.${rule.ok ? ` (Rule of origin for this product: ${rule.primaryRuleLabel}.)` : ''}`));
    }
  }

  return out;
}

// ── Packing list ────────────────────────────────────────

function auditPackingList(fields, plan) {
  const f = fields || {};
  const p = plan || {};
  const out = [];
  const lineItems = Array.isArray(f.lineItems) ? f.lineItems : [];

  let gross = Number(f.totalGrossWeightKg);
  let net = Number(f.totalNetWeightKg);
  if (!Number.isFinite(gross) && lineItems.length) {
    gross = lineItems.reduce((s, li) => s + (Number(li.grossWeightKg) || 0), 0) || NaN;
  }
  if (!Number.isFinite(net) && lineItems.length) {
    net = lineItems.reduce((s, li) => s + (Number(li.netWeightKg) || 0), 0) || NaN;
  }

  if (!Number.isFinite(gross)) out.push(finding('medium', 'missing_gross_weight', 'No total gross weight on the packing list — freight is priced on it.'));
  if (Number.isFinite(gross) && Number.isFinite(net) && net > gross) out.push(finding('high', 'weight_inconsistent', `Net weight (${net}kg) exceeds gross weight (${gross}kg) — impossible; one is wrong.`, { expected: `net ≤ ${gross}`, actual: net }));

  const planWeight = Number(p.weightKg);
  if (Number.isFinite(gross) && Number.isFinite(planWeight) && planWeight > 0) {
    const ratio = gross / planWeight;
    if (ratio < 0.5 || ratio > 2) out.push(finding('medium', 'weight_divergence', `Packing-list gross weight (${gross}kg) is far from your plan's weight (${planWeight}kg) — re-check your freight quote, which assumed the planned weight.`, { expected: planWeight, actual: gross }));
  }

  const cartons = Number(f.totalCartons || f.totalPackages);
  if (!Number.isFinite(cartons) || cartons <= 0) out.push(finding('low', 'missing_cartons', 'No carton / package count stated.'));

  return out;
}

// ── Certificate of origin ───────────────────────────────

function auditCertificateOfOrigin(fields, plan) {
  const f = fields || {};
  const p = plan || {};
  const out = [];

  const coOrigin = up(f.countryOfOrigin || f.origin);
  if (!coOrigin) out.push(finding('high', 'missing_origin', 'The certificate states no country of origin.'));
  else if (p.originCountry && up(p.originCountry) !== coOrigin) out.push(finding('high', 'origin_mismatch', `Certificate origin (${coOrigin}) differs from your plan (${up(p.originCountry)}).`, { expected: up(p.originCountry), actual: coOrigin }));

  if (p.claimPreferential) {
    const ref = String(f.rexNumber || f.eur1Number || f.certificateNumber || '').trim();
    if (!ref) out.push(finding('high', 'missing_reference', 'Preferential claim made, but the certificate has no REX / EUR.1 / certificate number to support it.'));
    const rule = roo.determineOriginRule({ hsCode: p.hsCode });
    if (rule.ok) out.push(finding('info', 'origin_rule', `For this product the typical rule of origin is "${rule.primaryRuleLabel}". Ensure the certificate's basis matches. ${rule.caveat}`));
  }
  return out;
}

// ── Cross-document: CBAM / EUDR documentation flags ─────

function complianceDocFlags(plan) {
  const out = [];
  let regimes = [];
  try {
    const eu = require('./data/eu-compliance');
    const fn = eu.findApplicableRegimes || eu.findRegimes;
    if (typeof fn === 'function') regimes = fn({ hsCode: plan.hsCode, productCategory: plan.productCategory }) || [];
  } catch (_) { regimes = []; }
  for (const r of regimes) {
    const id = String(r.id || r.code || '').toUpperCase();
    if (id === 'CBAM') out.push(finding('medium', 'cbam_docs', 'These goods are in CBAM scope — your import documentation should carry the installation/emissions data needed for the quarterly CBAM report.'));
    if (id === 'EUDR') out.push(finding('medium', 'eudr_docs', 'These goods are in EUDR scope — a Due Diligence Statement (DDS) reference with geolocation must accompany the consignment.'));
  }
  return out;
}

const DOC_AUDITORS = {
  commercial_invoice: auditCommercialInvoice,
  proforma_invoice: auditCommercialInvoice,
  packing_list: auditPackingList,
  certificate_of_origin: auditCertificateOfOrigin,
};

function verdictFor(counts) {
  if (counts.critical) return 'blocking_issues';
  if (counts.high) return 'review_needed';
  if (counts.medium || counts.low) return 'minor_issues';
  return 'consistent';
}

// Audit a document's fields against a plan. Returns structured findings, never
// throws. `plan` is optional — without it, only intra-document checks run.
function auditDocument({ documentType, fields, plan } = {}) {
  const type = String(documentType || '').trim();
  const auditor = DOC_AUDITORS[type];
  if (!auditor) {
    return { ok: false, error: `Unsupported document type "${type}". Supported: ${Object.keys(DOC_AUDITORS).join(', ')}.` };
  }
  let findings = [];
  try {
    findings = auditor(fields || {}, plan || {});
    if (plan && (plan.hsCode || plan.productCategory)) findings = findings.concat(complianceDocFlags(plan));
  } catch (_) {
    findings = [finding('low', 'audit_error', 'Some checks could not be completed on the provided fields.')];
  }
  findings.sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));

  const counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const f of findings) counts[f.severity] = (counts[f.severity] || 0) + 1;

  return {
    ok: true,
    documentType: type,
    checkedAgainstPlan: !!(plan && Object.keys(plan).length),
    counts,
    findingCount: findings.length,
    verdict: verdictFor(counts),
    findings,
    advisory: 'Indicative document audit — checks your fields against your plan and the calculators. It is not a substitute for your customs broker\'s review or a binding ruling.',
  };
}

module.exports = {
  auditDocument,
  auditCommercialInvoice,
  auditPackingList,
  auditCertificateOfOrigin,
  complianceDocFlags,
  DOC_AUDITORS,
  SEVERITY_ORDER,
};
