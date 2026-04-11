export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }),
      { status: 405, headers: { 'Content-Type': 'application/json' } });
  }

  const body = await req.json();
  const { query = '', category = 'Any', country = 'Any', riskTolerance = 'Any' } = body;

  if (!process.env.ORCATRADE_OS_API) {
    return new Response(JSON.stringify({ error: 'API not configured', factories: [] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  const isSpecificLookup = query.trim().length >= 3;
  const effectiveCountry = (country && country !== 'Any') ? country : 'Asia';
  const effectiveCategory = (category && category !== 'Any') ? category : 'General Manufacturing';

  const systemPrompt = isSpecificLookup

    ? `You are an expert supply chain analyst with deep knowledge of Asian manufacturers. The user is searching for a specific company.

YOUR TASK: Return intelligence on the company "${query.trim()}".

HONESTY PROTOCOL — follow strictly:
- If you have real knowledge of this company, use it. Set dataConfidence: "verified"
- If you recognise the name but are uncertain of details, set dataConfidence: "estimated"
- If you have never heard of this company, set companyFound: false
- NEVER invent employees, revenue, certifications or scores you don't actually know
- For scores you don't know, use null — not a made-up number

COMPANIES YOU KNOW WELL — use real data for these:
Foxconn (Hon Hai Precision Industry Co. Ltd, Tucheng Taiwan, founded 1974, ~730,000 employees, electronics contract mfg)
Unilumin Group Co. Ltd (Shenzhen China, founded 2004, LED display manufacturer, ~8000 employees, SZSE:300055)
BYD Co. Ltd (Shenzhen China, founded 1995, EV/batteries/electronics)
Luxshare Precision (Shenzhen, electronics, Apple supplier)
Leyard Optoelectronic (Beijing, LED displays, founded 1995)
Midea Group (Foshan China, home appliances, founded 1968)
Haier Group (Qingdao China, appliances, founded 1984)
Samsung Electronics (Suwon South Korea, founded 1969)
LG Electronics (Seoul South Korea, founded 1958)
Yue Yuen Industrial (HK listed, footwear, Vietnam/China/Indonesia)
Crystal International (HK listed, garments, Bangladesh/Vietnam)
Shenzhou International (Ningbo China, sportswear, Nike/Adidas)
PT Sritex (Solo Indonesia, textiles)
Hoa Phat Group (Vietnam, steel, founded 1992)

Return ONLY valid JSON, no markdown, no explanation.`

    : `You are a supply chain database returning representative manufacturer profiles for a market overview.

Generate realistic, plausible manufacturer profiles for the ${effectiveCategory} sector in ${effectiveCountry}. These are illustrative examples.

NAMING RULES: Use realistic local company naming conventions.
Chinese: "X Technology Co., Ltd." or "X Group Co., Ltd." — never generic placeholders
Vietnamese: "X Joint Stock Company" or "X Co., Ltd."
Indonesian: "PT X [Industry]"

VARIETY RULES:
- Use 6 different cities within ${effectiveCountry}
- Mix score ranges: 2 high (75-90), 2 medium (55-70), 2 lower (40-55)
- Mix compliance statuses — not everything "Verified"
- Different specialities within ${effectiveCategory}

Return ONLY valid JSON, no markdown.`;

  const userPrompt = isSpecificLookup

    ? `Search query: "${query.trim()}"
Country hint: ${effectiveCountry}
Category hint: ${effectiveCategory}

Return this exact JSON:
{
  "mode": "specific_lookup",
  "searchQuery": "${query.trim()}",
  "companyFound": true,
  "dataConfidence": "verified",
  "factories": [{
    "id": "unique-id",
    "name": "exact registered company name",
    "city": "headquarters city",
    "country": "headquarters country",
    "speciality": "what they actually make",
    "riskScore": null,
    "financialScore": null,
    "complianceScore": null,
    "capacityScore": null,
    "auditScore": null,
    "dataConfidence": "verified",
    "complianceStatus": "Unknown",
    "capacityStatus": "Unknown",
    "auditStatus": "Unknown",
    "established": null,
    "employees": "Unknown",
    "exportMarkets": [],
    "certifications": [],
    "moq": "Unknown",
    "leadTime": "Unknown",
    "paymentTerms": [],
    "orcatradeStatus": "Under Review",
    "findings": [{ "text": "finding text", "severity": "green" }],
    "requiredActions": [],
    "eudr": { "status": "Unknown", "reason": "Requires due diligence" },
    "cbam": { "status": "Unknown", "reason": "Requires assessment" },
    "csddd": { "status": "Unknown", "reason": "Requires assessment" },
    "confidenceNote": "brief note on data confidence"
  }]
}`

    : `Generate 6 representative ${effectiveCategory} manufacturers in ${effectiveCountry}.
Risk tolerance filter: ${riskTolerance}

Return this exact JSON:
{
  "mode": "category_browse",
  "generative": true,
  "factories": [{
    "id": "unique-id",
    "name": "realistic local company name",
    "city": "real city in ${effectiveCountry}",
    "country": "${effectiveCountry}",
    "speciality": "specific product type within ${effectiveCategory}",
    "riskScore": 65,
    "financialScore": 70,
    "complianceScore": 65,
    "capacityScore": 60,
    "auditScore": 62,
    "dataConfidence": "illustrative",
    "complianceStatus": "Pending",
    "capacityStatus": "Full",
    "auditStatus": "Passed",
    "established": 2005,
    "employees": "500-1000",
    "exportMarkets": ["EU", "US"],
    "certifications": ["ISO 9001"],
    "moq": "1000 units",
    "leadTime": "25-35 days",
    "paymentTerms": ["T/T"],
    "orcatradeStatus": "Under Review",
    "findings": [{ "text": "finding", "severity": "green" }],
    "requiredActions": [],
    "eudr": { "status": "N/A", "reason": "one line" },
    "cbam": { "status": "N/A", "reason": "one line" },
    "csddd": { "status": "N/A", "reason": "one line" }
  }]
}`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ORCATRADE_OS_API,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2000,
        temperature: isSpecificLookup ? 0 : 0.4,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!res.ok) throw new Error('Claude API ' + res.status);

    const d = await res.json();
    const text = d.content?.[0]?.text || '';
    const clean = text.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim();
    const parsed = JSON.parse(clean);

    if (isSpecificLookup && parsed.companyFound === false) {
      return new Response(JSON.stringify({
        mode: 'not_found',
        searchQuery: query.trim(),
        factories: [],
        message: `No verified data found for "${query.trim()}". Our Hong Kong team can conduct a ground-level verification within 3 weeks.`,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    // Recalculate riskScore from sub-scores where all are present
    if (parsed.factories) {
      parsed.factories = parsed.factories.map(f => {
        if (f.financialScore != null && f.complianceScore != null &&
            f.capacityScore != null && f.auditScore != null) {
          f.riskScore = Math.round(
            (f.financialScore * 0.30) +
            (f.complianceScore * 0.25) +
            (f.capacityScore * 0.25) +
            (f.auditScore * 0.20)
          );
        }
        return f;
      });
    }

    return new Response(JSON.stringify(parsed), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message, factories: [] }),
      { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}