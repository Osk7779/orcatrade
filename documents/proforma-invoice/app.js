// Proforma Invoice form — same line schema as Commercial Invoice plus Valid Until.

const STORAGE_KEY = 'orcatrade.proforma-invoice.draft.v1';
const API_ENDPOINT = '/api/documents';

const COLUMNS = [
  { field: 'description', placeholder: 'Description' },
  { field: 'hsCode', placeholder: 'HS code' },
  { field: 'quantity', type: 'number', step: '0.01', min: '0' },
  { field: 'unit', placeholder: 'pcs' },
  { field: 'unitPrice', type: 'number', step: '0.01', min: '0' },
  { field: 'countryOfOrigin', placeholder: 'CN' },
];
const SHARED_FIELDS = [
  'exporter.companyName', 'exporter.streetAddress', 'exporter.city', 'exporter.country', 'exporter.taxId', 'exporter.email',
  'consignee.companyName', 'consignee.streetAddress', 'consignee.city', 'consignee.country', 'consignee.eori', 'consignee.taxId',
  'currency', 'incoterm', 'incotermPlace', 'countryOfOrigin', 'countryOfDestination', 'transportMode',
];

const SCENARIOS = {
  'cn-electronics': {
    exporter: { companyName: 'Shenzhen Audio Tech Co. Ltd.', streetAddress: '88 Bao\'an Industrial Park', city: 'Shenzhen', country: 'China', taxId: '914403001234567X', email: 'export@shenzhen-audio.cn' },
    consignee: { companyName: 'AudioCraft GmbH', streetAddress: 'Friedrichstraße 100', city: 'Berlin', country: 'Germany', eori: 'DE123456789012345', taxId: 'DE123456789' },
    invoiceNumber: 'PRO-2026-0042',
    invoiceDate: '2026-05-07',
    validUntil: '2026-06-07',
    currency: 'EUR',
    incoterm: 'FOB',
    incotermPlace: 'Yantian',
    countryOfOrigin: 'China',
    countryOfDestination: 'Germany',
    transportMode: 'Sea FCL',
    poReference: '30 days from PO confirmation',
    lineItems: [
      { description: 'Bluetooth Smart Speaker, AS-100', hsCode: '8518 22', quantity: 500, unit: 'pcs', unitPrice: 32.50, countryOfOrigin: 'China' },
      { description: 'Power adaptor, 100-240V, EU plug', hsCode: '8504 40', quantity: 500, unit: 'pcs', unitPrice: 4.20, countryOfOrigin: 'China' },
    ],
    freightCost: 1850,
    insuranceCost: 220,
    bankingDetails: 'Bank of China · Shenzhen Bao\'an Branch\nSWIFT: BKCHCNBJ500\nAccount: 4000 1234 5678 9012',
    notes: '30% advance on PO confirmation, 70% on BL copy. Prices valid until the Valid Until date. Lead time 30 days from confirmed PO.',
    signedByName: 'Liu Wei',
    signedByTitle: 'Export Manager',
    signedDate: '2026-05-07',
  },
};

const els = {
  form: document.getElementById('proforma-form'),
  msg: document.getElementById('form-msg'),
  subtotal: document.getElementById('subtotal-display'),
  extras: document.getElementById('extras-display'),
  total: document.getElementById('total-display'),
  addLine: document.getElementById('add-line'),
  saveDraft: document.getElementById('save-draft'),
  year: document.getElementById('year'),
};

if (els.year) els.year.textContent = new Date().getFullYear();

const F = window.OrcaDocForm;

function recompute() {
  const items = F.readLineItems(els.form, '#line-items-tbody', COLUMNS.map(c => c.field));
  let sub = 0;
  items.forEach(it => { sub += (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0); });
  const data = F.readForm(els.form, COLUMNS.map(c => c.field), '#line-items-tbody');
  const extras = (Number(data.freightCost) || 0) + (Number(data.insuranceCost) || 0);
  const currency = String(data.currency || 'EUR').toUpperCase().slice(0, 3) || 'EUR';
  const fmt = v => {
    try { return new Intl.NumberFormat('en-IE', { style: 'currency', currency, maximumFractionDigits: 2 }).format(v); }
    catch { return `${currency} ${v.toFixed(2)}`; }
  };
  els.subtotal.textContent = fmt(sub);
  els.extras.textContent = fmt(extras);
  els.total.textContent = fmt(sub + extras);
}

function persist() {
  F.saveDraft(STORAGE_KEY, F.readForm(els.form, COLUMNS.map(c => c.field), '#line-items-tbody'));
}

els.form.addEventListener('input', () => { persist(); recompute(); });

els.addLine.addEventListener('click', () => {
  const tbody = document.getElementById('line-items-tbody');
  F.addLineRow(tbody, COLUMNS, F.emptyLine(COLUMNS.map(c => c.field)));
  F.updateRowNumbers(tbody);
  recompute();
});

F.bindLineActions(els.form, '#line-items-tbody', COLUMNS, () => { recompute(); persist(); });

els.saveDraft.addEventListener('click', () => {
  persist();
  els.msg.classList.remove('error');
  els.msg.textContent = 'Draft saved locally.';
  setTimeout(() => { els.msg.textContent = ''; }, 1500);
});

els.form.addEventListener('submit', async e => {
  e.preventDefault();
  const data = F.readForm(els.form, COLUMNS.map(c => c.field), '#line-items-tbody');
  F.saveDraft(STORAGE_KEY, data);
  await F.generateAndOpen({ apiEndpoint: API_ENDPOINT, type: 'proforma_invoice', data, msgEl: els.msg });
});

document.querySelectorAll('.scenario-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const key = btn.dataset.scenario;
    if (key === 'clear') {
      F.clearDraft(STORAGE_KEY);
      F.applyState(els.form, { lineItems: [F.emptyLine(COLUMNS.map(c => c.field))] }, { tbodySelector: '#line-items-tbody', lineColumns: COLUMNS });
      recompute();
      els.msg.textContent = 'Form cleared.';
      setTimeout(() => { els.msg.textContent = ''; }, 1200);
      return;
    }
    if (key === 'import-invoice') {
      const imported = F.importFromCommercialInvoice(SHARED_FIELDS);
      if (!imported) {
        els.msg.classList.add('error');
        els.msg.textContent = 'No Commercial Invoice draft found in this browser.';
        return;
      }
      const current = F.readForm(els.form, COLUMNS.map(c => c.field), '#line-items-tbody');
      const merged = Object.assign({}, current, imported);
      F.applyState(els.form, merged, { tbodySelector: '#line-items-tbody', lineColumns: COLUMNS });
      recompute();
      F.saveDraft(STORAGE_KEY, merged);
      els.msg.classList.remove('error');
      els.msg.textContent = 'Imported exporter / consignee / shipment from Commercial Invoice draft.';
      setTimeout(() => { els.msg.textContent = ''; }, 2000);
      return;
    }
    const scenario = SCENARIOS[key];
    if (!scenario) return;
    F.applyState(els.form, scenario, { tbodySelector: '#line-items-tbody', lineColumns: COLUMNS });
    recompute();
    F.saveDraft(STORAGE_KEY, scenario);
    els.msg.textContent = 'Demo scenario loaded.';
    setTimeout(() => { els.msg.textContent = ''; }, 1200);
  });
});

const draft = F.loadDraft(STORAGE_KEY);
if (draft) {
  F.applyState(els.form, draft, { tbodySelector: '#line-items-tbody', lineColumns: COLUMNS });
} else {
  F.applyState(els.form, { lineItems: [F.emptyLine(COLUMNS.map(c => c.field)), F.emptyLine(COLUMNS.map(c => c.field))] }, { tbodySelector: '#line-items-tbody', lineColumns: COLUMNS });
}
recompute();
