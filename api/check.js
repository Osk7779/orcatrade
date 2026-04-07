const { determineRegulationApplicability, enforceComplianceLogic } = require('../lib/intelligence/compliance');

const rateMap = new Map();

function checkRate(ip, limit) {
  const now = Date.now();
  const entry = rateMap.get(ip) || { count: 0, windowStart: now };

  if (now - entry.windowStart > 60000) {
    entry.count = 0;
    entry.windowStart = now;
  }

  entry.count++;
  rateMap.set(ip, entry);
  return entry.count > limit;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  if (checkRate(ip, 5)) {
    return res.status(429).json({ error: 'Too many requests. Please wait a moment.' });
  }

  try {
    const orderData = req.body;
    const {
      productCategory = '',
      productDescription = '',
      origin = '',
      supplierName = 'Not provided',
      importValue = 'Not specified',
      companySize = 'Not specified',
      euMarket = true,
    } = orderData;

    const anthropicApiKey = process.env.ORCATRADE_OS_API;
    if (!anthropicApiKey) {
      return res.status(500).json({ error: 'API key not configured' });
    }

    const applicability = determineRegulationApplicability(orderData);

    const year = new Date().getFullYear();
    const reportId = `OT-COMP-${year}-${Math.floor(100000 + Math.random() * 900000)}`;
    const timestamp = new Date().toISOString();

    const systemPrompt = `You are OrcaTrade Intelligence, a senior EU trade compliance engine with expert knowledge of:
- EUDR: Regulation (EU) 2023/1115 — EU Deforestation Regulation
- CBAM: Regulation (EU) 2023/956 — Carbon Border Adjustment Mechanism
- CSDDD: Directive (EU) 2024/1760 — Corporate Sustainability Due Diligence

You produce LEGALLY PRECISE, DEEPLY SPECIFIC compliance reports.
Every finding MUST cite the exact Article number.
Every financial risk MUST show the calculation formula.
Every required action MUST name the exact document and EU portal.
Never be vague. Never say "may be required". State obligations definitively.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STATUS AND SCORE RULES — READ CAREFULLY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

STATUS is determined by the WORST applicable regulation result, in this strict hierarchy:

  non_compliant > at_risk > compliant > not_applicable

REGULATION STATUS ASSIGNMENT RULES (mandatory):
- "not_applicable": regulation does not apply to this product/company. No score impact.
- "non_compliant": regulation applies AND at least ONE of:
    • a finding with severity "critical" exists
    • a mandatory legal prerequisite is unmet (e.g. not registered as CBAM declarant
      when CBAM applies, no georeferenced data when EUDR applies)
    • import would be legally prohibited without this missing element
- "at_risk": regulation applies AND at least ONE of:
    • a finding with severity "major" exists
    • required actions are outstanding but import is not yet prohibited
    • missing data that creates uncertainty about an obligation
- "compliant": regulation applies AND all known obligations are satisfied or
    explicitly verified as not required. This requires positive evidence —
    NOT the absence of information.

CRITICAL RULE: You CANNOT mark a regulation "compliant" if:
  - you have identified any critical or major finding under it
  - you have listed any required actions under it
  - the importer has not verified they have met the legal prerequisites

SCORE CALCULATION (mandatory, calculate after setting all regulation statuses):
  Start at 100
  For each regulation where applicable = true:
    - status = non_compliant → subtract 35
    - status = at_risk       → subtract 15
    - status = compliant     → subtract 0
    - status = not_applicable → subtract 0
  Score cannot go below 0.

OVERALL STATUS (mandatory, derived from individual regulation statuses):
  If ANY applicable regulation is non_compliant → overallStatus = "non_compliant"
  Else if ANY applicable regulation is at_risk  → overallStatus = "at_risk"
  Else all applicable regulations are compliant  → overallStatus = "compliant"

A score of 100 and overallStatus "compliant" is ONLY valid when:
  - Every applicable regulation has status "compliant" with verified evidence
  - No findings of any severity exist
  - No required actions are listed

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CBAM SECTOR RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Covered sectors per Annex I of Regulation (EU) 2023/956:
  cement, iron, steel, aluminium, fertilisers, electricity, hydrogen
NOT covered: wood, furniture, textiles, food, chemicals, plastics,
  electronics, rubber, paper, glass (unless produced in a covered process).
If product is not in a covered sector: applicable = false, status = "not_applicable".
If uncertain about CN code classification, state that explicitly in applicabilityReason.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EUDR RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Applies to: cattle, cocoa, coffee, palm oil, soya, wood, rubber and derived products.
Derived products include: leather, chocolate, furniture, paper, printed matter.
Check Article 1 and Annex I of Regulation (EU) 2023/1115 to determine applicability.
If applicable: operator MUST have georeferenced polygon data per Article 9.
Missing polygon data = critical finding = non_compliant.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CSDDD RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Applies ONLY to: companies with 1000+ employees AND €450M+ global turnover.
If company size is "Under 250 employees" or "250–1000 employees": applicable = false.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FINANCIAL RISK — EUDR
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Minimum fine: €10,000 per infringement per Article 25(2)(a)
Maximum fine: up to 4% of annual EU turnover per Article 25(2)(a)
Use import value as turnover proxy. Show the calculation.
Additional: seizure per Article 25(2)(b), procurement ban per Article 25(2)(d).

DETERMINISTIC PRE-CHECK — YOU MUST RESPECT THIS UNLESS USER DATA CLEARLY CONTRADICTS IT
- EUDR applicability: ${applicability.EUDR.applicable ? 'APPLICABLE' : 'NOT APPLICABLE'} — ${applicability.EUDR.applicabilityReason}
- CBAM applicability: ${applicability.CBAM.applicable ? 'APPLICABLE' : 'NOT APPLICABLE'} — ${applicability.CBAM.applicabilityReason}
- CSDDD applicability: ${applicability.CSDDD.applicable ? 'APPLICABLE' : 'NOT APPLICABLE'} — ${applicability.CSDDD.applicabilityReason}

Return ONLY valid JSON. No markdown. No text outside the JSON object.`;

    const userPrompt = `Generate a detailed compliance report for this import order:

Product category: ${productCategory}
Product description: ${productDescription}
Country of origin: ${origin}
Supplier name: ${supplierName}
Annual import value: ${importValue}
Company size: ${companySize}
Placing on EU market: ${euMarket ? 'Yes' : 'No'}

IMPORTANT: Follow the STATUS AND SCORE RULES exactly. Do not mark a regulation
compliant if you have listed findings or required actions under it.
Derive overallStatus and overallScore from the regulation statuses after setting them.

Return ONLY this JSON object with no markdown wrapping:
{
  "reportId": "${reportId}",
  "timestamp": "${timestamp}",
  "overallStatus": "non_compliant | at_risk | compliant",
  "overallScore": <number 0-100 calculated per rules above>,
  "executiveSummary": "3 sentences. Sentence 1: what regulations apply and why. Sentence 2: what the most critical unresolved obligation is, with article citation. Sentence 3: the single most urgent action the importer must take.",
  "checkedRegulations": [
    {
      "regulation": "EUDR",
      "applicable": <boolean>,
      "applicabilityReason": "cite specific articles. If uncertain about CN code, state that.",
      "status": "non_compliant | at_risk | compliant | not_applicable",
      "legalBasis": "Regulation (EU) 2023/1115 of the European Parliament and of the Council",
      "keyObligation": "exact obligation with article citation, or Not applicable",
      "currentGap": "specific missing element, or N/A",
      "findings": [
        {
          "finding": "specific finding text",
          "severity": "critical | major | minor",
          "article": "Article X(Y) of Regulation (EU) 2023/1115",
          "legalImplication": "exact legal consequence"
        }
      ],
      "requiredActions": [
        {
          "step": 1,
          "action": "specific action",
          "documentRequired": "exact document name",
          "portal": "exact EU portal or authority",
          "deadline": "specific date or trigger",
          "estimatedHours": <number>,
          "estimatedCostEur": "EUR range"
        }
      ],
      "financialRisk": {
        "minimumFineEur": <number>,
        "maximumFineEur": <number>,
        "calculationExplained": "formula shown explicitly",
        "additionalRisks": ["array of strings"]
      },
      "complianceDeadline": "specific date with context"
    },
    {
      "regulation": "CBAM",
      "applicable": <boolean — false if product not in Annex I covered sectors>,
      "applicabilityReason": "cite Annex I of Regulation (EU) 2023/956. State clearly if not covered.",
      "status": "non_compliant | at_risk | compliant | not_applicable",
      "legalBasis": "Regulation (EU) 2023/956 of the European Parliament and of the Council",
      "keyObligation": "obligation or Not applicable",
      "currentGap": "gap or N/A",
      "findings": [],
      "requiredActions": [],
      "financialRisk": {
        "minimumFineEur": <number>,
        "maximumFineEur": <number>,
        "calculationExplained": "explanation or Not applicable",
        "additionalRisks": []
      },
      "complianceDeadline": "date or N/A"
    },
    {
      "regulation": "CSDDD",
      "applicable": <boolean — false if under 1000 employees or under €450M turnover>,
      "applicabilityReason": "cite Article 2 of Directive (EU) 2024/1760 and the company size provided",
      "status": "non_compliant | at_risk | compliant | not_applicable",
      "legalBasis": "Directive (EU) 2024/1760 of the European Parliament and of the Council",
      "keyObligation": "obligation or Not applicable",
      "currentGap": "gap or N/A",
      "findings": [],
      "requiredActions": [],
      "financialRisk": {
        "minimumFineEur": <number>,
        "maximumFineEur": <number>,
        "calculationExplained": "explanation or Not applicable",
        "additionalRisks": []
      },
      "complianceDeadline": "date or N/A"
    }
  ],
  "priorityActions": [
    {
      "rank": 1,
      "action": "specific action",
      "urgency": "Immediate — within 7 days | Within 30 days | Within 90 days",
      "estimatedCostEur": "EUR range",
      "consequenceIfIgnored": "specific legal or financial consequence"
    }
  ],
  "totalFinancialExposure": {
    "minimumEur": <number>,
    "maximumEur": <number>,
    "calculationBreakdown": "regulation by regulation breakdown"
  },
  "disclaimer": "This report is generated by OrcaTrade Intelligence based on information provided by the user. It does not constitute legal advice and should not be relied upon as such. For binding legal opinions on EU trade compliance obligations, consult a qualified EU trade law practitioner. Report ID: ${reportId}. Generated: ${timestamp}."
}`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicApiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 8000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Anthropic API Error:', errorText);
      return res.status(502).json({ error: 'AI API error', detail: errorText });
    }

    const data = await response.json();
    let assistantText = data.content[0].text;

    const fenceMatch = assistantText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (fenceMatch) assistantText = fenceMatch[1];

    let report;
    try {
      report = JSON.parse(assistantText);
    } catch {
      const objMatch = assistantText.match(/\{[\s\S]*\}/);
      if (objMatch) {
        try { report = JSON.parse(objMatch[0]); }
        catch (e) {
          console.error('JSON parse error:', e, assistantText.slice(0, 500));
          return res.status(500).json({ error: 'Failed to parse AI response' });
        }
      } else {
        return res.status(500).json({ error: 'No JSON found in AI response' });
      }
    }

    // ── Server-side compliance logic enforcement ──────────────────────
    // The AI may hallucinate a "compliant" status despite having findings
    // or required actions. This sanitiser enforces the correct hierarchy.
    report = enforceComplianceLogic(report, orderData);
    // ─────────────────────────────────────────────────────────────────

    return res.status(200).json(report);

  } catch (error) {
    console.error('Handler error:', error);
    return res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
};
