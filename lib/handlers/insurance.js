// Insurance Marketplace quote endpoint.
// Accepts { cargoValueEur, transportMode, goodsType, originCountry, destinationCountry, coverage }
// returns structured premium quote with deterministic calculation.

const { consumeRateLimit } = require('../intelligence/runtime-store');
const {
  calculateQuote,
  listGoodsTypes,
  listTransportModes,
  listCoverageOptions,
  RATE_SNAPSHOT,
} = require('../intelligence/insurance-quote');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    return res.status(200).json({
      snapshot: RATE_SNAPSHOT,
      transportModes: listTransportModes(),
      goodsTypes: listGoodsTypes(),
      coverageOptions: listCoverageOptions(),
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  const rate = await consumeRateLimit('insurance', ip, 30, 60000);
  if (rate.limited) {
    return res.status(429).json({ error: 'Too many quote requests. Please wait a moment.' });
  }

  const body = req.body || {};
  const result = calculateQuote({
    cargoValueEur: body.cargoValueEur,
    transportMode: body.transportMode,
    goodsType: body.goodsType,
    originCountry: body.originCountry,
    destinationCountry: body.destinationCountry,
    coverage: body.coverage,
  });

  if (!result.ok) {
    return res.status(400).json({ error: 'Validation failed', errors: result.errors });
  }

  return res.status(200).json(result);
};
