const { COUNTRY_ROUTE_CONTEXT } = require('../lib/intelligence/catalog');
const {
  buildSupplyChainMock,
  normalizeSupplyChainInput,
  sanitizeSupplyChainResult,
} = require('../lib/intelligence/supply-chain');

function extractJsonObject(text) {
  const cleaned = String(text || '')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  return match ? match[0] : cleaned;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const input = normalizeSupplyChainInput(req.body || {});
    const route = COUNTRY_ROUTE_CONTEXT[input.sourcingCountry] || COUNTRY_ROUTE_CONTEXT.China;
    const todayStr = new Date().toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });

    if (!process.env.ORCATRADE_OS_API) {
      return res.status(200).json(buildSupplyChainMock(input));
    }

    const systemPrompt = `You are OrcaTrade Intelligence's supply chain monitoring engine.
Today's date: ${todayStr}

Return only a valid JSON object. No markdown. No explanation.

Hard constraints:
- Return exactly 4 shipments, 2 portConditions, 2 disruptionForecast items, 3 supplierSummary items, and 3 recommendations.
- Every shipment supplierCountry must be "${input.sourcingCountry}".
- Every shipment destinationPort must be "${input.destinationPort}".
- Every shipment productCategory must be one of: ${input.categories.join(', ')}.
- Every ETA must be in the future relative to ${todayStr}.
- Shipments with status "AT RISK" or "DELAYED" must include a concrete riskFlag.
- Shipments with status "IN TRANSIT" or "AT PORT" must not include a riskFlag.
- Use realistic shipping lines, ports, and vessel names.
- Recommendations must cite actual suppliers, ports, shipment IDs, or disruptions from the dashboard.

Country route context for ${input.sourcingCountry}:
- Route: ${route.routeDescription}
- Transit hub: ${route.transitHub}
- Typical shipping lines: ${route.shippingLines.join(', ')}`;

    const userPrompt = `Generate a focused supply chain dashboard for:
Company: ${input.company}
Sourcing country: ${input.sourcingCountry}
Categories: ${input.categories.join(', ')}
Active suppliers: ${input.supplierCount}
Destination port: ${input.destinationPort}
Main concern: ${input.mainConcern}

Return this exact JSON shape:
{
  "summary": {
    "activeShipments": 4,
    "portsMonitored": 2,
    "disruptionAlerts": 0,
    "healthScore": 0,
    "companyName": "${input.company}"
  },
  "shipments": [
    {
      "id": "OT-2026-0000",
      "supplierName": "string",
      "supplierCity": "string",
      "supplierCountry": "${input.sourcingCountry}",
      "destinationPort": "${input.destinationPort}",
      "productCategory": "string",
      "productDescription": "string",
      "status": "IN TRANSIT | AT PORT | DELAYED | AT RISK",
      "eta": "DD Mon YYYY",
      "progressPercent": 0,
      "vesselName": "string",
      "currentPosition": "string",
      "shippingLine": "string",
      "containerCount": 0,
      "containerType": "20ft | 40ft | 40ft HC | 45ft | Reefer",
      "orderValueEur": 0,
      "incoterms": "FOB | CIF | EXW | DDP | DAP",
      "billOfLading": "string",
      "journeyStep": 1,
      "riskFlag": null,
      "eudr": "Compliant | At Risk | N/A",
      "cbam": "Compliant | At Risk | N/A",
      "csddd": "Compliant | At Risk",
      "factoryRiskScore": 0
    }
  ],
  "portConditions": [
    {
      "portName": "string",
      "congestionLevel": "LOW | MODERATE | HIGH | SEVERE",
      "averageDelayDays": 0,
      "trend": "Worsening | Stable | Improving"
    }
  ],
  "disruptionForecast": [
    {
      "title": "string",
      "affectedRegion": "string",
      "impact": "HIGH | MEDIUM | LOW",
      "dateRange": "string",
      "recommendedAction": "string"
    }
  ],
  "supplierSummary": [
    {
      "name": "string",
      "riskScore": 0,
      "status": "string"
    }
  ],
  "recommendations": ["string", "string", "string"]
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
        max_tokens: 9000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Anthropic API error:', errorText);
      return res.status(200).json(buildSupplyChainMock(input));
    }

    const data = await response.json();
    const parsed = JSON.parse(extractJsonObject(data.content?.[0]?.text || '{}'));
    return res.status(200).json(sanitizeSupplyChainResult(parsed, input));
  } catch (error) {
    console.error('Server error:', error);
    return res.status(200).json(buildSupplyChainMock(req.body || {}));
  }
};
