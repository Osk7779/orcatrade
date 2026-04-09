const { cleanString } = require('../lib/intelligence/catalog');
const { createCacheKey } = require('../lib/intelligence/cache-store');
const {
  consumeRateLimit,
  getSharedCacheValue,
  getStoredComplianceReportByRequest,
  persistEvidenceBundle,
  persistComplianceReport,
  setSharedCacheValue,
} = require('../lib/intelligence/runtime-store');
const { attachReportAccess } = require('../lib/intelligence/report-access');
const { extractAnthropicText, requestAnthropicMessage } = require('../lib/intelligence/model-runtime');
const { validateCompliancePayload } = require('../lib/intelligence/compliance-validator');
const { applyRequestHeaders, buildRequestContext, emitAuditEvent } = require('../lib/intelligence/request-runtime');
const {
  buildDeterministicFallbackReport,
  enforceComplianceLogic,
  resolveAsOfDate,
  RULE_VERSION,
} = require('../lib/intelligence/compliance');

const REPORT_CACHE_TTL_MS = 10 * 60 * 1000;
const REPORT_PERSIST_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const REPORT_MODEL_TIMEOUT_MS = 18000;
const REPORT_MODEL_RETRIES = 1;

async function sendComplianceSummaryEmail(report, orderData = {}) {
  if (!process.env.RESEND_API_KEY) return;

  try {
    const productCategory = orderData.productCategory || 'Not provided';
    const origin = orderData.origin || 'Not provided';
    const company = orderData.company || 'Not provided';
    const body = [
      `OrcaTrade Intelligence compliance report summary`,
      ``,
      `Report ID: ${report.reportId || 'N/A'}`,
      `Product category: ${productCategory}`,
      `Origin: ${origin}`,
      `Company: ${company}`,
      `Overall status: ${report.overallStatus || 'N/A'}`,
      `Overall score: ${report.overallScore ?? 'N/A'}`,
    ].join('\n');

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM || 'OrcaTrade <onboarding@resend.dev>',
        to: ['intelligence@orcatrade.pl'],
        subject: `OrcaTrade Intelligence — New Compliance Report [${report.overallStatus}]`,
        text: body,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Compliance summary email error:', errorText);
    }
  } catch (error) {
    console.error('Compliance summary email failed:', error);
  }
}

function getCachePreference(req) {
  const value = cleanString(req.headers['x-orcatrade-cache-preference']).toLowerCase();
  return value === 'all' || value === 'reject' ? value : 'essential';
}

function canUseFullReportCache(preference) {
  return preference === 'all';
}

function normaliseCheckCacheInput(orderData = {}) {
  return {
    ruleVersion: RULE_VERSION,
    asOfDate: resolveAsOfDate(orderData),
    company: cleanString(orderData.company).toLowerCase(),
    email: cleanString(orderData.email).toLowerCase(),
    accountId: cleanString(orderData.accountId).toLowerCase(),
    productCategory: cleanString(orderData.productCategory).toLowerCase(),
    productDescription: cleanString(orderData.productDescription).toLowerCase(),
    origin: cleanString(orderData.origin).toLowerCase(),
    supplierName: cleanString(orderData.supplierName).toLowerCase(),
    importValue: cleanString(orderData.importValue).toLowerCase(),
    companySize: cleanString(orderData.companySize).toLowerCase(),
    employeeCount: cleanString(orderData.employeeCount).toLowerCase(),
    globalTurnover: cleanString(orderData.globalTurnover || orderData.companyTurnover || orderData.turnover).toLowerCase(),
    cnCode: cleanString(orderData.cnCode || orderData.hsCode).toLowerCase(),
    geolocationAvailable: String(orderData.geolocationAvailable),
    dueDiligenceStatement: String(orderData.dueDiligenceStatement),
    supplierEmissionsData: String(orderData.supplierEmissionsData),
    authorisedDeclarant: String(orderData.authorisedDeclarant),
    evidenceBundleId: cleanString(orderData.evidenceBundleId).toLowerCase(),
    evidenceSummary: cleanString(orderData.evidenceSummary).toLowerCase(),
    evidenceDocumentCount: Number(orderData.evidenceDocumentCount) || 0,
    evidenceFieldCount: Number(orderData.evidenceFieldCount) || 0,
    euMarket: orderData.euMarket !== false,
  };
}

function withReportAccess(report, cacheInput) {
  const requestFingerprint = cleanString(cacheInput?.requestFingerprint) ||
    cleanString(report?.reportLineage?.inputFingerprint) ||
    createCacheKey(cacheInput || {});
  return attachReportAccess(report, { requestFingerprint });
}

async function sendReport(res, cachePreference, cacheInput, report, orderData) {
  if (canUseFullReportCache(cachePreference)) {
    await setSharedCacheValue('compliance-report', cacheInput, report, REPORT_CACHE_TTL_MS);
    res.setHeader('X-OrcaTrade-Cache', 'MISS');
  } else {
    res.setHeader('X-OrcaTrade-Cache', 'BYPASS');
  }

  const persisted = await persistComplianceReport(report, orderData, cacheInput, REPORT_PERSIST_TTL_MS);
  const persistedReport = persisted.report || report;
  res.setHeader('X-OrcaTrade-Storage-Mode', persisted.storageMode);
  res.setHeader('X-OrcaTrade-Report-Id', persisted.reportId);
  if (persisted.reportFamilyId) {
    res.setHeader('X-OrcaTrade-Report-Family', persisted.reportFamilyId);
  }
  if (persisted.reportVersion) {
    res.setHeader('X-OrcaTrade-Report-Version', String(persisted.reportVersion));
  }
  if (persisted.evidenceSnapshotId) {
    res.setHeader('X-OrcaTrade-Evidence-Snapshot', persisted.evidenceSnapshotId);
  }
  if (persistedReport?.documentEvidence?.bundleId) {
    res.setHeader('X-OrcaTrade-Evidence-Bundle', persistedReport.documentEvidence.bundleId);
  }
  res.setHeader('Cache-Control', 'no-store');

  if (persistedReport && persistedReport.reportGeneration && persistedReport.reportGeneration.mode) {
    res.setHeader('X-OrcaTrade-Generation-Mode', persistedReport.reportGeneration.mode);
  }

  const deliveryReport = withReportAccess(persistedReport, cacheInput);
  if (deliveryReport.reportAccess?.mode) {
    res.setHeader('X-OrcaTrade-Report-Access-Mode', deliveryReport.reportAccess.mode);
  }
  if (deliveryReport.reportAccess?.expiresAt) {
    res.setHeader('X-OrcaTrade-Report-Access-Expires-At', deliveryReport.reportAccess.expiresAt);
  }
  if (deliveryReport.accountAccess?.mode) {
    res.setHeader('X-OrcaTrade-Account-Access-Mode', deliveryReport.accountAccess.mode);
  }
  if (deliveryReport.accountAccess?.expiresAt) {
    res.setHeader('X-OrcaTrade-Account-Access-Expires-At', deliveryReport.accountAccess.expiresAt);
  }

  return res.status(200).json(deliveryReport);
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-OrcaTrade-Cache-Preference, X-Request-Id');
  const requestContext = buildRequestContext(req, 'compliance-report');
  applyRequestHeaders(res, requestContext);

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const rate = await consumeRateLimit('compliance-report', requestContext.ip, 5, 60000);
  res.setHeader('X-OrcaTrade-Storage-Mode', rate.storageMode);
  if (rate.limited) {
    emitAuditEvent(requestContext, 'check.rate_limited', { storageMode: rate.storageMode });
    return res.status(429).json({ error: 'Too many requests. Please wait a moment.' });
  }

  let orderData = null;
  let cachePreference = 'essential';
  let cacheInput = null;
  let reportId = '';
  let timestamp = '';

  try {
    const validation = validateCompliancePayload(req.body, { mode: 'report' });
    if (!validation.ok) {
      return res.status(422).json({
        error: 'Missing required fields for the full compliance report.',
        details: validation.errors,
      });
    }

    orderData = validation.normalizedOrderData;
    if (validation.evidenceBundle?.bundleId) {
      const persistedEvidence = await persistEvidenceBundle(validation.evidenceBundle, orderData, REPORT_PERSIST_TTL_MS);
      res.setHeader('X-OrcaTrade-Evidence-Bundle', persistedEvidence.bundleId);
      res.setHeader('X-OrcaTrade-Storage-Mode', persistedEvidence.storageMode || rate.storageMode || 'memory');
    }
    cachePreference = getCachePreference(req);
    const {
      productCategory = '',
      productDescription = '',
      origin = '',
      supplierName = 'Not provided',
      importValue = 'Not specified',
      companySize = 'Not specified',
      employeeCount = 'Not specified',
      globalTurnover = 'Not specified',
      cnCode = '',
      geolocationAvailable = null,
      dueDiligenceStatement = null,
      supplierEmissionsData = null,
      authorisedDeclarant = null,
      evidenceBundleId = '',
      evidenceSummary = '',
      evidenceDocumentCount = 0,
      euMarket = true,
    } = orderData;

    const applicability = validation.applicability;
    cacheInput = normaliseCheckCacheInput(orderData);

    if (canUseFullReportCache(cachePreference)) {
      const cached = await getSharedCacheValue('compliance-report', cacheInput);
      if (cached) {
        const deliveryReport = withReportAccess(cached.value, cacheInput);
        res.setHeader('X-OrcaTrade-Cache', 'HIT');
        res.setHeader('X-OrcaTrade-Storage-Mode', cached.storageMode);
        res.setHeader('Cache-Control', 'no-store');
        if (deliveryReport?.reportId) {
          res.setHeader('X-OrcaTrade-Report-Id', deliveryReport.reportId);
        }
        if (deliveryReport?.reportLineage?.reportFamilyId) {
          res.setHeader('X-OrcaTrade-Report-Family', deliveryReport.reportLineage.reportFamilyId);
        }
        if (deliveryReport?.reportLineage?.reportVersion) {
          res.setHeader('X-OrcaTrade-Report-Version', String(deliveryReport.reportLineage.reportVersion));
        }
        if (deliveryReport?.evidenceSnapshot?.snapshotId) {
          res.setHeader('X-OrcaTrade-Evidence-Snapshot', deliveryReport.evidenceSnapshot.snapshotId);
        }
        if (deliveryReport?.documentEvidence?.bundleId) {
          res.setHeader('X-OrcaTrade-Evidence-Bundle', deliveryReport.documentEvidence.bundleId);
        }
        if (deliveryReport?.reportGeneration?.mode) {
          res.setHeader('X-OrcaTrade-Generation-Mode', deliveryReport.reportGeneration.mode);
        }
        if (deliveryReport?.reportAccess?.mode) {
          res.setHeader('X-OrcaTrade-Report-Access-Mode', deliveryReport.reportAccess.mode);
        }
        if (deliveryReport?.reportAccess?.expiresAt) {
          res.setHeader('X-OrcaTrade-Report-Access-Expires-At', deliveryReport.reportAccess.expiresAt);
        }
        if (deliveryReport?.accountAccess?.mode) {
          res.setHeader('X-OrcaTrade-Account-Access-Mode', deliveryReport.accountAccess.mode);
        }
        if (deliveryReport?.accountAccess?.expiresAt) {
          res.setHeader('X-OrcaTrade-Account-Access-Expires-At', deliveryReport.accountAccess.expiresAt);
        }
        return res.status(200).json(deliveryReport);
      }
    }

    const storedReport = await getStoredComplianceReportByRequest(cacheInput);
    if (storedReport && storedReport.report) {
      const deliveryReport = withReportAccess(storedReport.report, { requestFingerprint: storedReport.requestFingerprint });
      res.setHeader('X-OrcaTrade-Cache', 'REUSED');
      res.setHeader('X-OrcaTrade-Storage-Mode', storedReport.storageMode);
      res.setHeader('Cache-Control', 'no-store');
      if (deliveryReport?.reportId) {
        res.setHeader('X-OrcaTrade-Report-Id', deliveryReport.reportId);
      }
      if (deliveryReport?.reportLineage?.reportFamilyId) {
        res.setHeader('X-OrcaTrade-Report-Family', deliveryReport.reportLineage.reportFamilyId);
      }
      if (deliveryReport?.reportLineage?.reportVersion) {
        res.setHeader('X-OrcaTrade-Report-Version', String(deliveryReport.reportLineage.reportVersion));
      }
      if (deliveryReport?.evidenceSnapshot?.snapshotId) {
        res.setHeader('X-OrcaTrade-Evidence-Snapshot', deliveryReport.evidenceSnapshot.snapshotId);
      }
      if (deliveryReport?.documentEvidence?.bundleId) {
        res.setHeader('X-OrcaTrade-Evidence-Bundle', deliveryReport.documentEvidence.bundleId);
      }
      if (deliveryReport?.reportGeneration?.mode) {
        res.setHeader('X-OrcaTrade-Generation-Mode', deliveryReport.reportGeneration.mode);
      }
      if (deliveryReport?.reportAccess?.mode) {
        res.setHeader('X-OrcaTrade-Report-Access-Mode', deliveryReport.reportAccess.mode);
      }
      if (deliveryReport?.reportAccess?.expiresAt) {
        res.setHeader('X-OrcaTrade-Report-Access-Expires-At', deliveryReport.reportAccess.expiresAt);
      }
      if (deliveryReport?.accountAccess?.mode) {
        res.setHeader('X-OrcaTrade-Account-Access-Mode', deliveryReport.accountAccess.mode);
      }
      if (deliveryReport?.accountAccess?.expiresAt) {
        res.setHeader('X-OrcaTrade-Account-Access-Expires-At', deliveryReport.accountAccess.expiresAt);
      }
      return res.status(200).json(deliveryReport);
    }

    const year = new Date().getFullYear();
    reportId = `OT-COMP-${year}-${Math.floor(100000 + Math.random() * 900000)}`;
    timestamp = new Date().toISOString();
    const anthropicApiKey = process.env.ORCATRADE_OS_API;
    if (!anthropicApiKey) {
      const fallbackReport = buildDeterministicFallbackReport(orderData, {
        reportId,
        timestamp,
        reason: 'The Anthropic API key is not configured, so OrcaTrade returned a deterministic rules-based report.',
      });
      emitAuditEvent(requestContext, 'check.fallback_report', {
        reportId,
        reason: 'missing_api_key',
      });
      void sendComplianceSummaryEmail(fallbackReport, orderData);
      return sendReport(res, cachePreference, cacheInput, fallbackReport, orderData);
    }

    const systemPrompt = `You are OrcaTrade Intelligence, a senior EU trade compliance engine with expert knowledge of:
- EUDR: Regulation (EU) 2023/1115 — EU Deforestation Regulation
- CBAM: Regulation (EU) 2023/956 — Carbon Border Adjustment Mechanism
- CSDDD: Directive (EU) 2024/1760 — Corporate Sustainability Due Diligence

You produce LEGALLY PRECISE, DEEPLY SPECIFIC compliance reports.
Every finding MUST cite the exact Article number.
Every financial risk MUST show the calculation formula.
Every required action MUST name the exact document and EU portal.
Never be vague. Never say "may be required". State obligations definitively.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STATUS AND SCORE RULES — READ CAREFULLY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

STATUS is determined by the WORST applicable regulation result, in this strict hierarchy:

  non_compliant > at_risk > compliant > not_applicable

APPLICABILITY STATUS meanings:
- "applicable": the regulation is currently live on the provided facts
- "future_scope": the goods/company appear to fall within scope, but the binding application date is still in the future
- "insufficient_data": the software cannot safely decide scope because key facts are missing

REGULATION STATUS ASSIGNMENT RULES (mandatory):
- "not_applicable": regulation does not apply to this product/company. No score impact.
- "non_compliant": regulation applies AND at least ONE of:
    • a finding with severity "critical" exists
    • a mandatory legal prerequisite is unmet (e.g. not registered as CBAM declarant
      when CBAM applies, no georeferenced data when EUDR applies)
    • import would be legally prohibited without this missing element
- "at_risk": regulation applies AND at least ONE of:
    • a finding with severity "major" exists
    • required actions are outstanding but import is not yet prohibited
    • missing data that creates uncertainty about an obligation
- "compliant": regulation applies AND all known obligations are satisfied or
    explicitly verified as not required. This requires positive evidence —
    NOT the absence of information.

SPECIAL CASES:
- If applicabilityStatus = "future_scope", current status MUST be "not_applicable" today.
  Do not assign current fines or current non-compliance, but do provide readiness actions.
- If applicabilityStatus = "insufficient_data", status MUST be "at_risk".
  State the missing facts explicitly and do not claim the regulation is compliant or out of scope.

CRITICAL RULE: You CANNOT mark a regulation "compliant" if:
  - you have identified any critical or major finding under it
  - you have listed any required actions under it
  - the importer has not verified they have met the legal prerequisites

SCORE CALCULATION (mandatory, calculate after setting all regulation statuses):
  Start at 100
  For each regulation where applicable = true:
    - status = non_compliant → subtract 35
    - status = at_risk       → subtract 15
    - status = compliant     → subtract 0
    - status = not_applicable → subtract 0
  Score cannot go below 0.

OVERALL STATUS (mandatory, derived from individual regulation statuses):
  If ANY applicable regulation is non_compliant → overallStatus = "non_compliant"
  Else if ANY applicable regulation is at_risk  → overallStatus = "at_risk"
  Else all applicable regulations are compliant  → overallStatus = "compliant"

A score of 100 and overallStatus "compliant" is ONLY valid when:
  - Every applicable regulation has status "compliant" with verified evidence
  - No findings of any severity exist
  - No required actions are listed

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CBAM SECTOR RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Covered sectors per Annex I of Regulation (EU) 2023/956:
  cement, iron, steel, aluminium, fertilisers, electricity, hydrogen
NOT covered: wood, furniture, textiles, food, chemicals, plastics,
  electronics, rubber, paper, glass (unless produced in a covered process).
If product is not in a covered sector: applicable = false, status = "not_applicable".
If uncertain about CN code classification, state that explicitly in applicabilityReason.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EUDR RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Applies to: cattle, cocoa, coffee, palm oil, soya, wood, rubber and derived products.
Derived products include: leather, chocolate, furniture, paper, printed matter.
Check Article 1 and Annex I of Regulation (EU) 2023/1115 to determine applicability.
Application dates:
- 30 December 2026 for large and medium operators/traders
- 30 June 2027 for micro and small operators/traders
If the application date has not yet arrived, set applicabilityStatus = "future_scope" and current status = "not_applicable".
Once the application date has passed and EUDR applies: operator MUST have georeferenced polygon data per Article 9.
Missing polygon data after the application date = critical finding = non_compliant.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CSDDD RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Do NOT model CSDDD as a simple current order-clearance rule.
Use phased application thresholds:
- 26 July 2027: more than 5,000 employees and more than €1.5bn global turnover
- 26 July 2028: more than 3,000 employees and more than €900m global turnover
- 26 July 2029: more than 1,000 employees and more than €450m global turnover
If the threshold appears relevant but the date is still in the future, set applicabilityStatus = "future_scope" and current status = "not_applicable".
If global turnover or exact threshold facts are missing, set applicabilityStatus = "insufficient_data" and current status = "at_risk".

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FINANCIAL RISK — EUDR
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Minimum fine: €10,000 per infringement per Article 25(2)(a)
Maximum fine: up to 4% of annual EU turnover per Article 25(2)(a)
Use import value as turnover proxy. Show the calculation.
Additional: seizure per Article 25(2)(b), procurement ban per Article 25(2)(d).

DETERMINISTIC PRE-CHECK — YOU MUST RESPECT THIS UNLESS USER DATA CLEARLY CONTRADICTS IT
- Assessment date: ${resolveAsOfDate(orderData)}
- EUDR applicabilityStatus: ${applicability.EUDR.applicabilityStatus.toUpperCase()} — ${applicability.EUDR.applicabilityReason}${applicability.EUDR.futureApplicabilityDate ? ` Future date: ${applicability.EUDR.futureApplicabilityDate}.` : ''}${applicability.EUDR.missingFacts.length ? ` Missing facts: ${applicability.EUDR.missingFacts.join(', ')}.` : ''}
- CBAM applicabilityStatus: ${applicability.CBAM.applicabilityStatus.toUpperCase()} — ${applicability.CBAM.applicabilityReason}${applicability.CBAM.futureApplicabilityDate ? ` Future date: ${applicability.CBAM.futureApplicabilityDate}.` : ''}${applicability.CBAM.missingFacts.length ? ` Missing facts: ${applicability.CBAM.missingFacts.join(', ')}.` : ''}
- CSDDD applicabilityStatus: ${applicability.CSDDD.applicabilityStatus.toUpperCase()} — ${applicability.CSDDD.applicabilityReason}${applicability.CSDDD.futureApplicabilityDate ? ` Future date: ${applicability.CSDDD.futureApplicabilityDate}.` : ''}${applicability.CSDDD.missingFacts.length ? ` Missing facts: ${applicability.CSDDD.missingFacts.join(', ')}.` : ''}

If a document evidence bundle is provided below, treat its extracted facts as evidence-backed context unless the rest of the payload clearly contradicts it.

Return ONLY valid JSON. No markdown. No text outside the JSON object.`;

    const userPrompt = `Generate a detailed compliance report for this import order:

Product category: ${productCategory}
Product description: ${productDescription}
Country of origin: ${origin}
Supplier name: ${supplierName}
Annual import value: ${importValue}
Company size: ${companySize}
Exact employee count: ${employeeCount || 'Not provided'}
Global turnover: ${globalTurnover || 'Not provided'}
CN / HS code: ${cnCode || 'Not provided'}
Geolocation evidence available: ${geolocationAvailable === null ? 'Unknown' : geolocationAvailable ? 'Yes' : 'No'}
Due-diligence statement ready: ${dueDiligenceStatement === null ? 'Unknown' : dueDiligenceStatement ? 'Yes' : 'No'}
Supplier emissions data available: ${supplierEmissionsData === null ? 'Unknown' : supplierEmissionsData ? 'Yes' : 'No'}
Authorised CBAM declarant ready: ${authorisedDeclarant === null ? 'Unknown' : authorisedDeclarant ? 'Yes' : 'No'}
Document evidence bundle: ${evidenceBundleId || 'None'}
Document evidence count: ${evidenceDocumentCount || 0}
Document evidence summary: ${evidenceSummary || 'No document evidence submitted'}
Placing on EU market: ${euMarket ? 'Yes' : 'No'}

IMPORTANT: Follow the STATUS AND SCORE RULES exactly. Do not mark a regulation
compliant if you have listed findings or required actions under it.
Derive overallStatus and overallScore from the regulation statuses after setting them.

Return ONLY this JSON object with no markdown wrapping:
{
  "reportId": "${reportId}",
  "timestamp": "${timestamp}",
  "overallStatus": "non_compliant | at_risk | compliant",
  "overallScore": <number 0-100 calculated per rules above>,
  "executiveSummary": "3 sentences. Sentence 1: what regulations apply and why. Sentence 2: what the most critical unresolved obligation is, with article citation. Sentence 3: the single most urgent action the importer must take.",
  "checkedRegulations": [
    {
      "regulation": "EUDR",
      "applicable": <boolean>,
      "applicabilityStatus": "applicable | future_scope | insufficient_data | not_applicable",
      "applicabilityReason": "cite specific articles. If uncertain about CN code, state that.",
      "futureApplicabilityDate": "YYYY-MM-DD or null",
      "missingFacts": ["array of missing facts if any"],
      "readinessActions": ["array of readiness actions if future scope"],
      "confidence": "high | medium | low",
      "requiresManualReview": <boolean>,
      "status": "non_compliant | at_risk | compliant | not_applicable",
      "legalBasis": "Regulation (EU) 2023/1115 of the European Parliament and of the Council",
      "keyObligation": "exact obligation with article citation, or Not applicable",
      "currentGap": "specific missing element, or N/A",
      "findings": [
        {
          "finding": "specific finding text",
          "severity": "critical | major | minor",
          "article": "Article X(Y) of Regulation (EU) 2023/1115",
          "legalImplication": "exact legal consequence"
        }
      ],
      "requiredActions": [
        {
          "step": 1,
          "action": "specific action",
          "documentRequired": "exact document name",
          "portal": "exact EU portal or authority",
          "deadline": "specific date or trigger",
          "estimatedHours": <number>,
          "estimatedCostEur": "EUR range"
        }
      ],
      "financialRisk": {
        "minimumFineEur": <number>,
        "maximumFineEur": <number>,
        "calculationExplained": "formula shown explicitly",
        "additionalRisks": ["array of strings"]
      },
      "complianceDeadline": "specific date with context"
    },
    {
      "regulation": "CBAM",
      "applicable": <boolean — false if product not in Annex I covered sectors>,
      "applicabilityStatus": "applicable | insufficient_data | not_applicable",
      "applicabilityReason": "cite Annex I of Regulation (EU) 2023/956. State clearly if not covered.",
      "futureApplicabilityDate": "YYYY-MM-DD or null",
      "missingFacts": ["array of missing facts if any"],
      "readinessActions": ["array of readiness actions if useful"],
      "confidence": "high | medium | low",
      "requiresManualReview": <boolean>,
      "status": "non_compliant | at_risk | compliant | not_applicable",
      "legalBasis": "Regulation (EU) 2023/956 of the European Parliament and of the Council",
      "keyObligation": "obligation or Not applicable",
      "currentGap": "gap or N/A",
      "findings": [],
      "requiredActions": [],
      "financialRisk": {
        "minimumFineEur": <number>,
        "maximumFineEur": <number>,
        "calculationExplained": "explanation or Not applicable",
        "additionalRisks": []
      },
      "complianceDeadline": "date or N/A"
    },
    {
      "regulation": "CSDDD",
      "applicable": <boolean — true only if the relevant phased threshold is live on the assessment date>,
      "applicabilityStatus": "applicable | future_scope | insufficient_data | not_applicable",
      "applicabilityReason": "cite the phased threshold logic of Directive (EU) 2024/1760 and the company data provided",
      "futureApplicabilityDate": "YYYY-MM-DD or null",
      "missingFacts": ["array of missing facts if any"],
      "readinessActions": ["array of readiness actions if future scope"],
      "confidence": "high | medium | low",
      "requiresManualReview": <boolean>,
      "status": "non_compliant | at_risk | compliant | not_applicable",
      "legalBasis": "Directive (EU) 2024/1760 of the European Parliament and of the Council",
      "keyObligation": "obligation or Not applicable",
      "currentGap": "gap or N/A",
      "findings": [],
      "requiredActions": [],
      "financialRisk": {
        "minimumFineEur": <number>,
        "maximumFineEur": <number>,
        "calculationExplained": "explanation or Not applicable",
        "additionalRisks": []
      },
      "complianceDeadline": "date or N/A"
    }
  ],
  "priorityActions": [
    {
      "rank": 1,
      "action": "specific action",
      "urgency": "Immediate — within 7 days | Within 30 days | Within 90 days",
      "estimatedCostEur": "EUR range",
      "consequenceIfIgnored": "specific legal or financial consequence"
    }
  ],
  "totalFinancialExposure": {
    "minimumEur": <number>,
    "maximumEur": <number>,
    "calculationBreakdown": "regulation by regulation breakdown"
  },
  "disclaimer": "This report is generated by OrcaTrade Intelligence based on information provided by the user. It does not constitute legal advice and should not be relied upon as such. For binding legal opinions on EU trade compliance obligations, consult a qualified EU trade law practitioner. Report ID: ${reportId}. Generated: ${timestamp}."
}`;

    const modelResponse = await requestAnthropicMessage({
      apiKey: anthropicApiKey,
      model: 'claude-sonnet-4-6',
      maxTokens: 8000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      timeoutMs: REPORT_MODEL_TIMEOUT_MS,
      retries: REPORT_MODEL_RETRIES,
    });
    const data = modelResponse.data;
    let assistantText = extractAnthropicText(data);

    const fenceMatch = assistantText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (fenceMatch) assistantText = fenceMatch[1];

    let report;
    try {
      report = JSON.parse(assistantText);
    } catch {
      const objMatch = assistantText.match(/\{[\s\S]*\}/);
      if (objMatch) {
        try { report = JSON.parse(objMatch[0]); }
        catch (e) {
          console.error('JSON parse error:', e, assistantText.slice(0, 500));
          const fallbackReport = buildDeterministicFallbackReport(orderData, {
            reportId,
            timestamp,
            reason: 'The AI response could not be parsed into valid JSON, so OrcaTrade returned a deterministic rules-based report instead.',
          });
          emitAuditEvent(requestContext, 'check.fallback_report', {
            reportId,
            reason: 'json_parse_error',
          });
          void sendComplianceSummaryEmail(fallbackReport, orderData);
          return sendReport(res, cachePreference, cacheInput, fallbackReport, orderData);
        }
      } else {
        const fallbackReport = buildDeterministicFallbackReport(orderData, {
          reportId,
          timestamp,
          reason: 'The AI response did not contain a valid JSON payload, so OrcaTrade returned a deterministic rules-based report instead.',
        });
        emitAuditEvent(requestContext, 'check.fallback_report', {
          reportId,
          reason: 'missing_json_payload',
        });
        void sendComplianceSummaryEmail(fallbackReport, orderData);
        return sendReport(res, cachePreference, cacheInput, fallbackReport, orderData);
      }
    }

    // ── Server-side compliance logic enforcement ──────────────────────
    // The AI may hallucinate a "compliant" status despite having findings
    // or required actions. This sanitiser enforces the correct hierarchy.
    report = enforceComplianceLogic({
      ...report,
      reportGeneration: {
        mode: 'ai_assisted',
        source: 'claude-sonnet-4-6',
        reason: 'AI draft validated and corrected by OrcaTrade deterministic rules.',
        modelRuntime: {
          timeoutMs: REPORT_MODEL_TIMEOUT_MS,
          retries: REPORT_MODEL_RETRIES,
          attemptsUsed: modelResponse.attemptsUsed,
          durationMs: modelResponse.durationMs,
        },
      },
    }, orderData);
    // ─────────────────────────────────────────────────────────────────

    void sendComplianceSummaryEmail(report, orderData);
    emitAuditEvent(requestContext, 'check.completed', {
      reportId: cleanString(report.reportId),
      overallStatus: cleanString(report.overallStatus),
      generationMode: cleanString(report.reportGeneration?.mode),
    });
    return sendReport(res, cachePreference, cacheInput, report, orderData);

  } catch (error) {
    emitAuditEvent(requestContext, 'check.failed', {
      message: cleanString(error.message),
    });
    console.error('Handler error:', error);
    if (orderData) {
      const providerDetail = cleanString(error.responseText).slice(0, 240);
      const fallbackReport = buildDeterministicFallbackReport(orderData, {
        reportId,
        timestamp,
        reason: `Unexpected compliance handler error: ${cleanString(error.message) || 'Unknown error'}. OrcaTrade returned a deterministic rules-based report instead.${error.timedOut ? ` The model request timed out after ${REPORT_MODEL_TIMEOUT_MS}ms.` : ''}${providerDetail ? ` Provider detail: ${providerDetail}` : ''}`,
      });
      emitAuditEvent(requestContext, 'check.fallback_report', {
        reportId,
        reason: 'handler_error',
      });
      void sendComplianceSummaryEmail(fallbackReport, orderData);
      return sendReport(res, cachePreference, cacheInput || normaliseCheckCacheInput(orderData), fallbackReport, orderData);
    }
    return res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
};
