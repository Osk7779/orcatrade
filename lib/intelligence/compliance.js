const { cleanString } = require('./catalog');
const { evaluateRegulationApplicability, resolveAsOfDate } = require('./regulation-rules');

const RULE_VERSION = '2026-04-phase-1';
const REGULATION_ORDER = ['EUDR', 'CBAM', 'CSDDD'];

const REGULATION_TEMPLATES = {
  EUDR: {
    regulation: 'EUDR',
    legalBasis: 'Regulation (EU) 2023/1115 of the European Parliament and of the Council',
    complianceDeadline: 'Before the relevant EUDR application date and before placing covered goods on the EU market',
    keyObligation: 'Establish due diligence and collect geolocation data where the regulation applies.',
  },
  CBAM: {
    regulation: 'CBAM',
    legalBasis: 'Regulation (EU) 2023/956 of the European Parliament and of the Council',
    complianceDeadline: 'Before the relevant CBAM reporting or declaration window opens',
    keyObligation: 'Confirm whether the goods fall within Annex I and maintain emissions reporting controls.',
  },
  CSDDD: {
    regulation: 'CSDDD',
    legalBasis: 'Directive (EU) 2024/1760 of the European Parliament and of the Council',
    complianceDeadline: 'Before the relevant phased CSDDD application date for the company group',
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
  return evaluateRegulationApplicability(orderData);
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
  const applicabilityStatus = cleanString(source.applicabilityStatus) || applicability.applicabilityStatus || 'not_applicable';
  const readinessActions = ensureArray(source.readinessActions).map(cleanString).filter(Boolean);
  const missingFacts = ensureArray(source.missingFacts).map(cleanString).filter(Boolean);
  const evidenceSignals = ensureArray(source.evidenceSignals).map(cleanString).filter(Boolean);
  const legalReferences = ensureArray(source.legalReferences).map(cleanString).filter(Boolean);

  return {
    regulation: template.regulation,
    applicable: applicabilityStatus === 'applicable',
    applicabilityStatus,
    applicabilityReason: cleanString(source.applicabilityReason) || applicability.applicabilityReason,
    currentRequirementActive: source.currentRequirementActive === undefined
      ? Boolean(applicability.currentRequirementActive)
      : Boolean(source.currentRequirementActive),
    futureApplicabilityDate: cleanString(source.futureApplicabilityDate) || applicability.futureApplicabilityDate || null,
    missingFacts: missingFacts.length ? missingFacts : ensureArray(applicability.missingFacts).map(cleanString).filter(Boolean),
    confidence: cleanString(source.confidence) || applicability.confidence || 'medium',
    requiresManualReview: source.requiresManualReview === undefined
      ? Boolean(applicability.requiresManualReview)
      : Boolean(source.requiresManualReview),
    evidenceSignals: evidenceSignals.length ? evidenceSignals : ensureArray(applicability.evidenceSignals).map(cleanString).filter(Boolean),
    legalReferences: legalReferences.length ? legalReferences : ensureArray(applicability.legalReferences).map(cleanString).filter(Boolean),
    nextDecisionAction: cleanString(source.nextDecisionAction) || applicability.nextDecisionAction || '',
    readinessActions: readinessActions.length ? readinessActions : ensureArray(applicability.readinessActions).map(cleanString).filter(Boolean),
    status: cleanString(source.status) || 'at_risk',
    legalBasis: cleanString(source.legalBasis) || template.legalBasis,
    keyObligation: cleanString(source.keyObligation) || template.keyObligation,
    currentGap: cleanString(source.currentGap) || (
      applicabilityStatus === 'insufficient_data'
        ? 'Deterministic decision blocked by missing facts.'
        : applicabilityStatus === 'future_scope'
          ? 'Not legally active yet on the assessment date.'
          : applicabilityStatus === 'applicable'
            ? 'Not fully verified'
            : 'N/A'
    ),
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
    complianceDeadline: cleanString(source.complianceDeadline) || applicability.futureApplicabilityDate || template.complianceDeadline,
  };
}

function deriveStatus(regulation) {
  if (regulation.applicabilityStatus === 'not_applicable' || regulation.applicabilityStatus === 'future_scope') {
    return 'not_applicable';
  }
  if (regulation.applicabilityStatus === 'insufficient_data') {
    return 'at_risk';
  }

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

function buildPriorityActions(sourceReport, checkedRegulations) {
  const provided = ensureArray(sourceReport.priorityActions)
    .map(item => ({
      rank: Number(item && item.rank) || 1,
      action: cleanString(item && item.action),
      urgency: cleanString(item && item.urgency),
      estimatedCostEur: cleanString(item && item.estimatedCostEur),
      consequenceIfIgnored: cleanString(item && item.consequenceIfIgnored),
    }))
    .filter(item => item.action)
    .sort((left, right) => left.rank - right.rank);

  if (provided.length) return provided;

  const derived = [];

  checkedRegulations.forEach(regulation => {
    if (regulation.applicabilityStatus === 'insufficient_data' && regulation.missingFacts.length) {
      derived.push({
        action: `Provide the missing ${regulation.regulation} facts: ${regulation.missingFacts.join(', ')}.`,
        urgency: 'Immediate — within 7 days',
        estimatedCostEur: 'Internal review',
        consequenceIfIgnored: `OrcaTrade Intelligence cannot safely clear ${regulation.regulation} without those facts.`,
      });
    } else if (regulation.status === 'at_risk' && regulation.requiredActions.length) {
      const firstAction = regulation.requiredActions[0];
      derived.push({
        action: firstAction.action,
        urgency: cleanString(firstAction.deadline) || 'Within 30 days',
        estimatedCostEur: cleanString(firstAction.estimatedCostEur) || 'To be confirmed',
        consequenceIfIgnored: `${regulation.regulation} exposure remains unresolved.`,
      });
    } else if (regulation.applicabilityStatus === 'future_scope' && regulation.readinessActions.length) {
      derived.push({
        action: regulation.readinessActions[0],
        urgency: 'Within 90 days',
        estimatedCostEur: 'Preparation work',
        consequenceIfIgnored: `${regulation.regulation} readiness may slip ahead of the application date.`,
      });
    }
  });

  return derived.slice(0, 5).map((item, index) => ({
    rank: index + 1,
    ...item,
  }));
}

function buildFallbackExecutiveSummary(overallStatus, sourceReport, checkedRegulations) {
  const activeRegulations = checkedRegulations.filter(regulation => regulation.applicabilityStatus === 'applicable').map(regulation => regulation.regulation);
  const blockedRegulations = checkedRegulations.filter(regulation => regulation.applicabilityStatus === 'insufficient_data').map(regulation => regulation.regulation);
  const futureRegulations = checkedRegulations.filter(regulation => regulation.applicabilityStatus === 'future_scope').map(regulation => regulation.regulation);

  const sentenceOne = activeRegulations.length
    ? `${activeRegulations.join(' and ')} are currently in scope on the provided facts.`
    : futureRegulations.length
      ? `${futureRegulations.join(' and ')} appear relevant, but their binding application dates are still ahead.`
      : 'No regulation is currently confirmed in scope on the provided facts.';

  const sentenceTwo = blockedRegulations.length
    ? `The main blocker is missing data for ${blockedRegulations.join(' and ')}, so the software cannot safely clear those regimes yet.`
    : overallStatus === 'non_compliant'
      ? 'At least one currently active regulation shows a critical unresolved gap.'
      : overallStatus === 'at_risk'
        ? 'The main risk sits in unresolved actions or incomplete verification under the active regimes.'
        : 'No current critical gap was confirmed under the deterministic rules layer.';

  const firstAction = buildPriorityActions(sourceReport, checkedRegulations)[0];
  const sentenceThree = firstAction
    ? `The most urgent next step is to ${firstAction.action.charAt(0).toLowerCase()}${firstAction.action.slice(1)}`
    : 'The most urgent next step is to confirm the remaining missing evidence before relying on this report.';

  return `${sentenceOne} ${sentenceTwo} ${sentenceThree}`;
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

    if (regulation.applicabilityStatus === 'not_applicable') {
      regulation.currentGap = 'N/A';
      regulation.findings = [];
      regulation.requiredActions = [];
      regulation.financialRisk.minimumFineEur = 0;
      regulation.financialRisk.maximumFineEur = 0;
      regulation.financialRisk.calculationExplained = 'Not applicable';
      regulation.financialRisk.additionalRisks = [];
    }

    if (regulation.applicabilityStatus === 'future_scope') {
      regulation.currentGap = `Not legally active yet. Next relevant date: ${regulation.futureApplicabilityDate || 'To be confirmed'}.`;
      regulation.findings = [];
      regulation.requiredActions = [];
      regulation.financialRisk.minimumFineEur = 0;
      regulation.financialRisk.maximumFineEur = 0;
      regulation.financialRisk.calculationExplained = 'No current financial exposure is assigned while the regulation remains in future scope.';
      regulation.financialRisk.additionalRisks = ['Preparation delay could compress the implementation window before go-live.'];
    }

    if (regulation.applicabilityStatus === 'insufficient_data') {
      regulation.currentGap = `Decision blocked by missing facts: ${regulation.missingFacts.join(', ') || 'Required facts not provided'}.`;
      regulation.findings = [];
      regulation.requiredActions = [];
      regulation.financialRisk.minimumFineEur = 0;
      regulation.financialRisk.maximumFineEur = 0;
      regulation.financialRisk.calculationExplained = 'No financial exposure is assigned until the missing facts are provided and the regulation can be classified safely.';
      regulation.financialRisk.additionalRisks = ['The software cannot safely clear this regulation until the missing facts are provided.'];
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

  const priorityActions = buildPriorityActions(sourceReport, checkedRegulations);
  const blockedRegulations = checkedRegulations.filter(regulation => regulation.applicabilityStatus === 'insufficient_data');
  const futureScopeRegulations = checkedRegulations.filter(regulation => regulation.applicabilityStatus === 'future_scope');
  const asOfDate = resolveAsOfDate(orderData);

  return {
    ...sourceReport,
    ruleVersion: RULE_VERSION,
    asOfDate,
    checkedRegulations,
    overallStatus,
    overallScore: Math.max(0, score),
    requiresManualReview: checkedRegulations.some(regulation => regulation.requiresManualReview),
    blockedByMissingData: blockedRegulations.map(regulation => ({
      regulation: regulation.regulation,
      missingFacts: regulation.missingFacts,
      nextDecisionAction: regulation.nextDecisionAction,
    })),
    futureReadinessQueue: futureScopeRegulations.map(regulation => ({
      regulation: regulation.regulation,
      futureApplicabilityDate: regulation.futureApplicabilityDate,
      readinessActions: regulation.readinessActions,
    })),
    deterministicAssessment: {
      activeRegulations: checkedRegulations.filter(regulation => regulation.applicabilityStatus === 'applicable').map(regulation => regulation.regulation),
      futureScopeRegulations: futureScopeRegulations.map(regulation => regulation.regulation),
      blockedRegulations: blockedRegulations.map(regulation => regulation.regulation),
    },
    executiveSummary: cleanString(sourceReport.executiveSummary) || buildFallbackExecutiveSummary(overallStatus, sourceReport, checkedRegulations),
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
  resolveAsOfDate,
  RULE_VERSION,
};
