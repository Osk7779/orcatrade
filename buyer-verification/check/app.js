// Buyer check form. Submit → POST /api/buyer-verification → render verdict + profile.

const API_ENDPOINT = '/api/buyer-verification';

const els = {
  form: document.getElementById('check-form'),
  msg: document.getElementById('form-msg'),
  empty: document.getElementById('check-empty'),
  content: document.getElementById('check-content'),
  verdictDisplay: document.getElementById('verdict-display'),
  verdictBand: document.getElementById('verdict-band'),
  verdictHeadline: document.getElementById('verdict-headline'),
  profileGrid: document.getElementById('profile-grid'),
  signalsBlock: document.getElementById('signals-block'),
  signalsList: document.getElementById('signals-list'),
  flagsBlock: document.getElementById('flags-block'),
  flagsList: document.getElementById('flags-list'),
  nextStepsList: document.getElementById('next-steps-list'),
  disclaimer: document.getElementById('disclaimer'),
  year: document.getElementById('year'),
};

if (els.year) els.year.textContent = new Date().getFullYear();

const SCENARIOS = {
  mediamarkt: { companyName: 'MediaMarkt Saturn', country: 'DE' },
  allegro: { companyName: 'Allegro.eu', country: 'PL' },
  ikea: { companyName: 'IKEA Ingka', country: 'NL' },
  unknown: { companyName: 'Eurotech Components Sp. z o.o.', country: 'PL', registryId: 'KRS 0000345678' },
};

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = String(text == null ? '' : text);
  return div.innerHTML;
}

function readForm() {
  const data = {};
  els.form.querySelectorAll('input[name]').forEach(el => { data[el.name] = el.value.trim(); });
  return data;
}

function applyState(state) {
  Object.entries(state).forEach(([k, v]) => {
    const el = els.form.querySelector(`[name="${k}"]`);
    if (el) el.value = v == null ? '' : v;
  });
}

async function submitCheck() {
  const data = readForm();
  if (!data.companyName) {
    els.msg.classList.add('error');
    els.msg.textContent = 'Buyer company name is required.';
    return;
  }
  els.msg.classList.remove('error');
  els.msg.textContent = 'Checking…';

  try {
    const response = await fetch(API_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      els.msg.classList.add('error');
      const errors = Array.isArray(err.errors) ? err.errors : [err.error || 'Unknown server error'];
      els.msg.innerHTML = '<b>Could not check buyer:</b><ul>' + errors.map(e => `<li>${escapeHtml(e)}</li>`).join('') + '</ul>';
      return;
    }
    const result = await response.json();
    renderResult(result);
    els.msg.textContent = '';
  } catch (error) {
    els.msg.classList.add('error');
    els.msg.textContent = 'Network error: ' + (error.message || 'unknown');
  }
}

function renderResult(result) {
  els.empty.style.display = 'none';
  els.content.style.display = '';

  const profile = result.profile;
  const verdict = result.verdict;

  // Verdict block
  els.verdictDisplay.classList.remove('acceptable', 'require_security', 'decline', 'verify_required');
  els.verdictDisplay.classList.add(verdict.recommendation);
  els.verdictBand.classList.remove('low', 'medium', 'high', 'unknown');
  els.verdictBand.classList.add(verdict.creditBand || 'unknown');
  els.verdictBand.textContent = `${verdict.creditBand} risk · ${verdict.matchType === 'known' ? 'verified' : 'pre-check'}`;
  els.verdictHeadline.textContent = verdict.headline;

  // Profile grid
  const cells = [];
  if (profile.legalName) cells.push(['Legal name', escapeHtml(profile.legalName), true]);
  if (profile.country) cells.push(['Country', escapeHtml(profile.country)]);
  if (profile.registry) cells.push(['Registry', escapeHtml(profile.registry)]);
  if (profile.registryId) cells.push(['Registry ID', escapeHtml(profile.registryId)]);
  if (profile.yearsInOperation != null) cells.push(['Years in operation', escapeHtml(profile.yearsInOperation + ' years')]);
  if (profile.employeeCountBand) cells.push(['Employees', escapeHtml(profile.employeeCountBand)]);
  if (profile.turnoverBandEur) cells.push(['Turnover', escapeHtml(profile.turnoverBandEur)]);
  if (profile.tradeCreditCapEur != null) {
    cells.push(['Recommended cap', profile.tradeCreditCapEur > 0 ? '€' + profile.tradeCreditCapEur.toLocaleString('en-IE') : 'N/A — verify first']);
  }
  if (profile.securitySuggestion) cells.push(['Security', escapeHtml(profile.securitySuggestion), true]);
  els.profileGrid.innerHTML = cells.map(([label, value, fullWidth]) =>
    `<div class="profile-cell" ${fullWidth ? 'style="grid-column: 1 / -1;"' : ''}>
      <span class="profile-label">${escapeHtml(label)}</span>
      <span class="profile-value${label === 'Legal name' ? ' serif' : ''}">${value}</span>
    </div>`
  ).join('');

  if (profile.registryPublicUrl) {
    const linkCell = document.createElement('div');
    linkCell.className = 'profile-cell';
    linkCell.style.gridColumn = '1 / -1';
    linkCell.innerHTML = `<a href="${escapeHtml(profile.registryPublicUrl)}" target="_blank" rel="noopener" class="registry-link">Open ${escapeHtml(profile.registry)} →</a>`;
    els.profileGrid.appendChild(linkCell);
  }

  // Signals
  if (Array.isArray(profile.publicSignals) && profile.publicSignals.length) {
    els.signalsBlock.style.display = '';
    els.signalsList.innerHTML = profile.publicSignals.map(s => `<li>${escapeHtml(s)}</li>`).join('');
  } else {
    els.signalsBlock.style.display = 'none';
  }

  // Flags
  if (Array.isArray(profile.flags) && profile.flags.length) {
    els.flagsBlock.style.display = '';
    els.flagsList.innerHTML = profile.flags.map(s => `<li>${escapeHtml(s)}</li>`).join('');
  } else {
    els.flagsBlock.style.display = 'none';
  }

  // Next steps
  els.nextStepsList.innerHTML = (result.nextSteps || []).map(s => `<li>${escapeHtml(s)}</li>`).join('');

  // Disclaimer
  els.disclaimer.textContent = result.disclaimer || '';
}

els.form.addEventListener('submit', e => { e.preventDefault(); submitCheck(); });

document.querySelectorAll('.scenario-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const scenario = SCENARIOS[btn.dataset.scenario];
    if (!scenario) return;
    applyState(scenario);
    submitCheck();
  });
});
