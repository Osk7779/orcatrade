// Import Plan Builder wizard.
// Multi-step form, client-side validation, single POST to /api/start,
// renders the resulting plan inline on the same page.
//
// Share-permalink behaviour: if the URL has `?p=<base64>`, the wizard is
// skipped — we decode the inputs, regenerate the plan against current
// pricing, and render it directly. See lib/utils/plan-codec.js for the
// canonical Node-side codec; the browser-side version below is kept in
// sync with that whitelist.

const TOTAL_STEPS = 6;

const SHARE_KEYS = [
  'productCategory', 'originCountry', 'destinationCountry',
  'customsValueEur', 'weightKg', 'linesCount', 'urgencyWeeks',
  'monthlyOrders', 'avgUnitsPerOrder', 'avgPalletsHeld', 'avgOrderWeightKg',
  'claimPreferential', 'hsCode', 'moq', 'targetFobUnitEur',
];

function encodeShareInputs(inputs) {
  const minimal = {};
  for (const k of SHARE_KEYS) {
    if (inputs[k] !== undefined && inputs[k] !== null && inputs[k] !== '') minimal[k] = inputs[k];
  }
  const json = JSON.stringify(minimal);
  const bytes = new TextEncoder().encode(json);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeShareInputs(b64url) {
  const padded = b64url.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64url.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const parsed = JSON.parse(new TextDecoder().decode(bytes));
  const safe = {};
  for (const k of SHARE_KEYS) if (parsed[k] !== undefined) safe[k] = parsed[k];
  return safe;
}

const els = {
  form: document.getElementById('wizard'),
  steps: document.querySelectorAll('.step'),
  progress: document.querySelectorAll('.progress-step'),
  backBtn: document.getElementById('backBtn'),
  nextBtn: document.getElementById('nextBtn'),
  submitBtn: document.getElementById('submitBtn'),
  globalErr: document.getElementById('globalErr'),
  result: document.getElementById('result'),
  hero: document.getElementById('hero'),
};

const state = { current: 1, submitting: false };

function showStep(n) {
  state.current = n;
  els.steps.forEach(s => s.classList.toggle('active', Number(s.dataset.step) === n));
  els.progress.forEach(p => p.classList.toggle('active', Number(p.dataset.step) <= n));
  els.backBtn.style.display = n === 1 ? 'none' : '';
  els.nextBtn.style.display = n === TOTAL_STEPS ? 'none' : '';
  els.submitBtn.style.display = n === TOTAL_STEPS ? '' : 'none';
  // Focus first input on step
  const first = els.steps[n - 1].querySelector('input,select');
  if (first) setTimeout(() => first.focus(), 60);
}

function clearErrors() {
  els.globalErr.style.display = 'none';
  els.globalErr.textContent = '';
  document.querySelectorAll('[data-err-for]').forEach(el => { el.textContent = ''; });
}

function setErr(field, msg) {
  const el = document.querySelector(`[data-err-for="${field}"]`);
  if (el) el.textContent = msg;
}

function validateStep(n) {
  clearErrors();
  let ok = true;
  if (n === 1) {
    const v = els.form.productCategory.value;
    if (!v) { setErr('productCategory', 'Pick a category to continue'); ok = false; }
  } else if (n === 2) {
    if (!els.form.originCountry.value) { setErr('originCountry', 'Pick an origin'); ok = false; }
  } else if (n === 3) {
    if (!els.form.destinationCountry.value) { setErr('destinationCountry', 'Pick an EU destination'); ok = false; }
  } else if (n === 4) {
    const v = Number(els.form.customsValueEur.value);
    if (!Number.isFinite(v) || v <= 0) { setErr('customsValueEur', 'Customs value must be > 0'); ok = false; }
    const w = Number(els.form.weightKg.value);
    if (!Number.isFinite(w) || w <= 0) { setErr('weightKg', 'Weight must be > 0'); ok = false; }
  } else if (n === 6) {
    const e = els.form.email.value.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) { setErr('email', 'Enter a valid email'); ok = false; }
  }
  return ok;
}

function readForm() {
  const fd = new FormData(els.form);
  const out = {};
  for (const [k, v] of fd.entries()) {
    if (v === '') continue;
    out[k] = v;
  }
  // Numeric coercion for known fields
  ['customsValueEur', 'weightKg', 'linesCount', 'urgencyWeeks', 'monthlyOrders', 'avgUnitsPerOrder', 'avgPalletsHeld', 'avgOrderWeightKg'].forEach(k => {
    if (out[k] !== undefined) out[k] = Number(out[k]);
  });
  out.claimPreferential = out.claimPreferential === 'true';
  return out;
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = String(s == null ? '' : s);
  return d.innerHTML;
}

function fmtEur(value, decimals = 0) {
  if (value == null || !Number.isFinite(Number(value))) return '€0';
  return new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', maximumFractionDigits: decimals }).format(Number(value));
}

function renderPlan(plan) {
  const { sourcing, routing, customs, warehouse, totals, inputs } = plan;

  const sourcingPrimary = sourcing?.recommendation?.primary;
  const sourcingMatchesOrigin = sourcingPrimary === inputs.originCountry;

  const routingPrimary = routing?.recommendation?.primary;
  const routingQuote = routing?.recommendedQuote;

  const clearancePrimary = customs?.recommendation?.primary;
  const clearanceLabel = clearancePrimary === 'standard_clearance' ? 'Standard clearance' : 'Bonded warehouse';

  let sourcingNote = '';
  if (sourcingMatchesOrigin) {
    sourcingNote = `<p>Your chosen origin (${escapeHtml(inputs.originCountry)}) is the recommended sourcing country for this category and brief — proceed with confidence.</p>`;
  } else {
    sourcingNote = `<p>The Sourcing Agent flagged <strong>${escapeHtml(sourcingPrimary)}</strong> as the better option vs your selected ${escapeHtml(inputs.originCountry)}. Worth a comparison conversation before signing your first PO.</p>`;
  }

  const sourcingReasoning = sourcing?.recommendation?.reasoning ? `<div class="verdict-line">${escapeHtml(sourcing.recommendation.reasoning)}</div>` : '';

  const ordTransitDays = routingQuote?.transitDaysLabel || '—';
  const co2Kg = routingQuote?.co2kg ? `${routingQuote.co2kg} kg CO₂` : '';
  const railHint = routingPrimary === 'rail' ? '<p class="secondary-note">Rail wins on this corridor: 10–15 days faster than sea, ~70% cheaper than air, ~95% lower CO₂. Most forwarders never propose it.</p>' : '';

  const dutyPct = customs?.duty?.ratePercent != null ? `${customs.duty.ratePercent.toFixed(2)}%` : '—';
  const vatPct = customs?.vat?.ratePercent != null ? `${customs.vat.ratePercent.toFixed(1)}%` : '—';
  const originNotes = (customs?.duty?.originNotes && customs.duty.originNotes.length)
    ? `<p class="secondary-note"><strong>Origin overlay:</strong> ${customs.duty.originNotes.map(n => escapeHtml(n)).join(' · ')}</p>` : '';

  const warehouseSection = warehouse && !warehouse.skipped && warehouse.recommendedHub ? `
    <div class="result-section">
      <h3>Warehouse · 3PL hub</h3>
      <div class="verdict-line">${escapeHtml(warehouse.recommendation.rationale)}</div>
      <p>Recommended hub: <strong>${escapeHtml(warehouse.recommendedHub.hubName)}</strong> (${escapeHtml(warehouse.recommendedHub.hubCountryName)}). Total monthly cost <strong>${fmtEur(warehouse.recommendedHub.totalMonthlyEur)}</strong> at ${fmtEur(warehouse.recommendedHub.costPerOrderEur, 2)}/order. Onward transit to ${escapeHtml(inputs.destinationCountry)}: ${escapeHtml(warehouse.recommendedHub.transitToDestination)}.</p>
    </div>
  ` : '';

  els.hero.style.display = 'none';
  document.getElementById('progress').style.display = 'none';
  els.form.style.display = 'none';

  els.result.classList.add('active');
  els.result.innerHTML = `
    <div class="result-hero">
      <h2>Your plan is ready.</h2>
      <p>${plan.email?.sent ? 'A copy has been sent to your inbox.' : 'Below is the structured plan. Save the page or screenshot — email delivery was unavailable.'}</p>
    </div>

    <div class="result-stats">
      <div class="result-stat"><div class="num">${fmtEur(totals.transportEur)}</div><div class="label">Transport · per shipment</div></div>
      <div class="result-stat"><div class="num">${fmtEur(totals.dutyEur + totals.vatEur + totals.brokerageEur)}</div><div class="label">Duty + VAT + brokerage</div></div>
      <div class="result-stat"><div class="num">${fmtEur(totals.perShipmentLandedTotal)}</div><div class="label">Total landed cost</div></div>
      <div class="result-stat"><div class="num">${totals.warehouseMonthlyEur ? fmtEur(totals.warehouseMonthlyEur) : '—'}</div><div class="label">3PL · per month</div></div>
    </div>

    <div class="result-section">
      <h3>Sourcing</h3>
      ${sourcingReasoning}
      ${sourcingNote}
    </div>

    <div class="result-section">
      <h3>Transport · ${escapeHtml((routingPrimary || '').replace('_', ' ').toUpperCase())}</h3>
      ${routingQuote ? `<p>${escapeHtml(routingQuote.label)}: <strong>${fmtEur(routingQuote.totalEur)}</strong> · transit ${escapeHtml(ordTransitDays)} · ${co2Kg}</p>` : ''}
      ${railHint}
    </div>

    <div class="result-section">
      <h3>Customs · ${escapeHtml(clearanceLabel)}</h3>
      <p>HS chapter ${escapeHtml(inputs.hsCode)}${customs?.hsChapterLabel ? ' · ' + escapeHtml(customs.hsChapterLabel) : ''} · MFN duty rate <strong>${dutyPct}</strong> · ${escapeHtml(customs?.vat?.country || '')} VAT <strong>${vatPct}</strong></p>
      <table class="breakdown-table">
        <tr><td>Customs value (CIF)</td><td>${fmtEur(totals.customsValueEur)}</td></tr>
        <tr><td>Import duty (${dutyPct} on customs value)</td><td>${fmtEur(totals.dutyEur)}</td></tr>
        <tr><td>Import VAT (${vatPct} on customs value + duty)</td><td>${fmtEur(totals.vatEur)}</td></tr>
        <tr><td>Brokerage</td><td>${fmtEur(totals.brokerageEur)}</td></tr>
        <tr><td>Transport</td><td>${fmtEur(totals.transportEur)}</td></tr>
        <tr class="total"><td>Per-shipment landed total</td><td>${fmtEur(totals.perShipmentLandedTotal)}</td></tr>
      </table>
      ${originNotes}
    </div>

    ${warehouseSection}

    <div class="result-section">
      <h3>Where to go from here</h3>
      <p>You've got the headline numbers. Take any of them deeper through the agent suite — every recommendation traces back to the same calculator-grounded data, so the agents won't surprise you with new figures.</p>
      <div class="agent-cta-grid">
        <a class="agent-cta-card" href="/agent/orchestrator/?prompt=${encodeURIComponent(`I'm importing ${inputs.productCategory} from ${inputs.originCountry} to ${inputs.destinationCountry}, customs value €${inputs.customsValueEur}, weight ${inputs.weightKg}kg. Walk me through the full plan including any compliance overlays.`)}">
          <div class="ac-tag">Orchestrator</div>
          <h4>Refine across all domains</h4>
          <p>One agent, every specialty. Cross-domain Q&A on this plan.</p>
        </a>
        <a class="agent-cta-card" href="/agent/sourcing/?prompt=${encodeURIComponent(`I'm sourcing ${inputs.productCategory} from ${inputs.originCountry}. Compare against alternative origins on cost, lead time, IP risk.`)}">
          <div class="ac-tag">Sourcing</div>
          <h4>Compare alternative origins</h4>
          <p>Quality, IP, MOQ, lead time across CN/VN/IN/BD/TR.</p>
        </a>
        <a class="agent-cta-card" href="/agent/logistics/?prompt=${encodeURIComponent(`Compose the full shipment plan for ${inputs.weightKg}kg of ${inputs.productCategory} from ${inputs.originCountry} to ${inputs.destinationCountry}, customs value €${inputs.customsValueEur}.`)}">
          <div class="ac-tag">Logistics</div>
          <h4>Drill into mode + bonded</h4>
          <p>Sea/rail/air comparison, customs scenarios, 3PL hub.</p>
        </a>
      </div>
    </div>

    <div class="result-section">
      <h3>Share this plan</h3>
      <p>Send this URL to a colleague, supplier, or your finance team. The plan stays linked to live pricing — they'll see fresh duty rates and freight numbers if our calculators update.</p>
      <div class="share-row">
        <input class="share-url" id="shareUrl" readonly value="${escapeHtml(buildShareUrl(inputs))}">
        <button class="btn btn-primary" type="button" id="copyShareBtn">Copy link</button>
      </div>
    </div>

    <div class="result-section" style="text-align: center;">
      <a class="btn btn-primary" href="/start/" style="margin-right: 0.6rem;">Run another plan</a>
      <a class="btn" href="/guides/">Browse 351 guides</a>
    </div>
  `;

  const copyBtn = document.getElementById('copyShareBtn');
  const shareInput = document.getElementById('shareUrl');
  if (copyBtn && shareInput) {
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(shareInput.value);
        copyBtn.textContent = 'Copied ✓';
        setTimeout(() => { copyBtn.textContent = 'Copy link'; }, 2000);
      } catch (_) {
        shareInput.select();
        document.execCommand('copy');
        copyBtn.textContent = 'Copied ✓';
        setTimeout(() => { copyBtn.textContent = 'Copy link'; }, 2000);
      }
    });
  }
}

function buildShareUrl(inputs) {
  const encoded = encodeShareInputs(inputs);
  return `${window.location.origin}/start/?p=${encoded}`;
}

async function submitPlan() {
  if (state.submitting) return;
  if (!validateStep(6)) return;

  state.submitting = true;
  els.submitBtn.disabled = true;
  els.submitBtn.textContent = 'Building your plan…';
  clearErrors();

  try {
    const data = readForm();
    const response = await fetch('/api/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      const msg = (errBody.errors && errBody.errors.join('; ')) || errBody.error || `Server returned ${response.status}`;
      els.globalErr.textContent = msg;
      els.globalErr.style.display = '';
      els.submitBtn.disabled = false;
      els.submitBtn.textContent = 'Build my plan →';
      state.submitting = false;
      return;
    }
    const json = await response.json();
    if (json.ok && json.plan) {
      renderPlan({ ...json.plan, email: json.email });
      // Scroll to top of result
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      els.globalErr.textContent = 'Plan generation failed. Please try again or contact us.';
      els.globalErr.style.display = '';
      els.submitBtn.disabled = false;
      els.submitBtn.textContent = 'Build my plan →';
      state.submitting = false;
    }
  } catch (err) {
    els.globalErr.textContent = `Network error: ${err.message || 'unknown'}`;
    els.globalErr.style.display = '';
    els.submitBtn.disabled = false;
    els.submitBtn.textContent = 'Build my plan →';
    state.submitting = false;
  }
}

els.nextBtn.addEventListener('click', () => {
  if (validateStep(state.current)) showStep(state.current + 1);
});
els.backBtn.addEventListener('click', () => {
  if (state.current > 1) showStep(state.current - 1);
});
els.form.addEventListener('submit', e => {
  e.preventDefault();
  submitPlan();
});

// Allow Enter to advance (except in textarea)
els.form.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
    if (state.current < TOTAL_STEPS) {
      e.preventDefault();
      if (validateStep(state.current)) showStep(state.current + 1);
    }
  }
});

async function loadFromShareUrl(b64url) {
  els.hero.style.display = 'none';
  document.getElementById('progress').style.display = 'none';
  els.form.style.display = 'none';
  els.result.classList.add('active');
  els.result.innerHTML = '<div class="result-hero"><h2>Loading shared plan…</h2><p>Recomputing against current pricing.</p></div>';

  try {
    const inputs = decodeShareInputs(b64url);
    const response = await fetch('/api/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(inputs),
    });
    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      throw new Error((errBody.errors && errBody.errors.join('; ')) || errBody.error || `Server returned ${response.status}`);
    }
    const json = await response.json();
    if (!json.ok || !json.plan) throw new Error('Plan generation failed');
    renderPlan({ ...json.plan, email: { sent: false, reason: 'shared-plan-view' } });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (err) {
    els.result.innerHTML = `
      <div class="result-hero">
        <h2>This shared link couldn't be loaded.</h2>
        <p>${escapeHtml(err.message || 'Unknown error')}.</p>
        <p><a class="btn btn-primary" href="/start/">Build a new plan</a></p>
      </div>`;
  }
}

const sharedPlanParam = new URLSearchParams(window.location.search).get('p');
if (sharedPlanParam) {
  loadFromShareUrl(sharedPlanParam);
} else {
  showStep(1);
}
