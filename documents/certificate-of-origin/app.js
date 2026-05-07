// Certificate of Origin form — HS code per line, marks & numbers, country of origin emphasised.

const STORAGE_KEY = 'orcatrade.certificate-of-origin.draft.v1';
const API_ENDPOINT = '/api/documents';

const COLUMNS = [
  { field: 'description', placeholder: 'Description' },
  { field: 'hsCode', placeholder: 'HS code' },
  { field: 'quantity', type: 'number', step: '0.01', min: '0' },
  { field: 'unit', placeholder: 'pcs' },
  { field: 'marksAndNumbers', placeholder: 'Carton marks / serials' },
];
const SHARED_FIELDS = [
  'exporter.companyName', 'exporter.streetAddress', 'exporter.city', 'exporter.country', 'exporter.taxId', 'exporter.email',
  'consignee.companyName', 'consignee.streetAddress', 'consignee.city', 'consignee.country', 'consignee.eori',
  'countryOfOrigin', 'countryOfDestination', 'invoiceNumber', 'invoiceDate', 'transportMode', 'vesselFlightNo',
];

const SCENARIOS = {
  'vn-furniture': {
    exporter: { companyName: 'Saigon Timber Furniture Co.', streetAddress: '45 Tran Hung Dao, District 1', city: 'Ho Chi Minh City', country: 'Vietnam', taxId: '0312345678', email: 'export@saigontimber.vn' },
    consignee: { companyName: 'Nordica Wood Products GmbH', streetAddress: 'Industriestraße 5', city: 'Düsseldorf', country: 'Germany', eori: 'DE987654321098765' },
    countryOfOrigin: 'Vietnam',
    countryOfDestination: 'Germany',
    invoiceNumber: 'INV-NORD-2026-118',
    invoiceDate: '2026-05-07',
    transportMode: 'Sea FCL',
    vesselFlightNo: 'CMA CGM Ahmes V.062E',
    lineItems: [
      { description: 'Plywood panels, FSC-certified, 2440x1220x18mm', hsCode: '4412 10', quantity: 480, unit: 'sheets', marksAndNumbers: 'NORD-2026-118 / Cartons 1-12' },
      { description: 'Oak dining chairs, finished', hsCode: '9401 61', quantity: 120, unit: 'pcs', marksAndNumbers: 'NORD-2026-118 / Cartons 13-32' },
    ],
    signedByName: 'Nguyen Thanh',
    signedByTitle: 'Export Manager',
    signedDate: '2026-05-07',
  },
};

const els = {
  form: document.getElementById('coo-form'),
  msg: document.getElementById('form-msg'),
  addLine: document.getElementById('add-line'),
  saveDraft: document.getElementById('save-draft'),
  year: document.getElementById('year'),
};

if (els.year) els.year.textContent = new Date().getFullYear();

const F = window.OrcaDocForm;

function persist() {
  F.saveDraft(STORAGE_KEY, F.readForm(els.form, COLUMNS.map(c => c.field), '#line-items-tbody'));
}

els.form.addEventListener('input', persist);

els.addLine.addEventListener('click', () => {
  const tbody = document.getElementById('line-items-tbody');
  F.addLineRow(tbody, COLUMNS, F.emptyLine(COLUMNS.map(c => c.field)));
  F.updateRowNumbers(tbody);
});

F.bindLineActions(els.form, '#line-items-tbody', COLUMNS, persist);

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
  await F.generateAndOpen({ apiEndpoint: API_ENDPOINT, type: 'certificate_of_origin', data, msgEl: els.msg });
});

document.querySelectorAll('.scenario-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const key = btn.dataset.scenario;
    if (key === 'clear') {
      F.clearDraft(STORAGE_KEY);
      F.applyState(els.form, { lineItems: [F.emptyLine(COLUMNS.map(c => c.field))] }, { tbodySelector: '#line-items-tbody', lineColumns: COLUMNS });
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
      F.saveDraft(STORAGE_KEY, merged);
      els.msg.classList.remove('error');
      els.msg.textContent = 'Imported exporter / consignee / shipment from Commercial Invoice draft.';
      setTimeout(() => { els.msg.textContent = ''; }, 2000);
      return;
    }
    const scenario = SCENARIOS[key];
    if (!scenario) return;
    F.applyState(els.form, scenario, { tbodySelector: '#line-items-tbody', lineColumns: COLUMNS });
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
