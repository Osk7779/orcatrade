const { CATEGORY_SPECIALITIES, COUNTRY_CITIES } = require('../lib/intelligence/catalog');
const { extractAnthropicText, requestAnthropicMessage } = require('../lib/intelligence/model-runtime');
const {
  extractRequestedFactoryName,
  findDirectoryFactories,
  isSpecificFactoryLookup,
  normalizeFactorySearch,
  sanitizeFactoryResults,
} = require('../lib/intelligence/factory-risk');

const FACTORY_MODEL_TIMEOUT_MS = 6000;
const FACTORY_MODEL_RETRIES = 0;

function extractJsonObject(text) {
  const cleaned = String(text || '')
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  const match = cleaned.match(/\{[\s\S]*\}/);
  return match ? match[0] : cleaned;
}

function sendFactoryResponse(res, payload, generationMode) {
  res.setHeader('X-OrcaTrade-Generation-Mode', generationMode);
  return res.status(200).json({
    ...payload,
    generationMode,
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const filters = normalizeFactorySearch(req.body || {});
  const exactFactorySearch = isSpecificFactoryLookup(filters);
  const requestedFactoryName = extractRequestedFactoryName(filters.query, filters);
  const directoryCandidates = findDirectoryFactories(filters, exactFactorySearch ? 1 : 6);
  const allowedCities = (COUNTRY_CITIES[filters.country] || COUNTRY_CITIES.China).join(', ');
  const allowedSpecialities = (CATEGORY_SPECIALITIES[filters.category] || CATEGORY_SPECIALITIES.Other).join(', ');

  if (!process.env.ORCATRADE_OS_API) {
    return sendFactoryResponse(res, sanitizeFactoryResults(null, filters), 'deterministic_fallback');
  }

  if (exactFactorySearch && directoryCandidates.length) {
    return sendFactoryResponse(res, sanitizeFactoryResults({ factories: directoryCandidates }, filters), 'directory_match');
  }

  try {
    const systemPrompt = `You are OrcaTrade Intelligence's factory scoring engine.
Return only valid JSON. No markdown. No explanation.

Hard constraints:
- Return exactly ${exactFactorySearch ? '1 factory' : '6 factories'}.
- Every factory must match the requested country and category filters exactly when they are provided.
- riskScore MUST equal Math.round(financialScore*0.3 + complianceScore*0.25 + capacityScore*0.25 + auditScore*0.2).
- complianceScore, financialScore, capacityScore, and auditScore are all safety scores where high is good.
- Be conservative: if a certification, audit, or compliance fact is uncertain, prefer Pending or At Risk over Verified.
- Use realistic manufacturing cities only.
${exactFactorySearch ? `- This is an exact factory lookup for "${requestedFactoryName}". Keep the result tied to that company name and do not substitute alternative factories.
- If details are uncertain, preserve the requested company name and use conservative findings rather than inventing a different supplier.` : '' }

Country focus: ${filters.countryConstraint || 'Best-fit Asian sourcing market'}
Allowed cities for ${filters.country}: ${allowedCities}
Category focus: ${filters.categoryConstraint || 'Best-fit category from the query'}
Allowed specialities for ${filters.category}: ${allowedSpecialities}`;

    const userPrompt = `Generate factory intelligence for this search:
Query: "${filters.query || 'manufacturer search'}"
Country filter: "${filters.countryConstraint || 'Any'}"
Category filter: "${filters.categoryConstraint || 'Any'}"
Risk tolerance: "${filters.riskTolerance}"
Search mode: "${exactFactorySearch ? `Exact factory lookup for ${requestedFactoryName}` : 'Market scan'}"

Return this exact JSON shape:
{
  "factories": [
    {
      "id": "string",
      "name": "string",
      "city": "string",
      "country": "string",
      "speciality": "string",
      "riskScore": 0,
      "financialScore": 0,
      "complianceScore": 0,
      "capacityScore": 0,
      "auditScore": 0,
      "complianceStatus": "Verified | Pending | At Risk",
      "capacityStatus": "Full | Partial | Low",
      "auditStatus": "Passed | Due | Overdue",
      "established": 2015,
      "employees": "500-1000",
      "exportMarkets": ["EU", "US"],
      "certifications": ["ISO 9001"],
      "moq": "1000 units",
      "leadTime": "25-35 days",
      "paymentTerms": ["T/T"],
      "orcatradeStatus": "Verified Partner | Under Review | Flagged",
      "findings": [{ "text": "string", "severity": "green | amber | red" }],
      "requiredActions": ["string"],
      "eudr": { "status": "Compliant | At Risk | N/A", "reason": "string" },
      "cbam": { "status": "Compliant | At Risk | N/A", "reason": "string" },
      "csddd": { "status": "Compliant | At Risk", "reason": "string" }
    }
  ]
}`;

    const message = await requestAnthropicMessage({
      apiKey: process.env.ORCATRADE_OS_API,
      model: 'claude-sonnet-4-6',
      maxTokens: 3200,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      timeoutMs: FACTORY_MODEL_TIMEOUT_MS,
      retries: FACTORY_MODEL_RETRIES,
    });

    const textResponse = extractJsonObject(extractAnthropicText(message.data));
    const parsed = JSON.parse(textResponse);
    return sendFactoryResponse(res, sanitizeFactoryResults(parsed, filters), 'model');
  } catch (error) {
    console.error('Factory score error:', error.message);
    return sendFactoryResponse(res, sanitizeFactoryResults(null, filters), 'deterministic_fallback');
  }
};
