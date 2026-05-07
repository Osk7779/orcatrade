// Insurance quote calculator. Live recalc on form input.

const API_ENDPOINT = '/api/insurance';
const STORAGE_KEY = 'orcatrade.insurance-quote.draft.v1';

const els = {
  form: document.getElementById('quote-form'),
  msg: document.getElementById('form-msg'),
  empty: document.getElementById('quote-empty'),
  content: document.getElementById('quote-content'),
  amount: document.getElementById('premium-amount'),
  rate: document.getElementById('premium-rate'),
  savings: document.getElementById('premium-savings'),
  calcRows: document.getElementById('calc-rows'),
  coverageLabel: document.getElementById('coverage-label'),
  coverageWhat: document.getElementById('coverage-what'),
  nextSteps: document.getElementById('next-steps'),
  snapshotDate: document.getElementById('snapshot-date'),
  coverageToggle: document.getElementById('coverage-toggle'),
  coverageInput: document.querySelector('input[name="coverage"]'),
  year: document.getElementById('year'),
};

if (els.year) els.year.textContent = new Date().getFullYear();

const SCENARIOS = {
  'cn-electronics': { cargoValueEur: 250000, transportMode: 'sea_fcl', goodsType: 'electronics', originCountry: 'CN', destinationCountry: 'DE', coverage: 'icc_a' },
  'vn-furniture': { cargoValueEur: 100000, transportMode: 'sea_fcl', goodsType: 'furniture', originCountry: 'VN', destinationCountry: 'PL', coverage: 'icc_a' },
  'in-textiles': { cargoValueEur: 60000, transportMode: 'sea_lcl', goodsType: 'textiles', originCountry: 'IN', destinationCountry: 'NL', coverage: 'icc_a' },
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
    if (el.type === 'number' && value !== '') {
      data[el.name] = Number(value);
    } else {
      data[el.name] = value;
    }
  });
  return data;
}

function applyState(state) {
  if (!state) return;
  Object.entries(state).forEach(([k, v]) => {
    const el = els.form.querySelector(`[name="${k}"]`);
    if (el) el.value = v;
  });
  // Sync the coverage toggle visual state
  if (state.coverage) {
    els.coverageToggle.querySelectorAll('button').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.coverage === state.coverage);
    });
  }
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
  if (!data.cargoValueEur || !data.transportMode) {
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
    const quote = await response.json();
    renderQuote(quote);
    els.msg.textContent = '';
  } catch (error) {
    els.msg.classList.add('error');
    els.msg.textContent = 'Network error: ' + (error.message || 'unknown');
  }
}

function renderQuote(quote) {
  els.empty.style.display = 'none';
  els.content.style.display = '';

  els.amount.textContent = fmtEur(quote.premium.eur);
  els.rate.textContent = `${quote.premium.ratePct.toFixed(4)}% of insured value` + (quote.premium.minPremiumApplied ? ' · minimum premium applied' : '');
  els.savings.innerHTML = `<b>${fmtEurPrecise(quote.retailComparison.savingsVsRetailEur)} below retail</b> — typical SME without group leverage pays <span style="opacity:0.7;">${fmtEurPrecise(quote.retailComparison.retailPremiumEur)}</span> (${quote.retailComparison.savingsPct}% savings).`;

  els.calcRows.innerHTML = `
    <div class="calc-row"><span>Cargo value</span><span>${fmtEur(quote.inputs.cargoValueEur)}</span></div>
    <div class="calc-row"><span>${escapeHtml(quote.calc.baseRatePct.label)}</span><span>${quote.calc.baseRatePct.value}%</span></div>
    <div class="calc-row"><span>${escapeHtml(quote.calc.goodsMultiplier.label)}</span><span>${quote.calc.goodsMultiplier.value}</span></div>
    <div class="calc-row"><span>${escapeHtml(quote.calc.routeMultiplier.label)}</span><span>${quote.calc.routeMultiplier.value}</span></div>
    <div class="calc-row"><span>${escapeHtml(quote.calc.coverageMultiplier.label)}</span><span>${quote.calc.coverageMultiplier.value}</span></div>
    <div class="calc-row formula"><span>${escapeHtml(quote.calc.formula)}</span><span>${fmtEurPrecise(quote.premium.eur)}</span></div>
    <div class="calc-row" style="opacity:0.65; font-size: 0.78rem;"><span>OrcaTrade commission (${quote.breakdown.commissionPct}%)</span><span>${fmtEurPrecise(quote.breakdown.orcaTradeCommissionEur)}</span></div>
    <div class="calc-row" style="opacity:0.65; font-size: 0.78rem;"><span>Net to underwriter</span><span>${fmtEurPrecise(quote.breakdown.netToInsurerEur)}</span></div>
  `;

  els.coverageLabel.textContent = quote.coverage.label;
  els.coverageWhat.textContent = quote.coverage.whatIsCovered;
  els.nextSteps.innerHTML = (quote.nextSteps || []).map(s => `<li>${escapeHtml(s)}</li>`).join('');
  els.snapshotDate.textContent = quote.asOf;
}

// Form events
els.form.addEventListener('input', scheduleRecompute);
els.form.addEventListener('change', scheduleRecompute);
els.form.addEventListener('submit', e => { e.preventDefault(); recompute(); });

// Coverage toggle
els.coverageToggle.querySelectorAll('button').forEach(btn => {
  btn.addEventListener('click', () => {
    els.coverageToggle.querySelectorAll('button').forEach(b => b.classList.toggle('active', b === btn));
    els.coverageInput.value = btn.dataset.coverage;
    scheduleRecompute();
  });
});

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
if (draft && draft.cargoValueEur) {
  applyState(draft);
  recompute();
} else {
  applyState({ transportMode: 'sea_fcl', goodsType: 'general', coverage: 'icc_a' });
}
