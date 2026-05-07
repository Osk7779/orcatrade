// Returns quote calculator. Renders all three routes side-by-side with ranking + recommendation.

const API_ENDPOINT = '/api/returns';
const STORAGE_KEY = 'orcatrade.returns-quote.draft.v1';

const els = {
  form: document.getElementById('returns-form'),
  msg: document.getElementById('form-msg'),
  empty: document.getElementById('quote-empty'),
  content: document.getElementById('quote-content'),
  banner: document.getElementById('recommendation-banner'),
  verdict: document.getElementById('recommendation-verdict'),
  reasoning: document.getElementById('recommendation-reasoning'),
  routesGrid: document.getElementById('routes-grid'),
  nextStepsList: document.getElementById('next-steps-list'),
  snapshotDate: document.getElementById('snapshot-date'),
  assessmentFee: document.getElementById('assessment-fee'),
  year: document.getElementById('year'),
};

if (els.year) els.year.textContent = new Date().getFullYear();

const SCENARIOS = {
  'electronics-defective': { piecesCount: 50, totalWeightKg: 80, declaredValueEur: 15000, category: 'electronics', originCountry: 'CN', express: false },
  'textiles-batch': { piecesCount: 500, totalWeightKg: 200, declaredValueEur: 5000, category: 'textiles', originCountry: 'CN', express: false },
  'furniture-batch': { piecesCount: 20, totalWeightKg: 350, declaredValueEur: 25000, category: 'furniture', originCountry: 'VN', express: false },
  'cosmetics-expired': { piecesCount: 200, totalWeightKg: 60, declaredValueEur: 3000, category: 'cosmetics', originCountry: 'CN', express: false },
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

function fmtEurPrecise(value) {
  if (value == null || Number.isNaN(Number(value))) return '€0';
  return new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }).format(Number(value));
}

function readForm() {
  const data = {};
  els.form.querySelectorAll('input[name], select[name]').forEach(el => {
    const value = el.value;
    if (el.type === 'checkbox') data[el.name] = el.checked;
    else if (el.type === 'number' && value !== '') data[el.name] = Number(value);
    else data[el.name] = value;
  });
  return data;
}

function applyState(state) {
  Object.entries(state).forEach(([k, v]) => {
    const el = els.form.querySelector(`[name="${k}"]`);
    if (!el) return;
    if (el.type === 'checkbox') el.checked = Boolean(v);
    else el.value = v == null ? '' : v;
  });
}

function persist() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(readForm())); } catch {}
}

function loadDraft() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

let recomputeTimer = null;
function scheduleRecompute() {
  clearTimeout(recomputeTimer);
  recomputeTimer = setTimeout(recompute, 200);
}

async function recompute() {
  const data = readForm();
  if (!data.piecesCount || !data.totalWeightKg || data.declaredValueEur == null) {
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

  // Recommendation banner
  els.verdict.textContent = quote.recommendation.primaryRouteLabel || 'No viable route';
  els.reasoning.textContent = quote.recommendation.reasoning;
  els.snapshotDate.textContent = quote.asOf;
  els.assessmentFee.textContent = quote.assessmentFeeEur;

  // Routes grid
  els.routesGrid.innerHTML = quote.routes.map(route => renderRoute(route, quote.recommendation.primaryRouteKey)).join('');

  els.nextStepsList.innerHTML = (quote.nextSteps || []).map(s => `<li>${escapeHtml(s)}</li>`).join('');
}

function renderRoute(route, recommendedKey) {
  if (route.unavailable) {
    return `<article class="route-card unavailable">
      <div class="route-tag unavailable">Unavailable</div>
      <h3>${escapeHtml(route.label)}</h3>
      <div class="unavailable-block">${escapeHtml(route.reason || '')}</div>
    </article>`;
  }

  const isRecommended = route.routeKey === recommendedKey;
  const tagClass = isRecommended ? 'recommended' : '';
  const cardClass = isRecommended ? 'recommended' : '';
  const tagText = isRecommended ? 'Recommended' : route.routeKey === 'return_to_supplier' ? 'Route 1' : route.routeKey === 'local_refurb' ? 'Route 2' : 'Route 3';

  const breakdown = (route.breakdown || []).map(b =>
    `<div class="row"><span class="lbl">${escapeHtml(b.label)}</span><span>${b.eur < 0 ? '−' : ''}${fmtEurPrecise(Math.abs(b.eur))}</span></div>`
  ).join('');

  const cautions = (route.cautions || []).slice(0, 3).map(c => `<li>${escapeHtml(c)}</li>`).join('');

  return `<article class="route-card ${cardClass}">
    <div class="route-tag ${tagClass}">${tagText}</div>
    <h3>${escapeHtml(route.label)}</h3>
    <div class="route-cost">${fmtEur(route.totalIncludingAssessmentEur)}</div>
    <div class="route-meta">${escapeHtml(route.transitDays)}</div>
    <div class="route-breakdown">${breakdown}</div>
    <div class="route-best-for">${escapeHtml(route.bestFor || '')}</div>
    ${cautions ? `<ul class="route-cautions">${cautions}</ul>` : ''}
  </article>`;
}

// Form events
els.form.addEventListener('input', scheduleRecompute);
els.form.addEventListener('change', scheduleRecompute);
els.form.addEventListener('submit', e => { e.preventDefault(); recompute(); });

// Scenarios
document.querySelectorAll('.scenario-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const scenario = SCENARIOS[btn.dataset.scenario];
    if (!scenario) return;
    applyState(scenario);
    persist();
    recompute();
  });
});

// Init
const draft = loadDraft();
if (draft && draft.piecesCount) {
  applyState(draft);
  recompute();
} else {
  recompute();
}
