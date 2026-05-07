// Sample Management Service quote / request endpoint.

const { consumeRateLimit } = require('../intelligence/runtime-store');
const {
  calculateQuote,
  listShippingBands,
  listDestinationRegions,
  PRICING_SNAPSHOT,
} = require('../intelligence/sample-quote');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    return res.status(200).json({
      snapshot: PRICING_SNAPSHOT,
      shippingBands: listShippingBands(),
      destinationRegions: listDestinationRegions(),
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  const rate = await consumeRateLimit('samples', ip, 30, 60000);
  if (rate.limited) {
    return res.status(429).json({ error: 'Too many requests. Please wait a moment.' });
  }

  const body = req.body || {};
  const result = calculateQuote({
    supplierCount: body.supplierCount,
    totalWeightKg: body.totalWeightKg,
    destinationCountry: body.destinationCountry,
    express: body.express === true,
    rushTurnaround: body.rushTurnaround === true,
  });

  if (!result.ok) {
    return res.status(400).json({ error: 'Validation failed', errors: result.errors });
  }

  return res.status(200).json(result);
};
