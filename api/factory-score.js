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

  let query, category, country;
  try {
    ({ query, category, country } = await req.json());
  } catch (_) {
    return mockResponse();
  }

  if (!process.env.ORCATRADE_OS_API) {
    return mockResponse();
  }

  const selectedCountry = (country && country !== 'Any') ? country : null;
  const selectedCategory = (category && category !== 'Any') ? category : null;

  // Strip only country names from query — NOT category words (breaks "Samsung Electronics")
  const countryNames = ['china', 'vietnam', 'indonesia', 'india', 'bangladesh',
    'thailand', 'malaysia', 'taiwan', 'south korea'];
  let cleanQuery = (query || '').trim();
  countryNames.forEach(c => {
    cleanQuery = cleanQuery.replace(new RegExp(`\\b${c}\\b`, 'gi'), '').trim();
  });
  if (!cleanQuery || cleanQuery.length < 2) cleanQuery = '';

  const cty = selectedCountry || 'China';
  const cat = selectedCategory || 'General Manufacturing';

  const genericSearchTerms = ['electronics', 'textiles', 'food', 'packaging', 'steel',
    'chemical', 'ceramic', 'rubber', 'any', 'manufacturer', 'factory', 'supplier'];
  const isSpecificCompany = cleanQuery.length > 2 &&
    !genericSearchTerms.includes(cleanQuery.toLowerCase());

  const specificBlock = isSpecificCompany
    ? `IMPORTANT: "${cleanQuery}" appears to be a specific company name. Result 1 MUST use this exact company name: "${cleanQuery}". Do not replace it with a different company name.`
    : `Return 6 diverse realistic factories making ${cat} products in ${cty}.`;

  try {
    const systemPrompt = `You are a factory intelligence database for OrcaTrade. You return JSON data about manufacturers.

SPECIFIC FACTORY LOOKUP RULE — most important rule:
If the user's query contains a specific company name (not a generic word like "electronics" or "textiles"), you MUST return that exact company as result number 1. Use its real name. Do not invent a different company name.

Examples of specific names: "Unilumin", "Foxconn", "BYD", "Samsung", "Haier", "Midea", "Luxshare"

Unilumin Group Co., Ltd. is a real company. It is headquartered in Shenzhen, China. It manufactures LED display screens and fine-pitch LED panels. Founded 2004. ~8000 employees. Ticker: 300055 on Shenzhen Stock Exchange.

If you recognise the searched company, use its real data.
If you don't recognise it, still use the exact name the user typed as result 1 and generate plausible data for it.

COUNTRY RULE: Every factory must be located in: ${cty}. factory.country must equal "${cty}" exactly.
SCORE RULE: riskScore = round((financial*0.3)+(compliance*0.25)+(capacity*0.25)+(audit*0.20))
REALISM: Include score variation — some 45-55, some 65-75, some 80+. Not all green.
OUTPUT RULE: Return ONLY valid JSON. No markdown. No explanation.`;

    const userPrompt = `Search query: "${cleanQuery}"
Country: ${cty}
Category: ${cat}

${specificBlock}

Return exactly this JSON structure:
{
  "factories": [
    {
      "id": "unique-string",
      "name": "exact company name — must be ${cleanQuery || 'realistic local name'} for result 1 if it is a specific company",
      "city": "real city in ${cty}",
      "country": "${cty}",
      "speciality": "specific product type within ${cat}",
      "riskScore": 0,
      "financialScore": 0,
      "complianceScore": 0,
      "capacityScore": 0,
      "auditScore": 0,
      "complianceStatus": "Verified | Pending | At Risk",
      "capacityStatus": "Full | Partial | Low",
      "auditStatus": "Passed | Due | Overdue",
      "established": 2005,
      "employees": "1000-5000",
      "exportMarkets": ["EU", "US"],
      "certifications": ["ISO 9001"],
      "moq": "1000 units",
      "leadTime": "25-35 days",
      "paymentTerms": ["T/T"],
      "orcatradeStatus": "Verified Partner | Under Review | Flagged",
      "findings": [{ "text": "specific finding", "severity": "green | amber | red" }],
      "requiredActions": [],
      "eudr": { "status": "N/A", "reason": "not applicable" },
      "cbam": { "status": "N/A", "reason": "not applicable" },
      "csddd": { "status": "N/A", "reason": "below threshold" }
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
        max_tokens: 1500,
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

    // Bug 3: fuzzy country filter — handles "China, PRC", "Viet Nam" etc.
    if (selectedCountry) {
      const countryAliases = {
        'china': ['china', 'chinese', 'prc', 'cn'],
        'vietnam': ['vietnam', 'viet nam', 'vietnamese', 'vn'],
        'indonesia': ['indonesia', 'indonesian', 'id'],
        'india': ['india', 'indian', 'in'],
        'bangladesh': ['bangladesh', 'bangladeshi', 'bd'],
        'thailand': ['thailand', 'thai', 'th'],
        'malaysia': ['malaysia', 'malaysian', 'my'],
        'taiwan': ['taiwan', 'taiwanese', 'tw', 'roc'],
        'south korea': ['south korea', 'korea', 'korean', 'kr'],
      };
      const aliases = countryAliases[selectedCountry.toLowerCase()] || [selectedCountry.toLowerCase()];
      parsed.factories = parsed.factories.filter(f => {
        const fc = (f.country || '').toLowerCase();
        return aliases.some(alias => fc.includes(alias));
      });
    }

    if (!parsed.factories.length) {
      return new Response(JSON.stringify({
        factories: [],
        error: 'Claude returned factories from wrong country. Please try again.',
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