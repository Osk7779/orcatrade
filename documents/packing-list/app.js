// Packing List form. Uses window.OrcaDocForm helpers from documents/shared/form.js.

const STORAGE_KEY = 'orcatrade.packing-list.draft.v1';
const API_ENDPOINT = '/api/documents';

const COLUMNS = [
  { field: 'description', placeholder: 'Description' },
  { field: 'quantity', type: 'number', step: '0.01', min: '0' },
  { field: 'unit', placeholder: 'pcs' },
  { field: 'cartons', type: 'number', step: '1', min: '0' },
  { field: 'grossWeightKg', type: 'number', step: '0.01', min: '0' },
  { field: 'netWeightKg', type: 'number', step: '0.01', min: '0' },
  { field: 'dimensions', placeholder: 'L×W×H cm' },
];
const SHARED_FIELDS = [
  'exporter.companyName', 'exporter.streetAddress', 'exporter.city', 'exporter.country', 'exporter.taxId', 'exporter.email',
  'consignee.companyName', 'consignee.streetAddress', 'consignee.city', 'consignee.country', 'consignee.eori', 'consignee.taxId',
  'invoiceNumber', 'poReference', 'transportMode', 'vesselFlightNo', 'portOfLoading', 'portOfDischarge',
];

const SCENARIOS = {
  'cn-electronics': {
    exporter: { companyName: 'Shenzhen Audio Tech Co. Ltd.', streetAddress: '88 Bao\'an Industrial Park', city: 'Shenzhen', country: 'China', taxId: '914403001234567X', email: 'export@shenzhen-audio.cn' },
    consignee: { companyName: 'AudioCraft GmbH', streetAddress: 'Friedrichstraße 100', city: 'Berlin', country: 'Germany', eori: 'DE123456789012345', taxId: 'DE123456789' },
    invoiceNumber: 'INV-2026-0042',
    shipmentDate: '2026-05-07',
    poReference: 'PO-AUD-9001',
    transportMode: 'Sea FCL',
    vesselFlightNo: 'COSCO Tian Sheng V.043W',
    containerNumber: 'TCNU 4587612',
    portOfLoading: 'Yantian',
    portOfDischarge: 'Hamburg',
    lineItems: [
      { description: 'Bluetooth Smart Speaker, AS-100, packed 4 per master carton', quantity: 500, unit: 'pcs', cartons: 125, grossWeightKg: 1875, netWeightKg: 1625, dimensions: '60×40×35 cm/carton' },
      { description: 'Power adaptor, 100-240V, packed 50 per master carton', quantity: 500, unit: 'pcs', cartons: 10, grossWeightKg: 80, netWeightKg: 70, dimensions: '40×30×25 cm/carton' },
      { description: 'USB-C charging cable, packed 100 per master carton', quantity: 500, unit: 'pcs', cartons: 5, grossWeightKg: 25, netWeightKg: 22, dimensions: '40×30×20 cm/carton' },
    ],
    notes: 'Cartons palletised on 4 EUR pallets. Stack max 2 high. ISPM-15 fumigated wood packaging.',
    signedByName: 'Liu Wei',
    signedByTitle: 'Export Manager',
    signedDate: '2026-05-07',
  },
};

const els = {
  form: document.getElementById('packing-form'),
  msg: document.getElementById('form-msg'),
  cartons: document.getElementById('cartons-display'),
  gross: document.getElementById('gross-display'),
  net: document.getElementById('net-display'),
  addLine: document.getElementById('add-line'),
  saveDraft: document.getElementById('save-draft'),
  year: document.getElementById('year'),
};

if (els.year) els.year.textContent = new Date().getFullYear();

const F = window.OrcaDocForm;

function recompute() {
  const items = F.readLineItems(els.form, '#line-items-tbody', COLUMNS.map(c => c.field));
  let cartons = 0, gross = 0, net = 0;
  items.forEach(it => {
    cartons += Number(it.cartons) || 0;
    gross += Number(it.grossWeightKg) || 0;
    net += Number(it.netWeightKg) || 0;
  });
  els.cartons.textContent = cartons.toLocaleString('en-IE');
  els.gross.textContent = gross.toLocaleString('en-IE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' kg';
  els.net.textContent = net.toLocaleString('en-IE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' kg';
}

function persist() {
  const data = F.readForm(els.form, COLUMNS.map(c => c.field), '#line-items-tbody');
  F.saveDraft(STORAGE_KEY, data);
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
  await F.generateAndOpen({ apiEndpoint: API_ENDPOINT, type: 'packing_list', data, msgEl: els.msg });
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
      // Merge with whatever's already there
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

// Init
const draft = F.loadDraft(STORAGE_KEY);
if (draft) {
  F.applyState(els.form, draft, { tbodySelector: '#line-items-tbody', lineColumns: COLUMNS });
} else {
  F.applyState(els.form, { lineItems: [F.emptyLine(COLUMNS.map(c => c.field)), F.emptyLine(COLUMNS.map(c => c.field))] }, { tbodySelector: '#line-items-tbody', lineColumns: COLUMNS });
}
recompute();
