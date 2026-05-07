// Sample request quote calculator. Live recalc on form input.

const API_ENDPOINT = '/api/samples';
const STORAGE_KEY = 'orcatrade.sample-request.draft.v1';

const els = {
  form: document.getElementById('sample-form'),
  msg: document.getElementById('form-msg'),
  empty: document.getElementById('quote-empty'),
  content: document.getElementById('quote-content'),
  total: document.getElementById('total-amount'),
  timeline: document.getElementById('total-timeline'),
  rows: document.getElementById('breakdown-rows'),
  inclusions: document.getElementById('inclusions-list'),
  exclusions: document.getElementById('exclusions-list'),
  nextSteps: document.getElementById('next-steps-list'),
  rushToggle: document.getElementById('rush-toggle'),
  expressToggle: document.getElementById('express-toggle'),
  rushInput: document.querySelector('input[name="rushTurnaround"]'),
  expressInput: document.querySelector('input[name="express"]'),
  year: document.getElementById('year'),
};

if (els.year) els.year.textContent = new Date().getFullYear();

const SCENARIOS = {
  '3-pl': { supplierCount: 3, totalWeightKg: 2, destinationCountry: 'PL', rushTurnaround: false, express: false },
  '5-de': { supplierCount: 5, totalWeightKg: 8, destinationCountry: 'DE', rushTurnaround: false, express: false },
  'rush-de': { supplierCount: 5, totalWeightKg: 8, destinationCountry: 'DE', rushTurnaround: true, express: true },
};

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = String(text == null ? '' : text);
  return div.innerHTML;
}

function fmtEur(value) {
  if (value == null || Number.isNaN(Number(value))) return '€0';
  return new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }).format(Number(value));
}

function readForm() {
  const data = {};
  els.form.querySelectorAll('input[name]').forEach(el => {
    const value = el.value;
    if (el.type === 'number' && value !== '') data[el.name] = Number(value);
    else if (el.name === 'rushTurnaround' || el.name === 'express') data[el.name] = value === 'true';
    else data[el.name] = value;
  });
  return data;
}

function applyState(state) {
  Object.entries(state).forEach(([k, v]) => {
    const el = els.form.querySelector(`[name="${k}"]`);
    if (el) {
      if (k === 'rushTurnaround' || k === 'express') {
        el.value = String(Boolean(v));
        if (k === 'rushTurnaround') els.rushToggle.classList.toggle('active', Boolean(v));
        if (k === 'express') els.expressToggle.classList.toggle('active', Boolean(v));
      } else {
        el.value = v == null ? '' : v;
      }
    }
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
  if (!data.supplierCount || !data.destinationCountry) {
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

  const b = quote.breakdown;
  els.total.textContent = fmtEur(b.totalEur);
  els.timeline.textContent = `${quote.timeline.totalEstimate} · ${quote.timeline.consolidation} → ${quote.timeline.transit} courier`;

  const rows = [];
  rows.push(`<div class="breakdown-row"><span>${escapeHtml(b.consolidationFee.label)}<br/><span class="formula">${escapeHtml(b.consolidationFee.formula)}</span></span><span>${fmtEur(b.consolidationFee.eur)}</span></div>`);
  rows.push(`<div class="breakdown-row"><span>${escapeHtml(b.shipping.label)}<br/><span class="formula">${escapeHtml(b.shipping.formula)}</span></span><span>${fmtEur(b.shipping.eur)}</span></div>`);
  if (b.expressSurcharge) {
    rows.push(`<div class="breakdown-row"><span>${escapeHtml(b.expressSurcharge.label)}</span><span>${fmtEur(b.expressSurcharge.eur)}</span></div>`);
  }
  if (b.rushSurcharge) {
    rows.push(`<div class="breakdown-row"><span>${escapeHtml(b.rushSurcharge.label)}</span><span>${fmtEur(b.rushSurcharge.eur)}</span></div>`);
  }
  rows.push(`<div class="breakdown-row total"><span>Total · all-in</span><span>${fmtEur(b.totalEur)}</span></div>`);
  els.rows.innerHTML = rows.join('');

  els.inclusions.innerHTML = (quote.inclusions || []).map(i => `<li>${escapeHtml(i)}</li>`).join('');
  els.exclusions.innerHTML = (quote.exclusions || []).map(i => `<li>${escapeHtml(i)}</li>`).join('');
  els.nextSteps.innerHTML = (quote.nextSteps || []).map(s => `<li>${escapeHtml(s)}</li>`).join('');
}

// Form events
els.form.addEventListener('input', scheduleRecompute);
els.form.addEventListener('submit', e => { e.preventDefault(); recompute(); });

// Toggles
els.rushToggle.addEventListener('click', () => {
  const next = els.rushInput.value !== 'true';
  els.rushInput.value = String(next);
  els.rushToggle.classList.toggle('active', next);
  scheduleRecompute();
});
els.expressToggle.addEventListener('click', () => {
  const next = els.expressInput.value !== 'true';
  els.expressInput.value = String(next);
  els.expressToggle.classList.toggle('active', next);
  scheduleRecompute();
});

// Set initial toggle state to inactive (clear default-active classes)
els.rushToggle.classList.remove('active');
els.expressToggle.classList.remove('active');

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
if (draft && draft.supplierCount) {
  applyState(draft);
  recompute();
} else {
  recompute();
}
