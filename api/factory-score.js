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

  const selectedCountry = (country && country !== 'Any') ? country : null;
  const selectedCategory = (category && category !== 'Any') ? category : null;

  try {
    const systemPrompt = `You are a factory intelligence database for OrcaTrade. You return structured JSON data about real manufacturers.

CRITICAL RULES — you must follow every one of these exactly:
1. COUNTRY: Every single factory you return MUST be located in the country specified. If the country is China, ALL factories are in China. If Vietnam, ALL are in Vietnam. No exceptions.
2. CATEGORY: Every factory MUST produce products in the specified category. If Electronics, all factories make electronic products. If Textiles, all make garments or fabric. No mixing.
3. REAL NAMES: Use real, plausible manufacturer names for that country. Chinese factories use names like 'Shenzhen [X] Technology Co., Ltd.' Vietnamese factories use 'Vietnam [X] Manufacturing JSC.' Do not invent Western-sounding names for Asian factories.
4. REAL CITIES: Only use real manufacturing cities in the specified country. For China: Shenzhen, Guangzhou, Dongguan, Shanghai, Hangzhou, Suzhou, Ningbo, Qingdao, Tianjin. For Vietnam: Ho Chi Minh City, Hanoi, Binh Duong, Dong Nai, Hai Phong. For Indonesia: Jakarta, Surabaya, Bandung, Semarang, Bekasi.
5. SPECIFIC QUERY: If the user has typed a specific factory name in the query, include that factory as the first result and find 5 similar factories in the same country and category.
6. SCORE CONSISTENCY: riskScore MUST equal this formula rounded to nearest integer: (financialScore * 0.30) + (complianceScore * 0.25) + (capacityScore * 0.25) + (auditScore * 0.20). Never generate riskScore independently.
7. REALISTIC SCORES: Do not make every factory high-scoring. Include genuine variation — some factories should score in the 40s, some in the 80s. A realistic distribution looks like real due diligence data, not a marketing brochure.
8. Return ONLY valid JSON. No markdown. No explanation. No text outside the JSON object.`;

    const q = query || '';
    const cat = selectedCategory || 'General Manufacturing';
    const cty = selectedCountry || 'China';

    const userPrompt = `Generate exactly 6 factory results for this search.

Search query: '${q}'
Product category: '${cat}' — ALL factories must produce this.
Country: '${cty}' — ALL factories must be located here.
Risk filter: '${riskTolerance || 'Any'}'

If the query contains a specific company name, make that company result 1 and find 5 similar companies in the same country/category.

If the query is a product type or generic, return 6 factories that make '${cat}' products in '${cty}' specifically.

Validation checklist — verify each factory before including:
✓ factory.country matches '${cty}' exactly
✓ factory.city is a real city in '${cty}'
✓ factory.speciality is a product within '${cat}'
✓ factory.riskScore = round((financial*0.3)+(compliance*0.25)+(capacity*0.25)+(audit*0.20))
✓ factory name sounds like a real ${cty} manufacturer

Return this exact JSON structure:
{
  "factories": [
    {
      "id": "unique-string",
      "name": "Real manufacturer name",
      "city": "Real city in ${cty}",
      "country": "${cty}",
      "speciality": "Specific product type within ${cat}",
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
      "moq": "realistic MOQ",
      "leadTime": "e.g. 25-35 days",
      "paymentTerms": ["T/T", "L/C"],
      "orcatradeStatus": "Verified Partner | Under Review | Flagged",
      "findings": [{ "text": "specific finding", "severity": "green | amber | red" }],
      "requiredActions": ["action if any"],
      "eudr": { "status": "Compliant | At Risk | N/A", "reason": "one line" },
      "cbam": { "status": "Compliant | At Risk | N/A", "reason": "one line" },
      "csddd": { "status": "Compliant | At Risk | N/A", "reason": "one line" }
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
        max_tokens: 4000,
        temperature: 0.3,
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

    let parsed;
    try {
      parsed = JSON.parse(textResponse);
    } catch (_) {
      return mockResponse();
    }

    if (!parsed.factories || !parsed.factories.length) return mockResponse();

    // Hard validation: filter out factories that don't match the requested country
    if (selectedCountry) {
      parsed.factories = parsed.factories.filter(f =>
        f.country && f.country.toLowerCase().includes(selectedCountry.toLowerCase())
      );
    }

    if (!parsed.factories.length) {
      return new Response(JSON.stringify({
        error: 'No matching factories found for this country and category combination.',
        factories: [],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify(parsed), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('Factory score error:', err.message);
    return mockResponse();
  }
}