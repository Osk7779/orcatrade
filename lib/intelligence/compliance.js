const { cleanString } = require('./catalog');
const { buildReportOwnership } = require('./account-context');
const { createCacheKey } = require('./cache-store');
const { evaluateRegulationApplicability, parseBooleanFlag, pickFirstDefined, resolveAsOfDate } = require('./regulation-rules');

const RULE_VERSION = '2026-04-phase-2';
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

function normaliseComplianceInput(orderData = {}) {
  const input = orderData && typeof orderData === 'object' ? orderData : {};

  return {
    productCategory: cleanString(input.productCategory),
    productDescription: cleanString(input.productDescription),
    origin: cleanString(input.origin),
    company: cleanString(pickFirstDefined(input, ['company', 'companyName', 'importerCompany'])),
    email: cleanString(pickFirstDefined(input, ['email', 'workEmail', 'contactEmail'])).toLowerCase(),
    accountId: cleanString(pickFirstDefined(input, ['accountId', 'workspaceId', 'customerId'])),
    supplierName: cleanString(input.supplierName),
    importValue: cleanString(input.importValue),
    companySize: cleanString(input.companySize || input.operatorSize),
    employeeCount: cleanString(input.employeeCount),
    globalTurnover: cleanString(
      pickFirstDefined(input, ['globalTurnover', 'companyTurnover', 'turnover', 'annualTurnover'])
    ),
    euMarket: parseBooleanFlag(input.euMarket) === false ? false : true,
    asOfDate: cleanString(input.asOfDate),
    cnCode: cleanString(pickFirstDefined(input, ['cnCode', 'hsCode'])),
    hsCode: cleanString(pickFirstDefined(input, ['hsCode', 'cnCode'])),
    geolocationAvailable: parseBooleanFlag(
      pickFirstDefined(input, ['geolocationAvailable', 'geolocationEvidence', 'geolocationData', 'polygonDataAvailable'])
    ),
    dueDiligenceStatement: parseBooleanFlag(
      pickFirstDefined(input, ['dueDiligenceStatement', 'dueDiligenceReady', 'dueDiligenceStatementReady'])
    ),
    supplierEmissionsData: parseBooleanFlag(
      pickFirstDefined(input, ['supplierEmissionsData', 'emissionsDataAvailable', 'emissionsEvidenceAvailable'])
    ),
    authorisedDeclarant: parseBooleanFlag(
      pickFirstDefined(input, ['authorisedDeclarant', 'authorizedDeclarant', 'declarantReady'])
    ),
    evidenceBundleId: cleanString(input.evidenceBundleId),
    evidenceSummary: cleanString(input.evidenceSummary),
    evidenceDocumentCount: Math.max(0, Number(input.evidenceDocumentCount) || 0),
    evidenceFieldCount: Math.max(0, Number(input.evidenceFieldCount) || 0),
  };
}

function determineRegulationApplicability(orderData = {}) {
  return evaluateRegulationApplicability(normaliseComplianceInput(orderData));
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

function pushUniqueText(list, value) {
  const text = cleanString(value);
  if (!text) return;
  if (!list.includes(text)) list.push(text);
}

function addUniqueFinding(regulation, finding) {
  if (!finding || !cleanString(finding.finding)) return;

  const normalized = {
    finding: cleanString(finding.finding),
    severity: cleanString(finding.severity) || 'minor',
    article: cleanString(finding.article),
    legalImplication: cleanString(finding.legalImplication),
  };

  const exists = regulation.findings.some(item =>
    item.finding === normalized.finding &&
    item.article === normalized.article &&
    item.severity === normalized.severity
  );

  if (!exists) regulation.findings.push(normalized);
}

function addUniqueAction(regulation, action) {
  if (!action || !cleanString(action.action)) return;

  const normalized = {
    step: regulation.requiredActions.length + 1,
    action: cleanString(action.action),
    documentRequired: cleanString(action.documentRequired),
    portal: cleanString(action.portal),
    deadline: cleanString(action.deadline),
    estimatedHours: Math.max(0, Number(action.estimatedHours) || 0),
    estimatedCostEur: cleanString(action.estimatedCostEur),
  };

  const exists = regulation.requiredActions.some(item =>
    item.action === normalized.action &&
    item.documentRequired === normalized.documentRequired
  );

  if (!exists) regulation.requiredActions.push(normalized);
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
  if (regulation.applicabilityStatus === 'applicable' && (regulation.missingFacts.length || regulation.requiresManualReview)) {
    return 'at_risk';
  }
  if (hasFindings) return 'at_risk';
  if (regulation.status === 'compliant') return 'compliant';
  return 'at_risk';
}

function applyDeterministicEvidenceRules(regulation, orderData = {}) {
  if (regulation.applicabilityStatus !== 'applicable') {
    return regulation;
  }

  if (regulation.regulation === 'CBAM') {
    const declarantReady = orderData.authorisedDeclarant;
    const emissionsReady = orderData.supplierEmissionsData;

    if (declarantReady === false) {
      regulation.requiresManualReview = true;
      regulation.currentGap = 'Authorised CBAM declarant status is explicitly marked as not ready.';
      addUniqueFinding(regulation, {
        finding: 'The importing entity is not confirmed as an authorised CBAM declarant for an active CBAM goods flow.',
        severity: 'critical',
        article: 'Regulation (EU) 2023/956',
        legalImplication: 'The importer is not ready for an active CBAM declaration workflow on the provided facts.',
      });
      addUniqueAction(regulation, {
        action: 'Confirm authorised CBAM declarant status for the importing entity.',
        documentRequired: 'Authorised declarant registration evidence',
        portal: 'National competent authority / customs CBAM workflow',
        deadline: 'Before the next active CBAM filing cycle',
        estimatedHours: 3,
        estimatedCostEur: 'Internal review',
      });
    }

    if (emissionsReady === false) {
      regulation.requiresManualReview = true;
      if (!cleanString(regulation.currentGap) || regulation.currentGap === 'Not fully verified') {
        regulation.currentGap = 'Supplier emissions data is explicitly marked as unavailable.';
      }
      addUniqueFinding(regulation, {
        finding: 'Supplier emissions data is not confirmed for an active CBAM goods flow.',
        severity: 'major',
        article: 'Regulation (EU) 2023/956 Annex I',
        legalImplication: 'The importer cannot rely on a fully evidenced CBAM emissions position on the provided facts.',
      });
      addUniqueAction(regulation, {
        action: 'Collect supplier emissions methodology and supporting embedded-emissions data.',
        documentRequired: 'Supplier emissions evidence pack',
        portal: 'Supplier evidence workflow',
        deadline: 'Before the next active CBAM filing cycle',
        estimatedHours: 4,
        estimatedCostEur: 'Internal review',
      });
    }
  }

  if (regulation.regulation === 'EUDR') {
    const geolocationReady = orderData.geolocationAvailable;
    const dueDiligenceReady = orderData.dueDiligenceStatement;

    if (geolocationReady === false) {
      regulation.requiresManualReview = true;
      regulation.currentGap = 'Plot-level geolocation evidence is explicitly marked as unavailable.';
      addUniqueFinding(regulation, {
        finding: 'Plot-level geolocation evidence is missing for an active EUDR goods flow.',
        severity: 'critical',
        article: 'Article 9 of Regulation (EU) 2023/1115',
        legalImplication: 'The importer cannot evidence the required geolocation dataset for an active EUDR obligation.',
      });
      addUniqueAction(regulation, {
        action: 'Collect polygon-level geolocation evidence for all relevant plots before relying on this flow.',
        documentRequired: 'Plot-level geolocation dataset',
        portal: 'EUDR due-diligence workflow',
        deadline: 'Before placing the goods on the EU market',
        estimatedHours: 4,
        estimatedCostEur: 'Internal review',
      });
    }

    if (dueDiligenceReady === false) {
      regulation.requiresManualReview = true;
      if (!cleanString(regulation.currentGap) || regulation.currentGap === 'Not fully verified') {
        regulation.currentGap = 'The EUDR due-diligence statement is explicitly marked as not ready.';
      }
      addUniqueFinding(regulation, {
        finding: 'The due-diligence statement is not confirmed for an active EUDR goods flow.',
        severity: 'critical',
        article: 'Article 4 of Regulation (EU) 2023/1115',
        legalImplication: 'The importer is not ready to support an active EUDR placement on the EU market.',
      });
      addUniqueAction(regulation, {
        action: 'Prepare and verify the EUDR due-diligence statement and supporting evidence pack.',
        documentRequired: 'EUDR due-diligence statement',
        portal: 'EUDR due-diligence workflow',
        deadline: 'Before placing the goods on the EU market',
        estimatedHours: 3,
        estimatedCostEur: 'Internal review',
      });
    }
  }

  if (regulation.missingFacts.length) {
    regulation.requiresManualReview = true;
    if (!cleanString(regulation.currentGap) || regulation.currentGap === 'Not fully verified') {
      regulation.currentGap = `Decision remains provisional because these facts are missing: ${regulation.missingFacts.join(', ')}.`;
    }

    regulation.missingFacts.forEach(fact => {
      pushUniqueText(regulation.evidenceSignals, `Missing fact: ${fact}.`);
    });

    addUniqueAction(regulation, {
      action: `Provide the missing ${regulation.regulation} inputs: ${regulation.missingFacts.join(', ')}.`,
      documentRequired: 'Verified importer intake data',
      portal: 'OrcaTrade Intelligence intake',
      deadline: 'Before relying on this report',
      estimatedHours: 1,
      estimatedCostEur: 'Internal review',
    });
  }

  return regulation;
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

function buildComplianceDisclaimer(reportId, timestamp) {
  return `This report is generated by OrcaTrade Intelligence based on information provided by the user. It does not constitute legal advice and should not be relied upon as such. For binding legal opinions on EU trade compliance obligations, consult a qualified EU trade law practitioner. Report ID: ${reportId}. Generated: ${timestamp}.`;
}

function buildLineageInput(normalizedOrderData) {
  return {
    productCategory: normalizedOrderData.productCategory,
    productDescription: normalizedOrderData.productDescription,
    origin: normalizedOrderData.origin,
    supplierName: normalizedOrderData.supplierName,
    importValue: normalizedOrderData.importValue,
    companySize: normalizedOrderData.companySize,
    employeeCount: normalizedOrderData.employeeCount,
    globalTurnover: normalizedOrderData.globalTurnover,
    euMarket: normalizedOrderData.euMarket,
    asOfDate: resolveAsOfDate(normalizedOrderData),
    cnCode: normalizedOrderData.cnCode,
    hsCode: normalizedOrderData.hsCode,
    geolocationAvailable: normalizedOrderData.geolocationAvailable,
    dueDiligenceStatement: normalizedOrderData.dueDiligenceStatement,
    supplierEmissionsData: normalizedOrderData.supplierEmissionsData,
    authorisedDeclarant: normalizedOrderData.authorisedDeclarant,
    evidenceBundleId: normalizedOrderData.evidenceBundleId,
    evidenceSummary: normalizedOrderData.evidenceSummary,
    evidenceDocumentCount: normalizedOrderData.evidenceDocumentCount,
    evidenceFieldCount: normalizedOrderData.evidenceFieldCount,
  };
}

function buildLineageSubject(normalizedOrderData, reportOwnership = {}) {
  return {
    ownerFingerprint: cleanString(reportOwnership.ownerFingerprint),
    accountLabel: cleanString(reportOwnership.accountLabel).toLowerCase(),
    company: cleanString(reportOwnership.company || normalizedOrderData.company).toLowerCase(),
    productCategory: cleanString(normalizedOrderData.productCategory).toLowerCase(),
    productDescription: cleanString(normalizedOrderData.productDescription).toLowerCase(),
    origin: cleanString(normalizedOrderData.origin).toLowerCase(),
    supplierName: cleanString(normalizedOrderData.supplierName).toLowerCase(),
    importValue: cleanString(normalizedOrderData.importValue).toLowerCase(),
    euMarket: normalizedOrderData.euMarket !== false,
    evidenceBundleId: cleanString(normalizedOrderData.evidenceBundleId),
    evidenceSummary: cleanString(normalizedOrderData.evidenceSummary).toLowerCase(),
    evidenceDocumentCount: Math.max(0, Number(normalizedOrderData.evidenceDocumentCount) || 0),
  };
}

function buildReportLineage(sourceReport, normalizedOrderData, asOfDate, reportOwnership = {}) {
  const existingLineage = sourceReport && typeof sourceReport.reportLineage === 'object'
    ? sourceReport.reportLineage
    : {};
  const reportGeneration = sourceReport && typeof sourceReport.reportGeneration === 'object'
    ? sourceReport.reportGeneration
    : {};
  const subjectFingerprint = createCacheKey(buildLineageSubject(normalizedOrderData, reportOwnership));

  return {
    schemaVersion: '2026-04-09',
    reportVersion: Math.max(1, Number(existingLineage.reportVersion) || 1),
    parentReportId: cleanString(existingLineage.parentReportId) || null,
    generatedAt: cleanString(sourceReport.timestamp) || new Date().toISOString(),
    asOfDate,
    ruleVersion: RULE_VERSION,
    inputFingerprint: createCacheKey(buildLineageInput(normalizedOrderData)),
    subjectFingerprint,
    reportFamilyId: cleanString(existingLineage.reportFamilyId) || subjectFingerprint,
    generationMode: cleanString(reportGeneration.mode) || 'unknown',
    generationSource: cleanString(reportGeneration.source) || 'unknown',
    deterministicEnforcementApplied: true,
    evidenceBundleId: cleanString(normalizedOrderData.evidenceBundleId) || null,
  };
}

function buildEvidenceSnapshot(normalizedOrderData, checkedRegulations, generatedAt, reportOwnership = {}, reportLineage = {}) {
  const evidenceFields = [
    { key: 'cnCode', label: 'CN / HS code', value: normalizedOrderData.cnCode || normalizedOrderData.hsCode },
    { key: 'authorisedDeclarant', label: 'Authorised declarant status', value: normalizedOrderData.authorisedDeclarant },
    { key: 'supplierEmissionsData', label: 'Supplier emissions data', value: normalizedOrderData.supplierEmissionsData },
    { key: 'geolocationAvailable', label: 'Plot-level geolocation evidence', value: normalizedOrderData.geolocationAvailable },
    { key: 'dueDiligenceStatement', label: 'Due-diligence statement', value: normalizedOrderData.dueDiligenceStatement },
    { key: 'employeeCount', label: 'Exact employee count', value: normalizedOrderData.employeeCount },
    { key: 'globalTurnover', label: 'Global turnover', value: normalizedOrderData.globalTurnover },
  ];

  const items = evidenceFields.map(field => {
    const hasValue = field.value === true || field.value === false || Boolean(cleanString(field.value));
    return {
      key: field.key,
      label: field.label,
      provided: hasValue,
      valueSummary: field.value === true ? 'Yes'
        : field.value === false ? 'No'
        : cleanString(field.value) || 'Not provided',
    };
  });

  const criticalKeys = new Set(['cnCode', 'authorisedDeclarant', 'supplierEmissionsData', 'geolocationAvailable', 'dueDiligenceStatement']);
  const criticalItems = items.filter(item => criticalKeys.has(item.key));
  const criticalProvided = criticalItems.filter(item => item.provided).length;

  return {
    snapshotVersion: '2026-04-09',
    capturedAt: generatedAt,
    snapshotId: cleanString(reportLineage.evidenceSnapshotId) || null,
    reportFamilyId: cleanString(reportLineage.reportFamilyId) || null,
    reportVersion: Math.max(1, Number(reportLineage.reportVersion) || 1),
    ownerFingerprint: cleanString(reportOwnership.ownerFingerprint) || null,
    items,
    completeness: {
      totalFields: items.length,
      providedFields: items.filter(item => item.provided).length,
      missingFields: items.filter(item => !item.provided).length,
      criticalFields: criticalItems.length,
      criticalProvided,
      criticalMissing: criticalItems.length - criticalProvided,
    },
    regulationCoverage: checkedRegulations.map(regulation => ({
      regulation: regulation.regulation,
      applicabilityStatus: regulation.applicabilityStatus,
      missingFacts: regulation.missingFacts,
    })),
    documentEvidence: {
      bundleId: cleanString(reportLineage.evidenceBundleId) || cleanString(normalizedOrderData.evidenceBundleId) || null,
      documentCount: Math.max(0, Number(normalizedOrderData.evidenceDocumentCount) || 0),
      extractedFieldCount: Math.max(0, Number(normalizedOrderData.evidenceFieldCount) || 0),
      summary: cleanString(normalizedOrderData.evidenceSummary) || null,
    },
  };
}

function enforceComplianceLogic(report, orderData = {}) {
  const sourceReport = report && typeof report === 'object' ? report : {};
  const normalizedOrderData = normaliseComplianceInput(orderData);
  const applicabilityMap = determineRegulationApplicability(normalizedOrderData);
  const sourceByRegulation = new Map(
    ensureArray(sourceReport.checkedRegulations)
      .filter(item => item && item.regulation)
      .map(item => [item.regulation, item])
  );

  const checkedRegulations = REGULATION_ORDER.map(regulationKey => {
    const regulation = normaliseRegulation(regulationKey, sourceByRegulation.get(regulationKey), applicabilityMap[regulationKey]);
    applyDeterministicEvidenceRules(regulation, normalizedOrderData);
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
  const asOfDate = resolveAsOfDate(normalizedOrderData);
  const activeRegulations = checkedRegulations.filter(regulation => regulation.applicabilityStatus === 'applicable');
  const reportOwnership = buildReportOwnership(normalizedOrderData);
  const reportLineage = buildReportLineage(sourceReport, normalizedOrderData, asOfDate, reportOwnership);
  const evidenceSnapshot = buildEvidenceSnapshot(normalizedOrderData, checkedRegulations, reportLineage.generatedAt, reportOwnership, reportLineage);
  const decisionMissingFacts = checkedRegulations
    .filter(regulation => regulation.applicabilityStatus === 'applicable' || regulation.applicabilityStatus === 'insufficient_data')
    .map(regulation => ({
      regulation: regulation.regulation,
      missingFacts: regulation.missingFacts,
    }))
    .filter(item => item.missingFacts.length);
  const decisionReadinessLevel = blockedRegulations.length
    ? 'blocked'
    : activeRegulations.some(regulation => regulation.status !== 'compliant' || regulation.missingFacts.length || regulation.requiresManualReview)
      ? 'provisional'
      : activeRegulations.length
        ? 'evidence_backed'
        : 'screening_only';
  const finalDecisionEligible = decisionReadinessLevel !== 'blocked';
  const requiredEvidenceChecklist = checkedRegulations.map(regulation => ({
    regulation: regulation.regulation,
    applicabilityStatus: regulation.applicabilityStatus,
    status: regulation.status,
    finalDecisionEligible: regulation.applicabilityStatus !== 'insufficient_data' &&
      !(regulation.applicabilityStatus === 'applicable' && regulation.missingFacts.length > 0),
    missingCriticalFacts: regulation.applicabilityStatus === 'applicable' || regulation.applicabilityStatus === 'insufficient_data'
      ? regulation.missingFacts
      : [],
    nextDecisionAction: regulation.nextDecisionAction,
  }));

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
    decisionReadiness: {
      level: decisionReadinessLevel,
      finalDecisionEligible,
      screeningOnly: decisionReadinessLevel === 'screening_only',
      summary: decisionReadinessLevel === 'blocked'
        ? 'The software cannot safely conclude all relevant regulations yet because key threshold or classification facts are missing.'
        : decisionReadinessLevel === 'provisional'
          ? 'The report is directionally useful, but active regulations still depend on missing facts or unresolved evidence.'
          : decisionReadinessLevel === 'evidence_backed'
            ? 'All currently active regulations are backed by the facts and evidence signals provided to the backend.'
            : 'No regulation is currently active on the provided facts, so the result should be treated as a screening output.',
      missingCriticalFacts: decisionMissingFacts,
    },
    requiredEvidenceChecklist,
    deterministicAssessment: {
      activeRegulations: activeRegulations.map(regulation => regulation.regulation),
      futureScopeRegulations: futureScopeRegulations.map(regulation => regulation.regulation),
      blockedRegulations: blockedRegulations.map(regulation => regulation.regulation),
    },
    documentEvidence: {
      bundleId: normalizedOrderData.evidenceBundleId || null,
      documentCount: normalizedOrderData.evidenceDocumentCount || 0,
      extractedFieldCount: normalizedOrderData.evidenceFieldCount || 0,
      summary: normalizedOrderData.evidenceSummary || '',
      usedForDecision: Boolean(normalizedOrderData.evidenceBundleId),
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
    reportOwnership,
    reportLineage,
    evidenceSnapshot,
  };
}

function buildDeterministicFallbackReport(orderData = {}, options = {}) {
  const reportId = cleanString(options.reportId) || `OT-COMP-${new Date().getFullYear()}-FALLBACK`;
  const timestamp = cleanString(options.timestamp) || new Date().toISOString();
  const reason = cleanString(options.reason) || 'The AI generation layer was unavailable, so OrcaTrade returned a deterministic rules-based report instead.';

  return enforceComplianceLogic({
    reportId,
    timestamp,
    reportGeneration: {
      mode: 'deterministic_fallback',
      source: 'orcatrade-rules-engine',
      reason,
    },
    executiveSummary: '',
    checkedRegulations: [],
    disclaimer: buildComplianceDisclaimer(reportId, timestamp),
  }, orderData);
}

module.exports = {
  buildComplianceDisclaimer,
  buildDeterministicFallbackReport,
  determineRegulationApplicability,
  enforceComplianceLogic,
  normaliseComplianceInput,
  parseImportValue,
  resolveAsOfDate,
  RULE_VERSION,
};
