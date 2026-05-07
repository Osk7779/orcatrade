// Warehouse / 3PL multi-hub comparison. Live recalc on form input.

const API_ENDPOINT = '/api/warehouse';
const STORAGE_KEY = 'orcatrade.warehouse-quote.draft.v1';

const els = {
  form: document.getElementById('warehouse-form'),
  msg: document.getElementById('form-msg'),
  empty: document.getElementById('quote-empty'),
  content: document.getElementById('quote-content'),
  recVerdict: document.getElementById('rec-verdict'),
  recReasoning: document.getElementById('rec-reasoning'),
  hubsGrid: document.getElementById('hubs-grid'),
  eduWhat: document.getElementById('edu-what'),
  eduHub: document.getElementById('edu-hub'),
  eduMulti: document.getElementById('edu-multi'),
  eduNeg: document.getElementById('edu-neg'),
  nextSteps: document.getElementById('next-steps-list'),
  year: document.getElementById('year'),
};

if (els.year) els.year.textContent = new Date().getFullYear();

const SCENARIOS = {
  'dtc-de':         { monthlyOrders: 1500, avgUnitsPerOrder: 1.5, avgLinesPerOrder: 1.2, avgPalletsHeld: 50, avgOrderWeightKg: 2, primaryDestination: 'DE', skuCount: 0, returnsRate: 0, vas: [] },
  'dtc-fr':         { monthlyOrders: 1500, avgUnitsPerOrder: 1.5, avgLinesPerOrder: 1.2, avgPalletsHeld: 50, avgOrderWeightKg: 2, primaryDestination: 'FR', skuCount: 0, returnsRate: 0, vas: [] },
  'iberian-3k':     { monthlyOrders: 3000, avgUnitsPerOrder: 1.8, avgLinesPerOrder: 1.3, avgPalletsHeld: 90, avgOrderWeightKg: 1.5, primaryDestination: 'ES', skuCount: 0, returnsRate: 0, vas: [] },
  'enterprise-8k':  { monthlyOrders: 8000, avgUnitsPerOrder: 2,   avgLinesPerOrder: 1.5, avgPalletsHeld: 200, avgOrderWeightKg: 1.5, primaryDestination: 'FR', skuCount: 240, returnsRate: 8, vas: ['labelling', 'returns', 'photography'] },
};

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = String(text == null ? '' : text);
  return div.innerHTML;
}

function fmtEur(value) {
  if (value == null || Number.isNaN(Number(value))) return '€0';
  return new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(Number(value));
}

function fmtEurDecimals(value) {
  if (value == null || Number.isNaN(Number(value))) return '€0';
  return new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }).format(Number(value));
}

function readForm() {
  const data = {};
  els.form.querySelectorAll('input[name], select[name]').forEach(el => {
    if (el.name === 'vas') return; // collected separately
    const value = el.value;
    if (el.type === 'number' && value !== '') data[el.name] = Number(value);
    else if (el.type === 'number') data[el.name] = null;
    else data[el.name] = value;
  });
  data.valueAddedServices = Array.from(els.form.querySelectorAll('input[name="vas"]:checked')).map(c => c.value);
  // returnsRate UX is %; calculator wants decimal
  if (data.returnsRate != null) data.returnsRate = Math.max(0, Math.min(100, Number(data.returnsRate))) / 100;
  return data;
}

function applyState(state) {
  Object.entries(state).forEach(([k, v]) => {
    if (k === 'vas') return;
    const el = els.form.querySelector(`[name="${k}"]`);
    if (el) el.value = v == null ? '' : v;
  });
  // VAS checkboxes
  els.form.querySelectorAll('input[name="vas"]').forEach(c => { c.checked = false; });
  (state.vas || []).forEach(svc => {
    const cb = els.form.querySelector(`input[name="vas"][value="${svc}"]`);
    if (cb) cb.checked = true;
  });
}

function persist() {
  try {
    const data = readForm();
    // Persist UI form-shape (returnsRate as % for the input field)
    const persistable = { ...data, returnsRate: (data.returnsRate || 0) * 100, vas: data.valueAddedServices };
    delete persistable.valueAddedServices;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persistable));
  } catch {}
}

function loadDraft() {
  try { const raw = localStorage.getItem(STORAGE_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
}

let recomputeTimer = null;
function scheduleRecompute() { clearTimeout(recomputeTimer); recomputeTimer = setTimeout(recompute, 200); }

async function recompute() {
  const data = readForm();
  if (!data.monthlyOrders || !data.primaryDestination) {
    els.empty.style.display = '';
    els.content.style.display = 'none';
    return;
  }
  persist();
  els.msg.classList.remove('error');
  els.msg.textContent = 'Calculating…';
  try {
    const response = await fetch(API_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      els.msg.classList.add('error');
      els.msg.innerHTML = '<b>Could not calculate quote:</b> ' + escapeHtml((err.errors || []).join('; ') || err.error || 'unknown');
      return;
    }
    renderQuote(await response.json());
    els.msg.textContent = '';
  } catch (error) {
    els.msg.classList.add('error');
    els.msg.textContent = 'Network error: ' + (error.message || 'unknown');
  }
}

function renderQuote(quote) {
  els.empty.style.display = 'none';
  els.content.style.display = '';

  const recHub = quote.quotes.find(h => h.hubKey === quote.recommendation.primary);
  els.recVerdict.textContent = recHub ? `${recHub.hubName} (${recHub.hubCountryName}) — €${recHub.totalMonthlyEur.toLocaleString('en-IE')}/month` : 'No recommendation';
  els.recReasoning.textContent = quote.recommendation.rationale;

  const sorted = [...quote.quotes].sort((a, b) => a.totalMonthlyEur - b.totalMonthlyEur);
  els.hubsGrid.innerHTML = sorted.map(h => renderHub(h, quote.recommendation.primary)).join('');

  els.eduWhat.innerHTML = '<b>What 3PL is:</b> ' + escapeHtml(quote.threePLEducation.whatThis);
  els.eduHub.innerHTML = '<b>Hub choice:</b> ' + escapeHtml(quote.threePLEducation.hubChoice);
  els.eduMulti.innerHTML = '<b>Multi-hub:</b> ' + escapeHtml(quote.threePLEducation.multiHub);
  els.eduNeg.innerHTML = '<b>Negotiation:</b> ' + escapeHtml(quote.threePLEducation.negotiation);

  els.nextSteps.innerHTML = (quote.nextSteps || []).map(s => `<li>${escapeHtml(s)}</li>`).join('');
}

function renderHub(h, recommendedKey) {
  const isRecommended = h.hubKey === recommendedKey;
  const breakdownRows = (h.breakdown || []).map(b =>
    `<div class="row"><span>${escapeHtml(b.label)}</span><span class="val">${fmtEurDecimals(b.monthlyCostEur)}</span></div>`
  ).join('');
  const prosList = (h.pros || []).slice(0, 2).map(p => `<div>${escapeHtml(p)}</div>`).join('');
  return `<article class="hub-card ${isRecommended ? 'recommended' : ''}">
    <div class="hub-header">
      <div>
        <div class="hub-tag ${isRecommended ? 'recommended' : ''}">${isRecommended ? 'Recommended' : h.hubRegion}</div>
        <h3>${escapeHtml(h.hubName)}</h3>
        <div class="hub-country">${escapeHtml(h.hubCountryName)}</div>
      </div>
    </div>
    <div>
      <div class="hub-cost">${fmtEur(h.totalMonthlyEur)}<span style="font-size:0.6em;font-weight:400;color:rgba(255,255,255,0.5);"> /mo</span></div>
      <div class="hub-cost-sub">€${h.costPerOrderEur} per order</div>
    </div>
    <div class="hub-meta">
      <div class="row"><span class="lbl">Onward transit</span><span>${escapeHtml(h.transitToDestination)}</span></div>
      <div class="row"><span class="lbl">From Asia (sea)</span><span>${escapeHtml(h.transitFromAsiaSea)}</span></div>
    </div>
    <div class="hub-breakdown">${breakdownRows}</div>
    <div class="hub-pros"><b>Strengths</b>${prosList}</div>
  </article>`;
}

els.form.addEventListener('input', scheduleRecompute);
els.form.addEventListener('change', scheduleRecompute);
els.form.addEventListener('submit', e => { e.preventDefault(); recompute(); });

document.querySelectorAll('.scenario-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const scenario = SCENARIOS[btn.dataset.scenario];
    if (!scenario) return;
    applyState(scenario);
    persist();
    recompute();
  });
});

const draft = loadDraft();
if (draft && draft.monthlyOrders) {
  applyState(draft);
  recompute();
} else {
  recompute();
}
