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
  customs_entry: {
    label: 'Customs entry — SAD data sheet (draft)',
    description: 'Pre-filled EU Single Administrative Document data — declarant, parties, procedure code, goods table with HS / origin / weights / customs values. The data sheet is what your broker keys into CDS/CHIEF/AES; this draft is never a customs declaration on its own.',
    requiredFields: ['exporter', 'consignee', 'lineItems', 'countryOfOrigin', 'countryOfDestination'],
    requiredLineItemFields: ['description', 'hsCode'],
  },
  supplier_rfq: {
    label: 'Supplier RFQ email (draft)',
    description: 'Draft request-for-quote email from the importer to a supplier. Pre-fills product, target FOB price, incoterm, payment terms, lead time and quality requirement. Review and send from your own mail client — the platform never sends on your behalf.',
    requiredFields: ['exporter', 'consignee', 'lineItems'],
    requiredLineItemFields: ['description'],
  },
  lc_application: {
    label: 'Letter of credit application (draft)',
    description: 'Draft documentary-credit application along SWIFT MT700 lines — applicant, beneficiary, amount, dates, ports, transhipment terms, required documents. For review with your trade-finance officer before submission to the issuing bank; never wire-transfer details from this draft.',
    requiredFields: ['exporter', 'consignee', 'lineItems', 'currency'],
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

function renderCustomsEntry(data) {
  const items = Array.isArray(data.lineItems) ? data.lineItems : [];
  const procedureCode = data.procedureCode || '4000';
  const totals = items.reduce((acc, it) => {
    const qty = Number(it.quantity) || 0;
    const unit = Number(it.unitPrice) || 0;
    acc.gross += Number(it.grossWeightKg) || 0;
    acc.net += Number(it.netWeightKg) || 0;
    acc.value += Number(it.customsValueEur) || qty * unit;
    return acc;
  }, { gross: 0, net: 0, value: 0 });

  const rows = items.map((it, i) => {
    const qty = Number(it.quantity) || 0;
    const unit = Number(it.unitPrice) || 0;
    const customsValueEur = Number(it.customsValueEur) || qty * unit;
    return `
      <tr>
        <td class="num">${i + 1}</td>
        <td>${escapeHtml(it.description || '')}</td>
        <td class="num">${escapeHtml(it.hsCode || '')}</td>
        <td class="num">${escapeHtml(it.countryOfOrigin || data.countryOfOrigin || '')}</td>
        <td class="num">${formatNumber(it.grossWeightKg || 0, { maxDecimals: 2 })}</td>
        <td class="num">${formatNumber(it.netWeightKg || 0, { maxDecimals: 2 })}</td>
        <td class="num">${formatCurrency(customsValueEur, data.currency || 'EUR')}</td>
      </tr>
    `;
  }).join('');

  return `
    <h1 class="doc-h1">Customs entry — SAD data sheet</h1>
    <p class="doc-sub">EU Single Administrative Document data. DRAFT — your customs broker keys this into the destination's customs system (CDS / CHIEF / AES). This sheet is not itself a declaration and never reaches a customs authority directly.</p>
    <div class="party-row">
      ${renderParty('Declarant / Representative', data.declarant || { companyName: '[Declarant / broker — complete before use]' })}
      ${renderParty('Consignor', data.exporter)}
      ${renderParty('Consignee', data.consignee)}
    </div>
    ${renderShipmentBar(data)}
    <div class="banking-block">
      <div class="block-label">Customs procedure</div>
      <div class="block-body" style="font-weight:600;">Procedure code ${escapeHtml(procedureCode)} — ${procedureCode === '4000' ? 'release for free circulation (home use)' : 'see procedure-code mapping with your broker'}</div>
    </div>
    <table class="line-table">
      <thead><tr>
        <th class="num" style="width:3rem;">No.</th>
        <th>Description of goods</th>
        <th class="num" style="width:7rem;">HS code</th>
        <th class="num" style="width:5rem;">CoO</th>
        <th class="num" style="width:6rem;">Gross kg</th>
        <th class="num" style="width:6rem;">Net kg</th>
        <th class="num" style="width:9rem;">Customs value</th>
      </tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr>
        <td colspan="4" style="text-align:right; font-weight:600;">Totals</td>
        <td class="num" style="font-weight:600;">${formatNumber(totals.gross, { maxDecimals: 2 })}</td>
        <td class="num" style="font-weight:600;">${formatNumber(totals.net, { maxDecimals: 2 })}</td>
        <td class="num" style="font-weight:600;">${formatCurrency(totals.value, data.currency || 'EUR')}</td>
      </tr></tfoot>
    </table>
    <div class="declaration-block">
      <div class="block-label">Declarant statement</div>
      <div class="block-body">The undersigned declares that the particulars in this data sheet are correct and that no information has been omitted. Submission is made through the declarant's authorised customs interface.</div>
    </div>
    <div class="signature-row">
      <div class="signature-block">
        <div class="signature-label">Signed (Declarant)</div>
        <div class="signature-line"></div>
        <div class="signature-meta">${escapeHtml(data.signedByName || '')} · ${escapeHtml(data.signedByTitle || '')} · ${escapeHtml(data.signedDate || '')}</div>
      </div>
    </div>
  `;
}

function renderSupplierRfq(data) {
  // RFQ direction: the BUYER drafts it; in the OrcaTrade data model the buyer
  // side is `consignee` and the supplier side is `exporter`, so From/To are
  // swapped relative to the invoice templates.
  const from = data.consignee || { companyName: '[Your company — complete before use]' };
  const to = data.exporter || { companyName: '[Supplier — complete before use]' };
  const items = Array.isArray(data.lineItems) ? data.lineItems : [];
  const today = data.invoiceDate || new Date().toISOString().slice(0, 10);
  const validUntil = data.validUntil || '';
  const incoterm = data.incoterm || 'FOB';
  const payment = data.paymentTerms || 'L/C at sight, 30 days from B/L';
  const leadTime = data.leadTimeWeeks ? `${data.leadTimeWeeks} weeks` : '8–12 weeks';
  const quality = data.qualityStandard || 'ISO 9001 or equivalent QC inspection';
  const subject = data.subject
    || `RFQ — ${(items[0] && items[0].description) || data.productCategory || 'goods'} · ${escapeHtml(from.companyName || '')}`;

  const reqLines = items.map((it) => {
    const parts = [
      `<b>${escapeHtml(it.description || 'Goods')}</b>`,
      it.hsCode ? `HS&nbsp;${escapeHtml(it.hsCode)}` : '',
      it.quantity ? `Quantity: ${formatNumber(it.quantity, { minDecimals: 0, maxDecimals: 0 })} ${escapeHtml(it.unit || 'units')}` : '',
      it.targetFobUnitEur != null ? `Target unit price (${incoterm}): ${formatCurrency(it.targetFobUnitEur, data.currency || 'EUR')}` : '',
    ].filter(Boolean);
    return `<li>${parts.join(' · ')}</li>`;
  }).join('');

  return `
    <h1 class="doc-h1">Supplier RFQ — email draft</h1>
    <p class="doc-sub">Review and send from your own mail client. The platform never sends on your behalf.</p>
    <div class="banking-block">
      <div class="block-label">Email headers</div>
      <div class="block-body" style="font-family:monospace; font-size:0.86rem; line-height:1.7;">
        <div>From: ${escapeHtml(from.companyName || '')}${from.email ? ` &lt;${escapeHtml(from.email)}&gt;` : ''}</div>
        <div>To: ${escapeHtml(to.companyName || '')}${to.email ? ` &lt;${escapeHtml(to.email)}&gt;` : ''}</div>
        <div>Date: ${escapeHtml(today)}</div>
        <div>Subject: ${escapeHtml(subject)}</div>
      </div>
    </div>
    <div class="declaration-block">
      <div class="block-label">Message</div>
      <div class="block-body" style="line-height:1.7;">
        <p>Dear ${escapeHtml((to.contactName || to.companyName || 'Sir/Madam'))},</p>
        <p>I would like to request a quotation for the following:</p>
        <ul style="margin: 0.5rem 0 0.9rem 1.1rem;">${reqLines}</ul>
        <p><b>Terms requested</b></p>
        <ul style="margin: 0.3rem 0 0.9rem 1.1rem;">
          <li>Incoterm: <b>${escapeHtml(incoterm)}</b>${data.incotermPlace ? ` (${escapeHtml(data.incotermPlace)})` : ''}</li>
          <li>Currency: ${escapeHtml(data.currency || 'EUR')}</li>
          <li>Payment terms: ${escapeHtml(payment)}</li>
          <li>Lead time: ${escapeHtml(leadTime)} from PO</li>
          <li>Quality: ${escapeHtml(quality)}; pre-shipment inspection at our cost</li>
          ${validUntil ? `<li>Quote valid until: ${escapeHtml(validUntil)}</li>` : ''}
        </ul>
        <p>Please include unit price breakdown (materials / labour / packing), MOQ, sample availability and lead time, and a draft commercial invoice / packing list for the test order. If you are not the right person, kindly forward this to your export-sales team.</p>
        <p>Many thanks,<br/>${escapeHtml(from.contactName || from.companyName || '')}<br/>${escapeHtml(from.companyName || '')}</p>
      </div>
    </div>
  `;
}

function renderLcApplication(data) {
  const items = Array.isArray(data.lineItems) ? data.lineItems : [];
  const total = Number(data.amount)
    || items.reduce((s, it) => s + ((Number(it.quantity) || 0) * (Number(it.unitPrice) || 0)), 0);
  const currency = data.currency || 'EUR';
  const docs = Array.isArray(data.documentsRequired) && data.documentsRequired.length
    ? data.documentsRequired
    : [
        'Signed commercial invoice in 3 originals',
        'Packing list in 3 originals',
        'Full set 3/3 clean on-board ocean bills of lading made out to order of the issuing bank',
        'Marine insurance certificate for 110% of CIF value covering Institute Cargo Clauses (A)',
        'Certificate of origin issued by the chamber of commerce',
        'Pre-shipment inspection certificate (if required by the applicant)',
      ];

  const itemList = items.map((it) =>
    `<li>${escapeHtml(it.description || 'Goods')}${it.hsCode ? ` — HS ${escapeHtml(it.hsCode)}` : ''}${it.quantity ? ` × ${formatNumber(it.quantity, { minDecimals: 0, maxDecimals: 0 })} ${escapeHtml(it.unit || 'units')}` : ''}</li>`,
  ).join('');

  function row(field, value) {
    return `
      <tr>
        <td style="width: 11rem; font-family:monospace; font-size:0.78rem; color:rgba(0,0,0,0.55); padding:0.35rem 0.6rem 0.35rem 0; vertical-align:top;">${escapeHtml(field)}</td>
        <td style="padding:0.35rem 0;">${value}</td>
      </tr>
    `;
  }

  return `
    <h1 class="doc-h1">Letter of credit — application draft</h1>
    <p class="doc-sub">Documentary credit along SWIFT MT700 lines. DRAFT — review with your trade-finance officer before submission to your issuing bank; never wire-transfer figures directly from this draft.</p>
    <div class="party-row">
      ${renderParty('Applicant (buyer)', data.consignee)}
      ${renderParty('Beneficiary (supplier)', data.exporter)}
    </div>
    <table style="width:100%; border-collapse:collapse; margin-top:0.6rem;">
      <tbody>
        ${row('Form of credit', 'Irrevocable, available by negotiation')}
        ${row('Credit no.', '<i>to be issued by the issuing bank</i>')}
        ${row('Issuing bank', '<i>[applicant\'s bank — complete before submission]</i>')}
        ${row('Currency / amount', `<b>${escapeHtml(currency)}&nbsp;${formatNumber(total, { maxDecimals: 2 })}</b>`)}
        ${row('Tolerance', '0 / 0 (exact amount, exact quantity)')}
        ${row('Date of expiry', escapeHtml(data.expiryDate || ''))}
        ${row('Place of expiry', escapeHtml(data.expiryPlace || 'Beneficiary\'s country'))}
        ${row('Latest date of shipment', escapeHtml(data.latestShipmentDate || ''))}
        ${row('Partial shipments', escapeHtml(data.partialShipments || 'Not allowed'))}
        ${row('Transhipment', escapeHtml(data.transhipment || 'Not allowed'))}
        ${row('Port of loading', escapeHtml(data.portOfLoading || ''))}
        ${row('Port of discharge', escapeHtml(data.portOfDischarge || ''))}
        ${row('Incoterm', escapeHtml(data.incoterm || 'FOB') + (data.incotermPlace ? ` (${escapeHtml(data.incotermPlace)})` : ''))}
        ${row('Period for presentation', '21 days after the date of shipment but within the validity of the credit')}
      </tbody>
    </table>
    <div class="banking-block" style="margin-top:0.9rem;">
      <div class="block-label">Description of goods and / or services</div>
      <div class="block-body"><ul style="margin:0.2rem 0 0 1.1rem;">${itemList}</ul></div>
    </div>
    <div class="banking-block">
      <div class="block-label">Documents required</div>
      <div class="block-body"><ul style="margin:0.2rem 0 0 1.1rem;">${docs.map((d) => `<li>${escapeHtml(d)}</li>`).join('')}</ul></div>
    </div>
    <div class="declaration-block">
      <div class="block-label">Applicant request</div>
      <div class="block-body">The applicant requests the issuing bank to open the above documentary credit in favour of the beneficiary, subject to UCP 600 and any applicable local regulations. Charges outside the issuing bank are for the beneficiary's account unless otherwise agreed.</div>
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
  customs_entry: renderCustomsEntry,
  supplier_rfq: renderSupplierRfq,
  lc_application: renderLcApplication,
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
    customsValueEur: value > 0 ? value : Math.round(quantity * unitPrice * 100) / 100,
    // Plan-driven target unit price for the supplier RFQ draft.
    targetFobUnitEur: p.targetFobUnitEur != null ? Number(p.targetFobUnitEur) : unitPrice,
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
      // Amount + dates for lc_application; the renderer falls back if absent
      // but pre-filling keeps the draft a complete artifact ready for review.
      amount: value > 0 ? value : Math.round(quantity * unitPrice * 100) / 100,
      latestShipmentDate: addDays(today, 60),
      expiryDate: addDays(today, 90),
      // Payment terms string for supplier_rfq.
      paymentTerms: p.paymentTermsDays
        ? `${p.paymentTermsDays}-day terms from B/L; L/C at sight if first order`
        : 'L/C at sight, 30 days from B/L',
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
