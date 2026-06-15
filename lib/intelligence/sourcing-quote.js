// Sourcing-country comparison calculator.
//
// Compares CN / VN / IN / BD / TR for a given product category, surfacing:
//   - Estimated FOB cost (relative to CN baseline)
//   - Lead time (production + sea freight to EU)
//   - Quality risk (factory inspection prevalence)
//   - IP enforcement risk
//   - Specialties and cautions
//
// The data here is OrcaTrade's curated benchmark from supplier-side fieldwork.
// It is NOT a live market quote — for binding pricing, the agent routes to a
// human and a factory audit.
//
// Money: FOB unit/total computed in integer cents (lib/intelligence/money.js,
// half-even rounding, no float drift).

const M = require('./money');

const PRICING_SNAPSHOT = {
  asOf: '2026-05-07',
  source: 'OrcaTrade sourcing benchmark — composite of HK office negotiations, factory audits across CN/VN/IN/BD/TR (Q1 2026), Alibaba index pricing for category baselines. Refresh quarterly.',
  confidence: 'snapshot',
  notes: 'FOB indices are relative to a Chinese tier-2 factory baseline (CN = 1.00). Lead times include factory production + sea freight to Rotterdam. Quality and IP risk reflect OrcaTrade portfolio experience and are directional, not legal advice.',
};

// ── Sourcing countries ────────────────────────────────────
const COUNTRIES = {
  CN: {
    code: 'CN',
    name: 'China',
    region: 'East Asia',
    seaTransitWeeks: 5,
    notes: ['Largest manufacturing base globally', 'Most categories have multiple-tier factory ecosystems', 'Anti-dumping risk on certain commodity exports to EU (steel, aluminium, footwear)'],
  },
  VN: {
    code: 'VN',
    name: 'Vietnam',
    region: 'Southeast Asia',
    seaTransitWeeks: 5,
    notes: ['EVFTA gives preferential EU duty access on most categories', 'Rapid production capacity growth since 2018', 'Quality variance higher than CN tier-1 factories'],
  },
  IN: {
    code: 'IN',
    name: 'India',
    region: 'South Asia',
    seaTransitWeeks: 4,
    notes: ['Strong English communication culture', 'Textile and pharma capacity is world-class', 'Lead times less predictable; logistics infrastructure improving'],
  },
  BD: {
    code: 'BD',
    name: 'Bangladesh',
    region: 'South Asia',
    seaTransitWeeks: 5,
    notes: ['Everything But Arms (EBA) gives full duty waiver on most categories until LDC graduation', 'Strongly textile-specialised', 'Audit and worker-rights risks elevated — third-party social audits recommended'],
  },
  TR: {
    code: 'TR',
    name: 'Türkiye',
    region: 'Near Europe',
    seaTransitWeeks: 1,
    notes: ['EU Customs Union — most industrial goods enter duty-free with A.TR', 'Fast lead times (1–2 weeks transit)', 'Higher FOB cost but eliminates 20–25 days vs Asia'],
  },
};

// ── Product categories with country-specific FOB indices and properties ──
//
// fobIndex: cost relative to CN baseline (1.00). VN typically slightly cheaper for
// labour-intensive goods; IN/BD significantly cheaper for textiles; TR more expensive.
// leadTimeWeeks: factory production time only (not transit). Add country.seaTransitWeeks for total.
// qualityRisk / ipRisk: 'low' | 'medium' | 'high' — directional benchmark from OrcaTrade portfolio.
// minMoq / typicalMoq: typical minimum order quantity bands.

const CATEGORIES = {
  apparel: {
    label: 'Apparel & textiles',
    description: 'Knitted, woven, and finished garments',
    countryProfiles: {
      CN: { fobIndex: 1.00, leadTimeWeeks: 6,  minMoq: 500,  typicalMoq: 2000,  qualityRisk: 'low',    ipRisk: 'medium', specialty: 'Tier-1 factories in Guangdong/Zhejiang offer fastest sampling and broadest fabric library', caution: 'Mid-tier subcontracting can cause QC variance; insist on third-party AQL inspection' },
      VN: { fobIndex: 0.92, leadTimeWeeks: 7,  minMoq: 800,  typicalMoq: 3000,  qualityRisk: 'medium', ipRisk: 'low',    specialty: 'Strong on cotton knits and athleisure; EVFTA duty preference is significant', caution: 'Capacity tight Q4 due to seasonal apparel demand' },
      IN: { fobIndex: 0.85, leadTimeWeeks: 8,  minMoq: 1000, typicalMoq: 5000,  qualityRisk: 'medium', ipRisk: 'medium', specialty: 'Cotton, denim, embroidered/embellished garments — Tirupur and Ludhiana clusters', caution: 'Lead-time slippage is common; build 2-week buffer' },
      BD: { fobIndex: 0.78, leadTimeWeeks: 9,  minMoq: 2000, typicalMoq: 10000, qualityRisk: 'medium', ipRisk: 'medium', specialty: 'Cheapest unit cost for woven and basic knits at scale; EBA full duty waiver', caution: 'Mandatory third-party social audit (Accord/Alliance/RSC)' },
      TR: { fobIndex: 1.18, leadTimeWeeks: 4,  minMoq: 300,  typicalMoq: 1500,  qualityRisk: 'low',    ipRisk: 'low',    specialty: 'Fast-fashion replenishment; A.TR duty-free + 1-week transit beats Asia by 4 weeks', caution: 'Higher FOB but landed-cost competitive once you factor freight + duty' },
    },
  },
  electronics: {
    label: 'Consumer electronics',
    description: 'Audio devices, small appliances, accessories',
    countryProfiles: {
      CN: { fobIndex: 1.00, leadTimeWeeks: 5,  minMoq: 1000, typicalMoq: 5000,  qualityRisk: 'low',    ipRisk: 'high',   specialty: 'Shenzhen ecosystem unmatched for component sourcing and PCBA prototyping', caution: 'IP leakage risk is real; use NNN agreements and partition tooling' },
      VN: { fobIndex: 1.05, leadTimeWeeks: 6,  minMoq: 2000, typicalMoq: 8000,  qualityRisk: 'medium', ipRisk: 'medium', specialty: 'Major brands (Samsung, LG) have driven supplier-network buildout', caution: 'Component supply still partly imported from CN; lead time can ripple' },
      IN: { fobIndex: 1.10, leadTimeWeeks: 8,  minMoq: 2000, typicalMoq: 10000, qualityRisk: 'high',   ipRisk: 'medium', specialty: 'Government PLI scheme is subsidising mobile and component manufacturing', caution: 'Quality maturity uneven; tier-1 factories are limited; expect more sampling rounds' },
      BD: { fobIndex: 1.20, leadTimeWeeks: 12, minMoq: 5000, typicalMoq: 20000, qualityRisk: 'high',   ipRisk: 'medium', specialty: 'Limited electronics manufacturing — only basic accessories', caution: 'Generally not recommended for electronics; consider only for very large simple builds' },
      TR: { fobIndex: 1.15, leadTimeWeeks: 5,  minMoq: 500,  typicalMoq: 2000,  qualityRisk: 'low',    ipRisk: 'low',    specialty: 'White goods and consumer electronics for EU market; A.TR duty-free', caution: 'Component imports from EU/CN keep FOB elevated' },
    },
  },
  furniture: {
    label: 'Furniture & wood products',
    description: 'Solid wood, panel, upholstered furniture',
    countryProfiles: {
      CN: { fobIndex: 1.00, leadTimeWeeks: 7,  minMoq: 100,  typicalMoq: 500,   qualityRisk: 'low',    ipRisk: 'medium', specialty: 'Foshan/Dongguan clusters; full-range capability from flat-pack to luxury', caution: 'Wood input traceability for EUDR — request supply-chain documentation' },
      VN: { fobIndex: 0.95, leadTimeWeeks: 8,  minMoq: 200,  typicalMoq: 800,   qualityRisk: 'medium', ipRisk: 'low',    specialty: 'Solid-wood and rattan specialty; EVFTA preferential; major IKEA supplier base', caution: 'EUDR risk: rubberwood and acacia plantations need traceability proof' },
      IN: { fobIndex: 0.98, leadTimeWeeks: 9,  minMoq: 200,  typicalMoq: 1000,  qualityRisk: 'medium', ipRisk: 'low',    specialty: 'Carved/handcrafted wood and metal furniture niches', caution: 'Production scale variable; large orders may split across factories' },
      BD: { fobIndex: 0.85, leadTimeWeeks: 10, minMoq: 500,  typicalMoq: 2000,  qualityRisk: 'high',   ipRisk: 'medium', specialty: 'Bamboo and rattan basics at low cost; EBA duty waiver', caution: 'Limited sophisticated furniture capability' },
      TR: { fobIndex: 1.20, leadTimeWeeks: 5,  minMoq: 50,   typicalMoq: 300,   qualityRisk: 'low',    ipRisk: 'low',    specialty: 'Solid-wood and upholstered with EU-sized 1-week transit', caution: 'FOB premium of ~20% vs CN, partly offset by faster cycle' },
    },
  },
  toys: {
    label: 'Toys & childcare',
    description: 'Plush, plastic, wood, and electronic toys',
    countryProfiles: {
      CN: { fobIndex: 1.00, leadTimeWeeks: 6,  minMoq: 1000, typicalMoq: 5000,  qualityRisk: 'low',    ipRisk: 'high',   specialty: '70%+ of global toy production; Yiwu and Chenghai clusters', caution: 'Toy Safety Directive 2009/48/EC compliance must be tested at the factory' },
      VN: { fobIndex: 1.05, leadTimeWeeks: 8,  minMoq: 2000, typicalMoq: 8000,  qualityRisk: 'medium', ipRisk: 'medium', specialty: 'Limited toy capacity; better for plush than electronic toys', caution: 'Smaller supplier pool — fewer alternatives if production slips' },
      IN: { fobIndex: 1.10, leadTimeWeeks: 10, minMoq: 2000, typicalMoq: 10000, qualityRisk: 'high',   ipRisk: 'medium', specialty: 'Wooden and craft toys; growing capacity post-import-substitution policy', caution: 'Tier-1 toy factories are limited; longer audit cycle' },
      BD: { fobIndex: 1.15, leadTimeWeeks: 12, minMoq: 5000, typicalMoq: 20000, qualityRisk: 'high',   ipRisk: 'medium', specialty: 'Very limited; consider only for plush/soft toys at scale', caution: 'Not generally recommended for toys' },
      TR: { fobIndex: 1.20, leadTimeWeeks: 5,  minMoq: 500,  typicalMoq: 2000,  qualityRisk: 'low',    ipRisk: 'low',    specialty: 'Plush and educational toys for EU market', caution: 'Higher FOB but compliance and lead time win' },
    },
  },
  cosmetics: {
    label: 'Cosmetics & personal care',
    description: 'Skincare, haircare, packaging-led products',
    countryProfiles: {
      CN: { fobIndex: 1.00, leadTimeWeeks: 6,  minMoq: 1000, typicalMoq: 5000,  qualityRisk: 'medium', ipRisk: 'high',   specialty: 'Guangzhou and Shanghai have full-stack OEM/ODM capability', caution: 'EU CPNP notification + REACH/SVHC checks essential before EU import' },
      VN: { fobIndex: 1.10, leadTimeWeeks: 8,  minMoq: 2000, typicalMoq: 8000,  qualityRisk: 'medium', ipRisk: 'medium', specialty: 'Limited but growing OEM cosmetics scene', caution: 'Smaller selection; longer sampling rounds' },
      IN: { fobIndex: 0.90, leadTimeWeeks: 8,  minMoq: 2000, typicalMoq: 10000, qualityRisk: 'medium', ipRisk: 'medium', specialty: 'Ayurvedic and natural-formulation specialty; cost-effective', caution: 'EU regulatory translation can be challenging — confirm CPNP-readiness' },
      BD: { fobIndex: 1.25, leadTimeWeeks: 12, minMoq: 5000, typicalMoq: 20000, qualityRisk: 'high',   ipRisk: 'medium', specialty: 'Very limited cosmetics manufacturing', caution: 'Not generally recommended' },
      TR: { fobIndex: 1.05, leadTimeWeeks: 5,  minMoq: 500,  typicalMoq: 2000,  qualityRisk: 'low',    ipRisk: 'low',    specialty: 'Strong cosmetics OEM with EU regulatory familiarity', caution: 'Premium positioning; mid-market FOB' },
    },
  },
  homeware: {
    label: 'Homeware & kitchen',
    description: 'Kitchen tools, glassware, ceramics, home accessories',
    countryProfiles: {
      CN: { fobIndex: 1.00, leadTimeWeeks: 6,  minMoq: 500,  typicalMoq: 2000,  qualityRisk: 'low',    ipRisk: 'medium', specialty: 'Yiwu market plus Foshan ceramics; broadest range', caution: 'Standard QC inspection essential for breakage-sensitive items' },
      VN: { fobIndex: 1.05, leadTimeWeeks: 7,  minMoq: 1000, typicalMoq: 4000,  qualityRisk: 'medium', ipRisk: 'low',    specialty: 'Bamboo, lacquerware, ceramics niche', caution: 'Smaller pool than CN' },
      IN: { fobIndex: 0.92, leadTimeWeeks: 8,  minMoq: 1000, typicalMoq: 5000,  qualityRisk: 'medium', ipRisk: 'low',    specialty: 'Brass, copper, hand-finished metalware; cost-effective ceramics', caution: 'Lead-time variance' },
      BD: { fobIndex: 1.10, leadTimeWeeks: 12, minMoq: 5000, typicalMoq: 20000, qualityRisk: 'high',   ipRisk: 'medium', specialty: 'Limited specialty in jute and natural fibre crafts', caution: 'Most other homeware better sourced elsewhere' },
      TR: { fobIndex: 1.15, leadTimeWeeks: 5,  minMoq: 200,  typicalMoq: 1000,  qualityRisk: 'low',    ipRisk: 'low',    specialty: 'Glass and ceramics with EU design sensibility', caution: 'Premium FOB; useful for design-led ranges' },
    },
  },
  footwear: {
    label: 'Footwear',
    description: 'Leather, sport, casual, technical footwear',
    countryProfiles: {
      CN: { fobIndex: 1.00, leadTimeWeeks: 7,  minMoq: 1000, typicalMoq: 5000,  qualityRisk: 'low',    ipRisk: 'medium', specialty: 'Putian, Wenzhou, Jinjiang — full sport and casual capability', caution: 'CN-origin footwear has remaining anti-dumping duties on some HS lines' },
      VN: { fobIndex: 1.05, leadTimeWeeks: 8,  minMoq: 2000, typicalMoq: 8000,  qualityRisk: 'low',    ipRisk: 'low',    specialty: 'Major Nike, Adidas, Puma supplier base; EVFTA preferential duty', caution: 'Capacity tight; large brands consume top-tier slots' },
      IN: { fobIndex: 0.92, leadTimeWeeks: 9,  minMoq: 1000, typicalMoq: 5000,  qualityRisk: 'medium', ipRisk: 'low',    specialty: 'Leather footwear specialty (Agra, Chennai)', caution: 'Sport and technical capability is limited' },
      BD: { fobIndex: 1.15, leadTimeWeeks: 12, minMoq: 5000, typicalMoq: 15000, qualityRisk: 'high',   ipRisk: 'medium', specialty: 'Basic leather and slippers', caution: 'Limited sport footwear capability' },
      TR: { fobIndex: 1.25, leadTimeWeeks: 5,  minMoq: 300,  typicalMoq: 1500,  qualityRisk: 'low',    ipRisk: 'low',    specialty: 'Leather casual and women\'s footwear with fast turnaround', caution: 'Higher FOB but A.TR duty-free' },
    },
  },
  machinery: {
    label: 'Machinery & industrial',
    description: 'Light industrial machinery, components, tools',
    countryProfiles: {
      CN: { fobIndex: 1.00, leadTimeWeeks: 10, minMoq: 1,    typicalMoq: 10,    qualityRisk: 'medium', ipRisk: 'high',   specialty: 'Most cost-effective for general light machinery; CNC, plastic injection moulds', caution: 'Machinery Directive (EU) 2023/1230 conformity must be verified pre-shipment' },
      VN: { fobIndex: 1.15, leadTimeWeeks: 14, minMoq: 1,    typicalMoq: 5,     qualityRisk: 'medium', ipRisk: 'medium', specialty: 'Limited; growing capacity in basic industrial equipment', caution: 'Component supply often imported from CN' },
      IN: { fobIndex: 1.05, leadTimeWeeks: 12, minMoq: 1,    typicalMoq: 10,    qualityRisk: 'medium', ipRisk: 'low',    specialty: 'Strong in textile machinery, agricultural equipment, industrial pumps', caution: 'Lead times can be unpredictable for one-off custom builds' },
      BD: { fobIndex: 1.30, leadTimeWeeks: 16, minMoq: 1,    typicalMoq: 5,     qualityRisk: 'high',   ipRisk: 'medium', specialty: 'Minimal capability for industrial machinery', caution: 'Not recommended' },
      TR: { fobIndex: 1.10, leadTimeWeeks: 7,  minMoq: 1,    typicalMoq: 5,     qualityRisk: 'low',    ipRisk: 'low',    specialty: 'Well-built mid-range industrial machinery with EU CE compliance familiarity', caution: 'Best when you want shorter lead time and EU-grade documentation' },
    },
  },
};

// ── Curated supplier shortlist (illustrative, anonymised) ──
// Used by listSupplierShortlist to give the agent something concrete to surface.
// Not a real supplier directory — just OrcaTrade portfolio illustrations.
const SAMPLE_SUPPLIERS = {
  CN: {
    apparel:     [{ name: 'Guangzhou Tier-1 Knit Co. (anonymised)', city: 'Guangzhou', specialty: 'Cotton knits, athleisure', sampleLeadTime: '7–10 days', minMoq: 500 }],
    electronics: [{ name: 'Shenzhen Audio OEM (anonymised)', city: 'Shenzhen', specialty: 'Bluetooth speakers, earbuds', sampleLeadTime: '14 days', minMoq: 1000 }],
    furniture:   [{ name: 'Foshan Solid-Wood Atelier (anonymised)', city: 'Foshan', specialty: 'Solid-wood and upholstered', sampleLeadTime: '21 days', minMoq: 100 }],
    toys:        [{ name: 'Yiwu Toy House (anonymised)', city: 'Yiwu', specialty: 'Plush + plastic toys', sampleLeadTime: '14 days', minMoq: 1000 }],
  },
  VN: {
    apparel:     [{ name: 'Ho Chi Minh Knits Ltd (anonymised)', city: 'Ho Chi Minh City', specialty: 'Cotton + bamboo blends, EVFTA-ready', sampleLeadTime: '10 days', minMoq: 800 }],
    furniture:   [{ name: 'Binh Duong Solidwood (anonymised)', city: 'Binh Duong', specialty: 'Acacia and rubberwood', sampleLeadTime: '21 days', minMoq: 200 }],
    footwear:    [{ name: 'Dong Nai Sport Footwear (anonymised)', city: 'Dong Nai', specialty: 'Sport/casual footwear, multinational supplier', sampleLeadTime: '21 days', minMoq: 2000 }],
  },
  IN: {
    apparel:     [{ name: 'Tirupur Cotton Mills (anonymised)', city: 'Tirupur', specialty: 'Cotton t-shirts and basics', sampleLeadTime: '14 days', minMoq: 1000 }],
    homeware:    [{ name: 'Moradabad Brassware Co (anonymised)', city: 'Moradabad', specialty: 'Brass and copperware', sampleLeadTime: '14 days', minMoq: 500 }],
  },
  BD: {
    apparel:     [{ name: 'Dhaka EBA Garments (anonymised)', city: 'Dhaka', specialty: 'Woven garments at scale, EBA-compliant', sampleLeadTime: '21 days', minMoq: 2000 }],
  },
  TR: {
    apparel:     [{ name: 'Istanbul Fashion Atelier (anonymised)', city: 'Istanbul', specialty: 'Fast-fashion replenishment, A.TR-ready', sampleLeadTime: '7 days', minMoq: 300 }],
    furniture:   [{ name: 'Bursa Solid Furniture (anonymised)', city: 'Bursa', specialty: 'Upholstered + solid wood, EU sizes', sampleLeadTime: '14 days', minMoq: 50 }],
  },
};

// ── Tier-A coverage manifest (ADR 0020) ───────────────────────────────
//
// Universal envelope for sourcing-quote outputs. Every entry point
// (compareCountries, assessRisk, estimateLeadTime, shortlistSuppliers,
// recommendCountry) requires productCategory — bounded to the 8
// categories in CATEGORIES. A parity test asserts both directions
// (every CATEGORIES key in COVERAGE; every COVERAGE value in CATEGORIES).
//
// Honest posture: PRICING_SNAPSHOT is OrcaTrade's internal benchmark
// (HK office negotiations + Alibaba index + factory audits Q1 2026),
// so source_kind = 'mirror' and TA-2 reliably fails today. Same
// shape as customs-quote and finance-quote before live primary
// sources are wired. The contract works; eligibility flips
// automatically when a real source (e.g. World Bank Comtrade for
// volumes, BLS for labour-cost indices) lands.
const TIER_A_COVERAGE = Object.freeze({
  calculatorName: 'sourcing-quote',
  version: 1,
  axes: Object.freeze({
    productCategory: { type: 'set', values: Object.freeze(Object.keys(CATEGORIES)) },
  }),
});

// ── Public helpers ─────────────────────────────────────────

function listCategories() {
  return Object.entries(CATEGORIES).map(([key, c]) => ({ key, label: c.label, description: c.description }));
}

function listCountries() {
  return Object.values(COUNTRIES).map(c => ({
    code: c.code, name: c.name, region: c.region,
    seaTransitWeeks: c.seaTransitWeeks, notes: c.notes,
  }));
}

function getCountryNotes(code) {
  const c = COUNTRIES[String(code || '').toUpperCase()];
  return c ? { code: c.code, name: c.name, region: c.region, notes: c.notes } : null;
}

// ── Validation ────────────────────────────────────────────

function validateInput(input) {
  const errors = [];
  if (!input || typeof input !== 'object') {
    errors.push('input must be an object');
    return { ok: false, errors };
  }
  if (!input.productCategory) errors.push('productCategory required');
  else if (!CATEGORIES[input.productCategory]) {
    errors.push(`productCategory must be one of: ${Object.keys(CATEGORIES).join(', ')}`);
  }
  if (input.targetFobUnitEur != null) {
    const v = Number(input.targetFobUnitEur);
    if (!Number.isFinite(v) || v <= 0) errors.push('targetFobUnitEur must be > 0');
  }
  if (input.moq != null) {
    const v = Number(input.moq);
    if (!Number.isFinite(v) || v < 1) errors.push('moq must be a positive integer');
  }
  if (input.urgencyWeeks != null) {
    const v = Number(input.urgencyWeeks);
    if (!Number.isFinite(v) || v < 1) errors.push('urgencyWeeks must be 1 or higher');
  }
  if (input.countries) {
    if (!Array.isArray(input.countries)) errors.push('countries must be an array of ISO-2 codes');
    else for (const c of input.countries) {
      if (!COUNTRIES[String(c || '').toUpperCase()]) errors.push(`Unknown country: ${c}`);
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}

// ── Country comparison ─────────────────────────────────────

function compareCountries({ productCategory, targetFobUnitEur, moq, urgencyWeeks, countries }) {
  const cat = CATEGORIES[productCategory];
  const wantedCodes = (countries && countries.length)
    ? countries.map(c => String(c).toUpperCase())
    : Object.keys(COUNTRIES);

  const results = wantedCodes
    .filter(code => COUNTRIES[code] && cat.countryProfiles[code])
    .map(code => {
      const country = COUNTRIES[code];
      const profile = cat.countryProfiles[code];
      const totalLeadTimeWeeks = profile.leadTimeWeeks + country.seaTransitWeeks;
      const fobUnitCents = targetFobUnitEur ? M.mulRate(M.fromEuro(targetFobUnitEur), profile.fobIndex) : null;
      const fobUnitEur = fobUnitCents != null ? M.toEuro(fobUnitCents) : null;
      const fobTotalEur = (fobUnitCents != null && moq) ? Math.round(M.toEuro(M.mulRate(fobUnitCents, moq))) : null;

      const meetsUrgency = urgencyWeeks ? totalLeadTimeWeeks <= urgencyWeeks : true;
      const meetsMoq = moq ? moq >= profile.minMoq : true;

      return {
        country: code,
        countryName: country.name,
        region: country.region,
        fobIndex: profile.fobIndex,
        fobUnitEur,
        fobTotalEur,
        productionLeadTimeWeeks: profile.leadTimeWeeks,
        seaTransitWeeks: country.seaTransitWeeks,
        totalLeadTimeWeeks,
        meetsUrgency,
        meetsMoq,
        minMoq: profile.minMoq,
        typicalMoq: profile.typicalMoq,
        qualityRisk: profile.qualityRisk,
        ipRisk: profile.ipRisk,
        specialty: profile.specialty,
        caution: profile.caution,
      };
    });

  return results;
}

// ── Risk assessment ────────────────────────────────────────

function assessRisk({ productCategory, country }) {
  const cat = CATEGORIES[productCategory];
  if (!cat) return { error: `Unknown product category: ${productCategory}` };
  const code = String(country || '').toUpperCase();
  const c = COUNTRIES[code];
  const profile = cat.countryProfiles[code];
  if (!c || !profile) return { error: `No data for ${country} × ${productCategory}` };

  return {
    country: code,
    countryName: c.name,
    productCategory,
    qualityRisk: profile.qualityRisk,
    ipRisk: profile.ipRisk,
    countryNotes: c.notes,
    specialty: profile.specialty,
    caution: profile.caution,
    auditRecommendation: profile.qualityRisk === 'high'
      ? 'Strongly recommended: third-party audit (SGS / Bureau Veritas / Intertek) before contract signature; AQL inspection per shipment.'
      : profile.qualityRisk === 'medium'
        ? 'Recommended: factory inspection before first order; AQL on first 3 shipments.'
        : 'Suggested: pre-shipment AQL inspection; full audit optional for high-value contracts.',
  };
}

// ── Lead time estimate ─────────────────────────────────────

function estimateLeadTime({ productCategory, country, moq, urgencyWeeks }) {
  const cat = CATEGORIES[productCategory];
  if (!cat) return { error: `Unknown product category: ${productCategory}` };
  const code = String(country || '').toUpperCase();
  const c = COUNTRIES[code];
  const profile = cat.countryProfiles[code];
  if (!c || !profile) return { error: `No data for ${country} × ${productCategory}` };

  // Adjust production lead time for MOQ — larger orders take longer
  let production = profile.leadTimeWeeks;
  if (moq && moq > profile.typicalMoq * 2) production += 2;
  else if (moq && moq < profile.minMoq) production += 1; // small orders get deprioritised
  const total = production + c.seaTransitWeeks;

  return {
    country: code,
    productCategory,
    productionWeeks: production,
    seaTransitWeeks: c.seaTransitWeeks,
    totalWeeks: total,
    productionDays: production * 7,
    totalDays: total * 7,
    meetsUrgency: urgencyWeeks ? total <= urgencyWeeks : null,
    note: urgencyWeeks && total > urgencyWeeks
      ? `${total} weeks total exceeds your ${urgencyWeeks}-week deadline. Consider Türkiye (1-week transit) or a CN tier-1 factory with expedited slot.`
      : 'Total includes factory production + sea freight to Rotterdam. Air freight option saves 3–4 weeks at significant cost premium.',
  };
}

// ── Shortlist ─────────────────────────────────────────────

function shortlistSuppliers({ productCategory, country }) {
  const code = String(country || '').toUpperCase();
  const list = SAMPLE_SUPPLIERS[code]?.[productCategory] || [];
  if (!list.length) {
    return {
      country: code,
      productCategory,
      suppliers: [],
      note: `No curated shortlist available yet for ${productCategory} in ${code}. The OrcaTrade HK office can run a custom supplier-discovery sprint — typically 2-4 weeks for a 5-supplier longlist with samples.`,
    };
  }
  return {
    country: code,
    productCategory,
    suppliers: list,
    note: 'Sample shortlist from OrcaTrade portfolio (anonymised). For real introductions and audit data, route via the contact form — we open factory access through our HK office.',
  };
}

// ── Recommendation ────────────────────────────────────────

function recommendCountry({ productCategory, targetFobUnitEur, moq, urgencyWeeks, costPriority }) {
  const validation = validateInput({ productCategory, targetFobUnitEur, moq, urgencyWeeks });
  if (!validation.ok) return { ok: false, errors: validation.errors };

  const comparison = compareCountries({ productCategory, targetFobUnitEur, moq, urgencyWeeks });

  // Filter to viable options
  let viable = comparison.filter(c => c.meetsUrgency && c.meetsMoq);
  if (!viable.length) viable = comparison; // fall back to full list if nothing meets gates

  // Score: cost (lower fobIndex better), then quality (low risk better), then lead time
  const score = c => {
    const costScore = (1 / c.fobIndex) * 100;
    const qualityScore = c.qualityRisk === 'low' ? 30 : c.qualityRisk === 'medium' ? 15 : 0;
    const ipScore = c.ipRisk === 'low' ? 20 : c.ipRisk === 'medium' ? 10 : 0;
    const leadScore = Math.max(0, 30 - c.totalLeadTimeWeeks);
    return costPriority === 'cost' ? costScore + qualityScore : costScore + qualityScore + ipScore + leadScore;
  };

  viable.sort((a, b) => score(b) - score(a));
  const recommended = viable[0];

  // Identify alternatives by axis
  const cheapest = [...comparison].sort((a, b) => a.fobIndex - b.fobIndex)[0];
  const fastest = [...comparison].sort((a, b) => a.totalLeadTimeWeeks - b.totalLeadTimeWeeks)[0];
  const lowestRisk = [...comparison]
    .filter(c => c.qualityRisk === 'low')
    .sort((a, b) => a.fobIndex - b.fobIndex)[0] || null;

  return {
    ok: true,
    asOf: PRICING_SNAPSHOT.asOf,
    inputs: { productCategory, targetFobUnitEur, moq, urgencyWeeks, costPriority: costPriority || 'balanced' },
    comparison,
    recommendation: {
      primary: recommended.country,
      primaryName: recommended.countryName,
      reasoning: buildRationale(recommended, costPriority),
      alternatives: {
        cheapest: { country: cheapest.country, fobIndex: cheapest.fobIndex },
        fastest: { country: fastest.country, totalLeadTimeWeeks: fastest.totalLeadTimeWeeks },
        lowestRisk: lowestRisk ? { country: lowestRisk.country, fobIndex: lowestRisk.fobIndex } : null,
      },
    },
    sourcingEducation: {
      whatThis: 'Sourcing-country comparison is the first decision in the import journey — it determines unit cost, lead time, IP risk, and compliance posture for the next 12+ months of your product.',
      auditDiscipline: 'Always run a third-party factory audit (SGS / Bureau Veritas / Intertek) before signing your first PO above €20,000. The €1,500–€3,000 audit cost is an order of magnitude cheaper than a defective shipment.',
      multiSource: 'Above 5,000 units / month, dual-source from two countries to de-risk: e.g., 70% CN tier-1 + 30% VN backup. Single-source risk ages badly during port strikes, supplier disputes, or anti-dumping shifts.',
      preferentialTrade: 'VN (EVFTA), BD (EBA), and TR (Customs Union) all give EU duty preference vs CN baseline — for many categories this is worth 3–12% landed-cost savings.',
    },
    nextSteps: [
      `Run the factory-audit checklist for ${recommended.countryName} ${productCategory} suppliers — request a 5-supplier longlist via the OrcaTrade HK office.`,
      'Request 3 factory samples before MOQ commitment; test against your own QC criteria.',
      'For preferential origin (VN EVFTA, BD EBA, TR A.TR), confirm supplier can issue valid origin proof — invalid REX/Form A claims invalidate duty preference at EU import.',
      `Use the Compliance Agent to verify CBAM / EUDR / REACH / CE applicability for ${productCategory}; use the Logistics Agent to estimate landed cost from each viable origin.`,
    ],
    pricingSnapshot: PRICING_SNAPSHOT,
  };
}

function buildRationale(rec, costPriority) {
  const ipNote = rec.ipRisk === 'high' ? ' IP risk is high — use NNN agreements and tooling partition.' : '';
  const qualityNote = rec.qualityRisk === 'high' ? ' Third-party audit is mandatory before contract signature.' : '';
  if (costPriority === 'cost') {
    return `${rec.countryName} is the strongest cost option (FOB index ${rec.fobIndex}× CN baseline) for the category, with ${rec.totalLeadTimeWeeks}-week total lead time.${ipNote}${qualityNote}`;
  }
  return `${rec.countryName} balances FOB cost (${rec.fobIndex}× CN), ${rec.totalLeadTimeWeeks}-week lead time, ${rec.qualityRisk} quality risk and ${rec.ipRisk} IP risk for ${rec.specialty.split(';')[0].toLowerCase()}.${ipNote}${qualityNote}`;
}

// ── Helpers ────────────────────────────────────────────────

function round(value, decimals = 0) {
  if (!Number.isFinite(value)) return 0;
  const f = Math.pow(10, decimals);
  return Math.round(value * f) / f;
}

// ── Tier-A: build an EligibilityInput from a quote result ─────────────
//
// Same shape as customs-quote.buildTierAInput (PR #89) and
// finance-quote.buildTierAInput (PR #99). Every sourcing function
// returns { ok, inputs: { productCategory, ... }, asOf, ... }.
// productCategory becomes the coverageInput axis.
//
// PR #139 added the primary-source path. When recommendCountryAsync
// successfully reached UN Comtrade for a quote, the result carries a
// tradeFlowMeta field; we emit that as a primary_regulator snapshot
// and DROP the rate-card mirror (PR #132 customs pattern). When the
// sync path ran (or async fell back to the rate card), we still emit
// the mirror snapshot honestly so TA-2 fails with NON_PRIMARY_SOURCE
// rather than an empty-snapshots failure.

/**
 * @param {object} quoteResult
 */
function buildTierAInput(quoteResult) {
  if (!quoteResult || quoteResult.ok !== true) {
    return {
      calculatorName: TIER_A_COVERAGE.calculatorName,
      snapshots: [],
      escalations: [],
      overrides: [],
      coverageInput: {},
      calculatorCoverage: TIER_A_COVERAGE,
    };
  }

  const snapshots = [];

  // tradeFlowMeta — if recommendCountryAsync ran and Comtrade
  // returned data, the recommendation drew on the primary-regulator
  // trade-flow snapshot. This is the only path to TA-2 passing today
  // (per PR #139). When present, the rate-card mirror is dropped —
  // claiming the mirror is "part of the input" alongside the primary
  // would be misleading per the PR #132 customs precedent.
  const flow = quoteResult.tradeFlowMeta;
  const hasPrimary = Boolean(flow && flow.asOf && flow.source === 'un-comtrade');
  if (hasPrimary) {
    snapshots.push({
      id: `comtrade-flow:${flow.hs}@${flow.period}`,
      source_kind: 'primary_regulator',
      as_of_iso: toIsoSafe(flow.asOf),
    });
  } else {
    // Sync path (or async fell back to the rate card): honest mirror
    // declaration. TA-2 will fail on this snapshot with the correct
    // NON_PRIMARY_SOURCE reason.
    snapshots.push({
      id: `sourcing-quote:pricing@${PRICING_SNAPSHOT.asOf}`,
      source_kind: 'mirror',
      as_of_iso: toIsoStartOfDay(PRICING_SNAPSHOT.asOf),
    });
  }

  const productCategory = (quoteResult.inputs && quoteResult.inputs.productCategory) || null;

  return {
    calculatorName: TIER_A_COVERAGE.calculatorName,
    snapshots,
    escalations: [],
    overrides: [],
    coverageInput: { productCategory },
    calculatorCoverage: TIER_A_COVERAGE,
  };
}

// ── recommendCountryAsync — Comtrade-backed primary-source path ───────
//
// Mirror of customs-quote.calculateQuoteAsync. Falls back to the sync
// recommendCountry when Comtrade is unavailable, opted-out via
// opts.useComtrade=false, or no HS code is supplied (rate-card path
// stays operational for category-only queries).
//
// The trade-flow data doesn't currently change the ranking — the
// existing static comparison still selects the recommendation. What
// it changes is the AUDIT POSTURE: a Comtrade-backed recommendation
// cites a primary regulator, satisfying TA-2.
//
// A future PR can incorporate the Comtrade top-exporters list into
// the comparison itself (e.g. filter out countries with zero actual
// EU exports for the HS code), at which point the trade-flow data
// becomes operational as well as audit-bearing.
async function recommendCountryAsync(input, opts = {}) {
  const sync = recommendCountry(input);
  if (!sync.ok) return sync;

  const wantComtrade = opts.useComtrade !== false && input && input.hsCode;
  if (!wantComtrade) return sync;

  const comtrade = require('./comtrade-client');
  // Period MUST be supplied by the caller — the calculator stays
  // deterministic (lib/intelligence/*-quote.js are forbidden from
  // reading the clock; see test/calculator-determinism.test.js).
  // The caller (start.js or test code, both allowed to read
  // process-local time) derives "last full calendar year" and passes
  // it in. Comtrade typically lags partial-year data by 1-3 months,
  // so callers should supply `String(currentYear - 1)`.
  const period = opts.period;
  if (!period) return sync;

  let flow = null;
  try {
    flow = await comtrade.lookupTopExporters(input.hsCode, period, {
      skipUpstream: opts.skipUpstream === true,
    });
  } catch (_) {
    flow = null;
  }

  if (!flow || !flow.reporters || flow.reporters.length === 0) {
    return sync;
  }

  return {
    ...sync,
    tradeFlowMeta: {
      hs: flow.hs,
      period: flow.period,
      asOf: flow.asOf,
      source: flow.source,
      fromCache: flow.fromCache === true,
      stale: flow.stale === true,
      topExporterCount: flow.reporters.length,
      verifyUrl: comtrade.comtradeVerifyUrl(input.hsCode, period),
    },
  };
}

// Same shape as customs-quote.js / finance-quote.js — tolerate
// both PRICING_SNAPSHOT.asOf forms ('YYYY-MM-DD' + full ISO string).
function toIsoStartOfDay(ymd) {
  if (typeof ymd !== 'string') return new Date(0).toISOString();
  if (/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return `${ymd}T00:00:00.000Z`;
  return toIsoSafe(ymd);
}
function toIsoSafe(maybeIso) {
  if (typeof maybeIso !== 'string') return new Date(0).toISOString();
  const t = Date.parse(maybeIso);
  return Number.isFinite(t) ? new Date(t).toISOString() : new Date(0).toISOString();
}

module.exports = {
  PRICING_SNAPSHOT,
  TIER_A_COVERAGE,
  buildTierAInput,
  COUNTRIES,
  CATEGORIES,
  SAMPLE_SUPPLIERS,
  listCategories,
  listCountries,
  getCountryNotes,
  validateInput,
  compareCountries,
  assessRisk,
  estimateLeadTime,
  shortlistSuppliers,
  recommendCountry,
  recommendCountryAsync,
};
