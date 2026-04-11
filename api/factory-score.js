export const config = {
  runtime: 'edge',
};

const MOCK_RESPONSE = {
  factories: [
    {
      id: "f_10294",
      name: "Shenzhen Global Tech Manufacturing Ltd.",
      city: "Shenzhen",
      country: "China",
      speciality: "Electronics & Components",
      riskScore: 84,
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
      riskScore: 62,
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
      riskScore: 41,
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

function mockResponse() {
  return new Response(JSON.stringify(MOCK_RESPONSE), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let query, category, country, riskTolerance;
  try {
    ({ query, category, country, riskTolerance } = await req.json());
  } catch (_) {
    return mockResponse();
  }

  if (!process.env.ORCATRADE_OS_API) {
    return mockResponse();
  }

  const effectiveCountry = (country && country !== 'Any') ? country : null;
  const effectiveCategory = (category && category !== 'Any') ? category : null;

  // Detect if user is looking for a specific named company vs a general market scan
  const trimmedQuery = (query || '').trim();
  const genericTerms = /^(manufacturer|supplier|factory|factories|suppliers|manufacturer search|search)s?$/i;
  const isExactLookup = Boolean(
    trimmedQuery.length > 1 &&
    !genericTerms.test(trimmedQuery) &&
    !/\b(manufacturers|suppliers|factories|find|best|top|show|list)\b/i.test(trimmedQuery)
  );

  try {
    const systemPrompt = `You are OrcaTrade Intelligence's factory scoring engine with deep knowledge of global manufacturing.

CRITICAL RULE: The search query is the most important input. You must return factories that directly match what was searched.
- If the query is a company name (e.g. "Nike", "Samsung", "Foxconn", "BYD"), return that company's actual manufacturing operations.
- If the query describes a product or market (e.g. "shoe manufacturers", "electronics suppliers"), return relevant factories in that space.
- NEVER return unrelated factories. The name, speciality, and findings must all relate to the query.
- riskScore MUST equal Math.round(financialScore*0.3 + complianceScore*0.25 + capacityScore*0.25 + auditScore*0.2)
- Return only valid JSON. No markdown, no explanation.
- Vary scores realistically — not everything should be green.`;

    const countNote = isExactLookup
      ? `The user is looking up a specific company: "${trimmedQuery}". Return exactly 1 factory for that company. Use the actual company name in the "name" field.`
      : `Market scan for "${trimmedQuery}". Return 6 relevant factories.`;

    const countryLine = effectiveCountry ? `Country filter: "${effectiveCountry}"` : `Country: Best-fit manufacturing country for this query`;
    const categoryLine = effectiveCategory ? `Category filter: "${effectiveCategory}"` : `Category: Best-fit category for this query`;

    const userPrompt = `${countNote}
${countryLine}
${categoryLine}
Risk tolerance: "${riskTolerance || 'Any'}"

Return JSON:
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
      "established": 2010,
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

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ORCATRADE_OS_API,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 3000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!response.ok) {
      console.error('Anthropic API error:', response.status);
      return mockResponse();
    }

    const data = await response.json();
    let textResponse = data.content?.[0]?.text || '';
    if (!textResponse) return mockResponse();

    textResponse = textResponse
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();

    const match = textResponse.match(/\{[\s\S]*\}/);
    if (match) textResponse = match[0];

    try {
      const parsed = JSON.parse(textResponse);
      if (!parsed.factories || !parsed.factories.length) return mockResponse();
      return new Response(JSON.stringify(parsed), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (_) {
      return mockResponse();
    }

  } catch (err) {
    console.error('Factory score error:', err.message);
    return mockResponse();
  }
}