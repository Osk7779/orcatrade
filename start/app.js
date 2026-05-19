// Import Plan Builder wizard.
// Multi-step form, client-side validation, single POST to /api/start,
// renders the resulting plan inline on the same page.
//
// Locale is set by each locale's index.html (window.LOCALE = 'en' | 'pl' | 'de').
// Strings come from window.START_I18N — see start/i18n.js for the catalogue.
//
// Share-permalink behaviour: if the URL has `?p=<base64>`, the wizard is
// skipped — we decode the inputs, regenerate the plan against current
// pricing, and render it directly.

const LOCALE = (window.LOCALE && window.START_I18N[window.LOCALE]) ? window.LOCALE : 'en';
const T = window.START_I18N[LOCALE];

const TOTAL_STEPS = 6;

const SHARE_KEYS = [
  'productCategory', 'originCountry', 'destinationCountry',
  'customsValueEur', 'weightKg', 'linesCount', 'urgencyWeeks',
  'monthlyOrders', 'avgUnitsPerOrder', 'avgPalletsHeld', 'avgOrderWeightKg',
  'claimPreferential', 'hsCode', 'moq', 'targetFobUnitEur',
  'quoteCurrency', 'paymentTermsDays',
  'shipmentsPerYear', 'waccPct', 'daysInInventory', 'daysReceivable',
];

// Sprint AH: client-side currency toggle. Mirror of lib/intelligence/data/fx-snapshot.js
// for the 5 currencies an EU SME importer most commonly wants to see numbers in.
// Snapshot rates — refresh quarterly. The asOf date surfaces in the toggle UI.
const FX_DISPLAY = {
  asOf: '2026-05-08',
  // 1 EUR = X foreign
  rates: { EUR: 1.0, USD: 1.08, CNY: 7.85, VND: 26300, PLN: 4.30 },
  symbols: { EUR: '€', USD: '$', CNY: '¥', VND: '₫', PLN: 'zł' },
  // Currencies that round to whole units in display (low-precision)
  zeroDp: new Set(['VND']),
};
const CURRENCY_PREF_KEY = 'orcatrade.start.displayCurrency';

function getCurrencyPreference() {
  try {
    const v = localStorage.getItem(CURRENCY_PREF_KEY);
    return FX_DISPLAY.rates[v] ? v : 'EUR';
  } catch (_e) { return 'EUR'; }
}
function setCurrencyPreference(code) {
  try { localStorage.setItem(CURRENCY_PREF_KEY, code); } catch (_e) {}
}

function formatInCurrency(eurAmount, currencyCode, decimalsHint) {
  const rate = FX_DISPLAY.rates[currencyCode];
  if (rate == null) return null;
  const value = Number(eurAmount) * rate;
  if (!Number.isFinite(value)) return null;
  const symbol = FX_DISPLAY.symbols[currencyCode] || currencyCode;
  // Force 0 dp for low-precision currencies regardless of the original EUR
  // decimals hint (showing "₫27,500.00" reads worse than "₫27,500").
  const dp = FX_DISPLAY.zeroDp.has(currencyCode) ? 0 : Math.max(0, Math.min(2, Number(decimalsHint) || 0));
  const formatted = value.toLocaleString('en-IE', { maximumFractionDigits: dp, minimumFractionDigits: dp });
  // EUR uses native Intl rendering (matches fmtEur output). All others:
  // symbol prefix for €/$/¥/zł, suffix for ₫ to match local convention.
  if (currencyCode === 'EUR') return symbol + formatted;
  if (currencyCode === 'VND') return formatted + ' ' + symbol;
  if (currencyCode === 'PLN') return formatted + ' ' + symbol;
  return symbol + formatted;
}

function applyDisplayCurrency(currencyCode, root = document) {
  const nodes = root.querySelectorAll('.amt[data-eur]');
  nodes.forEach(function (n) {
    const eur = n.getAttribute('data-eur');
    const dp = Number(n.getAttribute('data-decimals')) || 0;
    const formatted = formatInCurrency(eur, currencyCode, dp);
    if (formatted != null) n.textContent = formatted;
  });
  const banner = root.querySelector('#currency-asof-banner');
  if (banner) {
    banner.textContent = currencyCode === 'EUR'
      ? ''
      : 'Displayed in ' + currencyCode + ' at ' + FX_DISPLAY.asOf + ' snapshot rates · indicative only';
  }
}

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

const state = {
  current: 1,
  submitting: false,
  // Sprint AG: scenario toggle state — when the user clicks "re-run with
  // preferential claimed", we remember the original (baseline) inputs so
  // they can switch back. scenarioClaimed=true means the current view is
  // the "claimed" alternate, not the baseline.
  scenarioClaimed: false,
  baselineInputs: null,
};

function showStep(n) {
  state.current = n;
  els.steps.forEach(s => s.classList.toggle('active', Number(s.dataset.step) === n));
  els.progress.forEach(p => p.classList.toggle('active', Number(p.dataset.step) <= n));
  els.backBtn.style.display = n === 1 ? 'none' : '';
  els.nextBtn.style.display = n === TOTAL_STEPS ? 'none' : '';
  els.submitBtn.style.display = n === TOTAL_STEPS ? '' : 'none';
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
    if (!els.form.productCategory.value) { setErr('productCategory', T.errPickCategory); ok = false; }
  } else if (n === 2) {
    if (!els.form.originCountry.value) { setErr('originCountry', T.errPickOrigin); ok = false; }
  } else if (n === 3) {
    if (!els.form.destinationCountry.value) { setErr('destinationCountry', T.errPickDestination); ok = false; }
  } else if (n === 4) {
    const v = Number(els.form.customsValueEur.value);
    if (!Number.isFinite(v) || v <= 0) { setErr('customsValueEur', T.errCustomsValue); ok = false; }
    const w = Number(els.form.weightKg.value);
    if (!Number.isFinite(w) || w <= 0) { setErr('weightKg', T.errWeight); ok = false; }
  } else if (n === 6) {
    const e = els.form.email.value.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) { setErr('email', T.errEmail); ok = false; }
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
  ['customsValueEur', 'weightKg', 'linesCount', 'urgencyWeeks', 'monthlyOrders', 'avgUnitsPerOrder', 'avgPalletsHeld', 'avgOrderWeightKg', 'paymentTermsDays', 'shipmentsPerYear', 'waccPct', 'daysInInventory', 'daysReceivable'].forEach(k => {
    if (out[k] !== undefined) out[k] = Number(out[k]);
  });
  out.claimPreferential = out.claimPreferential === 'true';
  out.locale = LOCALE;
  return out;
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = String(s == null ? '' : s);
  return d.innerHTML;
}

// Sprint AH: each formatted EUR amount carries data-eur so the currency
// toggle can re-render in USD/CNY/VND/PLN without re-running composePlan.
// data-decimals is preserved so warehouse-cost-per-order keeps its 2dp.
function fmtEur(value, decimals = 0) {
  if (value == null || !Number.isFinite(Number(value))) {
    return '<span class="amt" data-eur="0" data-decimals="' + decimals + '">€0</span>';
  }
  const n = Number(value);
  const formatted = new Intl.NumberFormat(T.currencyLocale, { style: 'currency', currency: 'EUR', maximumFractionDigits: decimals }).format(n);
  return '<span class="amt" data-eur="' + n + '" data-decimals="' + decimals + '">' + formatted + '</span>';
}

// Sprint AI: turn the structured roadmap from composePlan into a phased
// task list. Each phase becomes a card; tasks are rendered as a 3-column
// table (when, action, owner) with optional deliverable/evidence chips.
function renderRoadmap(roadmap) {
  if (!roadmap || !roadmap.ok || !roadmap.phases || !roadmap.phases.length) return '';
  const phaseRows = roadmap.phases.filter(p => p.tasks && p.tasks.length).map(phase => {
    const taskRows = phase.tasks.map(t => `
      <tr>
        <td class="rm-when">${escapeHtml(t.when || '')}</td>
        <td class="rm-action">
          <div>${escapeHtml(t.action || '')}</div>
          ${t.deliverable ? `<div class="rm-deliverable">${escapeHtml(t.deliverable)}</div>` : ''}
          ${t.evidence ? `<div class="rm-evidence">${escapeHtml(t.evidence)}</div>` : ''}
        </td>
        <td class="rm-owner">${escapeHtml(t.owner || '')}</td>
      </tr>`).join('');
    const window = `T${phase.windowWeeks[0] >= 0 ? '+' : ''}${phase.windowWeeks[0]}w → T${phase.windowWeeks[1] >= 0 ? '+' : ''}${phase.windowWeeks[1]}w`;
    return `
      <div class="rm-phase">
        <div class="rm-phase-header">
          <span class="rm-phase-name">${escapeHtml(phase.name)}</span>
          <span class="rm-phase-window">${escapeHtml(window)}</span>
          <span class="rm-phase-count">${phase.tasks.length} ${phase.tasks.length === 1 ? T.roadmapTaskOne || 'task' : T.roadmapTaskMany || 'tasks'}</span>
        </div>
        <table class="rm-table">
          <tbody>${taskRows}</tbody>
        </table>
      </div>`;
  }).join('');
  return `
    <div class="result-section">
      <h3>${T.secRoadmap || 'Implementation roadmap'}</h3>
      <p>${T.roadmapBody || 'A week-by-week sequence to actually execute this plan. Conditional tasks (preferential origin, trade-defence surveillance, FX hedge, CBAM reporting) are added based on what your plan requires.'}</p>
      ${phaseRows}
      <div class="rm-meta">${T.roadmapTotalTasks || 'Total tasks'}: ${roadmap.tasksTotal}</div>
    </div>
  `;
}

function renderPlan(plan) {
  const { sourcing, routing, customs, warehouse, totals, inputs } = plan;

  const sourcingPrimary = sourcing?.recommendation?.primary;
  const sourcingMatchesOrigin = sourcingPrimary === inputs.originCountry;

  const routingPrimary = routing?.recommendation?.primary;
  const routingQuote = routing?.recommendedQuote;

  const clearancePrimary = customs?.recommendation?.primary;
  const clearanceLabel = clearancePrimary === 'standard_clearance' ? T.customsStandard : T.customsBonded;

  const sourcingNote = sourcingMatchesOrigin
    ? `<p>${T.sourcingMatchesOrigin(escapeHtml(inputs.originCountry))}</p>`
    : `<p>${T.sourcingFlaggedAlt(escapeHtml(sourcingPrimary), escapeHtml(inputs.originCountry))}</p>`;

  const sourcingReasoning = sourcing?.recommendation?.reasoning ? `<div class="verdict-line">${escapeHtml(sourcing.recommendation.reasoning)}</div>` : '';

  const transitDays = routingQuote?.transitDaysLabel || '—';
  const co2Kg = routingQuote?.co2kg ? `${routingQuote.co2kg} kg CO₂` : '';
  const railHint = routingPrimary === 'rail' ? `<p class="secondary-note">${T.railWins}</p>` : '';

  const dutyPct = customs?.duty?.ratePercent != null ? `${customs.duty.ratePercent.toFixed(2)}%` : '—';
  const vatPct = customs?.vat?.ratePercent != null ? `${customs.vat.ratePercent.toFixed(1)}%` : '—';
  const originNotes = (customs?.duty?.originNotes && customs.duty.originNotes.length)
    ? `<p class="secondary-note"><strong>${T.customsOriginOverlay}:</strong> ${customs.duty.originNotes.map(n => escapeHtml(n)).join(' · ')}</p>` : '';

  // Sprint D: badge surfacing the duty-rate provenance. The chapter
  // estimator (default) gets a quiet "estimator" tag; a live TARIC lookup
  // returning a different rate gets a bright "live" tag plus a note when
  // the live value differs from the chapter baseline.
  const mfnSource = customs?.duty?.mfnSource || 'chapter-estimator';
  const liveMeta = customs?.duty?.liveRateMeta;
  const chapterPct = customs?.duty?.chapterRatePercent;
  const mfnPct = customs?.duty?.mfnRatePercent;
  let dutySourceBadge = '';
  if (liveMeta && mfnSource !== 'chapter-estimator') {
    const tag = liveMeta.fromCache ? (liveMeta.stale ? 'live · cached (stale)' : 'live · cached') : 'live · fresh';
    const divergence = (chapterPct != null && mfnPct != null && Math.abs(chapterPct - mfnPct) >= 0.5)
      ? ` <span class="duty-source-delta">chapter estimator was ${chapterPct.toFixed(1)}%</span>`
      : '';
    dutySourceBadge = `<p class="duty-source"><span class="duty-source-tag duty-source-tag--live">${tag}</span> ${escapeHtml(liveMeta.sourceLabel || 'TARIC')}${divergence}</p>`;
  } else if (mfnSource === 'chapter-estimator') {
    dutySourceBadge = `<p class="duty-source"><span class="duty-source-tag">chapter estimator</span> sub-chapter rates verify on TARIC at the 8-digit code</p>`;
  }

  const tdMeasures = customs?.tradeDefenceMeasures || [];
  const tradeDefenceBlock = tdMeasures.length ? `
    <div class="trade-defence-callout">
      <div class="td-header">⚠ ${T.tradeDefenceTitle}</div>
      <p>${T.tradeDefenceIntro(tdMeasures.length)}</p>
      <ul class="td-list">
        ${tdMeasures.map(m => `
          <li>
            <strong>${escapeHtml(m.type)} ${m.rateTypicalPct}%</strong> on ${escapeHtml(m.description)}
            <span class="td-meta">— ${escapeHtml(m.citation)}</span>
            <div class="td-note">${escapeHtml(m.notes || '')}</div>
          </li>
        `).join('')}
      </ul>
      <p class="secondary-note">${T.tradeDefenceVerify}</p>
    </div>
  ` : '';

  const prefApplied = customs?.preferentialApplied;
  const prefAvailable = customs?.preferentialAvailable;
  const prefSavingEur = customs?.preferentialSavingEur || 0;

  // When the user is currently viewing a "what-if claimed" scenario (after
  // pressing the rerun button), state.scenarioClaimed is true. Show a
  // sticky banner with a Switch-back button.
  const scenarioClaimedBanner = state.scenarioClaimed && prefApplied
    ? `<div class="scenario-banner">
         <span>${T.scenarioBannerActive(escapeHtml(prefApplied.name))}</span>
         <button class="btn-text" type="button" id="switchBackBtn">${T.btnScenarioSwitchBack}</button>
       </div>`
    : '';

  let preferentialBlock = '';
  if (prefApplied) {
    preferentialBlock = `
      <div class="preferential-callout applied">
        <div class="pref-header">✓ ${T.preferentialAppliedTitle}</div>
        <p>${T.preferentialAppliedBody(escapeHtml(prefApplied.name), escapeHtml(prefApplied.document || '—'))}</p>
        ${prefApplied.notes ? `<p class="secondary-note">${escapeHtml(prefApplied.notes)}</p>` : ''}
      </div>
    `;
  } else if (prefAvailable && prefAvailable.mfnReplaced && prefSavingEur > 0) {
    preferentialBlock = `
      <div class="preferential-callout available">
        <div class="pref-header">€ ${T.preferentialAvailableTitle}</div>
        <p>${T.preferentialAvailableBody(escapeHtml(prefAvailable.name), prefSavingEur, escapeHtml(prefAvailable.document || '—'))}</p>
        ${prefAvailable.notes ? `<p class="secondary-note">${escapeHtml(prefAvailable.notes)}</p>` : ''}
        ${prefAvailable.approximate ? `<p class="secondary-note"><em>${T.preferentialApproximate}</em></p>` : ''}
        <div class="pref-rerun-actions">
          <button class="btn-secondary pref-rerun-btn" type="button" id="rerunWithPrefBtn">${T.btnRerunWithPref}</button>
        </div>
      </div>
    `;
  } else if (prefAvailable && !prefAvailable.mfnReplaced && prefAvailable.notes) {
    // E.g. TR_AGRI_EXCLUDED — informational warning
    preferentialBlock = `
      <div class="preferential-callout warning">
        <div class="pref-header">ℹ ${escapeHtml(prefAvailable.name)}</div>
        <p>${escapeHtml(prefAvailable.notes)}</p>
      </div>
    `;
  }

  const tcoData = plan.tco;
  let tcoSection = '';
  if (tcoData && tcoData.ok) {
    const m = tcoData.main;
    const i = tcoData.inputs;
    const sensitivityRows = tcoData.sensitivity.map(s => `
      <tr${s.shipmentsPerYear === i.shipmentsPerYear ? ' class="is-user"' : ''}>
        <td><strong>${s.shipmentsPerYear}</strong>${s.shipmentsPerYear === i.shipmentsPerYear ? ' ✓' : ''}</td>
        <td>${fmtEur(s.annualCustomsValueEur)}</td>
        <td>${fmtEur(s.annualTransportEur)}</td>
        <td>${fmtEur(s.inventoryCarryingCostEur)}</td>
        <td><strong>${fmtEur(s.annualNetCost)}</strong></td>
      </tr>
    `).join('');

    tcoSection = `
      <div class="result-section">
        <h3>${T.secTco}</h3>
        <p>${T.tcoIntro(i.shipmentsPerYear)}</p>
        <div class="result-stats tco-stats">
          <div class="result-stat"><div class="num">${fmtEur(m.annualNetCostWithWarehouse)}</div><div class="label">${T.tcoStatNet}</div><div class="sub">${T.tcoStatNetSub}</div></div>
          <div class="result-stat"><div class="num">${fmtEur(m.annualCashFlowCostWithWarehouse)}</div><div class="label">${T.tcoStatCash}</div><div class="sub">${T.tcoStatCashSub}</div></div>
          <div class="result-stat"><div class="num">${fmtEur(m.annualCustomsValueEur)}</div><div class="label">${T.tcoStatThroughput}</div><div class="sub">${T.tcoStatThroughputSub}</div></div>
          <div class="result-stat"><div class="num">${fmtEur(m.inventoryCarryingCostEur)}</div><div class="label">${T.tcoStatCarrying}</div><div class="sub">${T.tcoStatCarryingSub(i.daysInInventory, i.waccPct)}</div></div>
        </div>
        <p>${T.tcoCostPerEur(tcoData.costPerEurThroughputBp)}</p>
        ${tcoData.bonded.worthExploring ? `<p class="secondary-note">${T.tcoBondedHint(tcoData.bonded.potentialDeferralValueEur)}</p>` : ''}

        <h4 class="tco-sensitivity-heading">${T.tcoSensitivity}</h4>
        <div class="origin-matrix-wrap">
          <table class="origin-matrix tco-sensitivity">
            <thead>
              <tr>
                <th>${T.tcoColFreq}</th>
                <th>${T.tcoColCustoms}</th>
                <th>${T.tcoColTransport}</th>
                <th>${T.tcoColCarrying}</th>
                <th>${T.tcoColNet}</th>
              </tr>
            </thead>
            <tbody>
              ${sensitivityRows}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  const wc = plan.workingCapital;
  let workingCapitalSection = '';
  if (wc && wc.ok) {
    const verdictKey = wc.verdict;
    const verdictText = (T.wcVerdict && T.wcVerdict[verdictKey]) || verdictKey;
    const cccCls = wc.ccc < 0 ? 'wc-supplier-funded'
      : wc.ccc <= 30 ? 'wc-tight'
      : wc.ccc <= 90 ? 'wc-standard'
      : wc.ccc <= 150 ? 'wc-capital-intensive'
      : 'wc-severe';
    const leverRows = wc.levers.map(l => `
      <tr>
        <td>${escapeHtml(l.label)}</td>
        <td>${l.cccDelta > 0 ? '+' : ''}${l.cccDelta} d</td>
        <td>${fmtEur(Math.abs(l.workingCapitalDelta))}</td>
        <td><strong>${fmtEur(Math.abs(l.annualCostDelta))}</strong></td>
      </tr>
    `).join('');

    workingCapitalSection = `
      <div class="result-section">
        <h3>${T.secWorkingCapital}</h3>
        <p>${T.wcIntro}</p>
        <div class="result-stats wc-stats">
          <div class="result-stat ${cccCls}"><div class="num">${wc.ccc} d</div><div class="label">${T.wcCccLabel}</div><div class="sub">${T.wcCccBreakdown(wc.dio, wc.dso, wc.dpo, wc.ccc)}</div></div>
          <div class="result-stat"><div class="num">${fmtEur(wc.workingCapitalEur)}</div><div class="label">${T.wcWorkingCapitalLabel}</div><div class="sub">tied up at any moment</div></div>
          <div class="result-stat"><div class="num">${fmtEur(wc.annualCapitalCostEur)}</div><div class="label">${T.wcAnnualCostLabel}</div><div class="sub">${wc.inputs.waccPct}% WACC × working capital</div></div>
          <div class="result-stat"><div class="num">${fmtEur(wc.dayValueEur)}</div><div class="label">${T.wcDayValueLabel}</div><div class="sub">freed per day shaved</div></div>
        </div>
        <p class="verdict-line">${verdictText}</p>

        <h4 class="tco-sensitivity-heading">${T.wcLeverHeading}</h4>
        <div class="origin-matrix-wrap">
          <table class="origin-matrix">
            <thead>
              <tr>
                <th>${T.wcLeverColLabel}</th>
                <th>${T.wcLeverColDelta}</th>
                <th>${T.wcLeverColCapital}</th>
                <th>${T.wcLeverColAnnual}</th>
              </tr>
            </thead>
            <tbody>
              ${leverRows}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  const fxRisk = plan.fx;
  let fxSection = '';
  if (fxRisk && fxRisk.ok && !fxRisk.noFxRisk) {
    const recKey = 'fxRecommendation' + fxRisk.recommendation.charAt(0).toUpperCase() + fxRisk.recommendation.slice(1);
    const cls = fxRisk.recommendation === 'hedge' ? 'rec-hedge'
      : fxRisk.recommendation === 'accept' ? 'rec-accept'
      : fxRisk.recommendation === 'consider' ? 'rec-consider'
      : 'rec-skip';
    fxSection = `
      <div class="result-section">
        <h3>${T.secFx}</h3>
        <p>${T.fxIntro(escapeHtml(fxRisk.currency), fxRisk.paymentTermsDays)}</p>
        <p class="secondary-note">${T.fxSpotRate(escapeHtml(fxRisk.currency), fxRisk.spotRateForeignPerEur.toFixed(4), fxRisk.spotRateEurPerForeign.toFixed(6))}</p>
        <p>${T.fxQuoteEquivalent(escapeHtml(fxRisk.equivalentForeignFormatted), fxRisk.customsValueEur.toLocaleString(T.currencyLocale))}</p>
        <div class="fx-callout ${cls}">
          <p>${T.fxRiskScenario(fxRisk.riskEur1Sigma90d, fxRisk.vol90dPct)}</p>
          <p>${T.fxHedgeCost(fxRisk.hedgeCostEur, fxRisk.hedgeCostBp)}</p>
          <p class="fx-rec">${T[recKey] || `Recommendation: ${fxRisk.recommendation}`}</p>
          <p class="secondary-note">${escapeHtml(fxRisk.rationale)}</p>
        </div>
      </div>
    `;
  }

  const sens = plan.originSensitivity;
  const originSensitivitySection = sens && sens.matrix && sens.matrix.length > 1 ? `
    <div class="result-section">
      <h3>${T.secOriginSensitivity}</h3>
      <p>${T.originSensitivityIntro}</p>
      ${sens.savingEurVsUserOrigin > 0 && sens.savingPctVsUserOrigin >= 5
        ? `<div class="origin-saving-callout">
             <p>${T.originSensitivitySaving(sens.savingEurVsUserOrigin, sens.savingPctVsUserOrigin, escapeHtml(sens.cheapestOrigin))}</p>
           </div>` : ''}
      <div class="origin-matrix-wrap">
        <table class="origin-matrix">
          <thead>
            <tr>
              <th>${T.originColCountry}</th>
              <th>${T.originColDuty}</th>
              <th>${T.originColTransport}</th>
              <th>${T.originColMode}</th>
              <th>${T.originColLanded}</th>
              ${sens.shipmentsPerYear ? `<th>${T.originColAnnual}</th>` : ''}
              <th>${T.originColPreferential}</th>
              <th>${T.originColTradeDefence}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${sens.matrix.map((e, i) => {
              const isCheapest = i === 0 && !e.isUserChoice;
              const cls = e.isUserChoice ? 'is-user' : (isCheapest ? 'is-cheapest' : '');
              const tag = e.isUserChoice
                ? `<span class="origin-tag user">${T.originSensitivityYourPick}</span>`
                : (isCheapest ? `<span class="origin-tag cheapest">${T.originSensitivityCheapest}</span>` : '');
              const compareBtn = e.isUserChoice
                ? ''
                : `<button class="compare-btn" type="button" data-compare-origin="${escapeHtml(e.origin)}">${T.btnCompare}</button>`;
              return `<tr class="${cls}">
                <td><strong>${escapeHtml(e.origin)}</strong> ${tag}</td>
                <td>${e.dutyRatePct.toFixed(1)}%</td>
                <td>${fmtEur(e.transportEur)}</td>
                <td>${escapeHtml(e.transportMode)}</td>
                <td><strong>${fmtEur(e.perShipmentLandedTotal)}</strong></td>
                ${sens.shipmentsPerYear ? `<td>${fmtEur(e.annualLandedTotal)}</td>` : ''}
                <td>${e.preferentialApplied ? `<span class="badge pref">${escapeHtml(e.preferentialApplied)}</span>` : '—'}</td>
                <td>${e.tradeDefenceMeasures.length ? `<span class="badge td">${e.tradeDefenceMeasures.length} measure${e.tradeDefenceMeasures.length > 1 ? 's' : ''}</span>` : '—'}</td>
                <td>${compareBtn}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
      <div class="comparison-panel" id="comparisonPanel" hidden></div>
    </div>
  ` : '';

  const complianceRegimes = plan.compliance?.regimes || [];
  const complianceSection = `
    <div class="result-section">
      <h3>${T.secCompliance}</h3>
      ${complianceRegimes.length === 0
        ? `<p class="secondary-note">${T.complianceEmpty}</p>`
        : `<p>${T.complianceIntro(complianceRegimes.length)}</p>
           <div class="compliance-list">
             ${complianceRegimes.map(r => `
               <div class="compliance-card sev-${escapeHtml(r.severity)}">
                 <div class="compliance-head">
                   <span class="compliance-name">${escapeHtml(r.name)}</span>
                   <span class="compliance-sev">${T['severity' + r.severity.charAt(0).toUpperCase() + r.severity.slice(1)] || r.severity}</span>
                 </div>
                 <div class="compliance-status">${T.complianceStatus}: ${escapeHtml(r.status)}</div>
                 <div class="compliance-obligation"><strong>${T.complianceObligation}:</strong> ${escapeHtml(r.importerObligation)}</div>
                 ${r.matchedTrigger ? `<div class="compliance-trigger">Matched on: ${escapeHtml(r.matchedTrigger)}</div>` : ''}
                 ${r.keyDates ? `<div class="compliance-dates"><strong>${T.complianceKeyDates}:</strong> ${escapeHtml(r.keyDates)}</div>` : ''}
                 ${r.note ? `<div class="compliance-note">${escapeHtml(r.note)}</div>` : ''}
                 ${r.additionalNote ? `<div class="compliance-note">${escapeHtml(r.additionalNote)}</div>` : ''}
                 ${r.deeperGuide ? `<a class="compliance-link" href="${escapeHtml(r.deeperGuide)}">${T.complianceMore} →</a>` : ''}
               </div>
             `).join('')}
           </div>`
      }
    </div>
  `;

  const warehouseSection = warehouse && !warehouse.skipped && warehouse.recommendedHub ? `
    <div class="result-section">
      <h3>${T.secWarehouse}</h3>
      <div class="verdict-line">${escapeHtml(warehouse.recommendation.rationale)}</div>
      <p>${T.warehouseRecommended(escapeHtml(warehouse.recommendedHub.hubName), escapeHtml(warehouse.recommendedHub.hubCountryName))} ${T.warehouseTotalCost(fmtEur(warehouse.recommendedHub.totalMonthlyEur), fmtEur(warehouse.recommendedHub.costPerOrderEur, 2))} ${T.warehouseTransitTo(escapeHtml(inputs.destinationCountry), escapeHtml(warehouse.recommendedHub.transitToDestination))}</p>
    </div>
  ` : '';

  els.hero.style.display = 'none';
  document.getElementById('progress').style.display = 'none';
  els.form.style.display = 'none';

  els.result.classList.add('active');
  const headerNote = plan.email?.shared
    ? T.sharedNotSent
    : (plan.email?.sent ? T.emailSent : T.emailNotSent);

  els.result.innerHTML = `
    <div class="print-header" aria-hidden="true">
      <div class="ph-brand">${T.printHeaderBrand}</div>
      <div class="ph-summary">${escapeHtml(T.printHeaderSummary(inputs))}</div>
      <div class="ph-meta">${escapeHtml(T.printHeaderMeta(plan.asOf || new Date().toISOString().slice(0,10)))}</div>
    </div>

    ${scenarioClaimedBanner}

    <div class="result-hero">
      <h2>${T.resultReady}</h2>
      <p>${headerNote}</p>
    </div>

    <div class="result-stats">
      <div class="result-stat"><div class="num">${fmtEur(totals.transportEur)}</div><div class="label">${T.statTransport}</div></div>
      <div class="result-stat"><div class="num">${fmtEur(totals.dutyEur + totals.vatEur + totals.brokerageEur)}</div><div class="label">${T.statDutyVatBrokerage}</div></div>
      <div class="result-stat">
        <div class="num">${fmtEur(totals.perShipmentLandedTotal)}</div>
        <div class="label">${T.statLanded}</div>
        ${Number.isFinite(totals.effectiveLandedTotal) ? `<div class="stat-sub">${T.statLandedEffective}: <strong>${fmtEur(totals.effectiveLandedTotal)}</strong></div>` : ''}
      </div>
      <div class="result-stat"><div class="num">${totals.warehouseMonthlyEur ? fmtEur(totals.warehouseMonthlyEur) : '—'}</div><div class="label">${T.statWarehouse}</div></div>
    </div>

    <div class="result-section">
      <h3>${T.secSourcing}</h3>
      ${sourcingReasoning}
      ${sourcingNote}
    </div>

    <div class="result-section">
      <h3>${T.secTransport} · ${escapeHtml((routingPrimary || '').replace('_', ' ').toUpperCase())}</h3>
      ${routingQuote ? `<p>${escapeHtml(routingQuote.label)}: <strong>${fmtEur(routingQuote.totalEur)}</strong> · ${T.transit} ${escapeHtml(transitDays)} · ${co2Kg}</p>` : ''}
      ${railHint}
    </div>

    <div class="result-section">
      <h3>${T.secCustoms} · ${escapeHtml(clearanceLabel)}</h3>
      <p>${T.customsHsChapter} ${escapeHtml(inputs.hsCode)}${customs?.hsChapterLabel ? ' · ' + escapeHtml(customs.hsChapterLabel) : ''} · ${T.customsMfnDuty} <strong>${dutyPct}</strong> · ${escapeHtml(customs?.vat?.country || '')} ${T.customsVatLabel} <strong>${vatPct}</strong></p>
      <table class="breakdown-table">
        <tr><td>${T.customsBreakdown.cif}</td><td>${fmtEur(totals.customsValueEur)}</td></tr>
        <tr><td>${T.customsBreakdown.duty} (${dutyPct})</td><td>${fmtEur(totals.dutyEur)}</td></tr>
        <tr><td>${T.customsBreakdown.vat} (${vatPct})</td><td>${fmtEur(totals.vatEur)}</td></tr>
        <tr><td>${T.customsBreakdown.brokerage}</td><td>${fmtEur(totals.brokerageEur)}</td></tr>
        <tr><td>${T.customsBreakdown.transport}</td><td>${fmtEur(totals.transportEur)}</td></tr>
        <tr class="total"><td>${T.customsBreakdown.total}</td><td>${fmtEur(totals.perShipmentLandedTotal)}</td></tr>
      </table>
      ${dutySourceBadge}
      ${tradeDefenceBlock}
      ${preferentialBlock}
      ${originNotes}
    </div>

    ${tcoSection}

    ${workingCapitalSection}

    ${fxSection}

    ${originSensitivitySection}

    ${complianceSection}

    ${warehouseSection}

    ${renderRoadmap(plan.roadmap)}

    <div class="result-section">
      <h3>${T.secNextSteps}</h3>
      <p>${T.nextStepsBody}</p>
      <div class="agent-cta-grid">
        <a class="agent-cta-card" href="${agentBase('orchestrator')}?prompt=${encodeURIComponent(T.promptOrchestrator(inputs))}">
          <div class="ac-tag">${T.agentOrchestrator.tag}</div>
          <h4>${T.agentOrchestrator.title}</h4>
          <p>${T.agentOrchestrator.body}</p>
        </a>
        <a class="agent-cta-card" href="${agentBase('sourcing')}?prompt=${encodeURIComponent(T.promptSourcing(inputs))}">
          <div class="ac-tag">${T.agentSourcing.tag}</div>
          <h4>${T.agentSourcing.title}</h4>
          <p>${T.agentSourcing.body}</p>
        </a>
        <a class="agent-cta-card" href="${agentBase('logistics')}?prompt=${encodeURIComponent(T.promptLogistics(inputs))}">
          <div class="ac-tag">${T.agentLogistics.tag}</div>
          <h4>${T.agentLogistics.title}</h4>
          <p>${T.agentLogistics.body}</p>
        </a>
      </div>
    </div>

    <!-- Sprint J.6: Founding 10 cross-sell. Hidden by default; the live
         counter fetch reveals it once remaining > 0 OR shows the
         waitlist variant when spots are full. Dismissed state persists
         in localStorage so repeat visitors don't re-see the pitch. -->
    <div class="result-section founding-crosssell" id="foundingCrossSell" hidden>
      <div class="founding-crosssell-card">
        <div class="founding-crosssell-text">
          <div class="founding-crosssell-kicker">${T.foundingCrossSellKicker}</div>
          <h3>${T.foundingCrossSellTitle}</h3>
          <p>${T.foundingCrossSellBody}</p>
          <div class="founding-crosssell-meta" id="foundingCrossSellMeta"></div>
        </div>
        <div class="founding-crosssell-actions">
          <a class="btn btn-primary" href="${T.foundingCrossSellHref}">${T.foundingCrossSellCta}</a>
          <button type="button" class="founding-crosssell-dismiss" id="foundingCrossSellDismiss">${T.foundingCrossSellDismiss}</button>
        </div>
      </div>
    </div>

    <div class="result-section">
      <h3>${T.secShare}</h3>
      <p>${T.shareBody}</p>
      <div class="share-row">
        <input class="share-url" id="shareUrl" readonly value="${escapeHtml(buildShareUrl(inputs))}">
        <button class="btn btn-primary" type="button" id="copyShareBtn">${T.btnCopyLink}</button>
      </div>
    </div>

    <div class="result-section" style="text-align: center;">
      <div class="currency-toggle" role="group" aria-label="Display currency">
        <span class="currency-toggle-label">${T.displayCurrencyLabel || 'Display in'}:</span>
        ${Object.keys(FX_DISPLAY.rates).map(code => `<button type="button" class="currency-btn" data-currency="${code}">${code}</button>`).join('')}
      </div>
      <div id="currency-asof-banner" class="currency-asof"></div>
      <div class="print-actions">
        <button class="btn btn-primary" type="button" id="savePdfBtn">${T.btnSaveAsPdf}</button>
        <button class="btn" type="button" id="printBtn">${T.btnPrint}</button>
        <button class="btn" type="button" id="savePlanBtn" hidden>${T.btnSavePlan}</button>
      </div>
      <div style="margin-top: 1.4rem;">
        <a class="btn btn-primary" href="${wizardHome()}" style="margin-right: 0.6rem;">${T.btnRunAnother}</a>
        <a class="btn" href="${guidesHome()}">${T.btnBrowseGuides}</a>
      </div>
    </div>
  `;

  const copyBtn = document.getElementById('copyShareBtn');
  const shareInput = document.getElementById('shareUrl');
  if (copyBtn && shareInput) {
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(shareInput.value);
        copyBtn.textContent = T.btnCopiedOk;
        setTimeout(() => { copyBtn.textContent = T.btnCopyLink; }, 2000);
      } catch (_) {
        shareInput.select();
        document.execCommand('copy');
        copyBtn.textContent = T.btnCopiedOk;
        setTimeout(() => { copyBtn.textContent = T.btnCopyLink; }, 2000);
      }
    });
  }

  // Sprint J.6: Founding 10 cross-sell. Reveal once the counter loads;
  // hide outright if the visitor dismissed it before, or if they've
  // already applied (sessionStorage flag set by the founding page on
  // successful submit — not implemented yet, future-friendly check).
  const foundingCard = document.getElementById('foundingCrossSell');
  const foundingMeta = document.getElementById('foundingCrossSellMeta');
  const foundingDismiss = document.getElementById('foundingCrossSellDismiss');
  if (foundingCard && foundingMeta) {
    let dismissed = false;
    try { dismissed = localStorage.getItem('orcatrade-founding-dismissed') === '1'; } catch (_) {}
    if (!dismissed) {
      fetch('/api/founding', { credentials: 'same-origin' })
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (!data || typeof data.remaining !== 'number') return;
          foundingMeta.textContent = data.remaining > 0
            ? T.foundingCrossSellRemaining(data.remaining)
            : T.foundingCrossSellRemainingFull;
          foundingCard.hidden = false;
        })
        .catch(() => { /* silent */ });
    }
    if (foundingDismiss) {
      foundingDismiss.addEventListener('click', () => {
        foundingCard.hidden = true;
        try { localStorage.setItem('orcatrade-founding-dismissed', '1'); } catch (_) {}
      });
    }
  }

  // Save as PDF / Print — both call window.print(), the browser's
  // print-to-PDF dialog handles the actual file generation. Our
  // @media print CSS in wizard.css does the layout work.
  const savePdfBtn = document.getElementById('savePdfBtn');
  const printBtn = document.getElementById('printBtn');
  if (savePdfBtn) savePdfBtn.addEventListener('click', () => window.print());
  if (printBtn) printBtn.addEventListener('click', () => window.print());

  // Sprint AH: currency toggle. Buttons live in .currency-toggle; clicking
  // re-renders every .amt[data-eur] node. Selection persists in localStorage.
  const currencyButtons = document.querySelectorAll('.currency-btn');
  function activateCurrencyButton(code) {
    currencyButtons.forEach(b => b.classList.toggle('active', b.getAttribute('data-currency') === code));
  }
  currencyButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const code = btn.getAttribute('data-currency');
      applyDisplayCurrency(code);
      activateCurrencyButton(code);
      setCurrencyPreference(code);
    });
  });
  const initialCurrency = getCurrencyPreference();
  activateCurrencyButton(initialCurrency);
  if (initialCurrency !== 'EUR') applyDisplayCurrency(initialCurrency);

  // Sprint 39: "Save plan to my account" — visible only when /api/auth/me
  // returns a signed-in user. Posts the plan inputs to /api/plans.
  const savePlanBtn = document.getElementById('savePlanBtn');
  if (savePlanBtn) {
    fetch('/api/auth/me', { credentials: 'same-origin' })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data && data.user && data.user.email) {
          savePlanBtn.hidden = false;
          savePlanBtn.addEventListener('click', async () => {
            savePlanBtn.disabled = true;
            const orig = savePlanBtn.textContent;
            savePlanBtn.textContent = '...';
            try {
              const resp = await fetch('/api/plans', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ inputs: plan.inputs, locale: LOCALE }),
              });
              if (resp.ok) {
                savePlanBtn.textContent = T.btnSavedOk;
                setTimeout(() => { savePlanBtn.textContent = orig; savePlanBtn.disabled = false; }, 2500);
              } else {
                savePlanBtn.textContent = orig;
                savePlanBtn.disabled = false;
              }
            } catch (_) {
              savePlanBtn.textContent = orig;
              savePlanBtn.disabled = false;
            }
          });
        }
      })
      .catch(() => { /* ignore — button stays hidden */ });
  }

  // Origin comparison — clicking a "Compare" button in the sensitivity
  // matrix renders a side-by-side panel using data already on the plan.
  const compareButtons = document.querySelectorAll('.compare-btn[data-compare-origin]');
  const comparisonPanel = document.getElementById('comparisonPanel');
  if (comparisonPanel && compareButtons.length) {
    compareButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const targetOrigin = btn.getAttribute('data-compare-origin');
        renderComparison(plan, targetOrigin, comparisonPanel);
      });
    });
  }

  // Sprint AG: scenario toggle — re-run the plan with claimPreferential=true
  // when the user clicks the "Re-run with this claimed" button. Switch
  // back returns to the baseline inputs.
  const rerunBtn = document.getElementById('rerunWithPrefBtn');
  if (rerunBtn) {
    rerunBtn.addEventListener('click', () => {
      const claimedInputs = { ...inputs, claimPreferential: true };
      // Stash baseline so the user can switch back
      state.baselineInputs = { ...inputs };
      state.scenarioClaimed = true;
      rerunPlan(claimedInputs);
    });
  }
  const switchBackBtn = document.getElementById('switchBackBtn');
  if (switchBackBtn && state.baselineInputs) {
    switchBackBtn.addEventListener('click', () => {
      const baseline = state.baselineInputs;
      state.scenarioClaimed = false;
      state.baselineInputs = null;
      rerunPlan(baseline);
    });
  }
}

// Sprint AG: helper to re-fetch /api/start with modified inputs and
// re-render the result. Reuses the same network plumbing as submitPlan
// but skips form validation since the inputs are programmatic.
async function rerunPlan(inputs) {
  els.result.innerHTML = `<div class="result-hero"><h2>${T.loadingSharedTitle}</h2><p>${T.loadingSharedBody}</p></div>`;
  try {
    const payload = { ...inputs, locale: LOCALE };
    const response = await fetch('/api/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      throw new Error((errBody.errors && errBody.errors.join('; ')) || errBody.error || `${T.errServer} ${response.status}`);
    }
    const json = await response.json();
    if (!json.ok || !json.plan) throw new Error(T.errSubmit);
    renderPlan({ ...json.plan, email: { sent: false, shared: true } });
    window.scrollTo({ top: els.result.offsetTop - 20, behavior: 'smooth' });
  } catch (err) {
    els.result.innerHTML = `
      <div class="result-hero">
        <h2>${T.sharedFailedTitle}</h2>
        <p>${escapeHtml(err.message || 'Unknown error')}.</p>
      </div>`;
  }
}

// ── Origin comparison: side-by-side from the sensitivity matrix ──
// Uses data already in plan.originSensitivity.matrix — no extra fetch.
// User's pick is the baseline; alt is the alternative origin selected.
function renderComparison(plan, altOriginCode, panelEl) {
  const sens = plan.originSensitivity;
  if (!sens) return;
  const userEntry = sens.matrix.find(e => e.isUserChoice);
  const altEntry = sens.matrix.find(e => e.origin === altOriginCode);
  if (!userEntry || !altEntry) return;

  // Deltas (alt minus user) — negative = saving, positive = penalty
  const dutyDelta = altEntry.dutyRatePct - userEntry.dutyRatePct;
  const transportDelta = altEntry.transportEur - userEntry.transportEur;
  const landedDelta = altEntry.perShipmentLandedTotal - userEntry.perShipmentLandedTotal;
  const annualDelta = (altEntry.annualLandedTotal || 0) - (userEntry.annualLandedTotal || 0);

  function deltaBadge(deltaEur, isPercent = false) {
    if (Math.abs(deltaEur) < (isPercent ? 0.05 : 1)) return `<span class="delta-zero">±0</span>`;
    const cls = deltaEur < 0 ? 'delta-saving' : 'delta-penalty';
    const sign = deltaEur < 0 ? '−' : '+';
    const formatted = isPercent
      ? `${Math.abs(deltaEur).toFixed(1)}%`
      : fmtEur(Math.abs(deltaEur));
    return `<span class="${cls}">${sign}${formatted}</span>`;
  }

  function tdMeasureSummary(e) {
    if (!e.tradeDefenceMeasures.length) return '—';
    return e.tradeDefenceMeasures.map(m => `${m.type} ${m.rateTypicalPct}%`).join(', ');
  }

  const compareUrl = buildComparisonUrl(plan.inputs, altEntry.origin);
  const html = `
    <div class="comparison-header">
      <span class="comparison-title">${T.compareTitle(escapeHtml(userEntry.origin), escapeHtml(altEntry.origin))}</span>
      <div class="comparison-actions">
        <button class="compare-copy-btn" type="button" id="copyComparisonBtn" data-compare-url="${escapeHtml(compareUrl)}">${T.btnCopyComparisonUrl}</button>
        <button class="compare-close" type="button" id="closeComparisonBtn" aria-label="${T.compareClose}">×</button>
      </div>
    </div>
    <p class="comparison-intro">${T.compareIntro(escapeHtml(userEntry.origin), escapeHtml(altEntry.origin))}</p>
    <table class="comparison-table">
      <thead>
        <tr>
          <th></th>
          <th class="col-user">${T.compareYourPick} (${escapeHtml(userEntry.origin)})</th>
          <th class="col-alt">${T.compareAlt} (${escapeHtml(altEntry.origin)})</th>
          <th class="col-delta">${T.compareDelta}</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>${T.originColDuty}</td>
          <td>${userEntry.dutyRatePct.toFixed(1)}%</td>
          <td>${altEntry.dutyRatePct.toFixed(1)}%</td>
          <td>${deltaBadge(dutyDelta, true)}</td>
        </tr>
        <tr>
          <td>${T.originColTransport}</td>
          <td>${fmtEur(userEntry.transportEur)} (${escapeHtml(userEntry.transportMode)})</td>
          <td>${fmtEur(altEntry.transportEur)} (${escapeHtml(altEntry.transportMode)})</td>
          <td>${deltaBadge(transportDelta)}</td>
        </tr>
        <tr class="comparison-headline-row">
          <td><strong>${T.originColLanded}</strong></td>
          <td><strong>${fmtEur(userEntry.perShipmentLandedTotal)}</strong></td>
          <td><strong>${fmtEur(altEntry.perShipmentLandedTotal)}</strong></td>
          <td><strong>${deltaBadge(landedDelta)}</strong></td>
        </tr>
        ${sens.shipmentsPerYear ? `<tr class="comparison-headline-row">
          <td><strong>${T.originColAnnual}</strong></td>
          <td><strong>${fmtEur(userEntry.annualLandedTotal)}</strong></td>
          <td><strong>${fmtEur(altEntry.annualLandedTotal)}</strong></td>
          <td><strong>${deltaBadge(annualDelta)}</strong></td>
        </tr>` : ''}
        <tr>
          <td>${T.originColPreferential}</td>
          <td>${userEntry.preferentialApplied || '—'}</td>
          <td>${altEntry.preferentialApplied || '—'}</td>
          <td>—</td>
        </tr>
        <tr>
          <td>${T.originColTradeDefence}</td>
          <td>${tdMeasureSummary(userEntry)}</td>
          <td>${tdMeasureSummary(altEntry)}</td>
          <td>—</td>
        </tr>
      </tbody>
    </table>
    <p class="comparison-verdict">${T.compareVerdict(escapeHtml(userEntry.origin), escapeHtml(altEntry.origin), landedDelta, annualDelta, sens.shipmentsPerYear)}</p>
  `;

  panelEl.innerHTML = html;
  panelEl.hidden = false;
  panelEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  const closeBtn = document.getElementById('closeComparisonBtn');
  if (closeBtn) closeBtn.addEventListener('click', () => {
    panelEl.hidden = true;
    panelEl.innerHTML = '';
  });

  const copyBtn = document.getElementById('copyComparisonBtn');
  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      const url = copyBtn.getAttribute('data-compare-url');
      try {
        await navigator.clipboard.writeText(url);
        copyBtn.textContent = T.btnCopiedOk;
        setTimeout(() => { copyBtn.textContent = T.btnCopyComparisonUrl; }, 2000);
      } catch (_) {
        // Clipboard API blocked — fall back to a temporary input + execCommand
        const tmp = document.createElement('input');
        tmp.value = url;
        document.body.appendChild(tmp);
        tmp.select();
        document.execCommand('copy');
        document.body.removeChild(tmp);
        copyBtn.textContent = T.btnCopiedOk;
        setTimeout(() => { copyBtn.textContent = T.btnCopyComparisonUrl; }, 2000);
      }
    });
  }
}

function localePrefix() {
  return LOCALE === 'en' ? '' : `/${LOCALE}`;
}
function wizardHome() { return `${localePrefix()}/start/`; }
function guidesHome() { return `${localePrefix()}/guides/`; }
function agentBase(name) {
  // Locale-routed: /pl/agent/<name>/, /de/agent/<name>/, or /agent/<name>/ for EN.
  // The compliance agent lives at /agent/ (not /agent/compliance/).
  const segment = name === 'compliance' ? '' : `${name}/`;
  return LOCALE === 'en' ? `/agent/${segment}` : `/${LOCALE}/agent/${segment}`;
}

function buildShareUrl(inputs) {
  const encoded = encodeShareInputs(inputs);
  return `${window.location.origin}${wizardHome()}?p=${encoded}`;
}

function buildComparisonUrl(inputs, altOriginCode) {
  return `${buildShareUrl(inputs)}&c=${encodeURIComponent(altOriginCode)}`;
}

async function submitPlan() {
  if (state.submitting) return;
  if (!validateStep(6)) return;

  state.submitting = true;
  els.submitBtn.disabled = true;
  els.submitBtn.textContent = T.btnSubmitting;
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
      const msg = (errBody.errors && errBody.errors.join('; ')) || errBody.error || `${T.errServer} ${response.status}`;
      els.globalErr.textContent = msg;
      els.globalErr.style.display = '';
      els.submitBtn.disabled = false;
      els.submitBtn.textContent = T.btnSubmit;
      state.submitting = false;
      return;
    }
    const json = await response.json();
    if (json.ok && json.plan) {
      renderPlan({ ...json.plan, email: json.email });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      els.globalErr.textContent = T.errSubmit;
      els.globalErr.style.display = '';
      els.submitBtn.disabled = false;
      els.submitBtn.textContent = T.btnSubmit;
      state.submitting = false;
    }
  } catch (err) {
    els.globalErr.textContent = `${T.errNetwork}: ${err.message || 'unknown'}`;
    els.globalErr.style.display = '';
    els.submitBtn.disabled = false;
    els.submitBtn.textContent = T.btnSubmit;
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

els.form.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
    if (state.current < TOTAL_STEPS) {
      e.preventDefault();
      if (validateStep(state.current)) showStep(state.current + 1);
    }
  }
});

async function loadFromShareUrl(b64url, compareWithOrigin = null) {
  els.hero.style.display = 'none';
  document.getElementById('progress').style.display = 'none';
  els.form.style.display = 'none';
  els.result.classList.add('active');
  els.result.innerHTML = `<div class="result-hero"><h2>${T.loadingSharedTitle}</h2><p>${T.loadingSharedBody}</p></div>`;

  try {
    const inputs = decodeShareInputs(b64url);
    inputs.locale = LOCALE;
    const response = await fetch('/api/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(inputs),
    });
    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      throw new Error((errBody.errors && errBody.errors.join('; ')) || errBody.error || `${T.errServer} ${response.status}`);
    }
    const json = await response.json();
    if (!json.ok || !json.plan) throw new Error(T.errSubmit);
    renderPlan({ ...json.plan, email: { sent: false, shared: true } });
    window.scrollTo({ top: 0, behavior: 'smooth' });

    // If a comparison origin was passed in the URL, auto-trigger the
    // comparison panel so the recipient lands on exactly the same view
    // the sender intended (not just the base plan).
    if (compareWithOrigin) {
      const panel = document.getElementById('comparisonPanel');
      if (panel) {
        // Validate the origin exists in the matrix and is not the user's pick
        const altEntry = json.plan.originSensitivity?.matrix?.find(
          e => e.origin === compareWithOrigin && !e.isUserChoice,
        );
        if (altEntry) {
          renderComparison(json.plan, compareWithOrigin, panel);
        }
      }
    }
  } catch (err) {
    els.result.innerHTML = `
      <div class="result-hero">
        <h2>${T.sharedFailedTitle}</h2>
        <p>${escapeHtml(err.message || 'Unknown error')}.</p>
        <p><a class="btn btn-primary" href="${wizardHome()}">${T.sharedFailedBuildNew}</a></p>
      </div>`;
  }
}

// Apply localised button labels to the static HTML
if (els.backBtn) els.backBtn.textContent = T.btnBack;
if (els.nextBtn) els.nextBtn.textContent = T.btnNext;
if (els.submitBtn) els.submitBtn.textContent = T.btnSubmit;

const urlParams = new URLSearchParams(window.location.search);
const sharedPlanParam = urlParams.get('p');
const compareWithParam = urlParams.get('c');
const shareCodeParam = urlParams.get('share');

// Sprint share-render-v1 — when the wizard loads with ?share=<code>,
// validate the code server-side before rendering. If the owner has
// revoked the share, replace the wizard with an overlay so the
// bookmarked URL stops being a quiet back-door into the plan.
// Failure (network error, 5xx, etc.) is non-blocking — we still
// render the plan from the inputs in the URL.
function maybeValidateShareCode() {
  if (!shareCodeParam) return Promise.resolve();
  if (!/^[a-f0-9]{4,32}$/i.test(shareCodeParam)) return Promise.resolve();
  return fetch('/api/share-check/' + encodeURIComponent(shareCodeParam), {
    credentials: 'omit',
  })
    .then(function (r) {
      if (r.status === 404) {
        showShareRevokedOverlay();
        return { revoked: true };
      }
      return r.ok ? r.json().catch(function () { return null; }) : null;
    })
    .catch(function () { /* non-blocking */ return null; });
}

function showShareRevokedOverlay() {
  // Hide the entire wizard form and put a full-page card in its place.
  var shell = document.querySelector('.wizard-shell') || document.body;
  var overlay = document.createElement('div');
  overlay.className = 'share-revoked-overlay';
  overlay.setAttribute('role', 'alert');
  overlay.innerHTML =
    '<div class="share-revoked-card">'
    + '<div class="share-revoked-kicker">Share link · revoked</div>'
    + '<h1>This share link is no longer active</h1>'
    + '<p>The plan owner has revoked this share. The numbers you may have seen before were a snapshot at the time the link was minted — for the latest, ask the owner for a fresh link or build your own plan from scratch.</p>'
    + '<div class="share-revoked-actions">'
    +   '<a class="share-revoked-cta" href="' + wizardHome() + '">Build your own import plan →</a>'
    + '</div>'
    + '</div>';
  // Drop everything else in the shell and replace with the overlay.
  while (shell.firstChild) shell.removeChild(shell.firstChild);
  shell.appendChild(overlay);
}

maybeValidateShareCode().then(function (result) {
  if (result && result.revoked) return; // overlay already swapped in
  if (sharedPlanParam) {
    loadFromShareUrl(sharedPlanParam, compareWithParam);
  } else {
    showStep(1);
  }
});
