// FX risk calculator for the Import Plan Builder.
//
// Takes (customsValueEur, quoteCurrency, paymentTermsDays) and produces:
//   - the EUR equivalent of the supplier quote (so the user can see what
//     they're actually paying in their reporting currency)
//   - a risk scenario: what happens to landed cost if the supplier currency
//     strengthens against EUR by 5% (a typical 90-day adverse move)
//   - hedge cost via FX forward contract, scaled to payment-term days
//   - a recommendation: hedge, accept, or skip-too-small
//
// All numbers are indicative. Real importers should get a quote from their
// bank or FX broker (Wise, Convera, Western Union Business Solutions).

const fx = require('./data/fx-snapshot');
const M = require('./money');

const HEDGE_RECOMMENDATION_THRESHOLD_EUR = 5000;   // below this, hedging cost > value
const HEDGE_BREAK_EVEN_VOL_PCT = 2.0;              // below this, accept the risk
const HEDGE_RECOMMEND_VOL_PCT = 4.0;               // above this, recommend hedge

// Reproducibility-v2 slice 3a (apex III3): the FX calculator normally reads the
// live `fx-snapshot` module. When recomputing a historical plan we instead pin
// it to the rate table that was in effect when the plan was saved, so the
// ORIGINAL euros reproduce exactly. `pinnedFx` is the `snapshot.fx` block from
// lib/intelligence/data-snapshot.js: { asOf, rates, volatility90dPct,
// hedgeCostBpPer30d }. Absent → the live module, so the default path is
// byte-identical and the regression suite stays green by construction.
function resolveFxSource(pinnedFx) {
  if (!pinnedFx || !pinnedFx.rates) return fx;
  const rates = pinnedFx.rates;
  const vol = pinnedFx.volatility90dPct || {};
  const hedge = pinnedFx.hedgeCostBpPer30d || {};
  return {
    ASOF: pinnedFx.asOf || null,
    RATES: rates,
    VOLATILITY_90D_PCT: vol,
    HEDGE_COST_BP_PER_30D: hedge,
    SUPPORTED_CURRENCIES: Object.keys(rates),
    isSupported: (cur) => Object.prototype.hasOwnProperty.call(rates, String(cur || '').toUpperCase()),
    getRate: (cur) => rates[String(cur || '').toUpperCase()],
    convertFromEur: (eur, cur) => Number(eur) * rates[String(cur || '').toUpperCase()],
  };
}

function validateInput({ customsValueEur, quoteCurrency, paymentTermsDays }, src = fx) {
  const errors = [];
  const v = Number(customsValueEur);
  if (!Number.isFinite(v) || v <= 0) errors.push('customsValueEur must be > 0');
  if (!src.isSupported(quoteCurrency)) errors.push(`quoteCurrency must be one of: ${src.SUPPORTED_CURRENCIES.join(', ')}`);
  const days = Number(paymentTermsDays);
  if (paymentTermsDays != null && (!Number.isFinite(days) || days < 0 || days > 365)) {
    errors.push('paymentTermsDays must be 0–365 if provided');
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}

function assessFxRisk({ customsValueEur, quoteCurrency, paymentTermsDays = 60, pinnedFx = null }) {
  const src = resolveFxSource(pinnedFx);
  const validation = validateInput({ customsValueEur, quoteCurrency, paymentTermsDays }, src);
  if (!validation.ok) return { ok: false, errors: validation.errors };

  const currency = String(quoteCurrency).toUpperCase();
  const valueEur = Number(customsValueEur);
  const days = Number(paymentTermsDays) || 60;

  // EUR is no-op
  if (currency === 'EUR') {
    return {
      ok: true,
      currency: 'EUR',
      noFxRisk: true,
      asOf: src.ASOF,
    };
  }

  const rate = src.getRate(currency);
  const equivalentForeign = src.convertFromEur(valueEur, currency);
  const vol90dPct = src.VOLATILITY_90D_PCT[currency] || 5.0;

  // Money lines go through integer-cents (half-even rounding, no float
  // drift) like the customs calc. valueCents is the shared base.
  const valueCents = M.fromEuro(valueEur);

  // Risk scenario: foreign strengthens 5% — cost in EUR rises 5%
  const adverseMovePct = 5.0;
  const riskEur = M.toEuro(M.mulRate(valueCents, adverseMovePct / 100));

  // Sized to vol-90d adverse case (1-sigma move over 90 days)
  const sigmaRiskEur = M.toEuro(M.mulRate(valueCents, vol90dPct / 100));

  // Hedge cost via forward: (basis points / 30 days) × days/30
  const hedgeBpPer30d = src.HEDGE_COST_BP_PER_30D[currency] || 30;
  const hedgeBp = hedgeBpPer30d * (days / 30);
  const hedgeCostEur = M.toEuro(M.mulRate(valueCents, hedgeBp / 10000));

  // Recommendation logic:
  //   - Below value threshold → "skip" (hedging cost exceeds risk gain)
  //   - Low vol (<2%) → "accept" (FX risk is small enough to absorb)
  //   - High vol (>4%) → "hedge"
  //   - In between → "consider"
  let recommendation;
  if (valueEur < HEDGE_RECOMMENDATION_THRESHOLD_EUR) {
    recommendation = 'skip';
  } else if (vol90dPct < HEDGE_BREAK_EVEN_VOL_PCT) {
    recommendation = 'accept';
  } else if (vol90dPct >= HEDGE_RECOMMEND_VOL_PCT) {
    recommendation = 'hedge';
  } else {
    recommendation = 'consider';
  }

  const equivalentForeignFormatted = formatForeign(equivalentForeign, currency);

  return {
    ok: true,
    currency,
    asOf: src.ASOF,
    spotRateEurPerForeign: 1 / rate,
    spotRateForeignPerEur: rate,
    customsValueEur: valueEur,
    equivalentForeign: Math.round(equivalentForeign * 100) / 100,
    equivalentForeignFormatted,
    paymentTermsDays: days,
    vol90dPct,
    riskEur5pctMove: riskEur,
    riskEur1Sigma90d: sigmaRiskEur,
    hedgeCostEur,
    hedgeCostBp: Math.round(hedgeBp),
    recommendation,
    rationale: rationaleFor(recommendation, currency, vol90dPct, hedgeCostEur, sigmaRiskEur),
  };
}

function rationaleFor(rec, currency, vol, hedge, risk) {
  if (rec === 'skip') return `Below the threshold where hedging is economic. Accept the FX exposure.`;
  if (rec === 'accept') return `${currency} has low historic vol (~${vol}% over 90 days) — FX risk is small relative to other landed-cost line items. Accept the exposure unless your margin is razor-thin.`;
  if (rec === 'hedge') return `${currency} has elevated 90-day vol (~${vol}%). 1-sigma adverse move ≈ €${risk.toLocaleString('en-IE')}. Forward hedge costs ~€${hedge.toLocaleString('en-IE')} — buy the certainty.`;
  return `${currency} sits in the moderate-vol range. If your supplier accepts EUR-denominated invoices, that's the cheapest hedge. Otherwise a 90-day forward at ~€${hedge.toLocaleString('en-IE')} is reasonable.`;
}

function formatForeign(amount, currency) {
  if (amount == null || !Number.isFinite(amount)) return '';
  const symbols = { USD: '$', GBP: '£', JPY: '¥', CNY: '¥', HKD: 'HK$', TWD: 'NT$', KRW: '₩', VND: '₫', INR: '₹', TRY: '₺', BDT: '৳', PLN: 'zł', CZK: 'Kč', HUF: 'Ft' };
  const symbol = symbols[currency] || currency + ' ';
  // Round to whole units for low-precision currencies
  const decimals = ['VND', 'KRW', 'JPY', 'IDR', 'HUF'].includes(currency) ? 0 : 0;
  const formatted = amount.toLocaleString('en-IE', { maximumFractionDigits: decimals });
  return `${symbol}${formatted}`;
}

module.exports = {
  assessFxRisk,
  validateInput,
  formatForeign,
  resolveFxSource,
  HEDGE_RECOMMENDATION_THRESHOLD_EUR,
};
