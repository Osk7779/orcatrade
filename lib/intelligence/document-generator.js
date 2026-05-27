// Trade Documentation Hub generator — schema, validator, and HTML renderer.
// Pure-JS, no npm dependencies. Adds a new document type by adding a schema +
// renderer entry to TYPES below.

const TYPES = {
  commercial_invoice: {
    label: 'Commercial Invoice',
    description: 'The core import document. Required for customs valuation, duty/VAT calculation, and banking settlement.',
    requiredFields: ['exporter', 'consignee', 'invoiceNumber', 'invoiceDate', 'incoterm', 'currency', 'lineItems'],
    requiredLineItemFields: ['description', 'quantity', 'unit', 'unitPrice'],
  },
  packing_list: {
    label: 'Packing List',
    description: 'Quantity, weight, dimensions, and packaging detail per line. Pairs with the Commercial Invoice for customs.',
    requiredFields: ['exporter', 'consignee', 'invoiceNumber', 'shipmentDate', 'lineItems'],
    requiredLineItemFields: ['description', 'quantity', 'grossWeightKg', 'netWeightKg', 'cartons'],
  },
  proforma_invoice: {
    label: 'Proforma Invoice',
    description: 'Pre-shipment quote document used for buyer authorisation, advance payment, and import permit applications.',
    requiredFields: ['exporter', 'consignee', 'invoiceNumber', 'invoiceDate', 'currency', 'lineItems', 'validUntil'],
    requiredLineItemFields: ['description', 'quantity', 'unit', 'unitPrice'],
  },
  certificate_of_origin: {
    label: 'Certificate of Origin (non-preferential)',
    description: 'States the country where the goods were manufactured. Most non-preferential CoOs require a chamber-of-commerce stamp before use; this template generates the data sheet ready for stamping.',
    requiredFields: ['exporter', 'consignee', 'countryOfOrigin', 'invoiceNumber', 'lineItems'],
    requiredLineItemFields: ['description', 'quantity', 'hsCode'],
  },
  cbam_report: {
    label: 'CBAM Quarterly Report (draft)',
    description: 'Draft of the CBAM transitional-period quarterly report. Pre-fills declarant + goods; embedded-emissions figures must be supplied by the installation/supplier before submission to the CBAM Transitional Registry.',
    requiredFields: ['exporter', 'reportingPeriod', 'lineItems'],
    requiredLineItemFields: ['description'],
  },
  eudr_dds: {
    label: 'EUDR Due Diligence Statement (draft)',
    description: 'Draft Due Diligence Statement under Reg. (EU) 2023/1115. Pre-fills the operator, commodity and country of production; geolocation of plots must be added before submission to the EU Information System.',
    requiredFields: ['exporter', 'countryOfOrigin', 'lineItems'],
    requiredLineItemFields: ['description'],
  },
};

function cleanString(value, max = 240) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function escapeHtml(text) {
  return String(text == null ? '' : text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatNumber(value, opts = {}) {
  const { minDecimals = 2, maxDecimals = 2 } = opts;
  const num = Number(value);
  if (!Number.isFinite(num)) return '—';
  return num.toLocaleString('en-IE', { minimumFractionDigits: minDecimals, maximumFractionDigits: maxDecimals });
}

function formatCurrency(value, currency) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '—';
  const code = String(currency || 'EUR').toUpperCase().slice(0, 3) || 'EUR';
  try {
    return new Intl.NumberFormat('en-IE', { style: 'currency', currency: code, maximumFractionDigits: 2 }).format(num);
  } catch {
    return `${code} ${formatNumber(num)}`;
  }
}

function validateInput(type, data) {
  const def = TYPES[type];
  if (!def) return { ok: false, error: `Unknown document type: ${type}` };

  const errors = [];
  for (const field of def.requiredFields) {
    if (field === 'lineItems') continue;
    if (!data[field] || (typeof data[field] === 'string' && !data[field].trim())) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  const items = Array.isArray(data.lineItems) ? data.lineItems : [];
  if (def.requiredFields.includes('lineItems') && items.length === 0) {
    errors.push('At least one line item is required');
  }

  for (let i = 0; i < items.length; i++) {
    for (const field of def.requiredLineItemFields) {
      const value = items[i][field];
      if (value == null || (typeof value === 'string' && !value.trim()) || (typeof value === 'number' && Number.isNaN(value))) {
        errors.push(`Line item ${i + 1}: missing ${field}`);
      }
    }
  }

  return errors.length ? { ok: false, errors } : { ok: true };
}

// ── Renderers ──────────────────────────────────────────

function renderParty(label, party) {
  if (!party) return '';
  const lines = [
    party.companyName,
    party.contactName,
    party.streetAddress,
    [party.postalCode, party.city, party.country].filter(Boolean).join(' '),
    party.taxId ? `Tax ID / VAT: ${party.taxId}` : '',
    party.eori ? `EORI: ${party.eori}` : '',
    party.phone ? `Phone: ${party.phone}` : '',
    party.email ? `Email: ${party.email}` : '',
  ].filter(Boolean);

  return `
    <div class="party-block">
      <div class="party-label">${escapeHtml(label)}</div>
      <div class="party-body">
        ${lines.map(l => `<div>${escapeHtml(l)}</div>`).join('')}
      </div>
    </div>
  `;
}

function renderShipmentBar(data) {
  const items = [
    ['Invoice no.', data.invoiceNumber],
    ['Invoice date', data.invoiceDate],
    ['PO / Order ref.', data.poReference],
    ['Incoterm', data.incoterm],
    ['Place', data.incotermPlace],
    ['Currency', data.currency],
    ['Country of origin', data.countryOfOrigin],
    ['Country of destination', data.countryOfDestination],
    ['Mode of transport', data.transportMode],
    ['Vessel / Flight no.', data.vesselFlightNo],
    ['Port of loading', data.portOfLoading],
    ['Port of discharge', data.portOfDischarge],
    ['Final destination', data.finalDestination],
    ['Shipment date', data.shipmentDate],
    ['Valid until', data.validUntil],
  ].filter(([, v]) => v && cleanString(v));

  if (!items.length) return '';
  return `
    <div class="bar-grid">
      ${items.map(([label, value]) => `
        <div class="bar-cell">
          <div class="bar-label">${escapeHtml(label)}</div>
          <div class="bar-value">${escapeHtml(cleanString(value))}</div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderCommercialInvoice(data) {
  const items = Array.isArray(data.lineItems) ? data.lineItems : [];
  const currency = String(data.currency || 'EUR').toUpperCase();
  let total = 0;

  const itemRows = items.map((it, i) => {
    const qty = Number(it.quantity) || 0;
    const unitPrice = Number(it.unitPrice) || 0;
    const lineTotal = qty * unitPrice;
    total += lineTotal;
    return `
      <tr>
        <td class="num">${i + 1}</td>
        <td>
          <div class="line-desc">${escapeHtml(it.description || '')}</div>
          ${it.hsCode ? `<div class="line-meta">HS code: ${escapeHtml(it.hsCode)}</div>` : ''}
          ${it.countryOfOrigin ? `<div class="line-meta">Origin: ${escapeHtml(it.countryOfOrigin)}</div>` : ''}
        </td>
        <td class="num">${formatNumber(qty, { minDecimals: 0, maxDecimals: 4 })} ${escapeHtml(it.unit || '')}</td>
        <td class="num">${formatCurrency(unitPrice, currency)}</td>
        <td class="num">${formatCurrency(lineTotal, currency)}</td>
      </tr>
    `;
  }).join('');

  return `
    <h1 class="doc-h1">Commercial Invoice</h1>
    <div class="party-row">
      ${renderParty('Exporter / Seller', data.exporter)}
      ${renderParty('Consignee / Buyer', data.consignee)}
      ${data.notifyParty ? renderParty('Notify Party', data.notifyParty) : '<div class="party-block placeholder"></div>'}
    </div>
    ${renderShipmentBar(data)}
    <table class="line-table">
      <thead>
        <tr>
          <th class="num" style="width: 3rem;">No.</th>
          <th>Description of goods</th>
          <th class="num" style="width: 8rem;">Quantity</th>
          <th class="num" style="width: 8rem;">Unit price</th>
          <th class="num" style="width: 9rem;">Line total</th>
        </tr>
      </thead>
      <tbody>${itemRows}</tbody>
      <tfoot>
        <tr>
          <td colspan="4" class="num"><b>Subtotal</b></td>
          <td class="num"><b>${formatCurrency(total, currency)}</b></td>
        </tr>
        ${data.freightCost ? `<tr><td colspan="4" class="num">Freight</td><td class="num">${formatCurrency(data.freightCost, currency)}</td></tr>` : ''}
        ${data.insuranceCost ? `<tr><td colspan="4" class="num">Insurance</td><td class="num">${formatCurrency(data.insuranceCost, currency)}</td></tr>` : ''}
        <tr>
          <td colspan="4" class="num"><b>Total invoice value</b></td>
          <td class="num total"><b>${formatCurrency(total + (Number(data.freightCost) || 0) + (Number(data.insuranceCost) || 0), currency)}</b></td>
        </tr>
      </tfoot>
    </table>
    ${data.bankingDetails ? `
      <div class="banking-block">
        <div class="block-label">Banking details</div>
        <div class="block-body">${escapeHtml(data.bankingDetails)}</div>
      </div>` : ''}
    ${data.notes ? `
      <div class="notes-block">
        <div class="block-label">Notes / Declarations</div>
        <div class="block-body">${escapeHtml(data.notes)}</div>
      </div>` : ''}
    <div class="declaration-block">
      <div class="block-label">Declaration</div>
      <div class="block-body">We declare that the above information is true and correct. Goods are of the country of origin stated above.</div>
    </div>
    <div class="signature-row">
      <div class="signature-block">
        <div class="signature-label">Signed (Exporter)</div>
        <div class="signature-line"></div>
        <div class="signature-meta">${escapeHtml(data.signedByName || '')} · ${escapeHtml(data.signedByTitle || '')} · ${escapeHtml(data.signedDate || '')}</div>
      </div>
      <div class="signature-block">
        <div class="signature-label">Stamp / Seal</div>
        <div class="signature-stamp"></div>
      </div>
    </div>
  `;
}

function renderPackingList(data) {
  const items = Array.isArray(data.lineItems) ? data.lineItems : [];
  let totalCartons = 0, totalGross = 0, totalNet = 0;

  const itemRows = items.map((it, i) => {
    const cartons = Number(it.cartons) || 0;
    const gross = Number(it.grossWeightKg) || 0;
    const net = Number(it.netWeightKg) || 0;
    totalCartons += cartons; totalGross += gross; totalNet += net;
    return `
      <tr>
        <td class="num">${i + 1}</td>
        <td>${escapeHtml(it.description || '')}</td>
        <td class="num">${formatNumber(it.quantity || 0, { minDecimals: 0, maxDecimals: 4 })} ${escapeHtml(it.unit || '')}</td>
        <td class="num">${formatNumber(cartons, { minDecimals: 0, maxDecimals: 0 })}</td>
        <td class="num">${formatNumber(gross, { minDecimals: 2 })} kg</td>
        <td class="num">${formatNumber(net, { minDecimals: 2 })} kg</td>
        <td>${escapeHtml(it.dimensions || '')}</td>
      </tr>
    `;
  }).join('');

  return `
    <h1 class="doc-h1">Packing List</h1>
    <div class="party-row">
      ${renderParty('Exporter / Seller', data.exporter)}
      ${renderParty('Consignee / Buyer', data.consignee)}
    </div>
    ${renderShipmentBar(data)}
    <table class="line-table">
      <thead>
        <tr>
          <th class="num" style="width: 3rem;">No.</th>
          <th>Description of goods</th>
          <th class="num" style="width: 7rem;">Quantity</th>
          <th class="num" style="width: 5rem;">Cartons</th>
          <th class="num" style="width: 7rem;">Gross weight</th>
          <th class="num" style="width: 7rem;">Net weight</th>
          <th style="width: 9rem;">Dimensions</th>
        </tr>
      </thead>
      <tbody>${itemRows}</tbody>
      <tfoot>
        <tr>
          <td colspan="3" class="num"><b>Total</b></td>
          <td class="num"><b>${formatNumber(totalCartons, { minDecimals: 0, maxDecimals: 0 })}</b></td>
          <td class="num"><b>${formatNumber(totalGross, { minDecimals: 2 })} kg</b></td>
          <td class="num"><b>${formatNumber(totalNet, { minDecimals: 2 })} kg</b></td>
          <td></td>
        </tr>
      </tfoot>
    </table>
    ${data.notes ? `<div class="notes-block"><div class="block-label">Notes</div><div class="block-body">${escapeHtml(data.notes)}</div></div>` : ''}
    <div class="signature-row">
      <div class="signature-block">
        <div class="signature-label">Signed (Exporter)</div>
        <div class="signature-line"></div>
        <div class="signature-meta">${escapeHtml(data.signedByName || '')} · ${escapeHtml(data.signedByTitle || '')} · ${escapeHtml(data.signedDate || '')}</div>
      </div>
    </div>
  `;
}

function renderProformaInvoice(data) {
  return renderCommercialInvoice(data).replace('Commercial Invoice', 'Proforma Invoice');
}

function renderCertificateOfOrigin(data) {
  const items = Array.isArray(data.lineItems) ? data.lineItems : [];
  const itemRows = items.map((it, i) => `
    <tr>
      <td class="num">${i + 1}</td>
      <td>${escapeHtml(it.description || '')}</td>
      <td class="num">${escapeHtml(it.hsCode || '')}</td>
      <td class="num">${formatNumber(it.quantity || 0, { minDecimals: 0, maxDecimals: 4 })} ${escapeHtml(it.unit || '')}</td>
      <td>${escapeHtml(it.marksAndNumbers || '')}</td>
    </tr>
  `).join('');

  return `
    <h1 class="doc-h1">Certificate of Origin</h1>
    <p class="doc-sub">Non-preferential. Most CoOs require a chamber-of-commerce stamp before use. This sheet is ready for stamping.</p>
    <div class="party-row">
      ${renderParty('Exporter / Seller', data.exporter)}
      ${renderParty('Consignee', data.consignee)}
    </div>
    ${renderShipmentBar(data)}
    <div class="banking-block">
      <div class="block-label">Country of origin</div>
      <div class="block-body" style="font-size: 1.05rem; font-weight: 600;">${escapeHtml(data.countryOfOrigin || '')}</div>
    </div>
    <table class="line-table">
      <thead>
        <tr>
          <th class="num" style="width: 3rem;">No.</th>
          <th>Description of goods</th>
          <th class="num" style="width: 7rem;">HS code</th>
          <th class="num" style="width: 8rem;">Quantity</th>
          <th style="width: 9rem;">Marks &amp; numbers</th>
        </tr>
      </thead>
      <tbody>${itemRows}</tbody>
    </table>
    <div class="declaration-block">
      <div class="block-label">Declaration</div>
      <div class="block-body">The undersigned declares that the goods described above originate in <b>${escapeHtml(data.countryOfOrigin || '')}</b> and that the information provided is true and correct.</div>
    </div>
    <div class="signature-row">
      <div class="signature-block">
        <div class="signature-label">Signed (Exporter)</div>
        <div class="signature-line"></div>
        <div class="signature-meta">${escapeHtml(data.signedByName || '')} · ${escapeHtml(data.signedByTitle || '')} · ${escapeHtml(data.signedDate || '')}</div>
      </div>
      <div class="signature-block">
        <div class="signature-label">Chamber of Commerce stamp</div>
        <div class="signature-stamp"></div>
      </div>
    </div>
  `;
}

function renderCbamReport(data) {
  const items = Array.isArray(data.lineItems) ? data.lineItems : [];
  const rows = items.map((it, i) => `
    <tr>
      <td class="num">${i + 1}</td>
      <td>${escapeHtml(it.description || '')}</td>
      <td class="num">${escapeHtml(it.hsCode || '')}</td>
      <td class="num">${escapeHtml(it.cnCode || it.hsCode || '')}</td>
      <td class="num">${formatNumber(it.quantity || 0, { minDecimals: 0, maxDecimals: 3 })} ${escapeHtml(it.unit || 't')}</td>
      <td class="num">${it.embeddedEmissionsTco2e != null ? formatNumber(it.embeddedEmissionsTco2e, { maxDecimals: 3 }) : '<span style="color:#b00">[supplier data required]</span>'}</td>
    </tr>
  `).join('');
  return `
    <h1 class="doc-h1">CBAM Quarterly Report</h1>
    <p class="doc-sub">Transitional period · Reg. (EU) 2023/956. DRAFT — embedded-emissions data must be obtained from the installation/supplier before submission to the CBAM Transitional Registry.</p>
    <div class="party-row">
      ${renderParty('Reporting declarant', data.exporter)}
      ${renderParty('Installation / supplier', data.consignee || { companyName: '[Installation — complete before use]' })}
    </div>
    <div class="banking-block">
      <div class="block-label">Reporting period</div>
      <div class="block-body" style="font-weight:600;">${escapeHtml(data.reportingPeriod || '')}</div>
    </div>
    <table class="line-table">
      <thead><tr>
        <th class="num" style="width:3rem;">No.</th><th>Goods</th>
        <th class="num" style="width:7rem;">HS code</th><th class="num" style="width:7rem;">CN code</th>
        <th class="num" style="width:8rem;">Quantity</th><th class="num" style="width:10rem;">Embedded emissions (tCO₂e)</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="declaration-block">
      <div class="block-label">Declarant statement</div>
      <div class="block-body">The reporting declarant declares the embedded emissions of the goods listed for the stated reporting period. Default values may be used only within the limits set by the Commission; actual installation data is required thereafter.</div>
    </div>
  `;
}

function renderEudrDds(data) {
  const items = Array.isArray(data.lineItems) ? data.lineItems : [];
  const rows = items.map((it, i) => `
    <tr>
      <td class="num">${i + 1}</td>
      <td>${escapeHtml(it.description || '')}</td>
      <td class="num">${escapeHtml(it.hsCode || '')}</td>
      <td>${escapeHtml(it.geolocation || '')}${it.geolocation ? '' : '<span style="color:#b00">[geolocation of plots required]</span>'}</td>
    </tr>
  `).join('');
  return `
    <h1 class="doc-h1">Due Diligence Statement</h1>
    <p class="doc-sub">EU Deforestation Regulation · Reg. (EU) 2023/1115. DRAFT — plot geolocation coordinates must be added before submission to the EU Information System.</p>
    <div class="party-row">
      ${renderParty('Operator / Trader', data.exporter)}
      ${renderParty('Producer', data.consignee || { companyName: '[Producer — complete before use]' })}
    </div>
    <div class="banking-block">
      <div class="block-label">Country of production</div>
      <div class="block-body" style="font-weight:600;">${escapeHtml(data.countryOfOrigin || '')}</div>
    </div>
    <table class="line-table">
      <thead><tr>
        <th class="num" style="width:3rem;">No.</th><th>Relevant commodity / product</th>
        <th class="num" style="width:7rem;">HS code</th><th>Plot geolocation</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="declaration-block">
      <div class="block-label">Due diligence declaration</div>
      <div class="block-body">By submitting this statement the operator confirms that due diligence in accordance with Reg. (EU) 2023/1115 was carried out and that the relevant products entail no or negligible risk of being non-compliant (deforestation-free, produced in accordance with the legislation of the country of production).</div>
    </div>
  `;
}

const RENDERERS = {
  commercial_invoice: renderCommercialInvoice,
  packing_list: renderPackingList,
  proforma_invoice: renderProformaInvoice,
  certificate_of_origin: renderCertificateOfOrigin,
  cbam_report: renderCbamReport,
  eudr_dds: renderEudrDds,
};

function generateDocument(type, data) {
  const validation = validateInput(type, data);
  if (!validation.ok) return { ok: false, errors: validation.errors || [validation.error] };

  const renderer = RENDERERS[type];
  if (!renderer) return { ok: false, errors: [`No renderer registered for type: ${type}`] };

  const innerHtml = renderer(data);
  return { ok: true, html: innerHtml };
}

function listDocumentTypes() {
  return Object.entries(TYPES).map(([id, def]) => ({
    id,
    label: def.label,
    description: def.description,
  }));
}

function addDays(isoDate, days) {
  const d = new Date(isoDate + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Pre-fill a document `data` object from an Import Plan's inputs
// (Sprint document-prefill-v1). The plan knows the goods, route, value, and HS
// code; the parties + final logistics detail are placeholders the user fills.
// Returns { ok, type, data } ready to merge/override and pass to
// generateDocument — every required field is present so the draft renders, but
// placeholder parties read "[… — complete before use]" so a draft can never be
// mistaken for a finished document.
function draftFromPlan(type, plan = {}, opts = {}) {
  if (!TYPES[type]) return { ok: false, error: `Unknown document type: ${type}` };
  const p = plan || {};
  const today = opts.today || new Date().toISOString().slice(0, 10);
  const value = Number(p.customsValueEur) || 0;
  const quantity = Number(p.quantity || p.moq) || 1;
  const unitPrice = quantity > 0 ? Math.round((value / quantity) * 100) / 100 : value;
  const origin = String(p.originCountry || '').toUpperCase();

  const lineItem = {
    description: opts.description || p.productDescription || p.productCategory || 'Goods — complete description before use',
    quantity,
    unit: opts.unit || 'units',
    unitPrice,
    hsCode: p.hsCode || '',
    countryOfOrigin: origin,
    grossWeightKg: Number(p.weightKg) || 0,
    netWeightKg: Number(p.weightKg) || 0,
    cartons: Number(p.cartons) || 1,
  };

  const placeholder = label => ({ companyName: `[${label} — complete before use]` });

  return {
    ok: true,
    type,
    data: {
      _draft: true,
      exporter: placeholder('Exporter / Seller'),
      consignee: placeholder('Consignee / Buyer'),
      invoiceNumber: `DRAFT-${today.replace(/-/g, '')}`,
      invoiceDate: today,
      shipmentDate: today,
      validUntil: addDays(today, 30),
      // CBAM quarterly reporting period (current calendar quarter) for cbam_report.
      reportingPeriod: `${today.slice(0, 4)} Q${Math.floor(Number(today.slice(5, 7)) / 3.0001) + 1}`,
      incoterm: p.incoterm || 'FOB',
      incotermPlace: p.incotermPlace || '',
      currency: opts.currency || 'EUR',
      countryOfOrigin: origin,
      countryOfDestination: String(p.destinationCountry || '').toUpperCase(),
      lineItems: [lineItem],
    },
  };
}

module.exports = {
  TYPES,
  validateInput,
  generateDocument,
  listDocumentTypes,
  draftFromPlan,
  // helpers exposed for tests
  formatNumber,
  formatCurrency,
  escapeHtml,
};
