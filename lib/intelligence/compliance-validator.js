const { cleanString } = require('./catalog');
const { determineRegulationApplicability, normaliseComplianceInput } = require('./compliance');
const { extractEvidenceBundle, mergeComplianceInputWithEvidence, validateEvidenceDocuments } = require('./evidence-ingestion');

function validateCompliancePayload(body, options = {}) {
  const mode = options.mode === 'quick-check' ? 'quick-check' : 'report';

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return {
      ok: false,
      errors: ['Request body must be a JSON object.'],
      normalizedOrderData: null,
      applicability: null,
      evidenceBundle: null,
    };
  }

  const errors = [];
  let evidenceBundle = null;

  if (Object.prototype.hasOwnProperty.call(body, 'evidenceDocuments')) {
    const evidenceValidation = validateEvidenceDocuments(body.evidenceDocuments);
    if (!evidenceValidation.ok) {
      errors.push(...evidenceValidation.errors);
    } else if (evidenceValidation.documents.length) {
      evidenceBundle = extractEvidenceBundle(evidenceValidation.documents, body);
    }
  } else if (body.evidenceBundle && typeof body.evidenceBundle === 'object') {
    evidenceBundle = body.evidenceBundle;
  }

  const normalizedOrderData = normaliseComplianceInput(
    mergeComplianceInputWithEvidence(body, evidenceBundle)
  );

  if (!cleanString(normalizedOrderData.productCategory)) {
    errors.push('Product category is required.');
  }

  if (!cleanString(normalizedOrderData.origin)) {
    errors.push('Country of origin is required.');
  }

  if (mode === 'report') {
    if (!cleanString(normalizedOrderData.productDescription)) {
      errors.push('Product description is required for the full compliance report.');
    }

    if (!cleanString(normalizedOrderData.importValue)) {
      errors.push('Annual import value is required for the full compliance report.');
    }

    if (!cleanString(normalizedOrderData.companySize) && !cleanString(normalizedOrderData.employeeCount)) {
      errors.push('Company size or exact employee count is required for the full compliance report.');
    }
  }

  const applicability = determineRegulationApplicability(normalizedOrderData);

  return {
    ok: errors.length === 0,
    errors,
    normalizedOrderData,
    applicability,
    evidenceBundle,
  };
}

module.exports = {
  validateCompliancePayload,
};
