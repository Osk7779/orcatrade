'use strict';

// HS-code precision + rules-of-origin determination (Sprint roo-v1 / Pillar II2).
//
// The preferential-origin data (data/preferential-origin.js) answers "is a
// preferential rate AVAILABLE for this origin?". This module goes one level
// deeper — the question importers actually get burned on: "do my goods QUALIFY
// for that rate, and what evidence do I need?". It determines the applicable
// rule of origin (wholly-obtained / change-of-tariff-heading / max-non-
// originating-value / specific-process) and, when value inputs are supplied,
// gives a deterministic qualification verdict.
//
// CALCULATOR-GROUNDED, LLM-FREE. The value-threshold maths use integer-cents
// money. The chapter→rule mapping is a curated heuristic of the TYPICAL primary
// rule in EU free-trade agreements (PEM-style list rules) — the binding rule is
// always the specific agreement's product-specific-rules (PSR) annex for the
// exact HS line, so every result carries a confidence tier + a caveat the AI
// layer must surface. We never tell a user they "qualify" as a fact.

const M = require('./money');

// ── HS-code precision ───────────────────────────────────
//
// Decompose an HS / CN / TARIC code into its hierarchy so callers know exactly
// how precise a classification is. HS6 is the international subheading; CN8 is
// the EU Combined Nomenclature; TARIC10 is the full EU measure-level code.

function cleanHs(hs) {
  return String(hs == null ? '' : hs).replace(/\D/g, '');
}

function precisionTier(len) {
  if (len >= 10) return 'taric10';
  if (len >= 8) return 'cn8';
  if (len >= 6) return 'subheading';
  if (len >= 4) return 'heading';
  if (len >= 2) return 'chapter';
  return 'none';
}

const TIER_LABEL = {
  taric10: 'TARIC 10-digit (EU measure level — most precise)',
  cn8: 'CN 8-digit (EU Combined Nomenclature)',
  subheading: 'HS6 subheading (international)',
  heading: 'HS4 heading',
  chapter: 'HS2 chapter only',
  none: 'unclassified',
};

function decomposeHs(hsCode) {
  const d = cleanHs(hsCode);
  const length = d.length;
  const tier = precisionTier(length);
  return {
    input: String(hsCode == null ? '' : hsCode),
    normalized: d || null,
    length,
    // `valid` mirrors taric-client.normaliseHs: a usable customs code is 6/8/10.
    valid: length === 6 || length === 8 || length === 10,
    tier,
    tierLabel: TIER_LABEL[tier],
    chapter: length >= 2 ? d.slice(0, 2) : null,
    heading: length >= 4 ? d.slice(0, 4) : null,
    subheading: length >= 6 ? d.slice(0, 6) : null,
    cn8: length >= 8 ? d.slice(0, 8) : null,
    taric10: length >= 10 ? d.slice(0, 10) : null,
  };
}

// ── Rule-of-origin archetypes ───────────────────────────

const RULE = {
  WO: { type: 'wholly_obtained', label: 'Wholly obtained', evidence: ['Proof the goods were entirely produced/harvested/extracted in the origin country'] },
  CTH: { type: 'change_of_heading', label: 'Change of tariff heading (CTH)', evidence: ['Bill of materials with the HS heading of each non-originating input', "Supplier's declarations for originating inputs"] },
  CTSH: { type: 'change_of_subheading', label: 'Change of tariff subheading (CTSH)', evidence: ['Bill of materials with the HS6 subheading of each non-originating input'] },
  MAXNOM: { type: 'max_non_originating_value', label: 'Maximum non-originating material value', evidence: ['Ex-works price calculation', 'Value of non-originating materials (customs value at import)'] },
  DOUBLE_TRANSFORMATION: { type: 'specific_process', label: 'Specific manufacturing process (e.g. textiles: from yarn / from fabric)', evidence: ['Proof of the production step (spinning / weaving / making-up) in the origin country', 'Origin of the fabric or yarn'] },
};

// Typical primary rule by HS chapter in EU FTAs. The alternative (where one is
// commonly offered) and a representative max-non-originating threshold are
// included. Heuristic — the binding rule is the agreement's PSR annex.
function ruleForChapter(chapter) {
  const ch = Number(chapter);
  if (!Number.isFinite(ch)) return { primary: RULE.CTH, alt: RULE.MAXNOM, maxNomPct: 50 };
  // Live animals, food, agriculture, minerals → wholly obtained.
  if (ch >= 1 && ch <= 24) return { primary: RULE.WO, alt: RULE.CTH, maxNomPct: null };
  if (ch >= 25 && ch <= 27) return { primary: RULE.WO, alt: RULE.CTH, maxNomPct: null };
  // Chemicals, plastics, rubber.
  if (ch >= 28 && ch <= 40) return { primary: RULE.CTH, alt: RULE.MAXNOM, maxNomPct: 50 };
  // Textiles + apparel — the classic trap: double transformation.
  if (ch >= 50 && ch <= 60) return { primary: RULE.DOUBLE_TRANSFORMATION, alt: RULE.CTH, maxNomPct: null };
  if (ch >= 61 && ch <= 63) return { primary: RULE.DOUBLE_TRANSFORMATION, alt: null, maxNomPct: null };
  // Footwear.
  if (ch === 64) return { primary: RULE.CTH, alt: null, maxNomPct: null };
  // Base metals + articles.
  if (ch >= 72 && ch <= 83) return { primary: RULE.CTH, alt: RULE.MAXNOM, maxNomPct: 50 };
  // Machinery + electrical.
  if (ch >= 84 && ch <= 85) return { primary: RULE.CTH, alt: RULE.MAXNOM, maxNomPct: 50 };
  // Vehicles + transport — stricter value rule.
  if (ch >= 86 && ch <= 89) return { primary: RULE.MAXNOM, alt: RULE.CTH, maxNomPct: 45 };
  // Optical, medical, instruments.
  if (ch >= 90 && ch <= 92) return { primary: RULE.CTH, alt: RULE.MAXNOM, maxNomPct: 50 };
  // Furniture, toys, misc manufactured.
  if (ch >= 94 && ch <= 96) return { primary: RULE.CTH, alt: RULE.MAXNOM, maxNomPct: 50 };
  return { primary: RULE.CTH, alt: RULE.MAXNOM, maxNomPct: 50 };
}

// Determine the applicable rule of origin for a product under a regime.
//   hsCode      the product's HS/CN/TARIC code
//   regimeCode  optional preferential regime (EVFTA, EBA, TCA, …) for context
// Returns the rule archetype(s), required evidence, the documentary proof,
// confidence, and a mandatory caveat. Pure.
function determineOriginRule({ hsCode, regimeCode } = {}) {
  const hs = decomposeHs(hsCode);
  if (!hs.chapter) {
    return {
      ok: false,
      reason: 'An HS code (at least the 2-digit chapter) is required to determine the rule of origin.',
      hs,
    };
  }
  const map = ruleForChapter(hs.chapter);
  const evidence = [...(map.primary.evidence || [])];
  if (map.alt) evidence.push(...map.alt.evidence.filter(e => !evidence.includes(e)));

  // Precision lowers confidence: a chapter-only code can't pin a PSR line.
  const confidence = hs.valid ? 'medium' : (hs.length >= 4 ? 'low' : 'very_low');

  return {
    ok: true,
    hs,
    regimeCode: regimeCode || null,
    primaryRule: map.primary.type,
    primaryRuleLabel: map.primary.label,
    alternativeRule: map.alt ? map.alt.type : null,
    alternativeRuleLabel: map.alt ? map.alt.label : null,
    maxNonOriginatingPct: map.maxNomPct,
    requiredEvidence: evidence,
    confidence,
    caveat:
      'Indicative primary rule, derived from the typical EU-FTA list rule for this HS chapter. ' +
      'The BINDING rule is the product-specific-rules (PSR) annex of the specific agreement for your exact ' +
      (hs.cn8 ? 'CN8/TARIC line' : 'HS line') + '. Confirm against the agreement text before claiming preference.',
  };
}

// Given the rule + (optional) value inputs, return a deterministic qualification
// verdict. Money is integer-cents. Verdicts:
//   likely_qualifies | likely_fails | needs_evidence | unknown
function assessOriginQualification({ hsCode, regimeCode, exFactoryPriceEur, nonOriginatingValueEur, nonOriginatingValuePct, processDone } = {}) {
  const rule = determineOriginRule({ hsCode, regimeCode });
  if (!rule.ok) return { ...rule, verdict: 'unknown' };

  const base = {
    hs: rule.hs,
    regimeCode: rule.regimeCode,
    rule: rule.primaryRule,
    ruleLabel: rule.primaryRuleLabel,
    maxNonOriginatingPct: rule.maxNonOriginatingPct,
    requiredEvidence: rule.requiredEvidence,
    confidence: rule.confidence,
    caveat: rule.caveat,
  };

  // Value rule: compute the non-originating share deterministically when inputs allow.
  if (rule.primaryRule === 'max_non_originating_value' && Number.isFinite(rule.maxNonOriginatingPct)) {
    let nomPct = null;
    if (Number.isFinite(nonOriginatingValuePct)) {
      nomPct = Number(nonOriginatingValuePct);
    } else if (Number.isFinite(exFactoryPriceEur) && exFactoryPriceEur > 0 && Number.isFinite(nonOriginatingValueEur)) {
      const exw = M.fromEuro(exFactoryPriceEur);
      const nom = M.fromEuro(nonOriginatingValueEur);
      nomPct = exw > 0 ? Math.round((nom / exw) * 1000) / 10 : null;
    }
    if (nomPct == null) {
      return { ...base, verdict: 'needs_evidence', detail: `This rule caps non-originating material at ${rule.maxNonOriginatingPct}% of the ex-works price. Provide the ex-works price and the value of non-originating materials to assess it.` };
    }
    const passes = nomPct <= rule.maxNonOriginatingPct;
    return {
      ...base,
      verdict: passes ? 'likely_qualifies' : 'likely_fails',
      nonOriginatingPct: nomPct,
      thresholdPct: rule.maxNonOriginatingPct,
      detail: `Non-originating materials are ${nomPct}% of ex-works price vs the ${rule.maxNonOriginatingPct}% cap — ${passes ? 'within' : 'OVER'} the limit.`,
    };
  }

  // Wholly obtained: a single yes/no on whether everything originated locally.
  if (rule.primaryRule === 'wholly_obtained') {
    return { ...base, verdict: 'needs_evidence', detail: 'This rule requires the goods to be wholly obtained in the origin country (grown, extracted, or born and raised there). Confirm no third-country materials were used.' };
  }

  // Specific process (textiles): did the required transformation happen?
  if (rule.primaryRule === 'specific_process') {
    if (typeof processDone === 'boolean') {
      return { ...base, verdict: processDone ? 'likely_qualifies' : 'likely_fails', detail: processDone ? 'The required manufacturing step appears to be performed in the origin country.' : 'The required transformation (e.g. from yarn/fabric) does NOT appear to be met — cut-make-trim from imported fabric usually fails EU textile rules.' };
    }
    return { ...base, verdict: 'needs_evidence', detail: 'Textile/apparel rules typically require double transformation (e.g. manufacture from yarn). Confirm the spinning/weaving/making-up step occurred in the origin country.' };
  }

  // CTH / CTSH: needs the bill of materials to verify the tariff shift.
  return { ...base, verdict: 'needs_evidence', detail: `This rule (${rule.primaryRuleLabel}) requires that every non-originating input changes tariff classification through manufacturing. Provide a bill of materials with each input's HS code to verify.` };
}

module.exports = {
  cleanHs,
  precisionTier,
  decomposeHs,
  ruleForChapter,
  determineOriginRule,
  assessOriginQualification,
  RULE,
  TIER_LABEL,
};
