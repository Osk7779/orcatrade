module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

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

EUDR FINANCIAL RISK RULES:
- Base fine: up to 4% of annual EU turnover per Article 25(2)(a)
- Minimum fine: €10,000 per infringement per Article 25(2)(a)
- Additional: seizure and confiscation of goods per Article 25(2)(b)
- Additional: temporary exclusion from public procurement per Article 25(2)(d)
- Calculate based on import value provided as proxy for EU turnover

CBAM FINANCIAL RISK RULES:
- Penalty: €100 per tonne CO2 equivalent shortfall per Article 26(1)
- Wood products: NOT a covered sector — mark as not_applicable
- Covered sectors ONLY: cement, iron, steel, aluminium, fertilisers, electricity, hydrogen per Annex I of Regulation (EU) 2023/956
- If product is NOT in a covered sector, set applicable: false and status: not_applicable

CSDDD FINANCIAL RISK RULES:
- Applies ONLY to companies with 1000+ employees AND €450M+ turnover
- Fines up to 5% of global net turnover per Article 27(1)
- SMEs (under 250 employees): NOT applicable — state this clearly
- Timeline: phased from 2027 for largest companies

SCORE CALCULATION:
- Start at 100
- Deduct 35 points per NON_COMPLIANT regulation that is applicable
- Deduct 15 points per AT_RISK regulation that is applicable
- Regulations marked not_applicable do not affect score

Return ONLY valid JSON. No markdown. No text outside the JSON object.`;

    const userPrompt = `Generate a detailed compliance report for this import order:

Product category: ${productCategory}
Product description: ${productDescription}
Country of origin: ${origin}
Supplier name: ${supplierName}
Annual import value: ${importValue}
Company size: ${companySize}
Placing on EU market: ${euMarket ? 'Yes' : 'No'}

Return ONLY this JSON object with no markdown wrapping:
{
  "reportId": "${reportId}",
  "timestamp": "${timestamp}",
  "overallStatus": "compliant or at_risk or non_compliant",
  "overallScore": 0-100,
  "executiveSummary": "Precise 3-sentence summary citing specific regulation names and article numbers. State the single most urgent action.",
  "checkedRegulations": [
    {
      "regulation": "EUDR",
      "applicable": true or false,
      "applicabilityReason": "cite Article 1 and 2 of Regulation (EU) 2023/1115 explaining why",
      "status": "compliant or at_risk or non_compliant or not_applicable",
      "legalBasis": "Regulation (EU) 2023/1115 of the European Parliament and of the Council",
      "keyObligation": "exact legal obligation with article citation, or Not applicable",
      "currentGap": "what is specifically missing, or N/A if not applicable",
      "findings": [
        {
          "finding": "specific detailed finding",
          "severity": "critical or major or minor",
          "article": "Article X(Y) of Regulation (EU) 2023/1115",
          "legalImplication": "exact legal consequence"
        }
      ],
      "requiredActions": [
        {
          "step": 1,
          "action": "specific action with exact steps",
          "documentRequired": "exact document name",
          "portal": "exact EU portal or authority name",
          "deadline": "specific date or trigger event",
          "estimatedHours": 4,
          "estimatedCostEur": "EUR range"
        }
      ],
      "financialRisk": {
        "minimumFineEur": 10000,
        "maximumFineEur": 20000,
        "calculationExplained": "4% x import value = X. Minimum per Article 25: €10,000.",
        "additionalRisks": ["seizure of goods", "market ban"]
      },
      "complianceDeadline": "specific date with context"
    },
    {
      "regulation": "CBAM",
      "applicable": false,
      "applicabilityReason": "cite Annex I of Regulation (EU) 2023/956 — wood and furniture are NOT listed covered sectors",
      "status": "not_applicable",
      "legalBasis": "Regulation (EU) 2023/956 of the European Parliament and of the Council",
      "keyObligation": "Not applicable — product sector not covered by CBAM Annex I",
      "currentGap": "N/A",
      "findings": [],
      "requiredActions": [],
      "financialRisk": {
        "minimumFineEur": 0,
        "maximumFineEur": 0,
        "calculationExplained": "Product sector not covered by CBAM Annex I — no CBAM financial exposure.",
        "additionalRisks": []
      },
      "complianceDeadline": "N/A"
    },
    {
      "regulation": "CSDDD",
      "applicable": false,
      "applicabilityReason": "cite Article 2 of Directive (EU) 2024/1760 — company must have 1000+ employees and €450M+ turnover to be in scope",
      "status": "not_applicable",
      "legalBasis": "Directive (EU) 2024/1760 of the European Parliament and of the Council",
      "keyObligation": "Not applicable based on company size threshold per Article 2",
      "currentGap": "N/A",
      "findings": [],
      "requiredActions": [],
      "financialRisk": {
        "minimumFineEur": 0,
        "maximumFineEur": 0,
        "calculationExplained": "Company below CSDDD thresholds — no CSDDD financial exposure.",
        "additionalRisks": []
      },
      "complianceDeadline": "N/A"
    }
  ],
  "priorityActions": [
    {
      "rank": 1,
      "action": "specific action text",
      "urgency": "Immediate — within 7 days",
      "estimatedCostEur": "EUR range",
      "consequenceIfIgnored": "specific legal or financial consequence"
    },
    {
      "rank": 2,
      "action": "specific action text",
      "urgency": "Within 30 days",
      "estimatedCostEur": "EUR range",
      "consequenceIfIgnored": "specific legal or financial consequence"
    },
    {
      "rank": 3,
      "action": "specific action text",
      "urgency": "Within 90 days",
      "estimatedCostEur": "EUR range",
      "consequenceIfIgnored": "specific legal or financial consequence"
    }
  ],
  "totalFinancialExposure": {
    "minimumEur": 10000,
    "maximumEur": 20000,
    "calculationBreakdown": "EUDR: min €10,000 — max €X,XXX. CBAM: N/A. CSDDD: N/A."
  },
  "disclaimer": "This report is generated by OrcaTrade Intelligence based on information provided by the user. It does not constitute legal advice. Report ID: ${reportId}. Generated: ${timestamp}."
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

    // Strip markdown fences if present
    const fenceMatch = assistantText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (fenceMatch) assistantText = fenceMatch[1];

    let parsedJson;
    try {
      parsedJson = JSON.parse(assistantText);
    } catch {
      const objMatch = assistantText.match(/\{[\s\S]*\}/);
      if (objMatch) {
        try {
          parsedJson = JSON.parse(objMatch[0]);
        } catch (e) {
          console.error('JSON parse error:', e, assistantText.slice(0, 500));
          return res.status(500).json({ error: 'Failed to parse AI response' });
        }
      } else {
        console.error('No JSON found in response:', assistantText.slice(0, 500));
        return res.status(500).json({ error: 'No JSON found in AI response' });
      }
    }

    return res.status(200).json(parsedJson);

  } catch (error) {
    console.error('Handler error:', error);
    return res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
};