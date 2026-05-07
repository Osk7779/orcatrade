// Dashboard state aggregator. Pure-JS module compiles activity across the platform
// from localStorage. Designed to run client-side; no network calls.
//
// This is v1 — localStorage only, single-browser scope. Real session-backed activity
// (server-persisted user state) lands when auth + database are wired in.
//
// Exported helpers are also imported by the test runner via Node — they're written to
// be environment-agnostic (they accept a storage adapter, not a hard-coded localStorage).

const ACTIVITY_KEYS = {
  // Trade Documentation Hub drafts
  commercialInvoice: { key: 'orcatrade.commercial-invoice.draft.v1', kind: 'document', label: 'Commercial Invoice draft', route: '/documents/commercial-invoice/' },
  packingList: { key: 'orcatrade.packing-list.draft.v1', kind: 'document', label: 'Packing List draft', route: '/documents/packing-list/' },
  proformaInvoice: { key: 'orcatrade.proforma-invoice.draft.v1', kind: 'document', label: 'Proforma Invoice draft', route: '/documents/proforma-invoice/' },
  certificateOfOrigin: { key: 'orcatrade.certificate-of-origin.draft.v1', kind: 'document', label: 'Certificate of Origin draft', route: '/documents/certificate-of-origin/' },
  // Tier 1 quote drafts
  insuranceQuote: { key: 'orcatrade.insurance-quote.draft.v1', kind: 'quote', label: 'Insurance quote', route: '/insurance/quote/' },
  sampleRequest: { key: 'orcatrade.sample-request.draft.v1', kind: 'quote', label: 'Sample request quote', route: '/samples/request/' },
  returnsQuote: { key: 'orcatrade.returns-quote.draft.v1', kind: 'quote', label: 'Returns quote', route: '/returns/quote/' },
};

function readJson(storage, key) {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function summariseDocument(kind, data) {
  if (!data || typeof data !== 'object') return null;
  const exporter = data.exporter && data.exporter.companyName ? data.exporter.companyName : null;
  const consignee = data.consignee && data.consignee.companyName ? data.consignee.companyName : null;
  const lineItems = Array.isArray(data.lineItems) ? data.lineItems.length : 0;
  return {
    invoiceNumber: data.invoiceNumber || null,
    invoiceDate: data.invoiceDate || data.shipmentDate || null,
    exporter, consignee, lineItems,
    currency: data.currency || null,
    countryOfOrigin: data.countryOfOrigin || null,
    countryOfDestination: data.countryOfDestination || null,
  };
}

function summariseInsuranceQuote(data) {
  if (!data || typeof data !== 'object') return null;
  return {
    cargoValueEur: Number(data.cargoValueEur) || null,
    transportMode: data.transportMode || null,
    goodsType: data.goodsType || null,
    originCountry: data.originCountry || null,
    destinationCountry: data.destinationCountry || null,
    coverage: data.coverage || null,
  };
}

function summariseSampleRequest(data) {
  if (!data || typeof data !== 'object') return null;
  return {
    supplierCount: Number(data.supplierCount) || null,
    totalWeightKg: Number(data.totalWeightKg) || null,
    destinationCountry: data.destinationCountry || null,
    express: data.express === true,
    rushTurnaround: data.rushTurnaround === true,
  };
}

function summariseReturnsQuote(data) {
  if (!data || typeof data !== 'object') return null;
  return {
    piecesCount: Number(data.piecesCount) || null,
    totalWeightKg: Number(data.totalWeightKg) || null,
    declaredValueEur: Number(data.declaredValueEur) || null,
    category: data.category || null,
    originCountry: data.originCountry || null,
  };
}

function buildActivityFeed(storage) {
  const items = [];
  for (const [name, def] of Object.entries(ACTIVITY_KEYS)) {
    const data = readJson(storage, def.key);
    if (!data) continue;
    let summary = null;
    if (name === 'commercialInvoice' || name === 'packingList' || name === 'proformaInvoice' || name === 'certificateOfOrigin') {
      summary = summariseDocument(def.kind, data);
    } else if (name === 'insuranceQuote') {
      summary = summariseInsuranceQuote(data);
    } else if (name === 'sampleRequest') {
      summary = summariseSampleRequest(data);
    } else if (name === 'returnsQuote') {
      summary = summariseReturnsQuote(data);
    }
    items.push({ name, kind: def.kind, label: def.label, route: def.route, summary });
  }
  return items;
}

function aggregateState(storage) {
  const activity = buildActivityFeed(storage);
  const grouped = {
    documents: activity.filter(item => item.kind === 'document'),
    quotes: activity.filter(item => item.kind === 'quote'),
  };
  const counts = {
    totalDrafts: activity.length,
    documents: grouped.documents.length,
    quotes: grouped.quotes.length,
  };
  return { activity, grouped, counts };
}

function loadSession(storage) {
  return readJson(storage, 'orcatrade.dashboard.session.v1');
}

function saveSession(storage, session) {
  if (!storage) return;
  try {
    storage.setItem('orcatrade.dashboard.session.v1', JSON.stringify(session));
  } catch {}
}

function clearSession(storage) {
  if (!storage) return;
  try {
    storage.removeItem('orcatrade.dashboard.session.v1');
  } catch {}
}

function buildSession({ email, name, workspaceName, role }) {
  if (!email || !email.includes('@')) {
    return { ok: false, error: 'A valid email is required.' };
  }
  return {
    ok: true,
    session: {
      email: String(email).trim().toLowerCase().slice(0, 200),
      name: String(name || email.split('@')[0]).trim().slice(0, 80),
      workspaceName: String(workspaceName || '').trim().slice(0, 120) || `${(name || email.split('@')[0]).split(' ')[0]}'s workspace`,
      role: ['owner', 'admin', 'member', 'viewer'].includes(role) ? role : 'owner',
      authMode: 'stub-localstorage',
      authNote: 'Stub auth for demo. Real Supabase / Auth.js / Clerk integration is the next sprint.',
      createdAt: new Date().toISOString(),
    },
  };
}

module.exports = {
  ACTIVITY_KEYS,
  readJson,
  summariseDocument,
  summariseInsuranceQuote,
  summariseSampleRequest,
  summariseReturnsQuote,
  buildActivityFeed,
  aggregateState,
  loadSession,
  saveSession,
  clearSession,
  buildSession,
};
