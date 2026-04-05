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

    const systemPrompt = `You are OrcaTrade Intelligence's factory scoring engine. You are an expert in Asian manufacturing, supply chain risk, and EU trade compliance. Generate realistic, detailed, plausible factory intelligence data based on the user's search query. Match the factories to what the user is actually searching for — product type, country, and category must be relevant. Scores should feel real — not all high, include genuine variation. Be specific with factory names, locations, and findings. Always return valid JSON only. No markdown, no explanation, just JSON.

CRITICAL SCORING RULES:
- ALL scores (riskScore, financialScore, complianceScore, capacityScore, auditScore) are SAFETY scores where 100 = best/safest and 0 = worst/most dangerous. High numbers are GOOD.
- riskScore MUST be calculated as the weighted average of the four sub-scores using this exact formula: Math.round((financialScore * 0.3) + (complianceScore * 0.25) + (capacityScore * 0.25) + (auditScore * 0.2)). Never generate riskScore independently.
- A factory with financialScore 90, complianceScore 88, capacityScore 85, auditScore 82 must have riskScore of Math.round(90*0.3 + 88*0.25 + 85*0.25 + 82*0.2) = Math.round(27+22+21.25+16.4) = 87.`;

    const userPrompt = `Generate 6 factory results for a search with these parameters:
Query: ${query || 'general manufacturing'}
Product category: ${category || 'Any'}
Country: ${country || 'Any'}
Risk tolerance: ${riskTolerance || 'medium'}

The factories MUST be relevant to the query above. If the query mentions a specific product (e.g. shoes, furniture, electronics), all factories should specialise in that product type. If a country is specified, factories should be in that country.

Remember: riskScore = Math.round((financialScore * 0.3) + (complianceScore * 0.25) + (capacityScore * 0.25) + (auditScore * 0.2)). Calculate this for every factory before writing the JSON.

Return a JSON object with this exact structure:
{
  "factories": [
    {
      "id": "unique string",
      "name": "realistic factory name",
      "city": "real city",
      "country": "country",
      "speciality": "specific product type matching the query",
      "riskScore": number 0-100 (MUST equal Math.round(financialScore*0.3 + complianceScore*0.25 + capacityScore*0.25 + auditScore*0.2)),
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