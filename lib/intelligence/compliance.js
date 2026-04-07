const { cleanString, isCbamCategoryText, isEudrCategoryText } = require('./catalog');

const REGULATION_ORDER = ['EUDR', 'CBAM', 'CSDDD'];

const REGULATION_TEMPLATES = {
  EUDR: {
    regulation: 'EUDR',
    legalBasis: 'Regulation (EU) 2023/1115 of the European Parliament and of the Council',
    complianceDeadline: 'Before placing covered goods on the EU market',
    keyObligation: 'Establish due diligence and collect geolocation data where the regulation applies.',
  },
  CBAM: {
    regulation: 'CBAM',
    legalBasis: 'Regulation (EU) 2023/956 of the European Parliament and of the Council',
    complianceDeadline: 'Before the relevant reporting or declaration window opens',
    keyObligation: 'Confirm whether the goods fall within Annex I and maintain emissions reporting controls.',
  },
  CSDDD: {
    regulation: 'CSDDD',
    legalBasis: 'Directive (EU) 2024/1760 of the European Parliament and of the Council',
    complianceDeadline: 'When the company falls within the directive threshold and must run due diligence',
    keyObligation: 'Maintain risk-based due diligence across the value chain when the threshold is met.',
  },
};

function parseImportValue(value) {
  const text = cleanString(value);
  if (/under\s*€?50k/i.test(text)) return 50000;
  if (/€?50k.*€?500k/i.test(text)) return 500000;
  if (/€?500k.*€?5m/i.test(text)) return 5000000;
  if (/over\s*€?5m/i.test(text)) return 5000001;
  return Number(String(text).replace(/[^\d.]/g, '')) || 0;
}

function determineRegulationApplicability(orderData = {}) {
  const categoryText = `${cleanString(orderData.productCategory)} ${cleanString(orderData.productDescription)}`.trim();
  const companySize = cleanString(orderData.companySize);

  const eudrApplies = isEudrCategoryText(categoryText);
  const cbamApplies = isCbamCategoryText(categoryText);
  const csdddApplies = /over 1000 employees/i.test(companySize);

  return {
    EUDR: {
      applicable: eudrApplies,
      applicabilityReason: eudrApplies
        ? 'Product description intersects Article 1 and Annex I EUDR-covered goods.'
        : 'Product description does not clearly intersect Article 1 and Annex I EUDR-covered goods.',
    },
    CBAM: {
      applicable: cbamApplies,
      applicabilityReason: cbamApplies
        ? 'Product description intersects Annex I CBAM-covered sectors.'
        : 'Product description does not clearly intersect Annex I CBAM-covered sectors.',
    },
    CSDDD: {
      applicable: csdddApplies,
      applicabilityReason: csdddApplies
        ? 'Company size reaches the employee threshold, but Article 2 turnover scope should still be legally confirmed.'
        : 'Provided company size does not indicate the Article 2 employee threshold is met.',
    },
  };
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function normaliseFinancialRisk(value) {
  const risk = value && typeof value === 'object' ? value : {};
  return {
    minimumFineEur: Math.max(0, Number(risk.minimumFineEur) || 0),
    maximumFineEur: Math.max(0, Number(risk.maximumFineEur) || 0),
    calculationExplained: cleanString(risk.calculationExplained) || 'Not provided',
    additionalRisks: ensureArray(risk.additionalRisks).map(item => cleanString(item)).filter(Boolean),
  };
}

function normaliseRegulation(regulationKey, inputRegulation, applicability) {
  const source = inputRegulation && typeof inputRegulation === 'object' ? inputRegulation : {};
  const template = REGULATION_TEMPLATES[regulationKey];

  return {
    regulation: template.regulation,
    applicable: Boolean(applicability.applicable),
    applicabilityReason: cleanString(source.applicabilityReason) || applicability.applicabilityReason,
    status: cleanString(source.status) || 'at_risk',
    legalBasis: cleanString(source.legalBasis) || template.legalBasis,
    keyObligation: cleanString(source.keyObligation) || template.keyObligation,
    currentGap: cleanString(source.currentGap) || (applicability.applicable ? 'Not fully verified' : 'N/A'),
    findings: ensureArray(source.findings).map(item => ({
      finding: cleanString(item && item.finding),
      severity: cleanString(item && item.severity) || 'minor',
      article: cleanString(item && item.article),
      legalImplication: cleanString(item && item.legalImplication),
    })).filter(item => item.finding),
    requiredActions: ensureArray(source.requiredActions).map(item => ({
      step: Number(item && item.step) || 1,
      action: cleanString(item && item.action),
      documentRequired: cleanString(item && item.documentRequired),
      portal: cleanString(item && item.portal),
      deadline: cleanString(item && item.deadline),
      estimatedHours: Number(item && item.estimatedHours) || 0,
      estimatedCostEur: cleanString(item && item.estimatedCostEur),
    })).filter(item => item.action),
    financialRisk: normaliseFinancialRisk(source.financialRisk),
    complianceDeadline: cleanString(source.complianceDeadline) || template.complianceDeadline,
  };
}

function deriveStatus(regulation) {
  if (!regulation.applicable) return 'not_applicable';

  const findings = ensureArray(regulation.findings);
  const actions = ensureArray(regulation.requiredActions);

  const hasCritical = findings.some(item => item.severity === 'critical');
  const hasMajor = findings.some(item => item.severity === 'major');
  const hasFindings = findings.length > 0;
  const hasActions = actions.length > 0;

  if (hasCritical) return 'non_compliant';
  if (hasMajor || hasActions) return 'at_risk';
  if (hasFindings) return 'at_risk';
  if (regulation.status === 'compliant') return 'compliant';
  return 'at_risk';
}

function enforceComplianceLogic(report, orderData = {}) {
  const sourceReport = report && typeof report === 'object' ? report : {};
  const applicabilityMap = determineRegulationApplicability(orderData);
  const sourceByRegulation = new Map(
    ensureArray(sourceReport.checkedRegulations)
      .filter(item => item && item.regulation)
      .map(item => [item.regulation, item])
  );

  const checkedRegulations = REGULATION_ORDER.map(regulationKey => {
    const regulation = normaliseRegulation(regulationKey, sourceByRegulation.get(regulationKey), applicabilityMap[regulationKey]);
    regulation.status = deriveStatus(regulation);

    if (regulation.status === 'not_applicable') {
      regulation.currentGap = 'N/A';
      regulation.findings = [];
      regulation.requiredActions = [];
      regulation.financialRisk.minimumFineEur = 0;
      regulation.financialRisk.maximumFineEur = 0;
      regulation.financialRisk.calculationExplained = 'Not applicable';
      regulation.financialRisk.additionalRisks = [];
    }

    return regulation;
  });

  let overallStatus = 'compliant';
  let score = 100;
  let minExposure = 0;
  let maxExposure = 0;

  checkedRegulations.forEach(regulation => {
    if (regulation.status === 'non_compliant') {
      overallStatus = 'non_compliant';
      score -= 35;
    } else if (regulation.status === 'at_risk') {
      if (overallStatus !== 'non_compliant') overallStatus = 'at_risk';
      score -= 15;
    }

    minExposure += regulation.financialRisk.minimumFineEur;
    maxExposure += regulation.financialRisk.maximumFineEur;
  });

  const priorityActions = ensureArray(sourceReport.priorityActions)
    .map(item => ({
      rank: Number(item && item.rank) || 1,
      action: cleanString(item && item.action),
      urgency: cleanString(item && item.urgency),
      estimatedCostEur: cleanString(item && item.estimatedCostEur),
      consequenceIfIgnored: cleanString(item && item.consequenceIfIgnored),
    }))
    .filter(item => item.action)
    .sort((left, right) => left.rank - right.rank);

  return {
    ...sourceReport,
    checkedRegulations,
    overallStatus,
    overallScore: Math.max(0, score),
    priorityActions,
    totalFinancialExposure: {
      minimumEur: minExposure,
      maximumEur: maxExposure,
      calculationBreakdown: checkedRegulations
        .map(regulation => `${regulation.regulation}: ${regulation.financialRisk.minimumFineEur}-${regulation.financialRisk.maximumFineEur} EUR`)
        .join('; '),
    },
  };
}

module.exports = {
  determineRegulationApplicability,
  enforceComplianceLogic,
  parseImportValue,
};
