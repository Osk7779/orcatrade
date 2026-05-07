// EU Customs & Bonded Solutions quote endpoint.

const { consumeRateLimit } = require('../intelligence/runtime-store');
const {
  calculateQuote,
  listCountries,
  listOrigins,
  listHsChapters,
  PRICING_SNAPSHOT,
} = require('../intelligence/customs-quote');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    return res.status(200).json({
      snapshot: PRICING_SNAPSHOT,
      countries: listCountries(),
      origins: listOrigins(),
      hsChapters: listHsChapters(),
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  const rate = await consumeRateLimit('customs', ip, 30, 60000);
  if (rate.limited) return res.status(429).json({ error: 'Too many requests. Please wait a moment.' });

  const body = req.body || {};
  const result = calculateQuote({
    customsValueEur: body.customsValueEur,
    hsCode: body.hsCode,
    destinationCountry: body.destinationCountry,
    originCountry: body.originCountry,
    linesCount: body.linesCount,
    bondedDays: body.bondedDays,
    bondedVolumeCbm: body.bondedVolumeCbm,
    releaseStrategy: body.releaseStrategy,
    claimPreferential: body.claimPreferential,
  });
  if (!result.ok) return res.status(400).json({ error: 'Validation failed', errors: result.errors });
  return res.status(200).json(result);
};
