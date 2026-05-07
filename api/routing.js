// Multi-modal routing quote endpoint.

const { consumeRateLimit } = require('../lib/intelligence/runtime-store');
const { calculateQuote, listModes, PRICING_SNAPSHOT } = require('../lib/intelligence/routing-quote');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    return res.status(200).json({ snapshot: PRICING_SNAPSHOT, modes: listModes() });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  const rate = await consumeRateLimit('routing', ip, 30, 60000);
  if (rate.limited) return res.status(429).json({ error: 'Too many requests. Please wait a moment.' });

  const body = req.body || {};
  const result = calculateQuote({
    weightKg: body.weightKg,
    volumeCbm: body.volumeCbm,
    originCountry: body.originCountry,
    destinationCountry: body.destinationCountry,
    urgencyDays: body.urgencyDays,
    costPriority: body.costPriority,
  });
  if (!result.ok) return res.status(400).json({ error: 'Validation failed', errors: result.errors });
  return res.status(200).json(result);
};
