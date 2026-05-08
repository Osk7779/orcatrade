// EU preferential origin regimes — curated mapping of origin × product to
// the best applicable preferential rate, the document required to claim it,
// and the savings vs MFN.
//
// PURPOSE
// MFN duty is the default; preferential origin is the *opt-in* — but only
// if the importer presents the right paperwork. A Bangladesh apparel
// shipment with a valid REX statement clears at 0% (EBA). Without it,
// 12% MFN. That's a 12% landed-cost swing on the largest single category
// for SME importers.
//
// SCOPE
// Regimes covered:
//   - EBA (Everything But Arms) — LDCs, 0% on all chapters except arms
//   - GSP+ — vulnerable countries, 0% on covered products
//   - GSP standard — partial reduction (~3.5pp typical)
//   - EVFTA (Vietnam) — phased to 0% for most goods by 2025-2027
//   - EUKFTA (South Korea) — almost all 0% since 2016
//   - EUJEPA (Japan) — most 0% by 2024
//   - EUSFTA (Singapore) — 0%
//   - EU-UK TCA — 0% with rules of origin
//   - Customs Union with Türkiye (ATR.1) — 0% on industrial goods
//
// LIMITS
// - LDC/EBA list reflects EU classification; status changes (e.g. Bangladesh
//   graduates 2026 with 3-year transition).
// - GSP standard rate is approximated as 70% of MFN (typical for non-sensitive
//   products); real per-line rates require TARIC lookup.
// - Specific HS exclusions per FTA (textile rules of origin, sensitive
//   products) are not exhaustively encoded — flagged via notes.
//
// All claims require the relevant document; without paperwork the preferential
// rate does NOT apply, even if eligible. The result UI explains what's needed.

const ASOF = '2026-05-08';

// LDCs eligible for EBA (Everything But Arms). Source: EU Annex IV to GSP Regulation.
const EBA_COUNTRIES = new Set([
  'AF', 'AO', 'BD', 'BF', 'BI', 'BJ', 'CD', 'CF', 'DJ', 'ER', 'ET',
  'GM', 'GN', 'GW', 'HT', 'KH', 'KM', 'KI', 'LA', 'LR', 'LS', 'MG',
  'ML', 'MM', 'MR', 'MW', 'MZ', 'NE', 'NP', 'RW', 'SB', 'SD', 'SL',
  'SN', 'SO', 'SS', 'TD', 'TG', 'TL', 'TZ', 'UG', 'VU', 'YE', 'ZM',
]);

// GSP+ beneficiaries (deeper preference for vulnerable economies).
const GSP_PLUS_COUNTRIES = new Set([
  'BO', 'CV', 'KG', 'MN', 'PK', 'LK', 'PH', 'UZ',
]);

// GSP standard beneficiaries — partial reduction on covered products.
// India is the dominant origin in this set for SME importers.
const GSP_STANDARD_COUNTRIES = new Set([
  'IN', 'ID', 'KE', 'NG', 'CI', 'CM', 'GH', 'TJ', 'SY',
]);

// FTA partner countries with active preferential coverage.
const FTA_REGIMES = {
  VN: {
    code: 'EVFTA',
    name: 'EU-Vietnam FTA',
    rate: 0.0,
    document: 'REX origin declaration on invoice (statement on origin), or EUR.1 for shipments > €6,000',
    notes: 'Most goods at 0% by 2025-2027. Textiles have origin-cumulation rules requiring fabric to come from VN, EU, or KR — pure CMT from CN-origin fabric does not qualify.',
    sensitivelChapters: ['61', '62'], // textiles have stricter rules of origin
  },
  KR: {
    code: 'EUKFTA',
    name: 'EU-South Korea FTA',
    rate: 0.0,
    document: 'Origin declaration on invoice (REX) for shipments any value; EUR.1 not used',
    notes: 'In force since 2011, full 0% reached for almost all industrial goods.',
    sensitivelChapters: [],
  },
  JP: {
    code: 'EUJEPA',
    name: 'EU-Japan Economic Partnership Agreement',
    rate: 0.0,
    document: 'Statement on origin (self-certification) for any value; supporting evidence required',
    notes: 'In force since 2019. Most industrial goods at 0% by 2024-2026; some agricultural still phased.',
    sensitivelChapters: [],
  },
  SG: {
    code: 'EUSFTA',
    name: 'EU-Singapore FTA',
    rate: 0.0,
    document: 'REX origin declaration',
    notes: 'In force since 2019. Most industrial goods at 0%.',
    sensitivelChapters: [],
  },
  GB: {
    code: 'TCA',
    name: 'EU-UK Trade and Cooperation Agreement',
    rate: 0.0,
    document: 'Statement on origin (importer or exporter knowledge based)',
    notes: 'In force since 2021. Strict rules of origin — UK goods with substantial third-country content lose preference.',
    sensitivelChapters: [],
  },
  CA: {
    code: 'CETA',
    name: 'EU-Canada CETA',
    rate: 0.0,
    document: 'Origin declaration on invoice',
    notes: 'In force provisionally since 2017.',
    sensitivelChapters: [],
  },
  MX: {
    code: 'EU_MX',
    name: 'EU-Mexico Global Agreement (modernised)',
    rate: 0.0,
    document: 'EUR.1 or origin declaration',
    notes: 'Modernised agreement covers most industrial and many agricultural goods at 0%.',
    sensitivelChapters: [],
  },
  CL: {
    code: 'EU_CL',
    name: 'EU-Chile Association Agreement',
    rate: 0.0,
    document: 'EUR.1 or origin declaration',
    notes: 'Modernised 2024.',
    sensitivelChapters: [],
  },
  CH: {
    code: 'EU_CH',
    name: 'EU-Switzerland (EFTA / FTA)',
    rate: 0.0,
    document: 'EUR.1 or origin declaration; cumulation under PEM',
    notes: 'PEM cumulation enables diagonal cumulation across Euro-Med partners.',
    sensitivelChapters: [],
  },
};

// Türkiye Customs Union — special case: free circulation under A.TR for
// industrial goods (chapters 25-99 minus ECSC/agriculture exceptions).
// Agriculture (ch. 01-24) excluded; some have separate bilateral preference.
const ATR_EXCLUDED_CHAPTERS = new Set([
  '01', '02', '03', '04', '05', '06', '07', '08', '09',
  '10', '11', '12', '13', '14', '15', '16', '17', '18', '19',
  '20', '21', '22', '23', '24',
]);

function chapterOf(hsCode) {
  if (!hsCode) return null;
  const digits = String(hsCode).replace(/[^0-9]/g, '');
  if (digits.length < 2) return null;
  return digits.slice(0, 2);
}

// ── Resolve the best regime for an origin × HS combination ───────

function findBestRegime({ origin, hsCode, mfnRatePct }) {
  if (!origin) return null;
  const o = String(origin).toUpperCase();
  const chapter = chapterOf(hsCode);

  // 1. Türkiye Customs Union (A.TR) — industrial goods
  if (o === 'TR' && chapter && !ATR_EXCLUDED_CHAPTERS.has(chapter)) {
    return {
      code: 'ATR',
      name: 'EU-Türkiye Customs Union',
      type: 'CU',
      rate: 0.0,
      ratePct: 0,
      document: 'A.TR movement certificate',
      notes: 'Industrial goods circulate free of customs duty under the Customs Union. Excludes agricultural chapters (01-24) and some ECSC steel products. A.TR replaces — not supplements — origin proof for Customs Union goods.',
      mfnReplaced: true,
      saving: typeof mfnRatePct === 'number' ? mfnRatePct : null,
    };
  }
  if (o === 'TR' && chapter && ATR_EXCLUDED_CHAPTERS.has(chapter)) {
    return {
      code: 'TR_AGRI_EXCLUDED',
      name: 'Türkiye agricultural goods',
      type: 'EXCLUDED',
      rate: null,
      document: null,
      notes: 'Customs Union with TR does not cover agricultural products (ch. 01-24). A separate EU-TR bilateral agreement applies to specific goods — verify TARIC.',
      mfnReplaced: false,
      saving: null,
    };
  }

  // 2. EBA (LDC) — 0% across the board except arms (chapter 93)
  if (EBA_COUNTRIES.has(o)) {
    if (chapter === '93') {
      return null; // arms excluded
    }
    return {
      code: 'EBA',
      name: 'Everything But Arms (LDC)',
      type: 'LDC',
      rate: 0.0,
      ratePct: 0,
      document: 'REX statement on origin (Form A discontinued in 2017)',
      notes: 'Least Developed Country preference. 0% MFN on all goods except arms (chapter 93). Bangladesh graduates 2026 — 3-year transition continues full benefits during phase-out. Supplier must be registered in REX.',
      mfnReplaced: true,
      saving: typeof mfnRatePct === 'number' ? mfnRatePct : null,
    };
  }

  // 3. FTA — bilateral free trade agreement
  if (FTA_REGIMES[o]) {
    const fta = FTA_REGIMES[o];
    const sensitive = chapter && fta.sensitivelChapters.includes(chapter);
    return {
      code: fta.code,
      name: fta.name,
      type: 'FTA',
      rate: fta.rate,
      ratePct: fta.rate * 100,
      document: fta.document,
      notes: sensitive
        ? `${fta.notes} ⚠ This HS chapter has stricter rules of origin — verify your supply chain meets the cumulation criteria.`
        : fta.notes,
      mfnReplaced: true,
      saving: typeof mfnRatePct === 'number' ? mfnRatePct : null,
    };
  }

  // 4. GSP+ — deeper preference for vulnerable economies
  if (GSP_PLUS_COUNTRIES.has(o)) {
    return {
      code: 'GSP_PLUS',
      name: 'GSP+',
      type: 'GSP_PLUS',
      rate: 0.0,
      ratePct: 0,
      document: 'REX statement on origin',
      notes: 'GSP+ beneficiaries get full duty suspension on most covered products in exchange for ratifying core human rights and labour conventions.',
      mfnReplaced: true,
      saving: typeof mfnRatePct === 'number' ? mfnRatePct : null,
    };
  }

  // 5. GSP standard — partial reduction (typical 3.5pp for non-sensitive
  //    products). Specific per-HS rates require TARIC lookup.
  if (GSP_STANDARD_COUNTRIES.has(o)) {
    if (typeof mfnRatePct !== 'number') return null;
    // Approximation: ~70% of MFN duty for most non-sensitive products,
    // duty-free for some chapters. We surface this as an estimate.
    const reducedPct = Math.max(0, mfnRatePct * 0.7 - 1.0); // typical 3.5pp reduction
    return {
      code: 'GSP_STANDARD',
      name: 'GSP standard',
      type: 'GSP',
      rate: reducedPct / 100,
      ratePct: reducedPct,
      document: 'REX statement on origin',
      notes: 'GSP standard provides partial duty reduction on covered "non-sensitive" products. Actual rates vary per HS line — verify TARIC. India has graduated out of GSP for textiles (chapters 50-63), copper, plastics, organic chemicals. Approximation shown here.',
      mfnReplaced: true,
      saving: typeof mfnRatePct === 'number' ? Math.max(0, mfnRatePct - reducedPct) : null,
      approximate: true,
    };
  }

  return null;
}

// ── Helpers ──────────────────────────────────────────────

function listRegimes() {
  return [
    { code: 'EBA', name: 'Everything But Arms', countries: Array.from(EBA_COUNTRIES) },
    { code: 'GSP_PLUS', name: 'GSP+', countries: Array.from(GSP_PLUS_COUNTRIES) },
    { code: 'GSP_STANDARD', name: 'GSP standard', countries: Array.from(GSP_STANDARD_COUNTRIES) },
    ...Object.entries(FTA_REGIMES).map(([country, r]) => ({ code: r.code, name: r.name, countries: [country] })),
    { code: 'ATR', name: 'EU-Türkiye Customs Union', countries: ['TR'] },
  ];
}

function isOriginCovered(origin) {
  const o = String(origin || '').toUpperCase();
  return EBA_COUNTRIES.has(o)
      || GSP_PLUS_COUNTRIES.has(o)
      || GSP_STANDARD_COUNTRIES.has(o)
      || Object.keys(FTA_REGIMES).includes(o)
      || o === 'TR';
}

module.exports = {
  ASOF,
  EBA_COUNTRIES,
  GSP_PLUS_COUNTRIES,
  GSP_STANDARD_COUNTRIES,
  FTA_REGIMES,
  ATR_EXCLUDED_CHAPTERS,
  findBestRegime,
  listRegimes,
  isOriginCovered,
  chapterOf,
};
