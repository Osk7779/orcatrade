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

function fmtEur(value, decimals = 0) {
  if (value == null || !Number.isFinite(Number(value))) return '€0';
  return new Intl.NumberFormat(T.currencyLocale, { style: 'currency', currency: 'EUR', maximumFractionDigits: decimals }).format(Number(value));
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
            </tr>
          </thead>
          <tbody>
            ${sens.matrix.map((e, i) => {
              const isCheapest = i === 0 && !e.isUserChoice;
              const cls = e.isUserChoice ? 'is-user' : (isCheapest ? 'is-cheapest' : '');
              const tag = e.isUserChoice
                ? `<span class="origin-tag user">${T.originSensitivityYourPick}</span>`
                : (isCheapest ? `<span class="origin-tag cheapest">${T.originSensitivityCheapest}</span>` : '');
              return `<tr class="${cls}">
                <td><strong>${escapeHtml(e.origin)}</strong> ${tag}</td>
                <td>${e.dutyRatePct.toFixed(1)}%</td>
                <td>${fmtEur(e.transportEur)}</td>
                <td>${escapeHtml(e.transportMode)}</td>
                <td><strong>${fmtEur(e.perShipmentLandedTotal)}</strong></td>
                ${sens.shipmentsPerYear ? `<td>${fmtEur(e.annualLandedTotal)}</td>` : ''}
                <td>${e.preferentialApplied ? `<span class="badge pref">${escapeHtml(e.preferentialApplied)}</span>` : '—'}</td>
                <td>${e.tradeDefenceMeasures.length ? `<span class="badge td">${e.tradeDefenceMeasures.length} measure${e.tradeDefenceMeasures.length > 1 ? 's' : ''}</span>` : '—'}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
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

    <div class="result-hero">
      <h2>${T.resultReady}</h2>
      <p>${headerNote}</p>
    </div>

    <div class="result-stats">
      <div class="result-stat"><div class="num">${fmtEur(totals.transportEur)}</div><div class="label">${T.statTransport}</div></div>
      <div class="result-stat"><div class="num">${fmtEur(totals.dutyEur + totals.vatEur + totals.brokerageEur)}</div><div class="label">${T.statDutyVatBrokerage}</div></div>
      <div class="result-stat"><div class="num">${fmtEur(totals.perShipmentLandedTotal)}</div><div class="label">${T.statLanded}</div></div>
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

    <div class="result-section">
      <h3>${T.secShare}</h3>
      <p>${T.shareBody}</p>
      <div class="share-row">
        <input class="share-url" id="shareUrl" readonly value="${escapeHtml(buildShareUrl(inputs))}">
        <button class="btn btn-primary" type="button" id="copyShareBtn">${T.btnCopyLink}</button>
      </div>
    </div>

    <div class="result-section" style="text-align: center;">
      <div class="print-actions">
        <button class="btn btn-primary" type="button" id="savePdfBtn">${T.btnSaveAsPdf}</button>
        <button class="btn" type="button" id="printBtn">${T.btnPrint}</button>
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

  // Save as PDF / Print — both call window.print(), the browser's
  // print-to-PDF dialog handles the actual file generation. Our
  // @media print CSS in wizard.css does the layout work.
  const savePdfBtn = document.getElementById('savePdfBtn');
  const printBtn = document.getElementById('printBtn');
  if (savePdfBtn) savePdfBtn.addEventListener('click', () => window.print());
  if (printBtn) printBtn.addEventListener('click', () => window.print());
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

async function loadFromShareUrl(b64url) {
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

const sharedPlanParam = new URLSearchParams(window.location.search).get('p');
if (sharedPlanParam) {
  loadFromShareUrl(sharedPlanParam);
} else {
  showStep(1);
}
