export const config = {
  runtime: 'edge',
};

import { eudrRegulation } from '../regulations/eudr.js';
import { cbamRegulation } from '../regulations/cbam.js';
import { csdddRegulation } from '../regulations/csddd.js';

export default async function handler(request) {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const orderData = await request.json();
    
    // Normalize data from the frontend form to match regulation checking logic
    const normalizedData = {
      ...orderData,
      destinationMarket: orderData.euMarket ? 'EU' : 'Other',
      importDestination: orderData.euMarket ? 'EU' : 'Other',
      products: orderData.productDescription ? [orderData.productCategory, orderData.productDescription.toLowerCase()] : [orderData.productCategory],
    };
    
    // Map company size to numerical values for CSDDD thresholds
    if (orderData.companySize === 'Over 1000 employees') {
      normalizedData.buyerCompanySize = 1500; 
    } else if (orderData.companySize === '250–1000 employees') {
      normalizedData.buyerCompanySize = 500;
    } else {
      normalizedData.buyerCompanySize = 100;
    }

    // Map import value to theoretical revenue for demo purposes to trigger thresholds
    if (orderData.importValue === 'Over €5M') {
      normalizedData.buyerRevenue = 500000000; // over €450M threshold
    } else {
      normalizedData.buyerRevenue = 10000000;
    }
    
    // Check relevance for each regulation
    const eudrCheck = eudrRegulation.checkRelevance(normalizedData);
    const cbamCheck = cbamRegulation.checkRelevance(normalizedData);
    const csdddCheck = csdddRegulation.checkRelevance(normalizedData);
    
    const applicableRegulations = [];
    if (eudrCheck.relevant) applicableRegulations.push({ reg: eudrRegulation, reasons: eudrCheck.reasons });
    if (cbamCheck.relevant) applicableRegulations.push({ reg: cbamRegulation, reasons: cbamCheck.reasons });
    if (csdddCheck.relevant) applicableRegulations.push({ reg: csdddRegulation, reasons: csdddCheck.reasons });
    
    // System Prompt setup
    const systemPrompt = `You are OrcaTrade Intelligence's compliance engine. You are an expert in EU trade regulations. Analyze the provided order details against the specified regulations and return a structured JSON compliance report. Be specific, practical, and actionable. Never be vague. Always cite the specific article or requirement that creates a compliance obligation.`;
    
    let regulationContext = "";
    if (applicableRegulations.length > 0) {
      regulationContext = "Relevant Regulations and Requirements:\n\n" + applicableRegulations.map(a => `
Name: ${a.reg.name}
Short Description: ${a.reg.shortDescription}
Applicable To: ${a.reg.applicableTo}
Effective Date: ${a.reg.effectiveDate}
Penalties: ${a.reg.penaltiesText}
Key Requirements:
- ${a.reg.keyRequirements.join('\n- ')}
Reasons this applies:
- ${a.reasons.join('\n- ')}
`).join('\n---\n');
    } else {
      regulationContext = "Based on our initial checks, none of our tracked regulations (EUDR, CBAM, CSDDD) are directly triggered. Please confirm this independently based on the order data, but you may report not_applicable for all.";
    }

    const jsonSchema = `{
  "overallStatus": "compliant" | "at_risk" | "non_compliant",
  "overallScore": 0-100,
  "checkedRegulations": [
    {
      "regulation": "EUDR" | "CBAM" | "CSDDD",
      "applicable": boolean,
      "status": "compliant" | "at_risk" | "non_compliant" | "not_applicable",
      "riskLevel": "low" | "medium" | "high",
      "summary": "one sentence plain English",
      "findings": ["specific finding 1", "finding 2"],
      "requiredActions": ["specific action 1", "action 2"],
      "deadline": "date or timeframe if applicable",
      "estimatedCost": "rough cost estimate if applicable"
    }
  ],
  "priorityActions": ["top 3 actions across all regulations"],
  "estimatedTotalRisk": "financial risk estimate in EUR",
  "nextSteps": "what to do in the next 30 days"
}`;

    const userPrompt = `Order Data:
${JSON.stringify(orderData, null, 2)}

${regulationContext}

Instructions:
Assess compliance gap, risk level, and specific action items based strictly on the regulations included above. You must return EXACTLY AND ONLY a valid JSON object matching the following structure:
${jsonSchema}

Do NOT wrap the JSON in Markdown backticks (e.g., \`\`\`json). Just return the raw JSON object.`;

    const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
    
    if (!anthropicApiKey) {
      throw new Error("Missing ANTHROPIC_API_KEY environment variable");
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicApiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6', // Model requested
        max_tokens: 4000,
        system: systemPrompt,
        messages: [
          { role: 'user', content: userPrompt }
        ]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Anthropic API Error:", errorText);
      return new Response(JSON.stringify({ error: 'Failed to communicate with Anthropic API. Model may not exist or key invalid.' }), {
        status: response.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const data = await response.json();
    let assistantText = data.content[0].text;
    
    // Graceful fallback parsing in case model wraps in markdown
    let parsedJson;
    try {
      const jsonMatch = assistantText.match(/```(?:json)?\n([\s\S]*)\n```/);
      if (jsonMatch) {
         assistantText = jsonMatch[1];
      }
      parsedJson = JSON.parse(assistantText);
    } catch (parseError) {
      console.error('Failed to parse Anthropic JSON output:', assistantText);
      return new Response(JSON.stringify({ error: 'Invalid JSON response from AI model' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify(parsedJson), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('API Error:', error);
    return new Response(JSON.stringify({ error: error.message || 'Internal Server Error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
