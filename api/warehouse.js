// EU 3PL warehouse comparison endpoint.

const { consumeRateLimit } = require('../lib/intelligence/runtime-store');
const {
  calculateQuote,
  listHubs,
  listValueAddedServices,
  PRICING_SNAPSHOT,
} = require('../lib/intelligence/warehouse-quote');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    return res.status(200).json({
      snapshot: PRICING_SNAPSHOT,
      hubs: listHubs(),
      valueAddedServices: listValueAddedServices(),
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  const rate = await consumeRateLimit('warehouse', ip, 30, 60000);
  if (rate.limited) return res.status(429).json({ error: 'Too many requests. Please wait a moment.' });

  const body = req.body || {};
  const result = calculateQuote({
    monthlyOrders: body.monthlyOrders,
    avgUnitsPerOrder: body.avgUnitsPerOrder,
    avgLinesPerOrder: body.avgLinesPerOrder,
    avgPalletsHeld: body.avgPalletsHeld,
    avgOrderWeightKg: body.avgOrderWeightKg,
    primaryDestination: body.primaryDestination,
    valueAddedServices: body.valueAddedServices,
    returnsRate: body.returnsRate,
    skuCount: body.skuCount,
  });
  if (!result.ok) return res.status(400).json({ error: 'Validation failed', errors: result.errors });
  return res.status(200).json(result);
};
