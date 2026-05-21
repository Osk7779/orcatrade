// Portfolio CSV export — Sprint portfolio-csv-v1.
//
// Pure serialiser: turns a portfolio aggregate + its per-line plans into
// an RFC 4180 CSV a procurement manager can file/share. Same escaping
// discipline as the leads/audit dashboard exports. No I/O — the handler
// recomputes (reusing the live fan-out) and calls this.

'use strict';

// RFC 4180: quote on comma/quote/CR/LF, double embedded quotes.
function escapeCsvField(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (s === '') return '';
  if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function row(fields) {
  return fields.map(escapeCsvField).join(',');
}

function num(n, decimals = 2) {
  if (n == null || !Number.isFinite(Number(n))) return '';
  const f = Math.pow(10, decimals);
  return String(Math.round(Number(n) * f) / f);
}

const COLUMNS = [
  'product_category', 'origin', 'destination', 'hs_code',
  'customs_value_eur', 'duty_eur', 'duty_pct', 'vat_eur',
  'brokerage_eur', 'transport_eur', 'landed_total_eur',
];

// aggregate: aggregatePortfolio() result. lines: the trimmed per-line
// plans the /api/portfolio response carries ({ inputs, totals, duty, … }).
function portfolioToCsv(aggregate, lines) {
  const out = [];
  out.push(row(COLUMNS));

  const ls = Array.isArray(lines) ? lines : [];
  for (const ln of ls) {
    const inp = ln.inputs || {};
    const t = ln.totals || {};
    const duty = ln.duty || {};
    out.push(row([
      inp.productCategory || '',
      inp.originCountry || '',
      inp.destinationCountry || '',
      inp.hsCode || '',
      num(inp.customsValueEur),
      num(t.dutyEur),
      duty.ratePercent != null ? num(duty.ratePercent, 1) : '',
      num(t.vatEur),
      num(t.brokerageEur),
      num(t.transportEur),
      num(t.perShipmentLandedTotal),
    ]));
  }

  // Totals row + portfolio-level summary rows.
  const agg = aggregate || {};
  const tot = agg.totals || {};
  out.push(row([
    'TOTAL', '', '', '',
    num(tot.customsValueEur),
    num(tot.dutyEur),
    agg.blendedDutyRatePct != null ? num(agg.blendedDutyRatePct, 1) : '',
    num(tot.vatEur),
    num(tot.brokerageEur),
    num(tot.transportEur),
    num(tot.perShipmentLandedTotal),
  ]));
  out.push('');
  out.push(row(['blended_duty_rate_pct', num(agg.blendedDutyRatePct, 1)]));
  out.push(row(['consolidation_saving_eur', num(agg.consolidationSavingEur)]));
  out.push(row(['sku_count', String(agg.lineCount != null ? agg.lineCount : ls.length)]));

  return out.join('\r\n') + '\r\n';
}

function csvFilename(now = new Date()) {
  return `orcatrade-portfolio-${now.toISOString().slice(0, 10)}.csv`;
}

module.exports = { escapeCsvField, portfolioToCsv, csvFilename, COLUMNS };
