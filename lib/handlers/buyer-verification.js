// Buyer Verification check endpoint.

const { consumeRateLimit } = require('../intelligence/runtime-store');
const { checkBuyer, listSampleBuyers, SNAPSHOT, COUNTRY_REGISTRIES } = require('../intelligence/buyer-verification');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    return res.status(200).json({
      snapshot: SNAPSHOT,
      sampleBuyers: listSampleBuyers(),
      countriesWithRegistries: Object.keys(COUNTRY_REGISTRIES),
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  const rate = await consumeRateLimit('buyer-verification', ip, 30, 60000);
  if (rate.limited) {
    return res.status(429).json({ error: 'Too many verification requests. Please wait a moment.' });
  }

  const body = req.body || {};
  const result = checkBuyer({
    companyName: body.companyName,
    country: body.country,
    registryId: body.registryId,
  });

  if (!result.ok) {
    return res.status(400).json({ error: 'Validation failed', errors: result.errors });
  }

  return res.status(200).json(result);
};
