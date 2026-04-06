export const config = {
  runtime: 'edge',
};

export default async function handler(request) {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const orderData = await request.json();
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
      return new Response(JSON.stringify({ error: 'API key not configured' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
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
- Wood products: NOT a covered sector — mark as N/A
- Covered sectors: cement, iron, steel, aluminium, fertilisers, electricity, hydrogen per Annex I of Regulation (EU) 2023/956
- ONLY applicable if product falls in a covered CBAM sector — be strict

CSDDD FINANCIAL RISK RULES:
- Applies ONLY to companies with 1000+ employees AND €450M+ turnover
- Fines up to 5% of global net turnover per Article 27(1)
- SMEs (under 250 employees): NOT applicable — state this clearly
- Timeline: phased from 2027 for largest companies

SCORE CALCULATION:
- Start at 100
- Deduct 35 points per NON_COMPLIANT regulation
- Deduct 15 points per AT_RISK regulation
- Each regulation only deducted if applicable to this product/company

Return ONLY valid JSON. No markdown. No text outside the JSON object.`;

    const userPrompt = `Generate a detailed compliance report for this import order:

Product category: ${productCategory}
Product description: ${productDescription}
Country of origin: ${origin}
Supplier name: ${supplierName}
Annual import value: ${importValue}
Company size: ${companySize}
Placing on EU market: ${euMarket ? 'Yes' : 'No'}

Return this exact JSON structure with no markdown wrapping:
{
  "reportId": "${reportId}",
  "timestamp": "${timestamp}",
  "overallStatus": "compliant" | "at_risk" | "non_compliant",
  "overallScore": number 0-100,
  "executiveSummary": "Precise 3-sentence summary citing specific regulation names and article numbers. State the single most urgent action.",
  "checkedRegulations": [
    {
      "regulation": "EUDR",
      "applicable": boolean,
      "applicabilityReason": "cite Article 1 and 2 of Regulation (EU) 2023/1115 explaining why this product triggers or does not trigger EUDR",
      "status": "compliant" | "at_risk" | "non_compliant" | "not_applicable",
      "legalBasis": "Regulation (EU) 2023/1115 of the European Parliament and of the Council",
      "keyObligation": "exact legal obligation in one sentence with article citation",
      "currentGap": "what is specifically missing for this product/supplier combination, or N/A if not applicable",
      "findings": [
        {
          "finding": "specific, detailed finding text — not generic",
          "severity": "critical" | "major" | "minor",
          "article": "Article X(Y) of Regulation (EU) 2023/1115",
          "legalImplication": "exact consequence of this finding under EU law"
        }
      ],
      "requiredActions": [
        {
          "step": 1,
          "action": "specific action text with exact steps",
          "documentRequired": "exact name of document needed",
          "portal": "exact EU portal or authority name",
          "deadline": "specific date or clear trigger event",
          "estimatedHours": number,
          "estimatedCostEur": "EUR range e.g. €500–€2,000"
        }
      ],
      "financialRisk": {
        "minimumFineEur": number,
        "maximumFineEur": number,
        "calculationExplained": "show the formula: e.g. 4% × €200,000 import value = €8,000 maximum fine. Minimum per Article 25: €10,000.",
        "additionalRisks": ["array of strings"]
      },
      "complianceDeadline": "specific date with context"
    },
    {
      "regulation": "CBAM",
      "applicable": boolean,
      "applicabilityReason": "cite Annex I of Regulation (EU) 2023/956 — wood and furniture are NOT covered sectors, state clearly if not applicable",
      "status": "compliant" | "at_risk" | "non_compliant" | "not_applicable",
      "legalBasis": "Regulation (EU) 2023/956 of the European Parliament and of the Council",
      "keyObligation": "exact legal obligation or N/A if sector not covered",
      "currentGap": "what is missing or N/A",
      "findings": [],
      "requiredActions": [],
      "financialRisk": {
        "minimumFineEur": 0,
        "maximumFineEur": 0,
        "calculationExplained": "Product sector not covered by CBAM Annex I — no CBAM financial exposure.",
        "additionalRisks": []
      },
      "complianceDeadline": "N/A — product not covered by CBAM"
    },
    {
      "regulation": "CSDDD",
      "applicable": boolean,
      "applicabilityReason": "cite Article 2 of Directive (EU) 2024/1760 on company size thresholds — under 250 employees is NOT applicable",
      "status": "compliant" | "at_risk" | "non_compliant" | "not_applicable",
      "legalBasis": "Directive (EU) 2024/1760 of the European Parliament and of the Council",
      "keyObligation": "exact legal obligation or N/A if thresholds not met",
      "currentGap": "what is missing or N/A",
      "findings": [],
      "requiredActions": [],
      "financialRisk": {
        "minimumFineEur": 0,
        "maximumFineEur": 0,
        "calculationExplained": "Company below CSDDD thresholds — no CSDDD financial exposure.",
        "additionalRisks": []
      },
      "complianceDeadline": "Not applicable based on company size"
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
    "minimumEur": number,
    "maximumEur": number,
    "calculationBreakdown": "regulation by regulation breakdown as a string"
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
      return new Response(JSON.stringify({ error: 'AI API error', detail: errorText }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const data = await response.json();
    let assistantText = data.content[0].text;

    // Strip markdown fences if present
    const fenceMatch = assistantText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (fenceMatch) assistantText = fenceMatch[1];

    // Extract first JSON object as final safety net
    let parsedJson;
    try {
      parsedJson = JSON.parse(assistantText);
    } catch {
      const objMatch = assistantText.match(/\{[\s\S]*\}/);
      if (objMatch) {
        try {
          parsedJson = JSON.parse(objMatch[0]);
        } catch {
          return new Response(JSON.stringify({ error: 'Failed to parse AI response' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      } else {
        return new Response(JSON.stringify({ error: 'No JSON found in AI response' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    return new Response(JSON.stringify(parsedJson), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Handler error:', error);
    return new Response(JSON.stringify({ error: error.message || 'Internal Server Error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}