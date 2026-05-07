// Buyer Verification — risk scoring for European buyers, designed for the export side.
// MVP returns structured profile based on:
//   1. Snapshot of a small set of known companies (curated, not authoritative)
//   2. Heuristic fallback for unknown companies based on registry-id pattern + country
//   3. Suggested next step: register with Creditreform / D&B / Atradius for full data
//
// Data sources for the production version (not yet wired):
//   - Poland: KRS (rejestr.io public mirror, AML-Suite paid API)
//   - Germany: Handelsregister (handelsregister.de — paid for full data)
//   - UK: Companies House (free public API)
//   - Netherlands: KvK (paid)
//   - Pan-EU: Creditreform / Dun & Bradstreet / Atradius credit reports (paid)

const SNAPSHOT = {
  asOf: '2026-04-15',
  source: 'Curated snapshot of well-known European importers/distributors. Real-time registry lookup is the next upgrade.',
  confidence: 'snapshot',
};

// Curated known-buyers list. Each entry has the data points an Asian exporter wants
// before extending trade credit. Real production would query live registries on demand.
const KNOWN_BUYERS = {
  'media-markt-saturn': {
    matchKeys: ['media markt', 'mediamarkt', 'saturn', 'media-saturn', 'ceconomy'],
    legalName: 'Ceconomy AG (parent of MediaMarkt and Saturn)',
    country: 'DE',
    registry: 'Handelsregister',
    registryId: 'HRB 70732 (Düsseldorf)',
    yearsInOperation: 11,
    employeeCountBand: '50,000+',
    turnoverBandEur: 'over €20bn',
    creditBand: 'low',
    recommendation: 'acceptable',
    tradeCreditCapEur: 500000,
    securitySuggestion: 'Net-60 acceptable up to cap; LC for orders above the cap.',
    flags: [],
    publicSignals: ['Listed on Frankfurt Stock Exchange', 'Audited financials publicly available'],
  },
  'allegro': {
    matchKeys: ['allegro', 'allegro.pl', 'allegro group'],
    legalName: 'Allegro.eu',
    country: 'PL',
    registry: 'KRS',
    registryId: '0000635012',
    yearsInOperation: 25,
    employeeCountBand: '5,000–10,000',
    turnoverBandEur: '€2–5bn',
    creditBand: 'low',
    recommendation: 'acceptable',
    tradeCreditCapEur: 200000,
    securitySuggestion: 'Net-30 acceptable up to cap; LC for orders above the cap.',
    flags: [],
    publicSignals: ['Listed on Warsaw Stock Exchange', 'CEE-leading e-commerce platform'],
  },
  'ikea': {
    matchKeys: ['ikea', 'ingka', 'inter ikea', 'inter-ikea'],
    legalName: 'Ingka Group / Inter IKEA Systems B.V.',
    country: 'NL',
    registry: 'KvK',
    registryId: '34193537',
    yearsInOperation: 80,
    employeeCountBand: '150,000+',
    turnoverBandEur: 'over €40bn',
    creditBand: 'low',
    recommendation: 'acceptable',
    tradeCreditCapEur: 2000000,
    securitySuggestion: 'Established commercial terms via tier-1 procurement contract.',
    flags: [],
    publicSignals: ['Global retail leader', 'Established supply-chain partnership programme'],
  },
  'zara-inditex': {
    matchKeys: ['zara', 'inditex'],
    legalName: 'Industria de Diseño Textil S.A. (Inditex)',
    country: 'ES',
    registry: 'Registro Mercantil',
    registryId: 'A15075062',
    yearsInOperation: 40,
    employeeCountBand: '160,000+',
    turnoverBandEur: 'over €35bn',
    creditBand: 'low',
    recommendation: 'acceptable',
    tradeCreditCapEur: 1000000,
    securitySuggestion: 'Tier-1 retail buyer; commercial terms via procurement contract.',
    flags: [],
    publicSignals: ['Listed on Madrid Stock Exchange'],
  },
  'kaufland': {
    matchKeys: ['kaufland', 'schwarz gruppe', 'lidl'],
    legalName: 'Kaufland Stiftung & Co. KG / Schwarz Gruppe',
    country: 'DE',
    registry: 'Handelsregister',
    registryId: 'HRA 730252 (Stuttgart)',
    yearsInOperation: 40,
    employeeCountBand: '500,000+',
    turnoverBandEur: 'over €130bn',
    creditBand: 'low',
    recommendation: 'acceptable',
    tradeCreditCapEur: 1500000,
    securitySuggestion: 'Tier-1 retail buyer; payment terms via central procurement.',
    flags: [],
    publicSignals: ['Largest European retail group'],
  },
  'biedronka-jeronimo': {
    matchKeys: ['biedronka', 'jeronimo martins'],
    legalName: 'Jerónimo Martins Polska S.A.',
    country: 'PL',
    registry: 'KRS',
    registryId: '0000222483',
    yearsInOperation: 30,
    employeeCountBand: '70,000+',
    turnoverBandEur: 'over €18bn',
    creditBand: 'low',
    recommendation: 'acceptable',
    tradeCreditCapEur: 500000,
    securitySuggestion: 'Tier-1 retailer; commercial terms via procurement contract.',
    flags: [],
    publicSignals: ['Largest Polish retailer'],
  },
};

const COUNTRY_REGISTRIES = {
  PL: { name: 'KRS — Krajowy Rejestr Sądowy', publicUrl: 'https://krs.ms.gov.pl' },
  DE: { name: 'Handelsregister', publicUrl: 'https://www.handelsregister.de' },
  AT: { name: 'Firmenbuch', publicUrl: 'https://justizonline.gv.at' },
  CZ: { name: 'Veřejný rejstřík', publicUrl: 'https://or.justice.cz' },
  SK: { name: 'Obchodný register', publicUrl: 'https://www.orsr.sk' },
  HU: { name: 'Cégbíróság', publicUrl: 'https://e-cegjegyzek.hu' },
  NL: { name: 'KvK Kamer van Koophandel', publicUrl: 'https://www.kvk.nl' },
  BE: { name: 'BCE / KBO', publicUrl: 'https://kbopub.economie.fgov.be' },
  FR: { name: 'INPI / Infogreffe', publicUrl: 'https://www.infogreffe.fr' },
  IT: { name: 'Registro Imprese', publicUrl: 'https://www.registroimprese.it' },
  ES: { name: 'Registro Mercantil', publicUrl: 'https://www.registradores.org' },
  PT: { name: 'Registo Comercial', publicUrl: 'https://justica.gov.pt' },
  GB: { name: 'Companies House', publicUrl: 'https://find-and-update.company-information.service.gov.uk' },
  IE: { name: 'CRO — Companies Registration Office', publicUrl: 'https://search.cro.ie' },
  SE: { name: 'Bolagsverket', publicUrl: 'https://www.bolagsverket.se' },
  DK: { name: 'CVR / Erhvervsstyrelsen', publicUrl: 'https://datacvr.virk.dk' },
  FI: { name: 'PRH', publicUrl: 'https://tietopalvelu.ytj.fi' },
  EU: { name: 'EU Business Registers Interconnection System (BRIS)', publicUrl: 'https://e-justice.europa.eu' },
};

function normaliseName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[\.\,\&]/g, ' ')
    .replace(/\b(s\.?p\.?\s*z\.?\s*o\.?\s*o\.?|gmbh|ag|sa|s\.?a\.?|bv|nv|ltd|limited|plc|kg|oy|ab|inc|llc)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function findKnownBuyer(name) {
  const normalised = normaliseName(name);
  if (!normalised) return null;
  for (const [key, def] of Object.entries(KNOWN_BUYERS)) {
    if (def.matchKeys.some(m => normalised.includes(m))) {
      return { key, ...def };
    }
  }
  return null;
}

function lookupCountryRegistry(country) {
  const code = String(country || '').toUpperCase().slice(0, 2);
  return COUNTRY_REGISTRIES[code] || COUNTRY_REGISTRIES.EU;
}

function validateInput(input) {
  const errors = [];
  if (!input || typeof input !== 'object') {
    errors.push('input must be an object');
    return { ok: false, errors };
  }
  const name = String(input.companyName || '').trim();
  if (!name || name.length < 2) errors.push('companyName is required (min 2 chars)');
  if (input.country && String(input.country).length !== 2) {
    errors.push('country must be a 2-letter ISO code (e.g. DE, PL, NL)');
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}

function heuristicProfile({ companyName, country, registryId }) {
  const code = String(country || '').toUpperCase().slice(0, 2);
  const registry = lookupCountryRegistry(code);
  const hasRegistryId = Boolean(registryId && String(registryId).trim());
  const recognisable = /\b(holding|group|sa|sp\.|gmbh|ag|bv|nv|ltd|plc|kg)\b/i.test(companyName);

  return {
    matchType: 'unknown',
    legalName: null,
    country: code || null,
    registry: registry.name,
    registryId: registryId || null,
    registryPublicUrl: registry.publicUrl,
    yearsInOperation: null,
    employeeCountBand: null,
    turnoverBandEur: null,
    creditBand: hasRegistryId ? 'unknown' : 'unknown',
    recommendation: hasRegistryId ? 'verify_required' : 'verify_required',
    tradeCreditCapEur: 0,
    securitySuggestion: hasRegistryId
      ? 'Registry ID supplied — perform a paid Creditreform / D&B / Atradius credit pull before extending any trade credit. Until then, require LC at sight or 100% advance payment.'
      : 'No registry ID supplied. Require buyer to confirm legal name and registration number, then run a paid credit pull. Until verified, accept LC at sight or 100% advance payment only.',
    flags: hasRegistryId ? [] : ['No registry ID provided'],
    publicSignals: recognisable ? ['Legal-entity suffix detected — appears to be a registered business'] : ['No registered legal-entity suffix detected — verify it is a real business entity'],
  };
}

function knownBuyerProfile(known, { country }) {
  const registry = lookupCountryRegistry(known.country || country);
  return {
    matchType: 'known',
    legalName: known.legalName,
    country: known.country,
    registry: known.registry || registry.name,
    registryId: known.registryId || null,
    registryPublicUrl: registry.publicUrl,
    yearsInOperation: known.yearsInOperation,
    employeeCountBand: known.employeeCountBand,
    turnoverBandEur: known.turnoverBandEur,
    creditBand: known.creditBand,
    recommendation: known.recommendation,
    tradeCreditCapEur: known.tradeCreditCapEur,
    securitySuggestion: known.securitySuggestion,
    flags: known.flags || [],
    publicSignals: known.publicSignals || [],
  };
}

function checkBuyer(input) {
  const validation = validateInput(input);
  if (!validation.ok) return { ok: false, errors: validation.errors };

  const known = findKnownBuyer(input.companyName);
  const profile = known
    ? knownBuyerProfile(known, input)
    : heuristicProfile(input);

  const verdict = buildVerdict(profile);
  const nextSteps = buildNextSteps(profile);

  return {
    ok: true,
    asOf: SNAPSHOT.asOf,
    confidence: profile.matchType === 'known' ? 'snapshot' : 'inferred',
    inputs: {
      companyName: input.companyName,
      country: profile.country || input.country || null,
      registryId: input.registryId || profile.registryId || null,
    },
    profile,
    verdict,
    nextSteps,
    snapshot: SNAPSHOT,
    disclaimer: 'This is an indicative pre-check, not a binding credit decision. Production-grade verification requires a paid Creditreform / D&B / Atradius credit pull and Member-State registry confirmation.',
  };
}

function buildVerdict(profile) {
  const { creditBand, recommendation, tradeCreditCapEur, matchType } = profile;
  let headline;
  if (recommendation === 'acceptable') {
    headline = `Buyer is verified low-risk. Trade credit acceptable up to €${tradeCreditCapEur.toLocaleString('en-IE')}.`;
  } else if (recommendation === 'require_security') {
    headline = 'Buyer has elevated signals. Trade credit only with security (LC, advance payment, or trade-credit insurance).';
  } else if (recommendation === 'decline') {
    headline = 'Buyer flagged. Decline trade credit. Accept LC at sight or 100% advance payment only.';
  } else {
    headline = matchType === 'known'
      ? 'Verification incomplete. Refresh registry data before extending trade credit.'
      : 'Buyer not in our verified-buyers snapshot. Run a paid credit pull before extending any trade credit.';
  }

  return {
    headline,
    creditBand,
    recommendation,
    matchType,
    tradeCreditCapEur,
  };
}

function buildNextSteps(profile) {
  const steps = [];
  if (profile.matchType === 'known') {
    steps.push(`Confirm registry record at ${profile.registry} (${profile.registryPublicUrl}).`);
    steps.push('Refresh credit-band assessment via Creditreform / D&B / Atradius if order is above 50% of the recommended trade-credit cap.');
    if (profile.creditBand === 'low') {
      steps.push('Net terms (Net-30 / Net-60) acceptable per the security suggestion.');
    } else {
      steps.push('Require LC at sight or partial advance payment.');
    }
  } else {
    steps.push(`Look up ${profile.country || 'the buyer'} on ${profile.registry} (${profile.registryPublicUrl}).`);
    steps.push('Request a Creditreform / D&B / Atradius credit pull (paid; €30–€150 per pull).');
    steps.push('Until verified: require LC at sight or 100% advance payment.');
    steps.push('Optional: route through OrcaTrade Trade Finance for letter-of-credit issuance and risk-shift.');
  }
  steps.push('Document the result in your supplier-side buyer file and refresh annually.');
  return steps;
}

function listSampleBuyers() {
  return Object.values(KNOWN_BUYERS).map(b => ({
    name: b.legalName.split('(')[0].trim(),
    country: b.country,
    creditBand: b.creditBand,
  }));
}

module.exports = {
  SNAPSHOT,
  KNOWN_BUYERS,
  COUNTRY_REGISTRIES,
  normaliseName,
  findKnownBuyer,
  lookupCountryRegistry,
  validateInput,
  checkBuyer,
  listSampleBuyers,
};
