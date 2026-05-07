// Commercial Invoice form — state, validation, line-item management, generate.

const STORAGE_KEY = 'orcatrade.commercial-invoice.draft.v1';
const API_ENDPOINT = '/api/documents';

const els = {
  form: document.getElementById('invoice-form'),
  tbody: document.getElementById('line-items-tbody'),
  addLine: document.getElementById('add-line'),
  saveDraft: document.getElementById('save-draft'),
  msg: document.getElementById('form-msg'),
  subtotal: document.getElementById('subtotal-display'),
  extras: document.getElementById('extras-display'),
  total: document.getElementById('total-display'),
  year: document.getElementById('year'),
};

if (els.year) els.year.textContent = new Date().getFullYear();

const SCENARIOS = {
  'cn-electronics': {
    exporter: { companyName: 'Shenzhen Audio Tech Co. Ltd.', contactName: 'Liu Wei', streetAddress: '88 Bao\'an Industrial Park, Building C', postalCode: '518101', city: 'Shenzhen', country: 'China', taxId: '914403001234567X', phone: '+86 755 8123 4567', email: 'export@shenzhen-audio.cn' },
    consignee: { companyName: 'AudioCraft GmbH', contactName: 'Lukas Schmitt', streetAddress: 'Friedrichstraße 100', postalCode: '10117', city: 'Berlin', country: 'Germany', eori: 'DE123456789012345', taxId: 'DE123456789' },
    notifyParty: { companyName: 'TransGlobal Logistics GmbH', streetAddress: 'Hafenstraße 12', city: 'Hamburg', country: 'Germany', email: 'ops@transglobal.de' },
    invoiceNumber: 'INV-2026-0042',
    invoiceDate: '2026-05-07',
    poReference: 'PO-AUD-9001',
    currency: 'EUR',
    incoterm: 'FOB',
    incotermPlace: 'Yantian',
    countryOfOrigin: 'China',
    countryOfDestination: 'Germany',
    transportMode: 'Sea FCL',
    vesselFlightNo: 'COSCO Tian Sheng V.043W',
    portOfLoading: 'Yantian',
    portOfDischarge: 'Hamburg',
    lineItems: [
      { description: 'Bluetooth Smart Speaker, Model AS-100', hsCode: '8518 22', quantity: 500, unit: 'pcs', unitPrice: 32.50, countryOfOrigin: 'China' },
      { description: 'Power adaptor, 100-240V, EU plug', hsCode: '8504 40', quantity: 500, unit: 'pcs', unitPrice: 4.20, countryOfOrigin: 'China' },
      { description: 'USB-C charging cable, 1.5m', hsCode: '8544 42', quantity: 500, unit: 'pcs', unitPrice: 1.10, countryOfOrigin: 'China' },
    ],
    freightCost: 1850,
    insuranceCost: 220,
    bankingDetails: 'Bank of China · Shenzhen Bao\'an Branch\nSWIFT: BKCHCNBJ500\nAccount: 4000 1234 5678 9012\nBeneficiary: Shenzhen Audio Tech Co. Ltd.',
    notes: 'Goods comply with EU CE marking framework (LVD, EMC, RED, RoHS).\nCertificates of conformity attached separately.\nCBAM not applicable (HS code outside Annex I).',
    signedByName: 'Liu Wei',
    signedByTitle: 'Export Manager',
    signedDate: '2026-05-07',
  },
  'vn-furniture': {
    exporter: { companyName: 'Saigon Timber Furniture Co.', contactName: 'Nguyen Thanh', streetAddress: '45 Tran Hung Dao, District 1', city: 'Ho Chi Minh City', country: 'Vietnam', taxId: '0312345678', phone: '+84 28 3823 1234', email: 'export@saigontimber.vn' },
    consignee: { companyName: 'Nordica Wood Products GmbH', contactName: 'Karl Müller', streetAddress: 'Industriestraße 5', postalCode: '40221', city: 'Düsseldorf', country: 'Germany', eori: 'DE987654321098765' },
    invoiceNumber: 'INV-NORD-2026-118',
    invoiceDate: '2026-05-07',
    poReference: 'PO-NORD-2026-118',
    currency: 'USD',
    incoterm: 'CIF',
    incotermPlace: 'Hamburg',
    countryOfOrigin: 'Vietnam',
    countryOfDestination: 'Germany',
    transportMode: 'Sea FCL',
    portOfLoading: 'Cat Lai',
    portOfDischarge: 'Hamburg',
    lineItems: [
      { description: 'Plywood panels, FSC-certified, 2440x1220x18mm', hsCode: '4412 10', quantity: 480, unit: 'sheets', unitPrice: 28.00, countryOfOrigin: 'Vietnam' },
      { description: 'Oak dining chairs, finished, packed in 2-pack cartons', hsCode: '9401 61', quantity: 120, unit: 'pcs', unitPrice: 45.00, countryOfOrigin: 'Vietnam' },
    ],
    freightCost: 2200,
    insuranceCost: 0,
    bankingDetails: 'Vietcombank · Ho Chi Minh City\nSWIFT: BFTVVNVX\nAccount: 0011 0023 4567 89',
    notes: 'EUDR Due Diligence Statement reference: TBD prior to placing on EU market.\nGeolocation data for plots provided separately.\nFSC certificate attached.',
    signedByName: 'Nguyen Thanh',
    signedByTitle: 'Export Manager',
    signedDate: '2026-05-07',
  },
};

const EMPTY_LINE = () => ({ description: '', hsCode: '', quantity: '', unit: '', unitPrice: '', countryOfOrigin: '' });

function loadDraft() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveDraft(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {}
}

function clearDraft() {
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
}

function setNested(obj, path, value) {
  const parts = path.split('.');
  let cursor = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof cursor[parts[i]] !== 'object' || cursor[parts[i]] === null) cursor[parts[i]] = {};
    cursor = cursor[parts[i]];
  }
  cursor[parts[parts.length - 1]] = value;
}

function readForm() {
  const data = {};
  const inputs = els.form.querySelectorAll('input[name], textarea[name], select[name]');
  inputs.forEach(el => {
    const name = el.getAttribute('name');
    if (!name) return;
    let value = el.value;
    if (el.type === 'number' && value !== '') value = Number(value);
    setNested(data, name, value);
  });
  data.lineItems = readLineItems();
  return data;
}

function readLineItems() {
  const rows = els.tbody.querySelectorAll('tr.line-row');
  return Array.from(rows).map(row => {
    const item = {};
    row.querySelectorAll('input').forEach(input => {
      const key = input.dataset.field;
      if (!key) return;
      const value = input.value;
      item[key] = (input.type === 'number' && value !== '') ? Number(value) : value;
    });
    return item;
  });
}

function applyState(data) {
  if (!data) return;
  const inputs = els.form.querySelectorAll('input[name], textarea[name], select[name]');
  inputs.forEach(el => {
    const name = el.getAttribute('name');
    if (!name) return;
    const parts = name.split('.');
    let cursor = data;
    for (const part of parts) {
      if (cursor == null) break;
      cursor = cursor[part];
    }
    el.value = (cursor == null) ? '' : String(cursor);
  });
  renderLineItems(Array.isArray(data.lineItems) ? data.lineItems : [EMPTY_LINE()]);
  recomputeTotals();
}

function renderLineItems(items) {
  els.tbody.innerHTML = '';
  if (!items.length) items = [EMPTY_LINE()];
  items.forEach((item, i) => addLineRow(item, i));
}

function addLineRow(item, index) {
  const idx = index != null ? index : els.tbody.querySelectorAll('tr.line-row').length;
  const tr = document.createElement('tr');
  tr.className = 'line-row';
  tr.innerHTML = `
    <td class="num" style="font-family: 'Geist Mono', monospace; opacity: 0.55;">${idx + 1}</td>
    <td><input data-field="description" placeholder="Description" /></td>
    <td><input data-field="hsCode" placeholder="HS code" /></td>
    <td><input data-field="quantity" type="number" step="0.01" min="0" /></td>
    <td><input data-field="unit" placeholder="pcs" /></td>
    <td><input data-field="unitPrice" type="number" step="0.01" min="0" /></td>
    <td><input data-field="countryOfOrigin" placeholder="CN" /></td>
    <td class="line-actions">
      <button type="button" class="icon-btn" data-action="duplicate" title="Duplicate line">⎘</button>
      <button type="button" class="icon-btn" data-action="remove" title="Remove line">×</button>
    </td>
  `;
  Object.entries(item || {}).forEach(([k, v]) => {
    const input = tr.querySelector(`input[data-field="${k}"]`);
    if (input) input.value = (v == null) ? '' : String(v);
  });
  els.tbody.appendChild(tr);
}

function recomputeTotals() {
  const items = readLineItems();
  let sub = 0;
  items.forEach(it => { sub += (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0); });
  const data = readForm();
  const extras = (Number(data.freightCost) || 0) + (Number(data.insuranceCost) || 0);
  const currency = String(data.currency || 'EUR').toUpperCase().slice(0, 3) || 'EUR';
  const fmt = (v) => {
    try {
      return new Intl.NumberFormat('en-IE', { style: 'currency', currency, maximumFractionDigits: 2 }).format(v);
    } catch { return `${currency} ${v.toFixed(2)}`; }
  };
  els.subtotal.textContent = fmt(sub);
  els.extras.textContent = fmt(extras);
  els.total.textContent = fmt(sub + extras);
}

function updateRowNumbers() {
  els.tbody.querySelectorAll('tr.line-row').forEach((row, i) => {
    const cell = row.querySelector('td.num');
    if (cell) cell.textContent = String(i + 1);
  });
}

els.form.addEventListener('input', () => {
  const state = readForm();
  saveDraft(state);
  recomputeTotals();
});

els.addLine.addEventListener('click', () => {
  addLineRow(EMPTY_LINE());
  updateRowNumbers();
  recomputeTotals();
});

els.tbody.addEventListener('click', (e) => {
  const btn = e.target.closest('.icon-btn');
  if (!btn) return;
  const row = btn.closest('tr.line-row');
  if (btn.dataset.action === 'remove') {
    if (els.tbody.querySelectorAll('tr.line-row').length === 1) return;
    row.remove();
  } else if (btn.dataset.action === 'duplicate') {
    const item = {};
    row.querySelectorAll('input').forEach(input => { item[input.dataset.field] = input.value; });
    const newRow = row.cloneNode(true);
    row.parentNode.insertBefore(newRow, row.nextSibling);
    newRow.querySelectorAll('input').forEach((input, i) => {
      const original = row.querySelectorAll('input')[i];
      if (original) input.value = original.value;
    });
  }
  updateRowNumbers();
  recomputeTotals();
  saveDraft(readForm());
});

els.saveDraft.addEventListener('click', () => {
  saveDraft(readForm());
  els.msg.classList.remove('error');
  els.msg.textContent = 'Draft saved locally.';
  setTimeout(() => { els.msg.textContent = ''; }, 1500);
});

els.form.addEventListener('submit', async (e) => {
  e.preventDefault();
  els.msg.classList.remove('error');
  els.msg.textContent = 'Generating…';

  const data = readForm();
  saveDraft(data);

  try {
    const response = await fetch(API_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'commercial_invoice', data }),
    });

    if (!response.ok) {
      const errPayload = await response.json().catch(() => ({}));
      els.msg.classList.add('error');
      const errors = Array.isArray(errPayload.errors) ? errPayload.errors : [errPayload.error || 'Unknown server error'];
      els.msg.innerHTML = '<b>Could not generate document:</b><ul>' + errors.map(e => `<li>${escapeHtml(e)}</li>`).join('') + '</ul>';
      return;
    }

    const html = await response.text();
    // Open the rendered document in a new window/tab for preview, print, save-as-PDF.
    const win = window.open('', '_blank');
    if (win) {
      win.document.open();
      win.document.write(html);
      win.document.close();
      els.msg.textContent = 'Invoice opened in a new tab. Use the Print button to save as PDF.';
    } else {
      // Fallback: navigate same-window
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      window.location.href = url;
    }
  } catch (error) {
    console.error(error);
    els.msg.classList.add('error');
    els.msg.textContent = 'Network error: ' + (error.message || 'unknown');
  }
});

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = String(text == null ? '' : text);
  return div.innerHTML;
}

document.querySelectorAll('.scenario-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const key = btn.dataset.scenario;
    if (key === 'clear') {
      clearDraft();
      applyState({ lineItems: [EMPTY_LINE()] });
      els.msg.textContent = 'Form cleared.';
      setTimeout(() => { els.msg.textContent = ''; }, 1200);
      return;
    }
    const scenario = SCENARIOS[key];
    if (!scenario) return;
    applyState(scenario);
    saveDraft(scenario);
    els.msg.textContent = 'Demo scenario loaded.';
    setTimeout(() => { els.msg.textContent = ''; }, 1200);
  });
});

// Initialise
const draft = loadDraft();
if (draft) {
  applyState(draft);
} else {
  applyState({ lineItems: [EMPTY_LINE(), EMPTY_LINE()] });
}
