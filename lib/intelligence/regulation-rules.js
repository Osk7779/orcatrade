const { cleanString, isCbamCategoryText, isEudrCategoryText } = require('./catalog');

const CBAM_START_DATE = '2026-01-01';
const EUDR_STANDARD_DATE = '2026-12-30';
const EUDR_SMALL_OPERATOR_DATE = '2027-06-30';
const CSDDD_PHASE_ONE_DATE = '2027-07-26';
const CSDDD_PHASE_TWO_DATE = '2028-07-26';
const CSDDD_PHASE_THREE_DATE = '2029-07-26';

function isoDate(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function resolveAsOfDate(orderData = {}) {
  return isoDate(orderData.asOfDate) || isoDate(new Date()) || '2026-04-08';
}

function collectCategoryText(orderData = {}) {
  return `${cleanString(orderData.productCategory)} ${cleanString(orderData.productDescription)}`.trim();
}

function parseEmployeeRange(value) {
  const text = cleanString(value).toLowerCase();
  if (!text) return null;

  if (text.includes('under 250')) {
    return { min: 0, max: 249, label: 'under_250', exact: false };
  }
  if (/250[\u2013\-–]1000/.test(text)) {
    return { min: 250, max: 1000, label: '250_1000', exact: false };
  }
  if (text.includes('over 1000')) {
    return { min: 1001, max: null, label: 'over_1000', exact: false };
  }

  const countMatch = text.match(/(\d[\d,.]*)/);
  if (!countMatch) return null;

  const count = Number(countMatch[1].replace(/[^\d]/g, ''));
  if (!count) return null;

  return { min: count, max: count, label: 'exact_count', exact: true };
}

function parseMoneyAmount(value) {
  const text = cleanString(value).toLowerCase();
  if (!text) return null;

  if (/under\s*€?\s*50k/.test(text)) return 50000;
  if (/€?\s*50k.*€?\s*500k/.test(text)) return 500000;
  if (/€?\s*500k.*€?\s*5m/.test(text)) return 5000000;
  if (/over\s*€?\s*5m/.test(text)) return 5000001;

  const compact = text.replace(/\s+/g, '');
  const unitMatch = compact.match(/(\d+(?:[.,]\d+)?)(k|m|bn|b)/);
  if (unitMatch) {
    const base = Number(unitMatch[1].replace(',', '.'));
    const unit = unitMatch[2];
    if (!Number.isFinite(base)) return null;
    if (unit === 'k') return Math.round(base * 1_000);
    if (unit === 'm') return Math.round(base * 1_000_000);
    if (unit === 'b' || unit === 'bn') return Math.round(base * 1_000_000_000);
  }

  const rawNumber = Number(compact.replace(/[^\d.]/g, ''));
  return Number.isFinite(rawNumber) && rawNumber > 0 ? rawNumber : null;
}

function parseGlobalTurnover(orderData = {}) {
  return parseMoneyAmount(
    orderData.globalTurnover ||
    orderData.companyTurnover ||
    orderData.turnover ||
    orderData.annualTurnover
  );
}

function buildEvaluation(regulation, overrides) {
  return {
    regulation,
    applicable: false,
    applicabilityStatus: 'not_applicable',
    applicabilityReason: '',
    currentRequirementActive: false,
    futureApplicabilityDate: null,
    missingFacts: [],
    confidence: 'medium',
    requiresManualReview: false,
    evidenceSignals: [],
    legalReferences: [],
    nextDecisionAction: '',
    readinessActions: [],
    ...overrides,
  };
}

function evaluateCbam(orderData = {}, asOfDate) {
  const categoryText = collectCategoryText(orderData);
  const euMarket = orderData.euMarket !== false;

  if (!categoryText) {
    return buildEvaluation('CBAM', {
      applicabilityStatus: 'insufficient_data',
      applicabilityReason: 'CBAM scope cannot be determined without a product description or CN/HS-aligned goods classification.',
      missingFacts: ['product description or CN / HS classification'],
      confidence: 'low',
      requiresManualReview: true,
      evidenceSignals: ['No goods description was provided.'],
      legalReferences: ['Regulation (EU) 2023/956 Annex I'],
      nextDecisionAction: 'Provide the product description or CN / HS code before relying on a CBAM decision.',
      readinessActions: ['Confirm the exact goods classification against Annex I of Regulation (EU) 2023/956.'],
    });
  }

  if (!euMarket) {
    return buildEvaluation('CBAM', {
      applicabilityStatus: 'not_applicable',
      applicabilityReason: 'The request states the goods are not being placed on the EU market, so CBAM import obligations are not triggered on the provided facts.',
      confidence: 'medium',
      evidenceSignals: ['EU market flag is set to false.'],
      legalReferences: ['Regulation (EU) 2023/956'],
      nextDecisionAction: 'Confirm the customs flow if the goods will still enter the EU customs territory.',
    });
  }

  if (isCbamCategoryText(categoryText)) {
    return buildEvaluation('CBAM', {
      applicable: true,
      applicabilityStatus: 'applicable',
      currentRequirementActive: asOfDate >= CBAM_START_DATE,
      applicabilityReason: `The product description intersects CBAM Annex I covered sectors, and the definitive regime is live from ${CBAM_START_DATE}.`,
      confidence: 'high',
      evidenceSignals: ['Goods description intersects Annex I sector keywords.', `Current assessment date: ${asOfDate}.`],
      legalReferences: ['Regulation (EU) 2023/956 Annex I', `CBAM definitive regime start date: ${CBAM_START_DATE}`],
      nextDecisionAction: 'Confirm Annex I classification, authorised declarant readiness, and supplier emissions evidence before the next filing cycle.',
      readinessActions: [
        'Confirm the CN / HS classification against Annex I.',
        'Collect supplier emissions methodology and supporting data.',
        'Verify authorised declarant readiness for the importing entity.',
      ],
    });
  }

  return buildEvaluation('CBAM', {
    applicabilityStatus: 'not_applicable',
    applicabilityReason: 'The product description does not clearly intersect Annex I CBAM-covered sectors on the provided facts.',
    confidence: 'medium',
    evidenceSignals: ['No Annex I CBAM sector keywords were found in the product description.'],
    legalReferences: ['Regulation (EU) 2023/956 Annex I'],
    nextDecisionAction: 'Run a manual classification review if the goods may sit near a covered CN heading.',
  });
}

function evaluateEudr(orderData = {}, asOfDate) {
  const categoryText = collectCategoryText(orderData);
  const companySize = cleanString(orderData.companySize);
  const euMarket = orderData.euMarket !== false;
  const origin = cleanString(orderData.origin);

  if (!categoryText) {
    return buildEvaluation('EUDR', {
      applicabilityStatus: 'insufficient_data',
      applicabilityReason: 'EUDR scope cannot be determined without a product description or commodity classification.',
      missingFacts: ['product description or commodity classification'],
      confidence: 'low',
      requiresManualReview: true,
      evidenceSignals: ['No product description was provided.'],
      legalReferences: ['Regulation (EU) 2023/1115 Article 1', 'Regulation (EU) 2023/1115 Annex I'],
      nextDecisionAction: 'Provide the exact goods description before relying on an EUDR decision.',
      readinessActions: ['Confirm whether the product falls within Article 1 and Annex I of Regulation (EU) 2023/1115.'],
    });
  }

  if (!euMarket) {
    return buildEvaluation('EUDR', {
      applicabilityStatus: 'not_applicable',
      applicabilityReason: 'The request states the goods are not being placed on the EU market, so EUDR operator obligations are not triggered on the provided facts.',
      confidence: 'medium',
      evidenceSignals: ['EU market flag is set to false.'],
      legalReferences: ['Regulation (EU) 2023/1115 Article 1'],
      nextDecisionAction: 'Confirm the goods flow if the products will later be placed on the EU market.',
    });
  }

  if (!isEudrCategoryText(categoryText)) {
    return buildEvaluation('EUDR', {
      applicabilityStatus: 'not_applicable',
      applicabilityReason: 'The product description does not clearly intersect Article 1 and Annex I EUDR-covered commodities or derived products.',
      confidence: 'medium',
      evidenceSignals: ['No EUDR commodity or derived-product keywords were found in the product description.'],
      legalReferences: ['Regulation (EU) 2023/1115 Article 1', 'Regulation (EU) 2023/1115 Annex I'],
      nextDecisionAction: 'Run a manual classification review if the goods are a borderline derived product.',
    });
  }

  const isSmallOperator = /under 250/i.test(companySize);
  const futureApplicabilityDate = isSmallOperator ? EUDR_SMALL_OPERATOR_DATE : EUDR_STANDARD_DATE;
  const missingFacts = [];

  if (!companySize) {
    missingFacts.push('operator size (micro/small vs other)');
  }
  if (!origin) {
    missingFacts.push('country of origin');
  }

  if (asOfDate < futureApplicabilityDate) {
    return buildEvaluation('EUDR', {
      applicabilityStatus: 'future_scope',
      futureApplicabilityDate,
      applicabilityReason: `The goods appear to be EUDR-covered, but the application date is ${futureApplicabilityDate} on the provided operator profile, so the obligation is not legally live yet as of ${asOfDate}.`,
      confidence: missingFacts.length ? 'medium' : 'high',
      missingFacts,
      requiresManualReview: missingFacts.length > 0,
      evidenceSignals: ['Goods description intersects EUDR-covered commodities or derived products.', `Current assessment date: ${asOfDate}.`, `Application date used: ${futureApplicabilityDate}.`],
      legalReferences: ['Regulation (EU) 2023/1115 Article 1', 'Regulation (EU) 2023/1115 Annex I', `EUDR application date used: ${futureApplicabilityDate}`],
      nextDecisionAction: 'Prepare geolocation, supply-chain, and due-diligence evidence before the EUDR application date.',
      readinessActions: [
        'Confirm the exact operator size to lock the right EUDR application date.',
        'Collect geolocation and traceability data for all covered goods.',
        'Prepare the due-diligence statement workflow before go-live.',
      ],
    });
  }

  return buildEvaluation('EUDR', {
    applicable: true,
    applicabilityStatus: 'applicable',
    currentRequirementActive: true,
    futureApplicabilityDate,
    applicabilityReason: `The goods appear to be EUDR-covered and the relevant application date (${futureApplicabilityDate}) has passed as of ${asOfDate}.`,
    confidence: missingFacts.length ? 'medium' : 'high',
    missingFacts,
    requiresManualReview: missingFacts.length > 0,
    evidenceSignals: ['Goods description intersects EUDR-covered commodities or derived products.', `Current assessment date: ${asOfDate}.`, `Application date used: ${futureApplicabilityDate}.`],
    legalReferences: ['Regulation (EU) 2023/1115 Article 1', 'Regulation (EU) 2023/1115 Annex I', 'Regulation (EU) 2023/1115 Article 9'],
    nextDecisionAction: 'Confirm geolocation evidence and the due-diligence statement process before placing the goods on the EU market.',
    readinessActions: [
      'Verify polygon-level geolocation coverage for all relevant plots.',
      'Prepare the due-diligence statement and supporting evidence pack.',
    ],
  });
}

function evaluateCsddd(orderData = {}, asOfDate) {
  const employeeRange = parseEmployeeRange(orderData.companySize || orderData.employeeCount);
  const globalTurnover = parseGlobalTurnover(orderData);
  const missingFacts = [];

  if (!employeeRange) {
    missingFacts.push('exact employee count');
  }
  if (!globalTurnover) {
    missingFacts.push('global turnover');
  }

  if (employeeRange && employeeRange.max !== null && employeeRange.max < 1000) {
    return buildEvaluation('CSDDD', {
      applicabilityStatus: 'not_applicable',
      applicabilityReason: 'The provided company-size band is below the employee threshold used in the phased CSDDD rollout.',
      confidence: 'high',
      evidenceSignals: [`Employee band supplied: ${cleanString(orderData.companySize)}.`],
      legalReferences: ['Directive (EU) 2024/1760 phased application thresholds'],
      nextDecisionAction: 'Re-check only if the company group exceeds the published employee thresholds.',
    });
  }

  if (globalTurnover && globalTurnover < 450_000_000) {
    return buildEvaluation('CSDDD', {
      applicabilityStatus: 'not_applicable',
      applicabilityReason: 'The provided global turnover is below the lowest published CSDDD turnover threshold.',
      confidence: 'high',
      evidenceSignals: [`Global turnover signal: €${globalTurnover.toLocaleString('en-GB')}.`],
      legalReferences: ['Directive (EU) 2024/1760 phased application thresholds'],
      nextDecisionAction: 'Re-check only if group turnover exceeds the published thresholds.',
    });
  }

  if (missingFacts.length > 0) {
    return buildEvaluation('CSDDD', {
      applicabilityStatus: 'insufficient_data',
      applicabilityReason: 'CSDDD scope cannot be confirmed from employee count alone; the phased thresholds require both workforce size and global turnover, and larger groups may enter scope on different dates.',
      missingFacts,
      confidence: 'low',
      requiresManualReview: true,
      evidenceSignals: employeeRange ? [`Employee band supplied: ${cleanString(orderData.companySize)}.`] : [],
      legalReferences: ['Directive (EU) 2024/1760 phased application thresholds'],
      nextDecisionAction: 'Provide exact employee count and global turnover before relying on a CSDDD scope decision.',
      readinessActions: [
        'Confirm exact group employee count.',
        'Confirm global turnover at group level.',
        'Map whether the company enters scope in the 2027, 2028, or 2029 phase.',
      ],
    });
  }

  let futureApplicabilityDate = null;

  if (employeeRange.min > 5000 && globalTurnover > 1_500_000_000) {
    futureApplicabilityDate = CSDDD_PHASE_ONE_DATE;
  } else if (employeeRange.min > 3000 && globalTurnover > 900_000_000) {
    futureApplicabilityDate = CSDDD_PHASE_TWO_DATE;
  } else if (employeeRange.min > 1000 && globalTurnover > 450_000_000) {
    futureApplicabilityDate = CSDDD_PHASE_THREE_DATE;
  }

  if (!futureApplicabilityDate) {
    return buildEvaluation('CSDDD', {
      applicabilityStatus: 'not_applicable',
      applicabilityReason: 'The provided employee and turnover signals do not clearly cross a published CSDDD phase threshold.',
      confidence: 'medium',
      evidenceSignals: [
        `Employee signal: ${cleanString(orderData.companySize) || 'Not provided'}.`,
        `Turnover signal: €${globalTurnover.toLocaleString('en-GB')}.`,
      ],
      legalReferences: ['Directive (EU) 2024/1760 phased application thresholds'],
      nextDecisionAction: 'Re-check if the group profile changes or if more exact size data becomes available.',
    });
  }

  if (asOfDate < futureApplicabilityDate) {
    return buildEvaluation('CSDDD', {
      applicabilityStatus: 'future_scope',
      futureApplicabilityDate,
      applicabilityReason: `The company appears to cross a published CSDDD phase threshold, but the binding application date is ${futureApplicabilityDate}, so the obligation is not legally live yet as of ${asOfDate}.`,
      confidence: employeeRange.exact ? 'high' : 'medium',
      requiresManualReview: !employeeRange.exact,
      evidenceSignals: [
        `Employee signal: ${cleanString(orderData.companySize) || employeeRange.min}.`,
        `Turnover signal: €${globalTurnover.toLocaleString('en-GB')}.`,
        `Current assessment date: ${asOfDate}.`,
      ],
      legalReferences: ['Directive (EU) 2024/1760 phased application thresholds'],
      nextDecisionAction: 'Prepare group-level due-diligence governance before the application date.',
      readinessActions: [
        'Confirm the exact group threshold band and application phase.',
        'Prepare value-chain due-diligence governance and escalation ownership.',
      ],
    });
  }

  return buildEvaluation('CSDDD', {
    applicable: true,
    applicabilityStatus: 'applicable',
    currentRequirementActive: true,
    futureApplicabilityDate,
    applicabilityReason: `The company appears to cross a published CSDDD phase threshold and the relevant application date (${futureApplicabilityDate}) has passed as of ${asOfDate}.`,
    confidence: employeeRange.exact ? 'high' : 'medium',
    requiresManualReview: !employeeRange.exact,
    evidenceSignals: [
      `Employee signal: ${cleanString(orderData.companySize) || employeeRange.min}.`,
      `Turnover signal: €${globalTurnover.toLocaleString('en-GB')}.`,
      `Current assessment date: ${asOfDate}.`,
    ],
    legalReferences: ['Directive (EU) 2024/1760 phased application thresholds'],
    nextDecisionAction: 'Confirm board-level due-diligence governance and escalation ownership now that the directive is live for the group.',
    readinessActions: [
      'Confirm the group governance model for due diligence.',
      'Map the value-chain risk process and remediation ownership.',
    ],
  });
}

function evaluateRegulationApplicability(orderData = {}) {
  const asOfDate = resolveAsOfDate(orderData);
  return {
    EUDR: evaluateEudr(orderData, asOfDate),
    CBAM: evaluateCbam(orderData, asOfDate),
    CSDDD: evaluateCsddd(orderData, asOfDate),
  };
}

module.exports = {
  evaluateRegulationApplicability,
  parseEmployeeRange,
  parseGlobalTurnover,
  resolveAsOfDate,
};
