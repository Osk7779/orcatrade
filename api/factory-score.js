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

  const effectiveCountry = (country && country !== 'Any') ? country : 'China';
  const effectiveCategory = (category && category !== 'Any') ? category : 'General Manufacturing';

  const isExactLookup = Boolean(
    query &&
    query.trim().length > 3 &&
    /\b(co\.?|ltd\.?|limited|inc\.?|corp\.?|industries|industrial|manufacturing|mfg|group|works|technology|tech|trading|electronics|textiles|furniture|plastics|metals?)\b/i.test(query)
  );

  try {
    const systemPrompt = `You are OrcaTrade Intelligence's factory scoring engine. You are an expert in Asian manufacturing, supply chain risk, and EU trade compliance.

Your job: generate realistic, specific factory intelligence exactly matching what the user searches for.

Rules:
- The factories MUST directly match the query. If the user searches "Nike" return Nike factories. If they search "Samsung" return Samsung facilities. If they search "shoe manufacturers Vietnam" return Vietnamese shoe factories.
- riskScore = Math.round(financialScore*0.3 + complianceScore*0.25 + capacityScore*0.25 + auditScore*0.2)
- Return only valid JSON. No markdown, no explanation.
- Use real manufacturing cities in the specified country.
- Vary scores realistically — not all high.`;

    const countNote = isExactLookup
      ? `This is an EXACT company lookup for "${query}". Return 1 factory tied to that specific company name.`
      : `Return 6 factories matching this market scan.`;

    const userPrompt = `${countNote}

Query: "${query || 'manufacturer search'}"
Country: "${effectiveCountry}"
Category: "${effectiveCategory}"
Risk tolerance: "${riskTolerance || 'Any'}"

Return JSON:
{
  "factories": [
    {
      "id": "string",
      "name": "string",
      "city": "string",
      "country": "${effectiveCountry}",
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
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2500,
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