const { MODELS } = require('../ai/models');

// Repair a JSON string truncated mid-array (the common shape when
// Claude hits max_tokens during a `{"factories": [{…},{…}` payload):
//   1. Walk to the last clean structural break (a closing brace `}` at
//      depth 1) — that's the last complete factory entry.
//   2. Truncate everything after it and close the array + object.
// If no clean break exists, return an empty-array shell so JSON.parse
// at least produces a structurally valid object the caller can read.
function repairTruncatedJson(raw) {
  if (!raw) return '{"factories":[]}';
  let depth = 0, inStr = false, esc = false, lastSafe = -1;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (esc) { esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') {
      depth--;
      // A `}` at depth 1 inside the outer factories array means we
      // just closed one entry — that's a safe truncation point.
      if (c === '}' && depth === 1) lastSafe = i;
    }
  }
  if (lastSafe < 0) return '{"factories":[]}';
  return raw.slice(0, lastSafe + 1) + ']}';
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const body = (req.body && typeof req.body === 'object') ? req.body : {};
  const {
    query = '',
    category = 'Any',
    country = 'Any',
    riskTolerance = 'Any',
    employees = '',
    yearsOp = '',
    certifications = '',
    euExperience = '',
  } = body;

  if (!(process.env.ANTHROPIC_API_KEY || process.env.ORCATRADE_OS_API)) {
    return res.status(200).json({ error: 'API not configured', factories: [] });
  }

  const hasQuery = query.trim().length >= 2;
  const mode = hasQuery ? 'specific' : 'browse';
  const effectiveCountry = (country && country !== 'Any') ? country : 'China';
  const effectiveCategory = (category && category !== 'Any') ? category : 'General Manufacturing';

  const contextSignals = [
    employees ? `Company size: ${employees} employees` : null,
    yearsOp ? `Years in operation: ${yearsOp}` : null,
    certifications ? `Known certifications: ${certifications}` : null,
    euExperience ? `EU export experience: ${euExperience}` : null,
  ].filter(Boolean).join('\n');

  const systemPrompt = mode === 'specific'

    ? `You are OrcaTrade Intelligence's factory risk scoring engine. You assess manufacturer risk for European importers.

YOUR CORE CAPABILITY: You can score ANY factory — not just famous ones. For unknown factories, use available signals to produce a risk assessment. This is standard practice in supply chain due diligence — assessors always produce a score based on available evidence, clearly noting confidence level.

SCORING METHODOLOGY:

financialScore (0-100):
  Increases: large company, established 20+ years, publicly listed, EU primary market
  Decreases: new company (0-2yr), micro size, single market dependence
  Country baseline: China ~65, Vietnam ~60, Indonesia ~58, India ~62, Bangladesh ~55, Taiwan ~72, South Korea ~75

complianceScore (0-100):
  Increases: ISO 9001 (+15), ISO 14001 (+8), BSCI (+10), SA8000 (+12), GOTS (+10), FSC (+10), established EU exporter (+10), multiple certs (+5 bonus)
  Decreases: no certifications (-10), no EU experience (-5)
  Country baseline: China ~65, Vietnam ~62, Bangladesh ~55, Indonesia ~60, Taiwan ~75, South Korea ~78

capacityScore (0-100):
  Increases: large employee count (+15-20), established (+10), enterprise size (+15)
  Decreases: micro/small (-15), new company (-10)
  Baseline: enterprise ~85, large ~75, medium ~65, small ~50

auditScore (0-100):
  Increases: multiple certs (+15), BSCI/SA8000 (+15), 10+ years (+8), established EU exporter (+10)
  Decreases: no certifications (-15), new company (-10), no EU experience (-8)
  Baseline: ~60 with no information

riskScore: ALWAYS = round((financial*0.30)+(compliance*0.25)+(capacity*0.25)+(audit*0.20))
NEVER return null for any score. Always provide a number based on available signals.

dataConfidence:
  "high" — well-known public company with verified data
  "medium" — signals provided allow confident assessment
  "low" — minimal signals, scores are conservative estimates

A low confidence score is still a useful score. Never return null. A score of 52 with confidence "low" is more useful than null.

Return ONLY valid JSON. No markdown. No explanation.`

    : `You are a supply chain database returning representative manufacturer profiles for a market overview.

Generate realistic, plausible manufacturer profiles for the ${effectiveCategory} sector in ${effectiveCountry}.

NAMING RULES: Use realistic local naming conventions.
Chinese: "X Technology Co., Ltd." or "X Group Co., Ltd."
Vietnamese: "X Joint Stock Company" or "X Co., Ltd."
Indonesian: "PT X [Industry]"
Never use generic placeholders like "Shenzhen Global Tech Mfg Ltd".

VARIETY RULES:
- 6 different cities within ${effectiveCountry}
- Mix scores: 2 high (75-88), 2 medium (58-72), 2 lower (42-57)
- Mix compliance statuses — not everything "Verified"
- Different specialities within ${effectiveCategory}

Return ONLY valid JSON. No markdown.`;

  const userPrompt = mode === 'specific'

    ? `Assess this factory/company for an EU importer:

Company name: "${query.trim()}"
Country: ${effectiveCountry}
Category: ${effectiveCategory}
${contextSignals ? 'Additional signals:\n' + contextSignals : 'No additional signals provided.'}

INSTRUCTIONS:
1. If you recognise this company, use real data and set dataConfidence "high"
2. If you don't recognise it, assess based on: company name structure, country risk baseline, category risk factors, and any signals above. Set dataConfidence "medium" if signals provided, "low" if minimal.
3. ALWAYS provide numerical scores — never null
4. Note in findings what signals were used to derive the score

Return exactly this JSON:
{
  "mode": "specific_lookup",
  "searchQuery": "${query.trim()}",
  "companyFound": true,
  "dataConfidence": "high",
  "scoringBasis": "brief note on what signals were used",
  "factories": [{
    "id": "f_specific_001",
    "name": "${query.trim()}",
    "city": "known city or best estimate",
    "country": "${effectiveCountry}",
    "speciality": "${effectiveCategory}",
    "riskScore": 65,
    "financialScore": 65,
    "complianceScore": 65,
    "capacityScore": 65,
    "auditScore": 65,
    "dataConfidence": "high",
    "complianceStatus": "Pending",
    "capacityStatus": "Full",
    "auditStatus": "Due",
    "established": null,
    "employees": "Unknown",
    "exportMarkets": [],
    "certifications": [],
    "moq": "Unknown — request from supplier",
    "leadTime": "Typical for ${effectiveCategory}: 25-45 days",
    "paymentTerms": ["T/T", "L/C"],
    "orcatradeStatus": "Under Review",
    "findings": [
      { "text": "specific finding based on available signals", "severity": "amber" }
    ],
    "requiredActions": ["Submit for OrcaTrade ground verification to improve score confidence"],
    "eudr": { "status": "Pending", "reason": "Requires due diligence" },
    "cbam": { "status": "Pending", "reason": "Requires assessment" },
    "csddd": { "status": "Pending", "reason": "Requires due diligence assessment" },
    "confidenceNote": "Scores derived from: list signals used"
  }]
}`

    : `Generate 6 representative ${effectiveCategory} manufacturers in ${effectiveCountry}.
Risk tolerance filter: ${riskTolerance}

Return exactly this JSON:
{
  "mode": "category_browse",
  "browseContext": "${effectiveCategory} manufacturers in ${effectiveCountry}",
  "factories": [{
    "id": "unique-id",
    "name": "realistic local company name",
    "city": "real manufacturing city in ${effectiveCountry}",
    "country": "${effectiveCountry}",
    "speciality": "specific product type within ${effectiveCategory}",
    "riskScore": 65,
    "financialScore": 65,
    "complianceScore": 65,
    "capacityScore": 65,
    "auditScore": 65,
    "dataConfidence": "illustrative",
    "complianceStatus": "Pending",
    "capacityStatus": "Full",
    "auditStatus": "Passed",
    "established": 2008,
    "employees": "500-1000",
    "exportMarkets": ["EU", "US"],
    "certifications": ["ISO 9001"],
    "moq": "1000 units",
    "leadTime": "25-35 days",
    "paymentTerms": ["T/T"],
    "orcatradeStatus": "Under Review",
    "findings": [{ "text": "realistic finding", "severity": "green" }],
    "requiredActions": [],
    "eudr": { "status": "N/A", "reason": "one line" },
    "cbam": { "status": "N/A", "reason": "one line" },
    "csddd": { "status": "N/A", "reason": "one line" }
  }]
}`;

  try {
    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': (process.env.ANTHROPIC_API_KEY || process.env.ORCATRADE_OS_API),
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODELS.TRIAGE,
        // Raised from 2000 — Claude was truncating mid-string on long
        // factory dossiers (200+ char findings × 5 factories) and the
        // partial JSON crashed JSON.parse with "Unterminated string at
        // position X". 4500 covers the upper bound seen in prod with
        // headroom; if we hit it again, bump to 6000.
        max_tokens: 4500,
        temperature: mode === 'specific' ? 0.1 : 0.4,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!apiRes.ok) throw new Error('Claude API error ' + apiRes.status);

    const d = await apiRes.json();
    const text = d.content?.[0]?.text || '';
    const clean = text.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim();
    // Defensive parse: when Claude truncates (max_tokens hit), the
    // tail is a half-written string + missing braces. Try a clean
    // parse first; on failure, attempt a structured repair (close
    // any open string, drop the last partial object, balance braces)
    // and re-parse. If both fail, return an empty-factories fallback
    // with the parse error in `degradedReason` so the UI can render
    // a "no results — try a different query" instead of a 500.
    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch (parseErr) {
      const repaired = repairTruncatedJson(clean);
      try {
        parsed = JSON.parse(repaired);
      } catch (_) {
        return res.status(200).json({
          factories: [],
          degradedReason: 'partial-response',
          parseError: parseErr.message,
        });
      }
    }

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

    return res.status(200).json(parsed);

  } catch (err) {
    return res.status(500).json({ error: err.message, factories: [] });
  }
};
