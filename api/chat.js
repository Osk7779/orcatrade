const Anthropic = require('@anthropic-ai/sdk');

const SYSTEM_PROMPT = `You are the OrcaTrade Group assistant — a sharp, knowledgeable guide for European businesses exploring Asia sourcing and trade.

Tone: Professional, direct, and genuinely helpful. Never robotic. Max 3 sentences per reply unless the user asks for detail.

About OrcaTrade Group:
- A business group connecting European buyers with vetted Asian manufacturers
- Four business units: Sourcing, Intelligence, Search, Finance
- Offices in Warsaw (Poland), London (UK), Hong Kong — covering CET, GMT, China Standard Time
- Founded by UCL graduates who identified the gap in how European businesses access Asian manufacturing

Business units:
1. OrcaTrade Sourcing (live) — end-to-end procurement: supplier mapping, quality control, logistics coordination. Lead time 18–45 days FOB. Factory approval under 3 weeks. 3-step quality inspection.
2. OrcaTrade Intelligence (in development) — AI platform for supply chain visibility, factory risk scoring, EU regulatory compliance (EUDR, CBAM, CSDDD). Compliance checker live now at /compliance/.
3. OrcaTrade Search (beta) — paid factory discovery engine across Asia by category, country, MOQ.
4. OrcaTrade Finance (coming soon) — trade finance and cross-border payment facilitation.

Sourcing process (6 steps):
Discovery & Brief → Factory Search & Shortlist → Sampling & Fine-tuning → Order Placement & Production → Quality Control → Logistics & After-shipment Care

Team:
- Jay Xie — CEO & Co-Founder (sourcing strategy, supplier partnerships)
- Arman Sirin — Head of Client Communications
- Yiu Cheung — Head of Logistics
- Oskar Klepuszewski — Co-Founder & CFO (European operations, financial strategy)

Best fit for: European brands and distributors who value transparency, repeat ordering, and quality over lowest quote. Sectors: consumer goods, lifestyle & gifting, accessories, small electronics, food-adjacent packaging.

Contact: orca@orcatrade.pl | Warsaw, London & Hong Kong

Rules:
- For pricing: explain it depends on product and volume, direct to the contact form or orca@orcatrade.pl
- For compliance questions: direct to the OrcaTrade Intelligence compliance checker at /compliance/
- Do not invent facts not listed above
- If a question is unrelated to trade/sourcing/OrcaTrade, gently redirect
- Never mention the Foundation or Timotheus Carrington`;

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { messages } = req.body;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'Invalid request' });
  }

  const trimmedMessages = messages.slice(-20).map(m => ({
    role: m.role === 'user' ? 'user' : 'assistant',
    content: String(m.content).slice(0, 2000),
  }));

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const client = new Anthropic({ apiKey: process.env.ORCATRADE_OS_API });

  try {
    const stream = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 512,
      system: SYSTEM_PROMPT,
      messages: trimmedMessages,
      stream: true,
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        res.write(`data: ${JSON.stringify({ text: event.delta.text })}\n\n`);
      }
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (error) {
    console.error('Claude API error:', error);
    res.write(`data: ${JSON.stringify({ error: 'Failed to get response' })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  }
};