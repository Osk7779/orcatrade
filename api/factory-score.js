const Anthropic = require('@anthropic-ai/sdk');

const MOCK_RESPONSE = {
  factories: [
    {
      id: "f_10294",
      name: "Shenzhen Global Tech Manufacturing Ltd.",
      city: "Shenzhen",
      country: "China",
      speciality: "Electronics & Components",
      riskScore: 86,
      financialScore: 92,
      complianceScore: 88,
      capacityScore: 78,
      auditScore: 85,
      complianceStatus: "Verified",
      capacityStatus: "Full",
      auditStatus: "Passed",
      established: 2012,
      employees: "1000-5000",
      exportMarkets: ["EU", "US"],
      certifications: ["ISO 9001", "ISO 14001"],
      moq: "5000 units",
      leadTime: "30-45 days",
      paymentTerms: ["T/T", "L/C"],
      orcatradeStatus: "Verified Partner",
      findings: [
        { text: "Strong financial stability over last 4 quarters.", severity: "green" },
        { text: "Passed rigorous EU compliance audit in Q4 2025.", severity: "green" },
        { text: "Operating near peak capacity, slight risk to lead times.", severity: "amber" }
      ],
      requiredActions: [],
      eudr: { status: "N/A", reason: "Product category mostly exempt from EUDR." },
      cbam: { status: "Compliant", reason: "Has established carbon reporting protocols." },
      csddd: { status: "Compliant", reason: "Verified labor practices passing CSDDD threshold." }
    },
    {
      id: "f_10295",
      name: "Mekong Delta Assembly Co.",
      city: "Ho Chi Minh City",
      country: "Vietnam",
      speciality: "Textiles & Apparel",
      riskScore: 67,
      financialScore: 65,
      complianceScore: 50,
      capacityScore: 90,
      auditScore: 60,
      complianceStatus: "Pending",
      capacityStatus: "Full",
      auditStatus: "Due",
      established: 2018,
      employees: "500-1000",
      exportMarkets: ["EU", "UK", "Australia"],
      certifications: ["ISO 9001"],
      moq: "1000 units",
      leadTime: "20-30 days",
      paymentTerms: ["T/T"],
      orcatradeStatus: "Under Review",
      findings: [
        { text: "Excess production capacity available.", severity: "green" },
        { text: "Missing recent labor compliance audit (Due).", severity: "amber" },
        { text: "Minor gaps detected in worker safety protocols.", severity: "red" }
      ],
      requiredActions: [
        "Schedule immediate third-party factory audit.",
        "Request latest worker safety guidelines."
      ],
      eudr: { status: "N/A", reason: "Not subject to EUDR" },
      cbam: { status: "N/A", reason: "Not heavy emission sector" },
      csddd: { status: "At Risk", reason: "Pending labor transparency audit." }
    },
    {
      id: "f_10296",
      name: "Apex Precision Forging",
      city: "Pune",
      country: "India",
      speciality: "Steel & Metal Products",
      riskScore: 37,
      financialScore: 40,
      complianceScore: 35,
      capacityScore: 30,
      auditScore: 45,
      complianceStatus: "At Risk",
      capacityStatus: "Low",
      auditStatus: "Overdue",
      established: 2005,
      employees: "100-500",
      exportMarkets: ["US", "Middle East"],
      certifications: [],
      moq: "10,000 units",
      leadTime: "60-90 days",
      paymentTerms: ["50% Advance"],
      orcatradeStatus: "Flagged",
      findings: [
        { text: "Failed carbon emission spot check under CBAM.", severity: "red" },
        { text: "Operating at reduced capacity due to supply issues.", severity: "red" },
        { text: "Significant gaps in financial reporting.", severity: "amber" }
      ],
      requiredActions: [
        "Initiate urgent CBAM remediation plan.",
        "Freeze new orders until capacity recovers."
      ],
      eudr: { status: "N/A", reason: "N/A" },
      cbam: { status: "At Risk", reason: "High undocumented emission rates." },
      csddd: { status: "At Risk", reason: "Lacking basic ESG documentation." }
    }
  ]
};

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { query, category, country, riskTolerance } = req.body || {};

  if (!process.env.ORCATRADE_OS_API) {
    return res.status(200).json(MOCK_RESPONSE);
  }

  try {
    const client = new Anthropic({ apiKey: process.env.ORCATRADE_OS_API });

    const effectiveQuery = query || `${category} manufacturer in ${country}`;
    const effectiveCategory = category || 'Any';
    const effectiveCountry = country || 'Any';

    const systemPrompt = `You are generating factory search results for OrcaTrade Intelligence. You are an expert in Asian manufacturing, supply chain risk, and EU trade compliance. Return only valid JSON. No markdown. No explanation.

CRITICAL SEARCH RULES — the user's filters are HARD CONSTRAINTS, not suggestions:
- Every factory MUST be located in the specified country. If country is "China", every factory.country must be "China". Never return factories from other countries.
- Every factory MUST produce products in the specified category. If category is "Electronics & Components", every factory.speciality must be an electronics product. Never return factories from other industries.
- Factory names, cities, and specialities must be realistic and consistent with the country and category.

CRITICAL SCORING RULES:
- ALL scores are SAFETY scores: 100 = best/safest, 0 = worst/most dangerous. High numbers are GOOD.
- riskScore MUST equal Math.round((financialScore * 0.3) + (complianceScore * 0.25) + (capacityScore * 0.25) + (auditScore * 0.2)). Never generate riskScore independently.`;

    const userPrompt = `The user has searched with these EXACT filters — respect all of them strictly:

Search query: "${effectiveQuery}"
Product category: "${effectiveCategory}" — ALL factories must produce this exact category. Do not return factories from other industries.
Country: "${effectiveCountry}" — ALL factories must be located in this country. Do not return factories from other countries.
Risk tolerance: "${riskTolerance || 'Any risk level'}"

Generate exactly 6 factory results that PRECISELY match the search.
If the query contains a specific factory name, include that factory and 5 similar ones from the same country and category.
If the query is a product type, return 6 factories that make that specific product in the specified country.

VALIDATION — before writing each factory, confirm:
✓ factory.country matches "${effectiveCountry}" exactly
✓ factory.speciality is within the "${effectiveCategory}" category
✓ factory.city is a real manufacturing city in "${effectiveCountry}"
✓ riskScore = Math.round(financialScore*0.3 + complianceScore*0.25 + capacityScore*0.25 + auditScore*0.2)

Return a JSON object with this exact structure:
{
  "factories": [
    {
      "id": "unique string",
      "name": "realistic factory name matching country and category",
      "city": "real manufacturing city in ${effectiveCountry}",
      "country": "${effectiveCountry}",
      "speciality": "specific product type within ${effectiveCategory}",
      "riskScore": number 0-100 (calculated from formula above),
      "financialScore": number 0-100 (safety score, high = good),
      "complianceScore": number 0-100 (safety score, high = good),
      "capacityScore": number 0-100 (safety score, high = good),
      "auditScore": number 0-100 (safety score, high = good),
      "complianceStatus": "Verified" | "Pending" | "At Risk",
      "capacityStatus": "Full" | "Partial" | "Low",
      "auditStatus": "Passed" | "Due" | "Overdue",
      "established": year number,
      "employees": "range string e.g. 500-1000",
      "exportMarkets": ["EU", "US", "UK"],
      "certifications": ["ISO 9001", "etc"],
      "moq": "realistic range",
      "leadTime": "e.g. 25-35 days",
      "paymentTerms": ["T/T", "L/C"],
      "orcatradeStatus": "Verified Partner" | "Under Review" | "Flagged",
      "findings": [
        { "text": "specific finding", "severity": "green" | "amber" | "red" }
      ],
      "requiredActions": ["action 1", "action 2"],
      "eudr": { "status": "Compliant" | "At Risk" | "N/A", "reason": "one line" },
      "cbam": { "status": "Compliant" | "At Risk" | "N/A", "reason": "one line" },
      "csddd": { "status": "Compliant" | "At Risk" | "N/A", "reason": "one line" }
    }
  ]
}`;

    const message = await client.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    let textResponse = message.content?.[0]?.text || '';
    textResponse = textResponse.replace(/^```json\s*/i, '').replace(/```$/, '').trim();

    try {
      const parsed = JSON.parse(textResponse);
      return res.status(200).json(parsed);
    } catch (_) {
      return res.status(200).json(MOCK_RESPONSE);
    }

  } catch (err) {
    console.error('Factory score error:', err.message);
    return res.status(200).json(MOCK_RESPONSE);
  }
};