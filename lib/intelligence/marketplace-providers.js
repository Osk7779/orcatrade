// Curated trade-finance + insurance providers for the marketplace introducer
// (apex II7). Pure data: nothing here is regulatory advice, nothing transacts.
// Each entry is illustrative; real provider negotiation is the user's task and
// the platform records the intro for take-rate accounting + audit.
//
// Adding a provider = a single entry below; the handler exposes them as-is.

'use strict';

// Product categories the marketplace covers.
const PRODUCTS = Object.freeze({
  LC: 'lc',                       // Documentary credit (letter of credit) issuance
  SCF: 'scf',                     // Supply-chain financing / payables financing
  TCI: 'tci',                     // Trade credit insurance
  INVOICE: 'invoice_financing',   // Invoice discounting
  CARGO: 'cargo_insurance',       // Marine / cargo insurance
});

// A small, deliberately illustrative provider list. Production-grade negotiation
// (KYC, indication of interest, signed terms) happens outside the platform; we
// surface the intro, audit it, and record the expected take-rate.
const PROVIDERS = Object.freeze([
  {
    id: 'icbc-europe',
    name: 'ICBC Europe',
    region: 'EU',
    products: [PRODUCTS.LC, PRODUCTS.SCF],
    summary: 'Documentary credits and supply-chain financing across major EU lanes; Chinese-bank network strength for CN-origin imports.',
    notes: 'Best-fit when the buyer is EU-incorporated and the supplier banks with a Chinese institution.',
    takeRatePct: 0.35,
    introContact: 'tradefinance.eu@example.icbc.com',
  },
  {
    id: 'bnp-paribas-trade',
    name: 'BNP Paribas — Trade Solutions',
    region: 'EU + UK',
    products: [PRODUCTS.LC, PRODUCTS.SCF, PRODUCTS.INVOICE],
    summary: 'EU pan-European trade-finance desk: LC issuance, confirmed irrevocable credits, payables financing programs.',
    notes: 'Strong for mid-market importers with structured payment terms.',
    takeRatePct: 0.40,
    introContact: 'trade.solutions@example.bnpparibas.com',
  },
  {
    id: 'standard-chartered-trade',
    name: 'Standard Chartered — Trade & Working Capital',
    region: 'EU + Asia corridor',
    products: [PRODUCTS.LC, PRODUCTS.SCF, PRODUCTS.INVOICE],
    summary: 'Asia-trade specialist with deep VN / IN / BD corridors; document checking + receivables financing.',
    notes: 'Often preferred for VN/BD apparel and CN electronics lanes.',
    takeRatePct: 0.45,
    introContact: 'transaction.banking@example.sc.com',
  },
  {
    id: 'euler-hermes',
    name: 'Allianz Trade (formerly Euler Hermes)',
    region: 'EU + UK',
    products: [PRODUCTS.TCI],
    summary: 'Trade credit insurance covering buyer non-payment risk on receivables.',
    notes: 'Useful when extending open-account terms to your customers (sell-side, not buy-side).',
    takeRatePct: 0.25,
    introContact: 'corporate.eu@example.alliantz-trade.com',
  },
  {
    id: 'atradius',
    name: 'Atradius',
    region: 'EU + UK',
    products: [PRODUCTS.TCI],
    summary: 'Trade credit insurance with EU-wide coverage on commercial debtors; political-risk add-ons available.',
    notes: 'Direct alternative / second quote to Allianz Trade for the same risk.',
    takeRatePct: 0.25,
    introContact: 'broker.eu@example.atradius.com',
  },
  {
    id: 'kuehne-nagel-marine',
    name: 'Kuehne+Nagel — Marine Insurance',
    region: 'Global',
    products: [PRODUCTS.CARGO],
    summary: 'All-risks cargo insurance on FCL/LCL ocean and air lanes; Institute Cargo Clauses (A) wording.',
    notes: 'Typically priced as a percentage of CIF value; quote per shipment or annual open cover.',
    takeRatePct: 0.20,
    introContact: 'cargo.insurance@example.kuehne-nagel.com',
  },
  {
    id: 'demica',
    name: 'Demica',
    region: 'EU + UK + US',
    products: [PRODUCTS.SCF, PRODUCTS.INVOICE],
    summary: 'Bank-agnostic supply-chain financing platform; lets large buyers fund their supplier payments via multiple bank funders.',
    notes: 'Most relevant when you are the BUYER offering early payment to your suppliers.',
    takeRatePct: 0.30,
    introContact: 'business.development@example.demica.com',
  },
]);

function listProviders({ product, region } = {}) {
  const lower = (v) => String(v || '').toLowerCase();
  return PROVIDERS.filter((p) => {
    if (product && !p.products.includes(lower(product))) return false;
    if (region && lower(p.region).indexOf(lower(region)) === -1) return false;
    return true;
  });
}

function getProvider(id) {
  return PROVIDERS.find((p) => p.id === id) || null;
}

module.exports = {
  PRODUCTS,
  PROVIDERS,
  listProviders,
  getProvider,
};
