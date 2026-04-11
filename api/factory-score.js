export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const body = await req.json();
  const { query = '', category = 'Any', country = 'Any' } = body;

  if (!query || query.trim().length < 2) {
    return new Response(JSON.stringify({
      error: 'Please enter a factory or company name to search.',
      factories: [],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  if (!process.env.ORCATRADE_OS_API) {
    return new Response(JSON.stringify({
      factories: [],
      message: `API key not configured. Submit "${query}" to OrcaTrade for a ground-level due diligence report.`,
      notFound: true,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  // Step 1: Try OpenCorporates for real registration data
  const countryCodeMap = {
    'China': 'cn', 'Vietnam': 'vn', 'Indonesia': 'id',
    'India': 'in', 'Bangladesh': 'bd', 'Thailand': 'th',
    'Malaysia': 'my', 'Taiwan': 'tw', 'South Korea': 'kr',
  };
  const countryCode = countryCodeMap[country] || null;

  let companiesData = [];
  try {
    const ocUrl = `https://api.opencorporates.com/v0.4/companies/search?q=${encodeURIComponent(query)}${countryCode ? '&jurisdiction_code=' + countryCode : ''}&fields=company_name,jurisdiction_code,registered_address,company_type,inactive&per_page=6`;
    const ocRes = await fetch(ocUrl, { headers: { 'Accept': 'application/json' } });
    if (ocRes.ok) {
      const ocData = await ocRes.json();
      companiesData = ocData?.results?.companies || [];
    }
  } catch (e) {
    // OpenCorporates unavailable — proceed with Claude only
  }

  // Step 2: Claude analyses based on real knowledge + any OC data found
  const systemPrompt = `You are a factory intelligence analyst for OrcaTrade.

YOUR JOB: Analyse the company "${query}" and return structured intelligence data.

CRITICAL HONESTY RULES:
- If you know real facts about this company, use them
- If you don't know something, use "Unknown" in that field — do NOT invent numbers
- Never fabricate financial scores, employee counts, or certifications you don't know are real
- The "dataConfidence" field must be "high" only if you actually know this company, "low" if estimating
- If this company name is not a real known manufacturer, set "companyFound": false

COMPANIES YOU SHOULD RECOGNISE (use real data for these):
Foxconn/Hon Hai, Samsung, LG, Huawei, Xiaomi, BYD, Midea, Haier, Gree,
Unilumin (Shenzhen, LED displays, founded 2004, ~8000 employees, ticker 300055),
Leyard, Absen, Novastar, Luxshare, Pegatron, Wistron, Compal, Quanta,
Flextronics/Flex, Jabil, Yue Yuen, Pou Chen, Crystal International,
Shenzhou International, Stella International, Esquel, TAL Apparel,
Hoa Phat, Vinfast, Viettel, PT Astra, PT Indofood, Tata, Wipro, Infosys

Return ONLY valid JSON. No markdown.`;

  const ocContext = companiesData.length > 0
    ? `\nReal company registration data found via public records:\n${JSON.stringify(
        companiesData.slice(0, 3).map(c => ({
          name: c.company?.name,
          jurisdiction: c.company?.jurisdiction_code,
          address: c.company?.registered_address?.street_address,
          type: c.company?.company_type,
          inactive: c.company?.inactive,
        })), null, 2
      )}\nUse this real data as the basis for result 1.\n`
    : '';

  const userPrompt = `Company to analyse: "${query}"
Country filter: ${country}
Category filter: ${category}
${ocContext}
Return this exact JSON:
{
  "searchQuery": "${query}",
  "companyFound": true,
  "dataConfidence": "high",
  "factories": [
    {
      "id": "unique-id",
      "name": "EXACT company name — do not change it",
      "city": "real city or Unknown",
      "country": "real country or ${country}",
      "speciality": "what this company actually makes, or Unknown",
      "riskScore": null,
      "financialScore": null,
      "complianceScore": null,
      "capacityScore": null,
      "auditScore": null,
      "dataConfidence": "high if you know this company, low if estimating",
      "complianceStatus": "Unknown",
      "capacityStatus": "Unknown",
      "auditStatus": "Unknown",
      "established": null,
      "employees": "real range if known, else Unknown",
      "exportMarkets": [],
      "certifications": [],
      "moq": "Unknown",
      "leadTime": "Unknown",
      "paymentTerms": [],
      "orcatradeStatus": "Under Review",
      "findings": [
        { "text": "Data confidence: [high/low] — [reason]", "severity": "green" }
      ],
      "requiredActions": ["Request full factory audit from OrcaTrade Hong Kong team"],
      "eudr": { "status": "Unknown", "reason": "Requires due diligence" },
      "cbam": { "status": "Unknown", "reason": "Requires assessment" },
      "csddd": { "status": "Unknown", "reason": "Requires assessment" },
      "note": "For verified risk scores, submit this factory for OrcaTrade due diligence review."
    }
  ]
}`;

  try {
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ORCATRADE_OS_API,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1500,
        temperature: 0,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!claudeRes.ok) {
      throw new Error('Claude API error: ' + claudeRes.status);
    }

    const claudeData = await claudeRes.json();
    const text = claudeData.content?.[0]?.text || '';
    const clean = text.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim();
    const parsed = JSON.parse(clean);

    if (!parsed.companyFound) {
      return new Response(JSON.stringify({
        factories: [],
        message: `No verified data found for "${query}". Submit this factory to OrcaTrade for a ground-level due diligence report from our Hong Kong team.`,
        notFound: true,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify(parsed), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message, factories: [] }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}