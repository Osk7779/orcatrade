// Trade-finance quote endpoint. Multi-action: instrument comparison / LC cost / FX / working capital / trade credit.
// Use the `action` field in the POST body to select which calculator runs.

const { consumeRateLimit } = require('../lib/intelligence/runtime-store');
const {
  comparePaymentInstruments,
  estimateLcCost,
  estimateFxHedgingCost,
  calculateWorkingCapitalCycle,
  assessTradeCreditCover,
  listInstruments,
  listFxPairs,
  PRICING_SNAPSHOT,
} = require('../lib/intelligence/finance-quote');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    return res.status(200).json({
      snapshot: PRICING_SNAPSHOT,
      instruments: listInstruments(),
      fxPairs: listFxPairs(),
    });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  const rate = await consumeRateLimit('finance', ip, 30, 60000);
  if (rate.limited) return res.status(429).json({ error: 'Too many requests. Please wait a moment.' });

  const body = req.body || {};
  const action = body.action || 'compare_payment';
  let result;
  switch (action) {
    case 'compare_payment':
      result = comparePaymentInstruments(body);
      break;
    case 'lc_cost':
      result = estimateLcCost(body);
      break;
    case 'fx_hedge':
      result = estimateFxHedgingCost(body);
      break;
    case 'working_capital':
      result = calculateWorkingCapitalCycle(body);
      break;
    case 'trade_credit':
      result = assessTradeCreditCover(body);
      break;
    default:
      return res.status(400).json({ error: `Unknown action "${action}". Supported: compare_payment, lc_cost, fx_hedge, working_capital, trade_credit.` });
  }

  if (!result.ok) return res.status(400).json({ error: 'Validation failed', errors: result.errors });
  return res.status(200).json(result);
};
