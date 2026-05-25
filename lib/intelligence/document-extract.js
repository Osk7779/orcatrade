'use strict';

// Document field extraction (Sprint document-intel-v2 / Pillar I4+).
//
// Turns the PASTED RAW TEXT of a trade document (commercial invoice, packing
// list, certificate of origin) into the structured `fields` shape the
// deterministic auditor (document-audit.js) consumes — so a user can paste an
// invoice and get an audit, without hand-filling a form.
//
// Deterministic + LLM-free: robust regex/heuristics over the common layouts.
// It reports a `confidence` and which fields it couldn't find, so the caller
// (and the AI layer, which can do messier extraction) knows what to trust.
// Extraction is a READING task, not a decision — the audit findings are still
// produced by the calculator-grounded auditor.

const INCOTERMS = ['EXW', 'FCA', 'FAS', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP', 'DAT'];

// A small country-name → ISO2 map for the origins importers actually use.
const COUNTRY_ISO = {
  china: 'CN', 'p.r. china': 'CN', prc: 'CN', vietnam: 'VN', 'viet nam': 'VN', india: 'IN',
  bangladesh: 'BD', turkey: 'TR', türkiye: 'TR', turkiye: 'TR', germany: 'DE', poland: 'PL',
  netherlands: 'NL', france: 'FR', spain: 'ES', italy: 'IT', 'united kingdom': 'GB', uk: 'GB',
  'south korea': 'KR', korea: 'KR', japan: 'JP', taiwan: 'TW', thailand: 'TH', indonesia: 'ID',
  cambodia: 'KH', pakistan: 'PK', 'sri lanka': 'LK', 'united states': 'US', usa: 'US', us: 'US',
  ghana: 'GH', 'ivory coast': 'CI', "côte d'ivoire": 'CI', brazil: 'BR', mexico: 'MX',
};

function toIso2(value) {
  const s = String(value || '').trim();
  if (!s) return '';
  if (/^[A-Za-z]{2}$/.test(s)) return s.toUpperCase();
  const k = s.toLowerCase().replace(/[.,]/g, '').trim();
  return COUNTRY_ISO[k] || (/^[A-Za-z]{2}\b/.test(s) ? s.slice(0, 2).toUpperCase() : '');
}

// Parse a money/number string handling both EU (1.234,56) and US (1,234.56).
function parseNumber(raw) {
  let s = String(raw == null ? '' : raw).replace(/[^\d.,]/g, '');
  if (!s) return NaN;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    // The later separator is the decimal point.
    if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (lastComma > -1) {
    // Only commas: thousands if exactly 3 trailing digits, else decimal.
    s = (s.length - lastComma - 1 === 3) ? s.replace(/,/g, '') : s.replace(',', '.');
  } else {
    s = s.replace(/,/g, '');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

function firstMatch(text, re) {
  const m = text.match(re);
  return m ? m[1].trim() : '';
}

function detectCurrency(text) {
  const named = firstMatch(text, /\b(EUR|USD|GBP|CNY|RMB|PLN|JPY|CHF|TRY)\b/i);
  if (named) return named.toUpperCase() === 'RMB' ? 'CNY' : named.toUpperCase();
  if (text.includes('€')) return 'EUR';
  if (text.includes('£')) return 'GBP';
  if (/\$/.test(text)) return 'USD';
  return '';
}

// ── Extraction ──────────────────────────────────────────

function extractFields(rawText, documentType) {
  const text = String(rawText == null ? '' : rawText);
  const found = [];
  const missing = [];
  const fields = {};

  const currency = detectCurrency(text);
  if (currency) { fields.currency = currency; found.push('currency'); } else missing.push('currency');

  const incoterm = (text.match(new RegExp('\\b(' + INCOTERMS.join('|') + ')\\b', 'i')) || [])[1];
  if (incoterm) { fields.incoterm = incoterm.toUpperCase(); found.push('incoterm'); } else missing.push('incoterm');

  const hs = firstMatch(text, /\b(?:HS|H\.S\.|commodity|tariff)\s*(?:code|no\.?|number)?\s*[:#]?\s*([0-9][0-9 .]{5,13}[0-9])/i)
    || firstMatch(text, /\bHS[:#]?\s*([0-9]{6,10})\b/i);
  if (hs) { fields.hsCode = hs.replace(/\D/g, ''); found.push('hsCode'); } else missing.push('hsCode');

  const origin = firstMatch(text, /(?:country of origin|origin|made in)\s*[:#]?\s*([A-Za-z][A-Za-z .'-]{1,30})/i);
  const originIso = toIso2(origin);
  if (originIso) { fields.countryOfOrigin = originIso; found.push('countryOfOrigin'); } else missing.push('countryOfOrigin');

  const dest = firstMatch(text, /(?:country of destination|destination|ship to country|deliver to)\s*[:#]?\s*([A-Za-z][A-Za-z .'-]{1,30})/i);
  const destIso = toIso2(dest);
  if (destIso) fields.countryOfDestination = destIso;

  const totalRaw = firstMatch(text, /(?:grand total|invoice total|total amount|amount due|total)\s*[:#]?\s*(?:[€$£]|EUR|USD|GBP)?\s*([\d.,]+)/i);
  const total = parseNumber(totalRaw);
  if (Number.isFinite(total) && total > 0) { fields.invoiceTotal = total; found.push('invoiceTotal'); } else missing.push('invoiceTotal');

  const exporter = firstMatch(text, /(?:exporter|seller|shipper|consignor)\s*[:#]?\s*([^\n]{2,80})/i);
  if (exporter) fields.exporter = { companyName: exporter };
  const consignee = firstMatch(text, /(?:consignee|buyer|importer|bill to|ship to)\s*[:#]?\s*([^\n]{2,80})/i);
  if (consignee) fields.consignee = { companyName: consignee };

  // Preference evidence.
  const rex = firstMatch(text, /\bREX\s*(?:no\.?|number)?\s*[:#]?\s*([A-Z]{2}[A-Za-z0-9-]{4,})/i);
  if (rex) fields.rexNumber = rex;
  const eur1 = firstMatch(text, /\bEUR\.?1\s*(?:no\.?|number)?\s*[:#]?\s*([A-Za-z0-9-]{3,})/i);
  if (eur1) fields.eur1Number = eur1;
  if (/statement on origin|origin declaration|declaration of origin/i.test(text)) {
    fields.originStatement = 'present';
  }

  // Weights (packing list).
  const gross = parseNumber(firstMatch(text, /(?:total\s+)?gross weight\s*[:#]?\s*([\d.,]+)\s*(?:kg|kgs|kilograms)/i));
  if (Number.isFinite(gross)) fields.totalGrossWeightKg = gross;
  const net = parseNumber(firstMatch(text, /(?:total\s+)?net weight\s*[:#]?\s*([\d.,]+)\s*(?:kg|kgs|kilograms)/i));
  if (Number.isFinite(net)) fields.totalNetWeightKg = net;
  const cartons = parseNumber(firstMatch(text, /(?:total\s+)?(?:cartons|packages|pkgs|boxes|pallets)\s*[:#]?\s*([\d.,]+)/i));
  if (Number.isFinite(cartons)) fields.totalCartons = cartons;

  // Best-effort line items: "<qty> x <desc> @ <price>" or "<desc> | qty | unit price".
  const lineItems = extractLineItems(text);
  if (lineItems.length) { fields.lineItems = lineItems; found.push('lineItems'); }

  // Confidence: how many of the high-value signals we located.
  const signals = ['hsCode', 'countryOfOrigin', 'invoiceTotal', 'currency'];
  const got = signals.filter((s) => fields[s] != null || (s === 'invoiceTotal' && fields.invoiceTotal)).length;
  const confidence = got >= 3 ? 'high' : got >= 2 ? 'medium' : 'low';

  return {
    ok: true,
    documentType: documentType || null,
    fields,
    extractedFields: found,
    missingFields: missing,
    confidence,
    note: 'Fields were extracted automatically from pasted text. Review them before relying on the audit — confirm anything the extractor marked missing.',
  };
}

// Pull simple line items out of common patterns. Conservative: returns [] when
// nothing parses cleanly rather than inventing rows.
function extractLineItems(text) {
  const items = [];
  // Pattern A: "120 x Bicycles @ 40.00"  or  "120 Bicycles @ €40"
  const reA = /(\d[\d.,]*)\s*(?:x|×|units?|pcs?)?\s+([A-Za-z][A-Za-z0-9 ,./-]{2,40}?)\s*(?:@|at)\s*[€$£]?\s*([\d.,]+)/gi;
  let m;
  while ((m = reA.exec(text)) && items.length < 50) {
    const quantity = parseNumber(m[1]);
    const unitPrice = parseNumber(m[3]);
    if (Number.isFinite(quantity) && Number.isFinite(unitPrice)) {
      items.push({ description: m[2].trim(), quantity, unitPrice });
    }
  }
  return items;
}

module.exports = {
  extractFields,
  extractLineItems,
  parseNumber,
  toIso2,
  detectCurrency,
  INCOTERMS,
  COUNTRY_ISO,
};
