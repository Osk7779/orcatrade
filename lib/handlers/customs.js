// EU Customs & Bonded Solutions quote endpoint.

const { consumeRateLimit } = require('../intelligence/runtime-store');
const {
  calculateQuote,
  calculateQuoteAsync,
  buildTierAInput,
  listCountries,
  listOrigins,
  listHsChapters,
  PRICING_SNAPSHOT,
} = require('../intelligence/customs-quote');
const tierA = require('../intelligence/tier-a');
const log = require('../log').withContext({ handler: 'customs' });

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
  const quoteInput = {
    customsValueEur: body.customsValueEur,
    hsCode: body.hsCode,
    destinationCountry: body.destinationCountry,
    originCountry: body.originCountry,
    linesCount: body.linesCount,
    bondedDays: body.bondedDays,
    bondedVolumeCbm: body.bondedVolumeCbm,
    releaseStrategy: body.releaseStrategy,
    claimPreferential: body.claimPreferential,
  };

  // Default to the async path so live-TARIC rates (and therefore the
  // primary_regulator snapshot that lets a quote satisfy Tier-A TA-2)
  // are available. Async falls back to sync internally on any TARIC
  // failure, so this is a strict superset of the prior behaviour.
  let result;
  try {
    result = await calculateQuoteAsync(quoteInput);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'async path threw';
    log.warn('calculateQuoteAsync threw — falling back to sync', { err: message });
    result = calculateQuote(quoteInput);
  }
  if (!result.ok) return res.status(400).json({ error: 'Validation failed', errors: result.errors });

  // Tier-A determination (ADR 0020). Best-effort: a failure to evaluate
  // never blocks the quote. The verdict is attached to the response
  // as `result.tier_a`; UI surfaces read it to render the underwriter-
  // grade badge. Observability log lets us track the eligible-rate
  // without inferring from request bodies.
  try {
    const verdict = await tierA.evaluate(buildTierAInput(result));
    result.tier_a = verdict;
    log.info('tier_a determined', {
      event: 'tier_a_determined',
      calculatorName: 'customs-quote',
      eligible: verdict.eligible,
      failedReason: verdict.failedReason || null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'tier-a evaluate threw';
    log.warn('tier-a evaluation failed — quote returned without verdict', { err: message });
  }

  return res.status(200).json(result);
};
