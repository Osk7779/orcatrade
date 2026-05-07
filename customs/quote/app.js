// Customs & bonded comparison calculator. Live recalc on form input.

const API_ENDPOINT = '/api/customs';
const STORAGE_KEY = 'orcatrade.customs-quote.draft.v1';

const els = {
  form: document.getElementById('customs-form'),
  msg: document.getElementById('form-msg'),
  empty: document.getElementById('quote-empty'),
  content: document.getElementById('quote-content'),
  recVerdict: document.getElementById('rec-verdict'),
  recReasoning: document.getElementById('rec-reasoning'),
  dutySummary: document.getElementById('duty-summary'),
  originNotes: document.getElementById('origin-notes'),
  scenariosGrid: document.getElementById('scenarios-grid'),
  eduWhat: document.getElementById('edu-what'),
  eduHelps: document.getElementById('edu-helps'),
  eduDoesnt: document.getElementById('edu-doesnt'),
  eduMix: document.getElementById('edu-mix'),
  nextSteps: document.getElementById('next-steps-list'),
  year: document.getElementById('year'),
};

if (els.year) els.year.textContent = new Date().getFullYear();

const SCENARIOS = {
  'apparel-cn-de': { customsValueEur: 25000, hsCode: '6203', originCountry: 'CN', destinationCountry: 'DE', linesCount: 4, bondedDays: 0, bondedVolumeCbm: 1, releaseStrategy: 'free_circulation', claimPreferential: false },
  'furniture-vn-fr-pref': { customsValueEur: 40000, hsCode: '94', originCountry: 'VN', destinationCountry: 'FR', linesCount: 6, bondedDays: 0, bondedVolumeCbm: 1, releaseStrategy: 'free_circulation', claimPreferential: true },
  'electronics-cn-pl-bonded': { customsValueEur: 80000, hsCode: '85', originCountry: 'CN', destinationCountry: 'PL', linesCount: 8, bondedDays: 180, bondedVolumeCbm: 25, releaseStrategy: 'free_circulation', claimPreferential: false },
  'samples-reexport': { customsValueEur: 15000, hsCode: '95', originCountry: 'CN', destinationCountry: 'NL', linesCount: 3, bondedDays: 30, bondedVolumeCbm: 4, releaseStrategy: 're_export', claimPreferential: false },
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
    const value = el.value;
    if (el.type === 'checkbox') data[el.name] = el.checked;
    else if (el.type === 'number' && value !== '') data[el.name] = Number(value);
    else if (el.type === 'number') data[el.name] = null;
    else data[el.name] = value;
  });
  return data;
}

function applyState(state) {
  Object.entries(state).forEach(([k, v]) => {
    const el = els.form.querySelector(`[name="${k}"]`);
    if (!el) return;
    if (el.type === 'checkbox') el.checked = !!v;
    else el.value = v == null ? '' : v;
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
  if (!data.customsValueEur || !data.hsCode || !data.destinationCountry) {
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

  const standard = quote.quotes.find(q => q.routeKey === 'standard_clearance');
  const bonded = quote.quotes.find(q => q.routeKey === 'bonded_warehouse');
  const recCard = quote.recommendation.primary === 'standard_clearance' ? standard : bonded;
  els.recVerdict.textContent = recCard ? recCard.label : 'No recommendation';
  els.recReasoning.textContent = quote.recommendation.reasoning;

  els.dutySummary.innerHTML = `
    <div class="row"><span class="lbl">HS chapter</span><span class="val">${escapeHtml(quote.inputs.hsChapter)} — ${escapeHtml(quote.inputs.hsChapterLabel)}</span></div>
    <div class="row"><span class="lbl">Origin</span><span class="val">${escapeHtml(quote.inputs.originName)}</span></div>
    <div class="row"><span class="lbl">Destination</span><span class="val">${escapeHtml(quote.inputs.destinationCountryName)} (${escapeHtml(quote.inputs.destinationCountry)})</span></div>
    <div class="row"><span class="lbl">Effective duty rate</span><span class="val">${quote.duty.ratePercent.toFixed(2)}%</span></div>
    <div class="row"><span class="lbl">Import VAT</span><span class="val">${quote.vat.ratePercent.toFixed(1)}%</span></div>
  `;

  if (quote.duty.originNotes && quote.duty.originNotes.length) {
    els.originNotes.style.display = '';
    els.originNotes.innerHTML = '<b>Origin notes:</b><ul>' + quote.duty.originNotes.map(n => `<li>${escapeHtml(n)}</li>`).join('') + '</ul>';
  } else {
    els.originNotes.style.display = 'none';
  }

  els.scenariosGrid.innerHTML = quote.quotes.map(q => renderScenario(q, quote.recommendation.primary)).join('');

  els.eduWhat.innerHTML = '<b>What it is:</b> ' + escapeHtml(quote.bondedEducation.whatItIs);
  els.eduHelps.innerHTML = '<b>When it helps:</b> ' + escapeHtml(quote.bondedEducation.whenItHelps);
  els.eduDoesnt.innerHTML = '<b>When it doesn\'t:</b> ' + escapeHtml(quote.bondedEducation.whenItDoesntHelp);
  els.eduMix.innerHTML = '<b>Typical mix:</b> ' + escapeHtml(quote.bondedEducation.typicalMix);

  els.nextSteps.innerHTML = (quote.nextSteps || []).map(s => `<li>${escapeHtml(s)}</li>`).join('');
}

function renderScenario(q, recommendedRouteKey) {
  if (q.unavailable) {
    return `<article class="scenario-card unavailable">
      <div class="tag">Not configured</div>
      <h3>${escapeHtml(q.label)}</h3>
      <div class="unavailable-text">${escapeHtml(q.reason || 'Not configured for this scenario.')}</div>
    </article>`;
  }
  const isRecommended = q.routeKey === recommendedRouteKey;
  const total = q.routeKey === 'standard_clearance' ? q.totalEur : q.totalCashOutEur;
  const totalLabel = q.routeKey === 'standard_clearance' ? 'Total cash out (incl. duty + VAT)' : 'Total cash out (incl. duty + VAT due)';
  const breakdownRows = (q.breakdown || []).map(b => {
    const isNeg = b.eur < 0;
    return `<div class="row"><span class="lbl ${isNeg ? 'neg' : ''}">${escapeHtml(b.label)}</span><span class="val ${isNeg ? 'neg' : ''}">${fmtEurDecimals(b.eur)}</span></div>`;
  }).join('');
  return `<article class="scenario-card ${isRecommended ? 'recommended' : ''}">
    <div class="tag ${isRecommended ? 'recommended' : ''}">${isRecommended ? 'Recommended' : (q.routeKey === 'standard_clearance' ? 'Standard' : 'Bonded')}</div>
    <h3>${escapeHtml(q.label)}</h3>
    <div class="total">${fmtEur(total)}<span class="label">${escapeHtml(totalLabel)}</span></div>
    ${q.releaseLabel ? `<div class="release-label">${escapeHtml(q.releaseLabel)}</div>` : ''}
    <div class="breakdown">${breakdownRows}</div>
    <div class="best-for">${escapeHtml(q.bestFor || '')}</div>
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
if (draft && draft.customsValueEur) {
  applyState(draft);
  recompute();
} else {
  recompute();
}
