const { createCacheKey } = require('./cache-store');
const { cleanString } = require('./catalog');

const MAX_DOCUMENTS = 5;
const MAX_DOCUMENT_CHARS = 12000;

function hasValue(value) {
  return value === true || value === false || Boolean(cleanString(value));
}

function normalizeEvidenceDocuments(input) {
  const rawDocuments = Array.isArray(input)
    ? input
    : input && typeof input === 'object' && Array.isArray(input.documents)
      ? input.documents
      : [];

  return rawDocuments
    .slice(0, MAX_DOCUMENTS)
    .map((document, index) => {
      const source = document && typeof document === 'object' ? document : {};
      const text = cleanString(source.text || source.content || source.body).slice(0, MAX_DOCUMENT_CHARS);
      if (!text) return null;

      return {
        documentId: cleanString(source.documentId) || `doc-${index + 1}`,
        name: cleanString(source.name) || `Evidence document ${index + 1}`,
        type: cleanString(source.type) || 'text/plain',
        text,
      };
    })
    .filter(Boolean);
}

function validateEvidenceDocuments(input) {
  const documents = normalizeEvidenceDocuments(input);
  const errors = [];

  if (input !== undefined) {
    if (!Array.isArray(input)) {
      errors.push('Evidence documents must be provided as an array.');
    } else if (!input.length) {
      errors.push('At least one evidence document is required when evidenceDocuments is provided.');
    }
  }

  if (Array.isArray(input) && input.length > MAX_DOCUMENTS) {
    errors.push(`A maximum of ${MAX_DOCUMENTS} evidence documents can be processed at once.`);
  }

  if (Array.isArray(input)) {
    input.forEach((document, index) => {
      const source = document && typeof document === 'object' ? document : {};
      const text = cleanString(source.text || source.content || source.body);
      if (!text) {
        errors.push(`Evidence document ${index + 1} must include text content.`);
      } else if (text.length > MAX_DOCUMENT_CHARS) {
        errors.push(`Evidence document ${index + 1} exceeds the ${MAX_DOCUMENT_CHARS}-character processing limit.`);
      }
    });
  }

  return {
    ok: errors.length === 0,
    errors,
    documents,
  };
}

function buildEvidenceBundleId(documents, context = {}) {
  return createCacheKey({
    company: cleanString(context.company).toLowerCase(),
    email: cleanString(context.email).toLowerCase(),
    accountId: cleanString(context.accountId).toLowerCase(),
    documents: documents.map(document => ({
      name: document.name.toLowerCase(),
      type: document.type.toLowerCase(),
      text: document.text.toLowerCase(),
    })),
  });
}

function normalizeCommodityCode(raw) {
  const text = cleanString(raw);
  const digits = text.replace(/[^\d]/g, '');
  if (digits.length < 4 || digits.length > 10) return '';
  if (digits.length <= 4) return digits;

  const groups = [digits.slice(0, 4)];
  let cursor = 4;
  while (cursor < digits.length) {
    groups.push(digits.slice(cursor, cursor + 2));
    cursor += 2;
  }
  return groups.join('.');
}

function normalizeEmployeeCount(raw) {
  const digits = cleanString(raw).replace(/[^\d]/g, '');
  if (!digits) return '';
  return String(Number(digits));
}

function normalizeTurnover(raw) {
  return cleanString(raw).replace(/\s+/g, ' ');
}

function buildSnippet(text, index, matchText) {
  const safeIndex = Math.max(0, Number(index) || 0);
  const safeMatch = cleanString(matchText);
  const radius = 80;
  const start = Math.max(0, safeIndex - radius);
  const end = Math.min(text.length, safeIndex + Math.max(safeMatch.length, 1) + radius);
  return text.slice(start, end).replace(/\s+/g, ' ').trim();
}

function pushCandidate(store, field, candidate) {
  if (!candidate || candidate.value === undefined || candidate.value === null || !hasValue(candidate.value)) return;

  if (!store[field]) store[field] = [];
  store[field].push(candidate);
}

function findLabeledValue(documents, field, patterns, normalizer) {
  const candidates = {};

  documents.forEach(document => {
    patterns.forEach(pattern => {
      const match = document.text.match(pattern);
      if (!match || !match[1]) return;

      const rawValue = cleanString(match[1]);
      const normalizedValue = normalizer ? normalizer(rawValue) : rawValue;
      if (!cleanString(normalizedValue)) return;

      pushCandidate(candidates, field, {
        value: normalizedValue,
        confidence: 3,
        documentId: document.documentId,
        documentName: document.name,
        snippet: buildSnippet(document.text, match.index, match[0]),
        sourceType: 'labeled_match',
      });
    });
  });

  return candidates[field] || [];
}

function findBooleanSignal(documents, field, config) {
  const candidates = {};

  documents.forEach(document => {
    const negativeMatch = config.negative.find(pattern => document.text.match(pattern));
    if (negativeMatch) {
      const match = document.text.match(negativeMatch);
      pushCandidate(candidates, field, {
        value: false,
        confidence: 3,
        documentId: document.documentId,
        documentName: document.name,
        snippet: buildSnippet(document.text, match.index, match[0]),
        sourceType: 'boolean_negative',
      });
      return;
    }

    const positiveMatch = config.positive.find(pattern => document.text.match(pattern));
    if (positiveMatch) {
      const match = document.text.match(positiveMatch);
      pushCandidate(candidates, field, {
        value: true,
        confidence: 3,
        documentId: document.documentId,
        documentName: document.name,
        snippet: buildSnippet(document.text, match.index, match[0]),
        sourceType: 'boolean_positive',
      });
    }
  });

  return candidates[field] || [];
}

function pickBestCandidate(candidates) {
  if (!Array.isArray(candidates) || !candidates.length) return null;
  return candidates
    .slice()
    .sort((left, right) => {
      const confidenceDiff = (Number(right.confidence) || 0) - (Number(left.confidence) || 0);
      if (confidenceDiff !== 0) return confidenceDiff;
      return cleanString(left.documentId).localeCompare(cleanString(right.documentId));
    })[0];
}

function extractEvidenceFacts(documents) {
  const candidates = {
    cnCode: findLabeledValue(documents, 'cnCode', [
      /\b(?:CN|HS)(?:\s*\/\s*HS)?\s*(?:code|classification)?\s*[:#-]?\s*([0-9][0-9.\-\s]{3,15})\b/i,
      /\bcommodity code\s*[:#-]?\s*([0-9][0-9.\-\s]{3,15})\b/i,
    ], normalizeCommodityCode),
    employeeCount: findLabeledValue(documents, 'employeeCount', [
      /\b(?:employee count|employees|headcount)\s*[:#-]?\s*([0-9][0-9,.\s]{0,12})\b/i,
    ], normalizeEmployeeCount),
    globalTurnover: findLabeledValue(documents, 'globalTurnover', [
      /\b(?:global turnover|group turnover|annual turnover|turnover)\s*[:#-]?\s*([€$£]?\s*[0-9][0-9,.\s]*(?:m|million|bn|billion)?)\b/i,
    ], normalizeTurnover),
    origin: findLabeledValue(documents, 'origin', [
      /\b(?:country of origin|origin)\s*[:#-]?\s*([A-Za-z][A-Za-z\s-]{2,40})\b/i,
    ]),
    supplierName: findLabeledValue(documents, 'supplierName', [
      /\b(?:supplier name|manufacturer name|factory name)\s*[:#-]?\s*([A-Za-z0-9][A-Za-z0-9\s&.,'()-]{2,80})/i,
      /\bsupplier(?! emissions data)\s*[:#-]?\s*([A-Za-z0-9][A-Za-z0-9\s&.,'()-]{2,80})/i,
    ]),
    company: findLabeledValue(documents, 'company', [
      /\b(?:company|importer|operator)\s*[:#-]?\s*([A-Za-z0-9][A-Za-z0-9\s&.,'()-]{2,80})/i,
    ]),
    authorisedDeclarant: findBooleanSignal(documents, 'authorisedDeclarant', {
      positive: [
        /\bauthori[sz]ed (?:cbam )?declarant(?: status)?\s*[:#-]?\s*(?:yes|true|ready|approved|registered|confirmed)\b/i,
        /\bcbam declarant registration (?:approved|confirmed)\b/i,
      ],
      negative: [
        /\bauthori[sz]ed (?:cbam )?declarant(?: status)?\s*[:#-]?\s*(?:no|false|not ready|pending|missing)\b/i,
        /\bnot an authori[sz]ed (?:cbam )?declarant\b/i,
      ],
    }),
    supplierEmissionsData: findBooleanSignal(documents, 'supplierEmissionsData', {
      positive: [
        /\b(?:supplier )?emissions data\s*[:#-]?\s*(?:yes|available|provided|attached|complete)\b/i,
        /\bembedded emissions (?:data|evidence|methodology).{0,20}(?:available|provided|attached|included)\b/i,
      ],
      negative: [
        /\b(?:supplier )?emissions data\s*[:#-]?\s*(?:no|unavailable|missing|pending|not provided)\b/i,
        /\bembedded emissions (?:data|evidence|methodology).{0,20}(?:missing|unavailable|not provided)\b/i,
      ],
    }),
    geolocationAvailable: findBooleanSignal(documents, 'geolocationAvailable', {
      positive: [
        /\bgeolocation evidence\s*[:#-]?\s*(?:yes|available|provided|attached|complete)\b/i,
        /\bgeolocation(?: data| evidence| polygon| coordinates)?\s*[:#-]?\s*(?:yes|available|provided|attached|complete)\b/i,
        /\bpolygon coordinates\b/i,
        /\blatitude\b.{0,20}\blongitude\b/i,
      ],
      negative: [
        /\bgeolocation evidence\s*[:#-]?\s*(?:no|unavailable|missing|pending|not provided)\b/i,
        /\bgeolocation(?: data| evidence| polygon| coordinates)?\s*[:#-]?\s*(?:no|unavailable|missing|pending|not provided)\b/i,
        /\bcoordinates not provided\b/i,
      ],
    }),
    dueDiligenceStatement: findBooleanSignal(documents, 'dueDiligenceStatement', {
      positive: [
        /\bdue[- ]diligence statement\s*[:#-]?\s*(?:yes|ready|submitted|available|complete)\b/i,
        /\bdds submitted\b/i,
      ],
      negative: [
        /\bdue[- ]diligence statement\s*[:#-]?\s*(?:no|missing|not ready|not submitted|pending)\b/i,
      ],
    }),
  };

  const extractedFacts = {};
  const factSources = {};

  Object.keys(candidates).forEach(field => {
    const best = pickBestCandidate(candidates[field]);
    if (!best) return;
    extractedFacts[field] = best.value;
    factSources[field] = {
      documentId: best.documentId,
      documentName: best.documentName,
      confidence: best.confidence >= 3 ? 'high' : 'medium',
      snippet: best.snippet,
      sourceType: best.sourceType,
    };
  });

  return { extractedFacts, factSources };
}

function buildEvidenceSummary(extractedFacts = {}, factSources = {}) {
  const orderedFields = [
    ['cnCode', 'CN / HS code'],
    ['authorisedDeclarant', 'authorised declarant status'],
    ['supplierEmissionsData', 'supplier emissions data'],
    ['geolocationAvailable', 'geolocation evidence'],
    ['dueDiligenceStatement', 'due-diligence statement'],
    ['employeeCount', 'employee count'],
    ['globalTurnover', 'global turnover'],
    ['origin', 'origin'],
    ['supplierName', 'supplier'],
  ];

  const parts = orderedFields
    .filter(([field]) => Object.prototype.hasOwnProperty.call(extractedFacts, field))
    .map(([field, label]) => {
      const value = extractedFacts[field];
      const rendered = value === true ? 'Yes' : value === false ? 'No' : String(value);
      const source = factSources[field];
      return `${label}: ${rendered}${source?.documentName ? ` (${source.documentName})` : ''}`;
    });

  return parts.join('; ');
}

function extractEvidenceBundle(input, context = {}) {
  const documents = normalizeEvidenceDocuments(input);
  const { extractedFacts, factSources } = extractEvidenceFacts(documents);
  const bundleId = buildEvidenceBundleId(documents, context);
  const evidenceSummary = buildEvidenceSummary(extractedFacts, factSources);

  return {
    bundleVersion: '2026-04-09',
    bundleId,
    documentCount: documents.length,
    documents: documents.map(document => ({
      documentId: document.documentId,
      name: document.name,
      type: document.type,
      textPreview: document.text.slice(0, 220),
      characterCount: document.text.length,
    })),
    extractedFacts,
    factSources,
    evidenceSummary,
    extractedFieldCount: Object.keys(extractedFacts).length,
  };
}

function mergeComplianceInputWithEvidence(body = {}, evidenceBundle = null) {
  const input = body && typeof body === 'object' ? { ...body } : {};
  const bundle = evidenceBundle && typeof evidenceBundle === 'object' ? evidenceBundle : null;
  const facts = bundle && bundle.extractedFacts && typeof bundle.extractedFacts === 'object'
    ? bundle.extractedFacts
    : {};

  const merged = { ...input };
  const aliases = {
    company: ['company', 'companyName', 'importerCompany'],
    supplierName: ['supplierName'],
    origin: ['origin'],
    cnCode: ['cnCode', 'hsCode'],
    employeeCount: ['employeeCount'],
    globalTurnover: ['globalTurnover', 'companyTurnover', 'turnover', 'annualTurnover'],
    authorisedDeclarant: ['authorisedDeclarant', 'authorizedDeclarant', 'declarantReady'],
    supplierEmissionsData: ['supplierEmissionsData', 'emissionsDataAvailable', 'emissionsEvidenceAvailable'],
    geolocationAvailable: ['geolocationAvailable', 'geolocationEvidence', 'geolocationData', 'polygonDataAvailable'],
    dueDiligenceStatement: ['dueDiligenceStatement', 'dueDiligenceReady', 'dueDiligenceStatementReady'],
  };

  Object.keys(aliases).forEach(field => {
    const sourceValue = facts[field];
    if (sourceValue === undefined || sourceValue === null || !hasValue(sourceValue)) return;

    const hasExplicitValue = aliases[field].some(alias => {
      const current = merged[alias];
      return hasValue(current);
    });

    if (!hasExplicitValue) {
      aliases[field].forEach((alias, index) => {
        if (index === 0) {
          merged[alias] = sourceValue;
        }
      });
    }
  });

  if (bundle) {
    merged.evidenceBundleId = cleanString(bundle.bundleId);
    merged.evidenceDocumentCount = Number(bundle.documentCount) || 0;
    merged.evidenceSummary = cleanString(bundle.evidenceSummary);
    merged.evidenceFieldCount = Number(bundle.extractedFieldCount) || 0;
  }

  return merged;
}

module.exports = {
  buildEvidenceSummary,
  extractEvidenceBundle,
  mergeComplianceInputWithEvidence,
  normalizeEvidenceDocuments,
  validateEvidenceDocuments,
};
