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

  // No API key — return demo data immediately
  if (!process.env.ANTHROPIC_API_KEY) {
    return mockResponse();
  }

  try {
    const systemPrompt = `You are OrcaTrade Intelligence's factory scoring engine. You are an expert in Asian manufacturing, supply chain risk, and EU trade compliance. Generate realistic, detailed, plausible factory intelligence data for demo purposes. Scores should feel real — not all high, include genuine variation. Be specific with factory names, locations, and findings. Always return valid JSON only. No markdown, no explanation, just JSON.`;

    const userPrompt = `Generate 6 factory results for a search with these parameters:
Query: ${query}
Product category: ${category}
Country: ${country}
Risk tolerance: ${riskTolerance}

Return a JSON object with this exact structure:
{
  "factories": [
    {
      "id": "unique string",
      "name": "realistic factory name",
      "city": "real city",
      "country": "country",
      "speciality": "specific product type",
      "riskScore": number 0-100,
      "financialScore": number 0-100,
      "complianceScore": number 0-100,
      "capacityScore": number 0-100,
      "auditScore": number 0-100,
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

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 4000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!response.ok) {
      console.error('Anthropic API error:', response.status, response.statusText);
      return mockResponse();
    }

    const data = await response.json();
    let textResponse = data.content?.[0]?.text || '';

    if (!textResponse) return mockResponse();

    textResponse = textResponse.replace(/^```json\s*/i, '').replace(/```$/, '').trim();

    try {
      const parsed = JSON.parse(textResponse);
      return new Response(JSON.stringify(parsed), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (_) {
      return mockResponse();
    }

  } catch (err) {
    console.error('Factory score handler error:', err);
    return mockResponse();
  }
}
