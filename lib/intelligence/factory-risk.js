const {
  COUNTRY_CITIES,
  cleanString,
  getCategoryKeywords,
  isCategoryCompatible,
  isCbamCategoryText,
  isEudrCategoryText,
  isKnownCountry,
  isKnownFactoryCategory,
  normaliseCountry,
  normaliseFactoryCategory,
  pickCategorySpeciality,
} = require('./catalog');

const SCORE_PROFILES = {
  any: [
    { financialScore: 91, complianceScore: 88, capacityScore: 85, auditScore: 87 },
    { financialScore: 84, complianceScore: 81, capacityScore: 78, auditScore: 80 },
    { financialScore: 76, complianceScore: 73, capacityScore: 74, auditScore: 72 },
    { financialScore: 66, complianceScore: 64, capacityScore: 67, auditScore: 63 },
    { financialScore: 56, complianceScore: 55, capacityScore: 58, auditScore: 54 },
    { financialScore: 43, complianceScore: 41, capacityScore: 46, auditScore: 42 },
  ],
  low: [
    { financialScore: 94, complianceScore: 92, capacityScore: 88, auditScore: 90 },
    { financialScore: 90, complianceScore: 87, capacityScore: 84, auditScore: 88 },
    { financialScore: 86, complianceScore: 83, capacityScore: 82, auditScore: 84 },
    { financialScore: 82, complianceScore: 80, capacityScore: 78, auditScore: 79 },
    { financialScore: 78, complianceScore: 76, capacityScore: 77, auditScore: 74 },
    { financialScore: 74, complianceScore: 72, capacityScore: 73, auditScore: 71 },
  ],
  medium: [
    { financialScore: 69, complianceScore: 67, capacityScore: 66, auditScore: 65 },
    { financialScore: 66, complianceScore: 63, capacityScore: 64, auditScore: 62 },
    { financialScore: 63, complianceScore: 60, capacityScore: 61, auditScore: 59 },
    { financialScore: 60, complianceScore: 58, capacityScore: 57, auditScore: 56 },
    { financialScore: 56, complianceScore: 54, capacityScore: 55, auditScore: 53 },
    { financialScore: 53, complianceScore: 51, capacityScore: 52, auditScore: 50 },
  ],
  high: [
    { financialScore: 48, complianceScore: 46, capacityScore: 44, auditScore: 42 },
    { financialScore: 45, complianceScore: 43, capacityScore: 41, auditScore: 40 },
    { financialScore: 42, complianceScore: 39, capacityScore: 38, auditScore: 37 },
    { financialScore: 38, complianceScore: 36, capacityScore: 35, auditScore: 34 },
    { financialScore: 34, complianceScore: 33, capacityScore: 31, auditScore: 30 },
    { financialScore: 31, complianceScore: 29, capacityScore: 28, auditScore: 27 },
  ],
};

const FACTORY_SUFFIXES = [
  'Manufacturing Co.',
  'Industrial Ltd.',
  'Precision Industries',
  'Export Group',
  'Production Works',
  'Supply Systems',
];

const EMPLOYEE_RANGES = ['100-300', '250-500', '500-1000', '1000-3000', '3000-5000'];
const GENERIC_FACTORY_SEARCH_TERMS = new Set([
  'any',
  'best',
  'check',
  'factories',
  'factory',
  'find',
  'for',
  'from',
  'in',
  'looking',
  'lookup',
  'manufacturer',
  'manufacturers',
  'score',
  'search',
  'show',
  'source',
  'supplier',
  'suppliers',
  'top',
  'verified',
]);
const CORPORATE_NAME_HINT_RE = /\b(co\.?|company|ltd\.?|limited|inc\.?|corp\.?|corporation|industries|industrial|manufacturing|mfg|factory|supplier|group|works|systems|technology|tech|trading|export|packaging|textiles|plastics|metals?|electronics|furniture)\b/i;

function normaliseRiskTolerance(riskTolerance) {
  const value = cleanString(riskTolerance).toLowerCase();
  if (value.includes('low risk')) return 'low';
  if (value.includes('medium risk')) return 'medium';
  if (value.includes('high risk')) return 'high';
  return 'any';
}

function normalizeFactorySearch(input = {}) {
  const rawCountry = cleanString(input.country);
  const rawCategory = cleanString(input.category);

  const countryConstraint = isKnownCountry(rawCountry) ? rawCountry : null;
  const categoryConstraint = isKnownFactoryCategory(rawCategory) && rawCategory !== 'Other' ? rawCategory : null;

  return {
    query: cleanString(input.query),
    country: countryConstraint || normaliseCountry(rawCountry, 'China'),
    countryConstraint,
    category: categoryConstraint || normaliseFactoryCategory(rawCategory, 'Other'),
    categoryConstraint,
    riskTolerance: normaliseRiskTolerance(input.riskTolerance),
  };
}

function calculateRiskScore(factory) {
  return Math.round(
    (Number(factory.financialScore || 0) * 0.3) +
    (Number(factory.complianceScore || 0) * 0.25) +
    (Number(factory.capacityScore || 0) * 0.25) +
    (Number(factory.auditScore || 0) * 0.2)
  );
}

function riskToleranceMatches(score, riskTolerance) {
  if (riskTolerance === 'low') return score >= 70;
  if (riskTolerance === 'medium') return score >= 50 && score <= 70;
  if (riskTolerance === 'high') return score < 50;
  return true;
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function tokenizeFactoryText(text) {
  return cleanString(text).toLowerCase().match(/[a-z0-9&.'-]+/g) || [];
}

function stripTrailingLocationQualifier(query, filters) {
  let text = cleanString(query).replace(/\s+/g, ' ');
  if (!text) return '';

  const candidateCountries = Array.from(new Set([
    filters.countryConstraint,
    filters.country,
    ...Object.keys(COUNTRY_CITIES),
  ].filter(Boolean))).sort((left, right) => right.length - left.length);

  candidateCountries.forEach((country) => {
    text = text.replace(new RegExp(`\\s+(?:in|from)\\s+${escapeRegex(country)}$`, 'i'), '');
  });

  return text.replace(/\s*[,;:-]\s*$/, '').trim();
}

function extractRequestedFactoryName(query, filters) {
  let text = stripTrailingLocationQualifier(query, filters);
  if (!text) return '';

  text = text.replace(/^(?:find|score|search(?:\s+for)?|check|show|lookup)\s+/i, '').trim();
  return text;
}

function looksLikeSpecificFactoryName(query, filters) {
  const text = extractRequestedFactoryName(query, filters);
  if (!text) return false;

  const lower = text.toLowerCase();
  if (/^(manufacturer|supplier|factory)(\s+search)?$/i.test(text)) {
    return false;
  }
  if (/\b(manufacturers|suppliers|factories)\b/i.test(lower)) {
    return false;
  }

  const tokens = tokenizeFactoryText(text);
  if (tokens.length < 2 || tokens.length > 10) {
    return false;
  }

  const categoryKeywords = new Set(
    getCategoryKeywords(filters.categoryConstraint || filters.category)
      .map(keyword => keyword.toLowerCase())
  );
  const nonGenericTokens = tokens.filter(token => (
    !GENERIC_FACTORY_SEARCH_TERMS.has(token) &&
    !categoryKeywords.has(token) &&
    token.length > 1
  ));
  const hasCorporateHint = CORPORATE_NAME_HINT_RE.test(text) || /[.,&]/.test(text);
  const hasCaseSignal = text.split(/\s+/).filter(token => /^[A-Z0-9][A-Za-z0-9&.,'-]*$/.test(token)).length >= 2;

  if (hasCorporateHint && nonGenericTokens.length >= 2) {
    return true;
  }
  if (hasCorporateHint && nonGenericTokens.length >= 1 && hasCaseSignal) {
    return true;
  }
  if (nonGenericTokens.length >= 2 && !filters.categoryConstraint) {
    return true;
  }
  if (nonGenericTokens.length >= 2 && !isCategoryCompatible(text, filters.categoryConstraint || filters.category)) {
    return true;
  }

  return false;
}

function titleCase(text) {
  return cleanString(text)
    .split(/\s+/)
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

function formatFactoryName(name, city, suffix) {
  const cleaned = cleanString(name);
  if (!cleaned) return `${city} ${suffix}`;
  if (/(co\.|ltd\.|limited|industries|manufacturing|factory|supplier|group|works|systems)$/i.test(cleaned)) return cleaned;
  return `${titleCase(cleaned)} ${suffix}`;
}

function buildFactoryName(filters, city, speciality, index) {
  const suffix = FACTORY_SUFFIXES[index % FACTORY_SUFFIXES.length];
  const requestedFactoryName = extractRequestedFactoryName(filters.query, filters);
  if (index === 0 && requestedFactoryName && looksLikeSpecificFactoryName(filters.query, filters)) {
    return formatFactoryName(requestedFactoryName, city, suffix);
  }

  const stem = titleCase(speciality.replace(/&/g, 'and'));
  return `${city} ${stem} ${suffix}`;
}

function buildFindings(riskScore, complianceScore, capacityScore, auditScore, speciality) {
  const findings = [];

  if (riskScore >= 75) {
    findings.push({ text: `Stable operating profile across ${speciality} programmes.`, severity: 'green' });
  } else if (riskScore >= 55) {
    findings.push({ text: `Moderate delivery and operating risk detected in the current ${speciality} pipeline.`, severity: 'amber' });
  } else {
    findings.push({ text: `Elevated operational and financial risk detected for current ${speciality} output.`, severity: 'red' });
  }

  if (complianceScore >= 75) {
    findings.push({ text: 'Recent compliance documentation is broadly complete.', severity: 'green' });
  } else if (complianceScore >= 55) {
    findings.push({ text: 'Compliance documents require refresh before onboarding.', severity: 'amber' });
  } else {
    findings.push({ text: 'Compliance evidence is incomplete and requires urgent remediation.', severity: 'red' });
  }

  if (capacityScore >= 75) {
    findings.push({ text: 'Capacity headroom appears sufficient for incremental volume.', severity: 'green' });
  } else if (capacityScore >= 55) {
    findings.push({ text: 'Capacity is manageable but should be checked before peak-season bookings.', severity: 'amber' });
  } else {
    findings.push({ text: 'Capacity pressure is likely to affect lead times.', severity: 'red' });
  }

  if (auditScore < 60) {
    findings.push({ text: 'Audit trail is stale and needs a new third-party review.', severity: 'red' });
  }

  return findings.slice(0, 4);
}

function buildRequiredActions(riskScore, complianceScore, auditScore) {
  const actions = [];

  if (complianceScore < 75) {
    actions.push('Request the latest compliance pack and verify scope against the product category.');
  }
  if (auditScore < 75) {
    actions.push('Schedule or refresh an independent factory audit before production award.');
  }
  if (riskScore < 60) {
    actions.push('Limit initial order exposure until the supplier clears remediation milestones.');
  }

  return actions;
}

function clampScore(value, fallback) {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(100, number));
}

function scoreToComplianceStatus(score) {
  if (score >= 80) return 'Verified';
  if (score >= 60) return 'Pending';
  return 'At Risk';
}

function scoreToCapacityStatus(score) {
  if (score >= 80) return 'Full';
  if (score >= 60) return 'Partial';
  return 'Low';
}

function scoreToAuditStatus(score) {
  if (score >= 80) return 'Passed';
  if (score >= 60) return 'Due';
  return 'Overdue';
}

function scoreToPartnerStatus(score) {
  if (score >= 80) return 'Verified Partner';
  if (score >= 60) return 'Under Review';
  return 'Flagged';
}

function regulationStatusForCategory(categoryText, complianceScore, riskScore) {
  const eudrApplies = isEudrCategoryText(categoryText);
  const cbamApplies = isCbamCategoryText(categoryText);

  return {
    eudr: {
      status: eudrApplies ? (complianceScore >= 75 ? 'Compliant' : 'At Risk') : 'N/A',
      reason: eudrApplies ? 'Category intersects EUDR-covered goods and requires due diligence checks.' : 'Category does not clearly fall within EUDR-covered goods.',
    },
    cbam: {
      status: cbamApplies ? (complianceScore >= 75 ? 'Compliant' : 'At Risk') : 'N/A',
      reason: cbamApplies ? 'Category intersects CBAM-covered sectors and requires emissions reporting controls.' : 'Category does not clearly fall within CBAM Annex I sectors.',
    },
    csddd: {
      status: riskScore >= 70 ? 'Compliant' : 'At Risk',
      reason: riskScore >= 70 ? 'Current risk profile is consistent with standard supplier due diligence.' : 'Operational and audit signals indicate enhanced due diligence is needed.',
    },
  };
}

function buildFallbackFactory(filters, index) {
  const profile = SCORE_PROFILES[filters.riskTolerance][index % SCORE_PROFILES[filters.riskTolerance].length];
  const cityPool = COUNTRY_CITIES[filters.country] || COUNTRY_CITIES.China;
  const city = cityPool[index % cityPool.length];
  const speciality = pickCategorySpeciality(filters.category, index);

  const financialScore = profile.financialScore;
  const complianceScore = profile.complianceScore;
  const capacityScore = profile.capacityScore;
  const auditScore = profile.auditScore;
  const riskScore = calculateRiskScore(profile);
  const regulation = regulationStatusForCategory(`${filters.category} ${speciality}`, complianceScore, riskScore);

  return {
    id: `f_${filters.country.replace(/\s+/g, '').toLowerCase()}_${String(index + 1).padStart(4, '0')}`,
    name: buildFactoryName(filters, city, speciality, index),
    city,
    country: filters.country,
    speciality,
    riskScore,
    financialScore,
    complianceScore,
    capacityScore,
    auditScore,
    complianceStatus: scoreToComplianceStatus(complianceScore),
    capacityStatus: scoreToCapacityStatus(capacityScore),
    auditStatus: scoreToAuditStatus(auditScore),
    established: 2006 + ((index * 3) % 16),
    employees: EMPLOYEE_RANGES[index % EMPLOYEE_RANGES.length],
    exportMarkets: ['EU', 'UK', 'US'].slice(0, 2 + (index % 2)),
    certifications: complianceScore >= 80 ? ['ISO 9001', 'ISO 14001'] : ['ISO 9001'],
    moq: `${1000 + (index * 1500)} units`,
    leadTime: `${22 + index * 4}-${30 + index * 4} days`,
    paymentTerms: index % 2 === 0 ? ['T/T', 'L/C'] : ['T/T'],
    orcatradeStatus: scoreToPartnerStatus(riskScore),
    findings: buildFindings(riskScore, complianceScore, capacityScore, auditScore, speciality),
    requiredActions: buildRequiredActions(riskScore, complianceScore, auditScore),
    eudr: regulation.eudr,
    cbam: regulation.cbam,
    csddd: regulation.csddd,
  };
}

function sanitiseStringArray(value, fallback) {
  if (!Array.isArray(value)) return fallback;
  const cleaned = value.map(item => cleanString(item)).filter(Boolean);
  return cleaned.length ? cleaned : fallback;
}

function normaliseComparableFactoryName(name) {
  return cleanString(name)
    .toLowerCase()
    .replace(/\b(co\.?|company|ltd\.?|limited|inc\.?|corp\.?|corporation|industries|industrial|manufacturing|mfg|factory|supplier|group|works|systems|technology|tech|trading|export)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function candidateMatchesRequestedFactory(candidateName, requestedFactoryName) {
  const candidate = normaliseComparableFactoryName(candidateName);
  const requested = normaliseComparableFactoryName(requestedFactoryName);

  if (!candidate || !requested) return false;
  if (candidate === requested || candidate.includes(requested) || requested.includes(candidate)) {
    return true;
  }

  const candidateTokens = new Set(candidate.split(' ').filter(Boolean));
  const requestedTokens = requested.split(' ').filter(Boolean);
  const overlap = requestedTokens.filter(token => candidateTokens.has(token)).length;
  return overlap >= Math.max(2, Math.ceil(requestedTokens.length * 0.6));
}

function sanitiseFactory(candidate, fallback, filters, index) {
  const factory = candidate && typeof candidate === 'object' ? candidate : {};
  const cityPool = COUNTRY_CITIES[filters.country] || COUNTRY_CITIES.China;
  const city = cityPool.includes(cleanString(factory.city)) ? cleanString(factory.city) : fallback.city;
  const requestedFactoryName = extractRequestedFactoryName(filters.query, filters);
  const exactFactorySearch = requestedFactoryName && looksLikeSpecificFactoryName(filters.query, filters);

  let speciality = cleanString(factory.speciality);
  if (filters.categoryConstraint && !isCategoryCompatible(speciality, filters.categoryConstraint)) {
    speciality = fallback.speciality;
  } else if (!speciality) {
    speciality = fallback.speciality;
  }

  let financialScore = clampScore(factory.financialScore, fallback.financialScore);
  let complianceScore = clampScore(factory.complianceScore, fallback.complianceScore);
  let capacityScore = clampScore(factory.capacityScore, fallback.capacityScore);
  let auditScore = clampScore(factory.auditScore, fallback.auditScore);
  let riskScore = calculateRiskScore({ financialScore, complianceScore, capacityScore, auditScore });

  if (!riskToleranceMatches(riskScore, filters.riskTolerance)) {
    financialScore = fallback.financialScore;
    complianceScore = fallback.complianceScore;
    capacityScore = fallback.capacityScore;
    auditScore = fallback.auditScore;
    riskScore = fallback.riskScore;
  }

  const regulation = regulationStatusForCategory(`${filters.category} ${speciality}`, complianceScore, riskScore);
  let name = cleanString(factory.name) || fallback.name;
  if (index === 0 && exactFactorySearch && !candidateMatchesRequestedFactory(name, requestedFactoryName)) {
    name = formatFactoryName(requestedFactoryName, city, FACTORY_SUFFIXES[index % FACTORY_SUFFIXES.length]);
  }

  return {
    id: cleanString(factory.id) || fallback.id || `f_result_${index + 1}`,
    name,
    city,
    country: filters.countryConstraint || filters.country,
    speciality,
    riskScore,
    financialScore,
    complianceScore,
    capacityScore,
    auditScore,
    complianceStatus: scoreToComplianceStatus(complianceScore),
    capacityStatus: scoreToCapacityStatus(capacityScore),
    auditStatus: scoreToAuditStatus(auditScore),
    established: Number.isFinite(Number(factory.established)) ? Math.max(1990, Math.min(2025, Math.round(Number(factory.established)))) : fallback.established,
    employees: cleanString(factory.employees) || fallback.employees,
    exportMarkets: sanitiseStringArray(factory.exportMarkets, fallback.exportMarkets),
    certifications: sanitiseStringArray(factory.certifications, fallback.certifications),
    moq: cleanString(factory.moq) || fallback.moq,
    leadTime: cleanString(factory.leadTime) || fallback.leadTime,
    paymentTerms: sanitiseStringArray(factory.paymentTerms, fallback.paymentTerms),
    orcatradeStatus: scoreToPartnerStatus(riskScore),
    findings: Array.isArray(factory.findings) && factory.findings.length
      ? factory.findings
          .map(item => ({
            text: cleanString(item && item.text) || null,
            severity: ['green', 'amber', 'red'].includes(cleanString(item && item.severity)) ? cleanString(item.severity) : 'amber',
          }))
          .filter(item => item.text)
          .slice(0, 4)
      : fallback.findings,
    requiredActions: buildRequiredActions(riskScore, complianceScore, auditScore),
    eudr: regulation.eudr,
    cbam: regulation.cbam,
    csddd: regulation.csddd,
  };
}

function sanitizeFactoryResults(raw, input = {}) {
  const filters = normalizeFactorySearch(input);
  const fallbackFactories = Array.from({ length: 6 }, (_, index) => buildFallbackFactory(filters, index));
  const candidates = raw && Array.isArray(raw.factories) ? raw.factories : [];
  const usedNames = new Set();

  const factories = fallbackFactories.map((fallback, index) => {
    let factory = sanitiseFactory(candidates[index], fallback, filters, index);

    if (usedNames.has(factory.name.toLowerCase())) {
      factory = { ...fallback, id: `${fallback.id}_${index + 1}` };
    }
    usedNames.add(factory.name.toLowerCase());
    return factory;
  });

  return { factories };
}

module.exports = {
  SCORE_PROFILES,
  calculateRiskScore,
  normalizeFactorySearch,
  riskToleranceMatches,
  sanitizeFactoryResults,
};
