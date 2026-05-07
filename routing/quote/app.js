// Routing comparison calculator. Live recalc on form input.

const API_ENDPOINT = '/api/routing';
const STORAGE_KEY = 'orcatrade.routing-quote.draft.v1';

const els = {
  form: document.getElementById('routing-form'),
  msg: document.getElementById('form-msg'),
  empty: document.getElementById('quote-empty'),
  content: document.getElementById('quote-content'),
  recVerdict: document.getElementById('rec-verdict'),
  recReasoning: document.getElementById('rec-reasoning'),
  modesGrid: document.getElementById('modes-grid'),
  eduRailWhy: document.getElementById('edu-rail-why'),
  eduRailBest: document.getElementById('edu-rail-best'),
  eduRailWrong: document.getElementById('edu-rail-wrong'),
  nextSteps: document.getElementById('next-steps-list'),
  year: document.getElementById('year'),
};

if (els.year) els.year.textContent = new Date().getFullYear();

const SCENARIOS = {
  '500kg-cn-de': { weightKg: 500, volumeCbm: 2, originCountry: 'CN', destinationCountry: 'DE', costPriority: 'balanced', urgencyDays: '' },
  '2t-cn-pl': { weightKg: 2000, volumeCbm: 6, originCountry: 'CN', destinationCountry: 'PL', costPriority: 'balanced', urgencyDays: '' },
  '50kg-vn-de-urgent': { weightKg: 50, volumeCbm: 0.3, originCountry: 'VN', destinationCountry: 'DE', costPriority: 'balanced', urgencyDays: 7 },
  '8t-cn-pl': { weightKg: 8000, volumeCbm: 18, originCountry: 'CN', destinationCountry: 'PL', costPriority: 'balanced', urgencyDays: '' },
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

function readForm() {
  const data = {};
  els.form.querySelectorAll('input[name], select[name]').forEach(el => {
    const value = el.value;
    if (el.type === 'number' && value !== '') data[el.name] = Number(value);
    else if (el.type === 'number') data[el.name] = null;
    else data[el.name] = value;
  });
  return data;
}

function applyState(state) {
  Object.entries(state).forEach(([k, v]) => {
    const el = els.form.querySelector(`[name="${k}"]`);
    if (el) el.value = v == null ? '' : v;
  });
}

function persist() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(readForm())); } catch {}
}

function loadDraft() {
  try { const raw = localStorage.getItem(STORAGE_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
}

let recomputeTimer = null;
function scheduleRecompute() { clearTimeout(recomputeTimer); recomputeTimer = setTimeout(recompute, 200); }

async function recompute() {
  const data = readForm();
  if (!data.weightKg || !data.originCountry || !data.destinationCountry) {
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

  els.recVerdict.textContent = quote.recommendation.primaryQuote ? quote.recommendation.primaryQuote.label : 'No viable mode';
  els.recReasoning.textContent = quote.recommendation.reasoning;

  els.modesGrid.innerHTML = quote.quotes.map(q => renderMode(q, quote.recommendation.primary)).join('');

  els.eduRailWhy.innerHTML = '<b>Why rail matters:</b> ' + escapeHtml(quote.railEducation.whyRailMatters);
  els.eduRailBest.innerHTML = '<b>Best for rail:</b> ' + escapeHtml(quote.railEducation.bestForRail);
  els.eduRailWrong.innerHTML = '<b>When rail is wrong:</b> ' + escapeHtml(quote.railEducation.whenRailIsWrong);

  els.nextSteps.innerHTML = (quote.nextSteps || []).map(s => `<li>${escapeHtml(s)}</li>`).join('');
}

function renderMode(q, recommendedMode) {
  if (!q.viable) {
    return `<article class="mode-card unavailable">
      <div class="mode-tag">Unavailable</div>
      <h3>${escapeHtml(q.label)}</h3>
      <div class="mode-unavailable-text">${escapeHtml(q.viabilityReason || 'Not viable for this route.')}</div>
    </article>`;
  }
  const isRecommended = q.mode === recommendedMode;
  return `<article class="mode-card ${isRecommended ? 'recommended' : ''}">
    <div class="mode-tag ${isRecommended ? 'recommended' : ''}">${isRecommended ? 'Recommended' : q.mode.replace('_', ' ').toUpperCase()}</div>
    <h3>${escapeHtml(q.label)}</h3>
    <div class="mode-cost">${fmtEur(q.totalEur)}</div>
    <div class="mode-meta">
      <div class="row"><span class="lbl">Transit</span><span>${escapeHtml(q.transitDaysLabel)}</span></div>
      <div class="row"><span class="lbl">Chargeable</span><span>${q.chargeableWeightKg} kg</span></div>
      <div class="row"><span class="lbl">Distance</span><span>${q.distanceKm.toLocaleString('en-IE')} km</span></div>
      <div class="row"><span class="lbl">CO₂</span><span>${q.co2kg} kg</span></div>
      <div class="row"><span class="lbl">CO₂ rate</span><span>${q.co2gramsPerTkm} g/tkm</span></div>
    </div>
    <div class="mode-formula">${escapeHtml(q.formula)}</div>
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
if (draft && draft.weightKg) {
  applyState(draft);
  recompute();
} else {
  recompute();
}
