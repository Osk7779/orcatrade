module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { company, sourcingCountry, categories, supplierCount, destinationPort, mainConcern } = req.body;

    if (!process.env.ORCATRADE_OS_API) {
      console.log('No ORCATRADE_OS_API. Using mock demo values.');
      return res.status(200).json({
        summary: {
          activeShipments: 14,
          portsMonitored: 3,
          disruptionAlerts: 2,
          healthScore: 78,
          companyName: company || 'Your Company'
        },
        shipments: [
          {
            id: 'OT-2026-0842',
            supplierName: 'Shenzhen Global Tech Manufacturing Ltd.',
            supplierCity: 'Shenzhen',
            supplierCountry: 'China',
            destinationPort: destinationPort || 'Rotterdam',
            productCategory: categories && categories.length ? categories[0] : 'Electronics',
            productDescription: 'Consumer electronics & components',
            status: 'IN TRANSIT',
            eta: '12 May 2026',
            progressPercent: 65,
            vesselName: 'Evergreen Apex',
            currentPosition: 'Currently in the Indian Ocean',
            shippingLine: 'Maersk',
            containerCount: 4,
            containerType: '40ft HC',
            orderValueEur: 420000,
            incoterms: 'FOB',
            billOfLading: 'MSK-9284716',
            journeyStep: 5,
            riskFlag: null,
            eudr: 'N/A',
            cbam: 'Compliant',
            csddd: 'Compliant',
            factoryRiskScore: 84
          },
          {
            id: 'OT-2026-0843',
            supplierName: 'Apex Precision Forging',
            supplierCity: 'Pune',
            supplierCountry: 'India',
            destinationPort: destinationPort || 'Rotterdam',
            productCategory: 'Steel & Metal',
            productDescription: 'Industrial forged components',
            status: 'AT RISK',
            eta: '22 May 2026',
            progressPercent: 30,
            vesselName: 'MSC Isabella',
            currentPosition: 'Departed Mumbai Port',
            shippingLine: 'MSC',
            containerCount: 2,
            containerType: '20ft',
            orderValueEur: 185000,
            incoterms: 'CIF',
            billOfLading: 'MSC-421194',
            journeyStep: 4,
            riskFlag: {
              title: 'Port Strike Imminent',
              estimatedDelayDays: 14,
              financialImpactEur: 12000,
              recommendedAction: 'Reroute to Felixstowe port available for €2,400 surcharge.'
            },
            eudr: 'N/A',
            cbam: 'At Risk',
            csddd: 'At Risk',
            factoryRiskScore: 41
          },
          {
            id: 'OT-2026-0844',
            supplierName: 'Mekong Delta Assembly Co.',
            supplierCity: 'Ho Chi Minh City',
            supplierCountry: 'Vietnam',
            destinationPort: destinationPort || 'Rotterdam',
            productCategory: 'Textiles',
            productDescription: 'Apparel and fabric rolls',
            status: 'AT PORT',
            eta: '02 May 2026',
            progressPercent: 85,
            vesselName: 'CMA CGM Vela',
            currentPosition: 'Waiting at destination anchorage',
            shippingLine: 'CMA CGM',
            containerCount: 6,
            containerType: '40ft Standard',
            orderValueEur: 610000,
            incoterms: 'DDP',
            billOfLading: 'CMA-99931',
            journeyStep: 6,
            riskFlag: null,
            eudr: 'N/A',
            cbam: 'N/A',
            csddd: 'At Risk',
            factoryRiskScore: 62
          }
        ],
        portConditions: [
          {
            portName: destinationPort || 'Rotterdam',
            congestionLevel: 'MODERATE',
            averageDelayDays: 3,
            trend: 'Stable'
          },
          {
            portName: 'Singapore (Transit)',
            congestionLevel: 'HIGH',
            averageDelayDays: 5,
            trend: 'Worsening'
          }
        ],
        disruptionForecast: [
          {
            title: 'Suez Canal Capacity Restrictions',
            affectedRegion: 'Red Sea / Egypt',
            impact: 'HIGH',
            dateRange: 'Next 60 Days',
            recommendedAction: 'Factor +14 days into all China-EU lead times.'
          },
          {
            title: 'Typhoon Season Early Onset',
            affectedRegion: 'South China Sea',
            impact: 'MEDIUM',
            dateRange: 'Starting late May',
            recommendedAction: 'Accelerate critical shipments from Shenzhen and Taiwan.'
          }
        ],
        supplierSummary: [
          {
            name: 'Shenzhen Global Tech Manufacturing Ltd.',
            riskScore: 84,
            status: 'Stable operations. No active risks.'
          },
          {
            name: 'Mekong Delta Assembly Co.',
            riskScore: 62,
            status: 'Minor labor compliance gap detected.'
          },
          {
            name: 'Apex Precision Forging',
            riskScore: 41,
            status: 'High ESG risk. Carbon reporting incomplete.'
          }
        ],
        recommendations: [
          'Diversify port of entry: Recent strikes at your primary destination warrant exploring secondary EU ports.',
          'Review CBAM exposure: Apex Precision Forging is currently designated high-risk for carbon reporting deadlines next month.',
          'Consolidate Vietnam shipments: Freight rates are projected to rise 15% next quarter.'
        ]
      });
    }

    const systemPrompt = `You are OrcaTrade Intelligence's supply chain monitoring engine.
Generate realistic, detailed supply chain dashboard data for a company importing goods from Asia to Europe.
The data must be internally consistent and feel like a real operational dashboard — not a generic template.
Be specific: use real port names, real shipping routes, real vessel types, realistic ETAs, realistic disruption events.
Make disruption alerts and risk levels feel genuine — not everything is fine, not everything is catastrophic. Show real operational nuance.
Return only valid JSON. No markdown. No explanation.`;

    const userPrompt = `Generate a complete supply chain dashboard for:
Company: ${company}
Sourcing country: ${sourcingCountry}
Product categories: ${categories}
Number of suppliers: ${supplierCount}
Destination port: ${destinationPort}
Main concern: ${mainConcern}

Return this exact JSON structure:
{
  "summary": {
    "activeShipments": number,
    "portsMonitored": number,
    "disruptionAlerts": number,
    "healthScore": number 0-100,
    "companyName": string
  },
  "shipments": [
    {
      "id": "OT-2026-XXXX",
      "supplierName": string,
      "supplierCity": string,
      "supplierCountry": string,
      "destinationPort": string,
      "productCategory": string,
      "productDescription": string,
      "status": "IN TRANSIT"|"AT PORT"|"DELAYED"|"AT RISK",
      "eta": "DD Mon YYYY",
      "progressPercent": number 0-100,
      "vesselName": string,
      "currentPosition": string,
      "shippingLine": string,
      "containerCount": number,
      "containerType": string,
      "orderValueEur": number,
      "incoterms": string,
      "billOfLading": string,
      "journeyStep": number 1-8,
      "riskFlag": null | {
        "title": string,
        "estimatedDelayDays": number,
        "financialImpactEur": number,
        "recommendedAction": string
      },
      "eudr": "Compliant"|"At Risk"|"N/A",
      "cbam": "Compliant"|"At Risk"|"N/A",
      "csddd": "Compliant"|"At Risk"|"N/A",
      "factoryRiskScore": number 0-100
    }
  ],
  "portConditions": [
    {
      "portName": string,
      "congestionLevel": "LOW"|"MODERATE"|"HIGH"|"SEVERE",
      "averageDelayDays": number,
      "trend": "Worsening"|"Stable"|"Improving"
    }
  ],
  "disruptionForecast": [
    {
      "title": string,
      "affectedRegion": string,
      "impact": "HIGH"|"MEDIUM"|"LOW",
      "dateRange": string,
      "recommendedAction": string
    }
  ],
  "supplierSummary": [
    {
      "name": string,
      "riskScore": number 0-100,
      "status": "string one line"
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
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Anthropic API error:', errorText);
      return res.status(500).json({ error: `Anthropic API error: ${response.statusText}` });
    }

    const data = await response.json();
    let textResponse = data.content?.[0]?.text || '{}';
    textResponse = textResponse.replace(/^```json\s*/, '').replace(/```$/, '').trim();

    try {
      const parsed = JSON.parse(textResponse);
      return res.status(200).json(parsed);
    } catch (parseError) {
      return res.status(500).json({ error: 'Failed to parse AI response' });
    }

  } catch (err) {
    console.error('Server error:', err);
    return res.status(500).json({ error: err.message });
  }
};