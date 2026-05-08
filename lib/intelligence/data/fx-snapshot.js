// FX rate snapshot — EUR pairs for the currencies SME importers most often
// receive supplier quotes in.
//
// PURPOSE
// MFN duty, VAT, freight, and 3PL costs all clear in EUR for EU-bound goods —
// but suppliers in Asia quote in USD (CN/general), CNY (CN domestic),
// VND (VN), INR (IN), BDT (BD), TRY (TR), HKD/TWD/KRW/JPY (East Asia),
// or GBP (UK suppliers). A user entering "€30k customs value" is silently
// making an FX assumption that costs 2-5% over a typical 60-day payment cycle.
//
// LIMITS
// - Snapshot, not live. Refreshed periodically; ASOF date below.
// - Mid-market rate; importers actually transact at retail+spread (typically
//   1.5-3% worse). The hedge-cost calculation accounts for that spread.
// - For pure FX risk assessment in the wizard. For executable forwards or
//   swaps, importers should consult their bank or a broker like Wise/Convera.

const ASOF = '2026-05-08';

// Mid-market rates: 1 EUR = X foreign currency
// (i.e. how many units of the foreign currency you get for 1 EUR)
const RATES = {
  EUR: 1.0,
  USD: 1.08,
  CNY: 7.85,
  VND: 26300,
  INR: 91.0,
  BDT: 118.0,
  TRY: 36.0,
  HKD: 8.45,
  TWD: 34.5,
  KRW: 1490,
  JPY: 165.0,
  GBP: 0.85,
  PLN: 4.30,   // for Polish importers reporting locally
  CZK: 25.2,
  HUF: 395,
};

// Typical 90-day historical volatility (rolling 5-year). Used to size the
// "5% adverse move" risk scenario. Most major USD/EUR pairs have ~5-7%
// 90-day vol; emerging pairs (TRY, INR, VND) higher.
const VOLATILITY_90D_PCT = {
  USD: 5.0,
  CNY: 4.0,
  VND: 3.5,
  INR: 5.5,
  BDT: 6.0,
  TRY: 12.0,   // historically much more volatile
  HKD: 1.0,    // pegged to USD, very low independent vol
  TWD: 4.5,
  KRW: 6.5,
  JPY: 7.0,
  GBP: 5.5,
};

// Forward-points / hedge cost in basis points per 30 days, rough mid-market.
// Major pairs (USD, GBP, JPY): ~10-30 bp/month forward cost.
// Emerging pairs (TRY, VND, INR): wider — 50-200 bp/month due to interest-rate
// differentials and lower liquidity.
const HEDGE_COST_BP_PER_30D = {
  USD: 15,
  CNY: 30,
  VND: 90,
  INR: 50,
  BDT: 80,
  TRY: 200,
  HKD: 15,
  TWD: 25,
  KRW: 35,
  JPY: 12,
  GBP: 18,
};

const SUPPORTED_CURRENCIES = Object.keys(RATES);

function isSupported(currency) {
  if (!currency) return false;
  return SUPPORTED_CURRENCIES.includes(String(currency).toUpperCase());
}

function getRate(currency) {
  if (!currency) return null;
  const c = String(currency).toUpperCase();
  return RATES[c] || null;
}

// Convert an amount in `fromCurrency` to EUR using snapshot rates.
// `1 EUR = R foreign` → `1 foreign = 1/R EUR` → `amount foreign = amount/R EUR`.
function convertToEur(amount, fromCurrency) {
  const rate = getRate(fromCurrency);
  if (rate == null || !Number.isFinite(Number(amount))) return null;
  return Number(amount) / rate;
}

function convertFromEur(amountEur, toCurrency) {
  const rate = getRate(toCurrency);
  if (rate == null || !Number.isFinite(Number(amountEur))) return null;
  return Number(amountEur) * rate;
}

module.exports = {
  ASOF,
  RATES,
  VOLATILITY_90D_PCT,
  HEDGE_COST_BP_PER_30D,
  SUPPORTED_CURRENCIES,
  isSupported,
  getRate,
  convertToEur,
  convertFromEur,
};
