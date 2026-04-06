module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { company, sourcingCountry, categories, supplierCount, destinationPort, mainConcern } = req.body;

    if (!process.env.ORCATRADE_OS_API) {
      console.log('No ORCATRADE_OS_API. Using mock demo values.');
      return res.status(200).json(mockData(company, categories, destinationPort));
    }

    // Today's date for the model to anchor ETAs correctly
    const today = new Date();
    const todayStr = today.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

    // ── Regulatory rules ──────────────────────────────────────────────────────
    // CBAM: steel & iron, aluminium, cement, fertilisers, electricity, hydrogen
    // EUDR: timber/wood/furniture, cocoa, coffee, palm oil, soya, beef/cattle, rubber, leather
    // CSDDD: applies to all categories — always relevant
    const categoriesList = Array.isArray(categories) ? categories : [categories];
    const catStr = categoriesList.join(', ');

    const cbamApplies = categoriesList.some(c =>
      /steel|metal|alumin|cement|fertiliz|electr|hydrogen/i.test(c)
    );
    const eudrApplies = categoriesList.some(c =>
      /wood|timber|furniture|cocoa|coffee|palm|soy|beef|cattle|rubber|leather/i.test(c)
    );

    // ── Shipping route logic ──────────────────────────────────────────────────
    // Map sourcing country → typical transit hubs and shipping lines
    const routeContext = {
      China: 'Via South China Sea → Strait of Malacca → Indian Ocean → Suez Canal → Mediterranean → destination. Major lines: Maersk, MSC, CMA CGM, COSCO, Evergreen.',
      Vietnam: 'Via South China Sea → Strait of Malacca → Indian Ocean → Suez Canal → Mediterranean → destination. Major lines: CMA CGM, MSC, Hapag-Lloyd.',
      India: 'Via Arabian Sea → Gulf of Aden → Red Sea → Suez Canal → Mediterranean → destination. Major lines: MSC, Maersk, ONE.',
      Bangladesh: 'Via Bay of Bengal → Strait of Malacca → Indian Ocean → Suez Canal → Mediterranean → destination. Major lines: Maersk, MSC, CMA CGM.',
      Indonesia: 'Via Java Sea → Strait of Malacca → Indian Ocean → Suez Canal → Mediterranean → destination. Major lines: Evergreen, MSC, CMA CGM.',
      Thailand: 'Via Gulf of Thailand → South China Sea → Strait of Malacca → Indian Ocean → Suez Canal → destination. Major lines: Maersk, MSC, ONE.',
      Malaysia: 'Via Strait of Malacca → Indian Ocean → Suez Canal → Mediterranean → destination. Major lines: Maersk, Evergreen, MSC.',
      Taiwan: 'Via East China Sea → South China Sea → Strait of Malacca → Indian Ocean → Suez Canal → destination. Major lines: Evergreen, Yang Ming, CMA CGM.',
      'South Korea': 'Via East China Sea → South China Sea → Strait of Malacca → Indian Ocean → Suez Canal → destination. Major lines: HMM, Maersk, MSC.',
    };
    const route = routeContext[sourcingCountry] || routeContext['China'];

    // Journey step → progress mapping (used for validation later)
    const stepProgressMap = { 1: 5, 2: 18, 3: 28, 4: 40, 5: 60, 6: 78, 7: 90, 8: 100 };

    const systemPrompt = `You are OrcaTrade Intelligence, a professional supply chain monitoring platform used by European importers.
Your job is to generate a realistic, internally consistent supply chain dashboard for a specific company.

Today's date: ${todayStr}

STRICT RULES — violations will cause errors:
1. Return ONLY a valid JSON object. No markdown fences, no explanation, no text outside the JSON.
2. Generate EXACTLY 4 shipments, EXACTLY 2 portConditions, EXACTLY 2 disruptionForecast items, EXACTLY 3 supplierSummary items, EXACTLY 3 recommendations.
3. All supplier names, cities, and countries must match the specified sourcing country (${sourcingCountry}).
4. All ETAs must be in the future relative to today (${todayStr}). Minimum ETA: 2 weeks from today. Maximum: 16 weeks.
5. journeyStep must be an integer 1–8. progressPercent must be consistent with journeyStep:
   step 1 → 5–12%, step 2 → 13–25%, step 3 → 26–35%, step 4 → 36–50%, step 5 → 51–70%, step 6 → 71–85%, step 7 → 86–95%, step 8 → 96–100%
6. Shipments with status "AT RISK" or "DELAYED" MUST have a non-null riskFlag with specific title, estimatedDelayDays (5–30), financialImpactEur, and a concrete recommendedAction.
7. Shipments with status "IN TRANSIT" or "AT PORT" MUST have riskFlag: null (unless there is a genuine secondary concern — in that case status must be AT RISK).
8. EUDR applicability: "${eudrApplies ? 'APPLICABLE' : 'N/A for these categories'}" — EUDR applies to timber, wood, furniture, cocoa, coffee, palm oil, soya, cattle/beef, rubber, leather. If not applicable, set eudr: "N/A".
9. CBAM applicability: "${cbamApplies ? 'APPLICABLE' : 'N/A for these categories'}" — CBAM applies to steel, iron, aluminium, cement, fertilisers, electricity, hydrogen. If not applicable, set cbam: "N/A".
10. CSDDD is always potentially applicable — set to "Compliant" or "At Risk" based on the supplier's profile.
11. summary.disruptionAlerts must equal the number of shipments with status "AT RISK" or "DELAYED" plus the number of disruptionForecast items with impact "HIGH".
12. summary.healthScore must be a realistic weighted score: start at 100, subtract 15 per AT RISK shipment, subtract 8 per DELAYED, subtract 5 per HIGH disruption forecast, subtract 3 per MODERATE port congestion, subtract 5 per HIGH port congestion. Minimum 30.
13. Shipping route for ${sourcingCountry}: ${route}
14. Use real vessel names (e.g. "MSC Gülsün", "Ever Given", "CMA CGM Palais Royal"), realistic B/L references, and accurate port names.
15. Recommendations must be specific, actionable, and reference actual suppliers, ports, or regulations from the generated data — not generic platitudes.
16. supplierSummary names must match the supplierName values used in the shipments array.`;

    const userPrompt = `Generate a supply chain dashboard for:
Company: ${company}
Sourcing country: ${sourcingCountry}
Product categories: ${catStr}
Number of active suppliers: ${supplierCount}
Destination port: ${destinationPort}
Main concern: ${mainConcern}

Return this exact JSON structure (no extra fields, no missing fields):
{
  "summary": {
    "activeShipments": 4,
    "portsMonitored": 2,
    "disruptionAlerts": <integer — see rule 11>,
    "healthScore": <integer 30-100 — see rule 12>,
    "companyName": "${company}"
  },
  "shipments": [
    {
      "id": "OT-2026-<4-digit number>",
      "supplierName": <real-sounding company name in ${sourcingCountry}>,
      "supplierCity": <real city in ${sourcingCountry}>,
      "supplierCountry": "${sourcingCountry}",
      "destinationPort": "${destinationPort}",
      "productCategory": <one of: ${catStr}>,
      "productDescription": <specific description>,
      "status": <"IN TRANSIT"|"AT PORT"|"DELAYED"|"AT RISK">,
      "eta": <"DD Mon YYYY" — future date>,
      "progressPercent": <number consistent with journeyStep — see rule 5>,
      "vesselName": <real vessel name>,
      "currentPosition": <specific geographic description>,
      "shippingLine": <real shipping line>,
      "containerCount": <number>,
      "containerType": <"20ft"|"40ft"|"40ft HC"|"45ft"|"Reefer">,
      "orderValueEur": <realistic number>,
      "incoterms": <"FOB"|"CIF"|"EXW"|"DDP"|"DAP">,
      "billOfLading": <realistic B/L ref>,
      "journeyStep": <1-8>,
      "riskFlag": <null or { "title": string, "estimatedDelayDays": number, "financialImpactEur": number, "recommendedAction": string }>,
      "eudr": <"Compliant"|"At Risk"|"N/A">,
      "cbam": <"Compliant"|"At Risk"|"N/A">,
      "csddd": <"Compliant"|"At Risk">,
      "factoryRiskScore": <number 20-95>
    }
  ],
  "portConditions": [
    {
      "portName": <one must be "${destinationPort}">,
      "congestionLevel": <"LOW"|"MODERATE"|"HIGH"|"SEVERE">,
      "averageDelayDays": <number>,
      "trend": <"Worsening"|"Stable"|"Improving">
    }
  ],
  "disruptionForecast": [
    {
      "title": <specific event title>,
      "affectedRegion": <specific region relevant to ${sourcingCountry}–${destinationPort} route>,
      "impact": <"HIGH"|"MEDIUM"|"LOW">,
      "dateRange": <specific date range or window>,
      "recommendedAction": <specific actionable advice>
    }
  ],
  "supplierSummary": [
    {
      "name": <must match a supplierName from shipments>,
      "riskScore": <number 20-95>,
      "status": <one-sentence operational status>
    }
  ],
  "recommendations": [<3 specific, actionable strings referencing actual data in this dashboard>]
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
        max_tokens: 16000,
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

    // Strip markdown fences
    textResponse = textResponse.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();

    // Extract first JSON object
    const jsonMatch = textResponse.match(/\{[\s\S]*\}/);
    if (jsonMatch) textResponse = jsonMatch[0];

    let parsed;
    try {
      parsed = JSON.parse(textResponse);
    } catch (parseError) {
      console.error('Parse error. Raw:', textResponse.slice(0, 500));
      return res.status(500).json({ error: 'Failed to parse AI response', raw: textResponse.slice(0, 300) });
    }

    // ── Server-side sanitisation & correction ─────────────────────────────────
    parsed = sanitise(parsed, { destinationPort, cbamApplies, eudrApplies, stepProgressMap });

    return res.status(200).json(parsed);

  } catch (err) {
    console.error('Server error:', err);
    return res.status(500).json({ error: err.message });
  }
};

// ── Sanitisation function ─────────────────────────────────────────────────────
function sanitise(d, opts) {
  const { destinationPort, cbamApplies, eudrApplies, stepProgressMap } = opts;

  // Ensure shipments array
  if (!Array.isArray(d.shipments)) d.shipments = [];

  let atRiskCount = 0;
  let highDisruptionCount = 0;
  let healthPenalty = 0;

  d.shipments = d.shipments.map(s => {
    // Clamp journeyStep
    s.journeyStep = Math.max(1, Math.min(8, Math.round(s.journeyStep || 4)));

    // Fix progressPercent to be consistent with journeyStep
    const expectedProgress = stepProgressMap[s.journeyStep];
    if (!s.progressPercent || Math.abs(s.progressPercent - expectedProgress) > 20) {
      s.progressPercent = expectedProgress;
    }
    s.progressPercent = Math.max(1, Math.min(100, s.progressPercent));

    // Fix status vs riskFlag consistency
    if ((s.status === 'AT RISK' || s.status === 'DELAYED') && !s.riskFlag) {
      s.riskFlag = {
        title: 'Operational Delay',
        estimatedDelayDays: 7,
        financialImpactEur: Math.round((s.orderValueEur || 50000) * 0.03),
        recommendedAction: 'Monitor closely and engage freight forwarder for status update.'
      };
    }
    if ((s.status === 'IN TRANSIT' || s.status === 'AT PORT') && s.riskFlag !== null) {
      // Allow riskFlag on IN TRANSIT if there's a genuine flag, but upgrade status
      if (s.riskFlag && s.status === 'IN TRANSIT') {
        s.status = 'AT RISK';
      }
    }

    // Fix EUDR/CBAM based on actual rules
    if (!eudrApplies) s.eudr = 'N/A';
    if (!cbamApplies) s.cbam = 'N/A';

    // Clamp factoryRiskScore
    s.factoryRiskScore = Math.max(20, Math.min(95, Math.round(s.factoryRiskScore || 60)));

    // Count for summary
    if (s.status === 'AT RISK' || s.status === 'DELAYED') {
      atRiskCount++;
      healthPenalty += s.status === 'AT RISK' ? 15 : 8;
    }

    // Clamp orderValueEur
    if (s.orderValueEur) s.orderValueEur = Math.round(s.orderValueEur);

    return s;
  });

  // Port conditions
  if (!Array.isArray(d.portConditions)) d.portConditions = [];
  d.portConditions.forEach(p => {
    if (p.congestionLevel === 'HIGH' || p.congestionLevel === 'SEVERE') healthPenalty += 5;
    else if (p.congestionLevel === 'MODERATE') healthPenalty += 3;
  });

  // Ensure destination port appears in portConditions
  const hasDestPort = d.portConditions.some(p =>
    p.portName && p.portName.toLowerCase().includes(destinationPort.toLowerCase())
  );
  if (!hasDestPort && d.portConditions.length > 0) {
    d.portConditions[0].portName = destinationPort;
  }

  // Disruption forecast
  if (!Array.isArray(d.disruptionForecast)) d.disruptionForecast = [];
  d.disruptionForecast.forEach(f => {
    if (f.impact === 'HIGH') { highDisruptionCount++; healthPenalty += 5; }
  });

  // Fix summary
  if (!d.summary) d.summary = {};
  d.summary.disruptionAlerts = atRiskCount + highDisruptionCount;
  d.summary.healthScore = Math.max(30, Math.min(100, 100 - healthPenalty));
  d.summary.activeShipments = d.shipments.length;
  d.summary.portsMonitored = d.portConditions.length;

  // Fix supplierSummary names to match shipment suppliers
  if (Array.isArray(d.supplierSummary) && d.shipments.length > 0) {
    const shipmentSuppliers = d.shipments.map(s => s.supplierName);
    d.supplierSummary = d.supplierSummary.map((sup, i) => {
      if (!shipmentSuppliers.includes(sup.name) && shipmentSuppliers[i]) {
        sup.name = shipmentSuppliers[i];
      }
      sup.riskScore = Math.max(20, Math.min(95, Math.round(sup.riskScore || 60)));
      return sup;
    });
  }

  return d;
}

// ── Mock data (used when no API key is set) ───────────────────────────────────
function mockData(company, categories, destinationPort) {
  const port = destinationPort || 'Rotterdam';
  const cat = Array.isArray(categories) && categories.length ? categories[0] : 'Electronics';
  return {
    summary: {
      activeShipments: 4,
      portsMonitored: 2,
      disruptionAlerts: 2,
      healthScore: 72,
      companyName: company || 'Your Company'
    },
    shipments: [
      {
        id: 'OT-2026-0842',
        supplierName: 'Shenzhen Innovatech Manufacturing Co.',
        supplierCity: 'Shenzhen',
        supplierCountry: 'China',
        destinationPort: port,
        productCategory: cat,
        productDescription: 'Consumer electronics & components',
        status: 'IN TRANSIT',
        eta: '14 Jun 2026',
        progressPercent: 60,
        vesselName: 'MSC Gülsün',
        currentPosition: 'Passing through the Strait of Malacca',
        shippingLine: 'MSC',
        containerCount: 4,
        containerType: '40ft HC',
        orderValueEur: 420000,
        incoterms: 'FOB',
        billOfLading: 'MSC-9284716',
        journeyStep: 5,
        riskFlag: null,
        eudr: 'N/A',
        cbam: 'N/A',
        csddd: 'Compliant',
        factoryRiskScore: 82
      },
      {
        id: 'OT-2026-0843',
        supplierName: 'Guangzhou Precision Parts Ltd.',
        supplierCity: 'Guangzhou',
        supplierCountry: 'China',
        destinationPort: port,
        productCategory: cat,
        productDescription: 'Precision mechanical components',
        status: 'AT RISK',
        eta: '28 Jun 2026',
        progressPercent: 40,
        vesselName: 'COSCO Universe',
        currentPosition: 'Anchored at Singapore awaiting berth',
        shippingLine: 'COSCO',
        containerCount: 2,
        containerType: '20ft',
        orderValueEur: 185000,
        incoterms: 'CIF',
        billOfLading: 'COS-421194',
        journeyStep: 4,
        riskFlag: {
          title: 'Singapore Port Congestion — Berth Delay',
          estimatedDelayDays: 9,
          financialImpactEur: 8400,
          recommendedAction: 'Engage freight forwarder to request priority berthing or reroute via Port Klang with +2 day adjustment.'
        },
        eudr: 'N/A',
        cbam: 'N/A',
        csddd: 'At Risk',
        factoryRiskScore: 54
      },
      {
        id: 'OT-2026-0844',
        supplierName: 'Dongguan Allied Components Co.',
        supplierCity: 'Dongguan',
        supplierCountry: 'China',
        destinationPort: port,
        productCategory: cat,
        productDescription: 'Assembled sub-components',
        status: 'AT PORT',
        eta: '05 Jun 2026',
        progressPercent: 78,
        vesselName: 'Evergreen Emerald',
        currentPosition: `Waiting at ${port} anchorage`,
        shippingLine: 'Evergreen',
        containerCount: 6,
        containerType: '40ft Standard',
        orderValueEur: 610000,
        incoterms: 'DDP',
        billOfLading: 'EVG-99931',
        journeyStep: 6,
        riskFlag: null,
        eudr: 'N/A',
        cbam: 'N/A',
        csddd: 'Compliant',
        factoryRiskScore: 76
      },
      {
        id: 'OT-2026-0845',
        supplierName: 'Tianjin Export Manufacturing Group',
        supplierCity: 'Tianjin',
        supplierCountry: 'China',
        destinationPort: port,
        productCategory: cat,
        productDescription: 'Industrial machinery parts',
        status: 'DELAYED',
        eta: '20 Jul 2026',
        progressPercent: 18,
        vesselName: 'Maersk Mc-Kinney Møller',
        currentPosition: 'Awaiting vessel loading at Tianjin Port',
        shippingLine: 'Maersk',
        containerCount: 3,
        containerType: '40ft HC',
        orderValueEur: 290000,
        incoterms: 'EXW',
        billOfLading: 'MSK-338821',
        journeyStep: 2,
        riskFlag: {
          title: 'Production Delay at Origin Factory',
          estimatedDelayDays: 12,
          financialImpactEur: 14500,
          recommendedAction: 'Escalate to supplier management and request revised production completion certificate. Consider partial shipment to meet deadline.'
        },
        eudr: 'N/A',
        cbam: 'N/A',
        csddd: 'At Risk',
        factoryRiskScore: 38
      }
    ],
    portConditions: [
      {
        portName: port,
        congestionLevel: 'MODERATE',
        averageDelayDays: 3,
        trend: 'Stable'
      },
      {
        portName: 'Singapore (Transit Hub)',
        congestionLevel: 'HIGH',
        averageDelayDays: 6,
        trend: 'Worsening'
      }
    ],
    disruptionForecast: [
      {
        title: 'Suez Canal Southbound Traffic Restrictions',
        affectedRegion: 'Red Sea / Suez Canal',
        impact: 'HIGH',
        dateRange: 'Next 45 days',
        recommendedAction: 'Add 12–16 days buffer to all China–EU lead times. Pre-alert customers of potential delays on affected shipments.'
      },
      {
        title: 'South China Sea Typhoon Season Onset',
        affectedRegion: 'South China Sea',
        impact: 'MEDIUM',
        dateRange: 'Late May – September 2026',
        recommendedAction: 'Advance loading schedules for Shenzhen and Guangzhou shipments before June. Confirm insurance coverage for weather-related delays.'
      }
    ],
    supplierSummary: [
      {
        name: 'Shenzhen Innovatech Manufacturing Co.',
        riskScore: 82,
        status: 'Stable operations. On-time delivery rate 96% over last 12 months.'
      },
      {
        name: 'Dongguan Allied Components Co.',
        riskScore: 76,
        status: 'Minor capacity constraints reported — monitor Q3 output.'
      },
      {
        name: 'Tianjin Export Manufacturing Group',
        riskScore: 38,
        status: 'Production delay active. ESG audit overdue by 60 days.'
      }
    ],
    recommendations: [
      'Prioritise customs pre-clearance for OT-2026-0844 (Dongguan Allied) currently waiting at anchorage — every day of delay costs approximately €1,800 in demurrage.',
      'Tianjin Export Manufacturing Group (OT-2026-0845) has an overdue ESG audit — this will trigger CSDDD non-compliance risk in Q3. Request audit completion by end of June.',
      'Singapore transit congestion is worsening — request that your freight forwarder pre-book priority berthing slots for the next two outbound China shipments.'
    ]
  };
}