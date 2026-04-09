const ORDER_KEY = 'orcatradeComplianceOrder';
const RECOVERY_KEY = 'orcatradeComplianceRecovery';
const FACT_TO_FIELD_MAP = [
  { pattern: /cn\s*\/?\s*hs|goods classification|classification/i, fieldId: 'cnCode', label: 'CN / HS code' },
  { pattern: /authori[sz]ed.*declarant|declarant status/i, fieldId: 'authorisedDeclarant', label: 'Authorised declarant status' },
  { pattern: /supplier emissions|embedded emissions|emissions data/i, fieldId: 'supplierEmissionsData', label: 'Supplier emissions data' },
  { pattern: /geolocation|polygon|plot-level/i, fieldId: 'geolocationAvailable', label: 'Plot-level geolocation evidence' },
  { pattern: /due[- ]?diligence statement|due diligence/i, fieldId: 'dueDiligenceStatement', label: 'Due-diligence statement' },
  { pattern: /global turnover|turnover/i, fieldId: 'globalTurnover', label: 'Global turnover' },
  { pattern: /employee count/i, fieldId: 'employeeCount', label: 'Exact employee count' },
  { pattern: /company size|operator size/i, fieldId: 'companySize', label: 'Company size' },
  { pattern: /country of origin|origin/i, fieldId: 'origin', label: 'Country of origin' },
  { pattern: /product description|commodity classification|goods description/i, fieldId: 'productDescription', label: 'Product description' },
];

function buildReportCacheKey(orderData) {
  return {
    productCategory: orderData.productCategory || '',
    productDescription: orderData.productDescription || '',
    origin: orderData.origin || '',
    supplierName: orderData.supplierName || '',
    importValue: orderData.importValue || '',
    companySize: orderData.companySize || '',
    employeeCount: orderData.employeeCount || '',
    globalTurnover: orderData.globalTurnover || orderData.companyTurnover || orderData.turnover || '',
    cnCode: orderData.cnCode || orderData.hsCode || '',
    geolocationAvailable: orderData.geolocationAvailable ?? '',
    dueDiligenceStatement: orderData.dueDiligenceStatement ?? '',
    supplierEmissionsData: orderData.supplierEmissionsData ?? '',
    authorisedDeclarant: orderData.authorisedDeclarant ?? '',
    euMarket: orderData.euMarket !== false,
  };
}

function readWorkflowState(key) {
  const cache = window.OrcaTradeCachePreference;
  if (cache) return cache.readWorkflowState(key);
  return window.localStorage.getItem(key);
}

function writeWorkflowState(key, value) {
  const cache = window.OrcaTradeCachePreference;
  if (cache) {
    cache.writeWorkflowState(key, value);
    return;
  }
  window.localStorage.setItem(key, value);
}

function buildRecoveryState(readiness, report) {
  const missingFacts = [];

  (Array.isArray(readiness?.missingCriticalFacts) ? readiness.missingCriticalFacts : []).forEach(item => {
    (Array.isArray(item.missingFacts) ? item.missingFacts : []).forEach(fact => missingFacts.push(fact));
  });

  (Array.isArray(report?.requiredEvidenceChecklist) ? report.requiredEvidenceChecklist : []).forEach(item => {
    (Array.isArray(item.missingCriticalFacts) ? item.missingCriticalFacts : []).forEach(fact => missingFacts.push(fact));
  });

  const fieldIds = [];
  const fieldLabels = [];

  missingFacts.forEach(fact => {
    FACT_TO_FIELD_MAP.forEach(mapping => {
      if (mapping.pattern.test(String(fact || '')) && !fieldIds.includes(mapping.fieldId)) {
        fieldIds.push(mapping.fieldId);
        fieldLabels.push(mapping.label);
      }
    });
  });

  if (!fieldIds.length) return null;

  return {
    fieldIds,
    fieldLabels,
  };
}

document.addEventListener('DOMContentLoaded', async () => {
  const loadingState   = document.getElementById('loadingState');
  const resultsContainer = document.getElementById('resultsContainer');
  const loadingText    = document.getElementById('loadingText');
  const cache = window.OrcaTradeCachePreference;

  const orderDataStr = readWorkflowState(ORDER_KEY);
  if (!orderDataStr) {
    window.location.href = 'index.html';
    return;
  }

  const orderData = JSON.parse(orderDataStr);
  const reportCacheKey = buildReportCacheKey(orderData);

  if (cache) {
    const cachedPayload = cache.getCachedJson('compliance-report', reportCacheKey);
    if (cachedPayload) {
      renderResults(cachedPayload, orderData);
      loadingState.style.display = 'none';
      resultsContainer.style.display = 'block';

      const dlBtn = document.getElementById('downloadBtn');
      if (dlBtn) {
        dlBtn.addEventListener('click', () => {
          const originalTitle = document.title;
          const rid = cachedPayload.reportId || 'report';
          document.title = 'OrcaTrade-Compliance-' + rid;
          window.print();
          setTimeout(() => { document.title = originalTitle; }, 1000);
        });
      }

      return;
    }
  }

  // Loading animation
  const steps = [
    'Checking EUDR tracing requirements…',
    'Verifying CBAM sector coverage…',
    'Scanning CSDDD thresholds…',
    'Cross-referencing regulatory database…',
    'Calculating financial exposure…',
    'Generating compliance report…',
  ];
  let stepIndex = 0;
  const interval = setInterval(() => {
    if (stepIndex < steps.length) loadingText.textContent = steps[stepIndex++];
  }, 1200);

  let payload = null;

  try {
    const res = await fetch('/api/check', {
      method: 'POST',
      headers: Object.assign(
        { 'Content-Type': 'application/json' },
        cache ? cache.getRequestHeaders() : {}
      ),
      body: orderDataStr,
    });

    if (res.ok) {
      payload = await res.json();
      if (cache) {
        cache.setCachedJson('compliance-report', reportCacheKey, payload, 10 * 60 * 1000);
      }
    } else {
      const err = await res.json().catch(() => ({}));
      console.error('API error:', err);
      showError(err.error || 'The compliance engine returned an error. Please try again.', err.details);
      clearInterval(interval);
      return;
    }
  } catch (err) {
    console.error('Fetch error:', err);
    showError('Could not reach the compliance engine. Check your connection and try again.');
    clearInterval(interval);
    return;
  }

  clearInterval(interval);
  renderResults(payload, orderData);
  loadingState.style.display = 'none';
  resultsContainer.style.display = 'block';

  // PDF download
  const dlBtn = document.getElementById('downloadBtn');
  if (dlBtn) {
    dlBtn.addEventListener('click', () => {
      const originalTitle = document.title;
      const rid = payload.reportId || 'report';
      document.title = 'OrcaTrade-Compliance-' + rid;
      window.print();
      setTimeout(() => { document.title = originalTitle; }, 1000);
    });
  }
});

function showError(message, details) {
  const list = Array.isArray(details) && details.length
    ? `<div style="margin:1rem auto 2rem;max-width:42ch;text-align:left;padding:1rem;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);">
         <div style="font-size:0.72rem;letter-spacing:0.14em;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.55rem;">What is missing</div>
         ${details.map(item => `<div style="margin-bottom:0.35rem;color:var(--text-muted);">• ${esc(item)}</div>`).join('')}
       </div>`
    : '';

  const loadingState = document.getElementById('loadingState');
  loadingState.innerHTML = `
    <div style="text-align:center; padding:3rem;">
      <div style="font-size:2rem; margin-bottom:1rem;">⚠</div>
      <h2 style="color:var(--accent-color); margin-bottom:0.75rem;">Report generation failed</h2>
      <p style="color:var(--text-muted); max-width:40ch; margin:0 auto 2rem;">${message}</p>
      ${list}
      <a href="index.html" class="btn btn-outline" style="border-radius:0;border:1px solid var(--accent-color);color:var(--accent-color);padding:0.6rem 1.4rem;">Try again</a>
    </div>`;
}

function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function fmtEur(n) {
  if (!n && n !== 0) return '—';
  return '€' + Number(n).toLocaleString('en-GB');
}

function severityBadge(s) {
  const map = { critical:'#c94a4a', major:'#c9893a', minor:'#6f7783' };
  const col = map[s] || '#6f7783';
  return `<span style="font-size:0.68rem;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;padding:0.2rem 0.55rem;border:1px solid ${col};color:${col};">${esc(s)}</span>`;
}

function urgencyBadge(u) {
  const col = u && u.toLowerCase().includes('immediate') ? '#c94a4a'
            : u && u.toLowerCase().includes('30')        ? '#c9893a'
            : '#6f7783';
  return `<span style="font-size:0.68rem;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;padding:0.2rem 0.55rem;border:1px solid ${col};color:${col};">${esc(u)}</span>`;
}

function triStateLabel(value) {
  if (value === true || value === 'true') return 'Yes';
  if (value === false || value === 'false') return 'No';
  return 'Unknown';
}

function statusPill(status) {
  const map = {
    compliant:      { label:'COMPLIANT',      bg:'rgba(80,180,100,0.12)', border:'rgba(80,180,100,0.4)', color:'#5cb884' },
    at_risk:        { label:'AT RISK',         bg:'rgba(200,140,50,0.12)', border:'rgba(200,140,50,0.4)', color:'#c98f3a' },
    non_compliant:  { label:'NON-COMPLIANT',   bg:'rgba(200,70,70,0.12)',  border:'rgba(200,70,70,0.4)',  color:'#c95050' },
    not_applicable: { label:'NOT APPLICABLE',  bg:'rgba(100,100,120,0.1)', border:'rgba(100,100,120,0.3)', color:'#6f7783' },
  };
  const s = map[status] || map.not_applicable;
  return `<span style="font-size:0.72rem;font-weight:700;letter-spacing:0.12em;padding:0.3rem 0.8rem;border:1px solid ${s.border};background:${s.bg};color:${s.color};">${s.label}</span>`;
}

function applicabilityPill(status) {
  const map = {
    applicable:      { label: 'ACTIVE NOW', bg: 'rgba(80,180,100,0.12)', border: 'rgba(80,180,100,0.4)', color: '#5cb884' },
    future_scope:    { label: 'FUTURE SCOPE', bg: 'rgba(80,120,180,0.12)', border: 'rgba(80,120,180,0.35)', color: '#7ea5d8' },
    insufficient_data: { label: 'MISSING FACTS', bg: 'rgba(200,140,50,0.12)', border: 'rgba(200,140,50,0.35)', color: '#c98f3a' },
    not_applicable:  { label: 'OUT OF SCOPE', bg: 'rgba(100,100,120,0.1)', border: 'rgba(100,100,120,0.3)', color: '#6f7783' },
  };
  const s = map[status] || map.not_applicable;
  return `<span style="font-size:0.66rem;font-weight:700;letter-spacing:0.11em;padding:0.25rem 0.65rem;border:1px solid ${s.border};background:${s.bg};color:${s.color};">${s.label}</span>`;
}

function readinessPill(level) {
  const map = {
    evidence_backed: { label: 'EVIDENCE-BACKED', bg: 'rgba(80,180,100,0.12)', border: 'rgba(80,180,100,0.4)', color: '#5cb884' },
    provisional: { label: 'PROVISIONAL', bg: 'rgba(200,140,50,0.12)', border: 'rgba(200,140,50,0.4)', color: '#c98f3a' },
    blocked: { label: 'BLOCKED', bg: 'rgba(200,70,70,0.12)', border: 'rgba(200,70,70,0.4)', color: '#c95050' },
    screening_only: { label: 'SCREENING ONLY', bg: 'rgba(100,100,120,0.1)', border: 'rgba(100,100,120,0.3)', color: '#6f7783' },
  };
  const value = map[level] || map.screening_only;
  return `<span style="font-size:0.72rem;font-weight:700;letter-spacing:0.12em;padding:0.35rem 0.85rem;border:1px solid ${value.border};background:${value.bg};color:${value.color};">${value.label}</span>`;
}

const REG_FULL_NAMES = {
  EUDR:  'EU Deforestation Regulation (EU) 2023/1115',
  CBAM:  'Carbon Border Adjustment Mechanism (EU) 2023/956',
  CSDDD: 'Corporate Sustainability Due Diligence Directive (EU) 2024/1760',
};

function renderResults(res, orderData) {
  // Report ID
  const reportId = res.reportId || '—';
  const timestamp = res.timestamp ? new Date(res.timestamp).toLocaleString('en-GB', { dateStyle:'long', timeStyle:'short' }) : new Date().toLocaleString('en-GB');

  const el = id => document.getElementById(id);

  el('reportId').textContent      = reportId;
  el('reportTimestamp').textContent = timestamp;
  el('reportProduct').textContent   = `${orderData.productCategory || 'Product'} — ${orderData.productDescription || ''}`;
  el('reportOrigin').textContent    = orderData.origin    || '—';
  el('reportSupplier').textContent  = orderData.supplierName || 'Not provided';
  el('reportImportValue').textContent = orderData.importValue || '—';
  el('reportCompanySize').textContent = orderData.companySize || '—';
  el('reportCnCode').textContent = orderData.cnCode || orderData.hsCode || 'Not provided';
  el('reportEmployeeCount').textContent = orderData.employeeCount || 'Not provided';
  el('reportGlobalTurnover').textContent = orderData.globalTurnover || orderData.companyTurnover || orderData.turnover || 'Not provided';

  // Overall status badge
  const badge = el('overallStatusBadge');
  badge.className = `status-large ${res.overallStatus}`;
  badge.textContent = res.overallStatus === 'compliant' ? 'COMPLIANT'
                    : res.overallStatus === 'at_risk'   ? 'AT RISK'
                    : 'NON-COMPLIANT';

  el('overallScoreText').textContent = res.overallScore ?? '—';

  // Executive summary
  if (res.executiveSummary) {
    el('executiveSummary').textContent = res.executiveSummary;
    el('execSummaryBox').style.display = 'block';
  }

  const readiness = res.decisionReadiness || null;
  if (readiness) {
    el('decisionReadinessCard').style.display = 'block';
    el('decisionReadinessBadge').innerHTML = readinessPill(readiness.level);
    el('decisionReadinessSummary').textContent = readiness.summary || 'The backend did not return a readiness summary.';
    el('decisionEligibilityText').textContent = readiness.finalDecisionEligible === false
      ? 'Final verdict blocked until the missing critical facts are provided.'
      : readiness.screeningOnly
        ? 'This is a screening result because no regulation is currently active.'
        : 'The backend can issue a current verdict on the provided facts.';
    el('decisionEvidenceMode').textContent = res.reportGeneration?.mode === 'deterministic_fallback'
      ? 'Rule-only fallback report'
      : readiness.level === 'evidence_backed'
        ? 'Structured evidence-backed decision'
        : readiness.level === 'screening_only'
          ? 'Initial regulatory screening'
          : 'Structured decision with missing evidence or unresolved gaps';

    const factsBox = el('decisionFactsBox');
    const factsList = el('decisionFactsList');
    const missingFacts = Array.isArray(readiness.missingCriticalFacts) ? readiness.missingCriticalFacts : [];
    if (missingFacts.length) {
      factsBox.style.display = 'block';
      factsList.innerHTML = missingFacts.map(item => {
        const facts = Array.isArray(item.missingFacts) ? item.missingFacts.map(esc).join(', ') : 'Required facts not provided';
        return `<div style="margin-bottom:0.4rem;"><strong style="color:var(--text-primary);">${esc(item.regulation)}:</strong> ${facts}</div>`;
      }).join('');
    } else {
      factsBox.style.display = 'none';
      factsList.innerHTML = '';
    }

    const checklist = Array.isArray(res.requiredEvidenceChecklist) ? res.requiredEvidenceChecklist : [];
    el('decisionChecklist').innerHTML = checklist.map(item => {
      const state = item.applicabilityStatus === 'not_applicable'
        ? 'Out of scope on current facts'
        : item.applicabilityStatus === 'future_scope'
          ? 'Future readiness only'
          : item.finalDecisionEligible
            ? 'Final verdict can be issued'
            : 'Missing critical facts';

      const copy = item.missingCriticalFacts && item.missingCriticalFacts.length
        ? `Missing: ${item.missingCriticalFacts.map(esc).join(', ')}.`
        : item.nextDecisionAction
          ? esc(item.nextDecisionAction)
          : 'No additional evidence requirement returned.';

      return `
        <div class="decision-check-item">
          <div class="decision-check-title">
            <span>${esc(item.regulation)}</span>
            ${applicabilityPill(item.applicabilityStatus)}
          </div>
          <div style="font-size:0.78rem;color:var(--text-primary);margin-bottom:0.35rem;">${esc(state)}</div>
          <div class="decision-check-copy">${copy}</div>
        </div>`;
    }).join('');

    const recoveryActions = el('decisionRecoveryActions');
    const recoveryState = buildRecoveryState(readiness, res);
    if (recoveryActions) {
      if ((readiness.level === 'blocked' || readiness.level === 'provisional') && recoveryState) {
        recoveryActions.style.display = 'block';
        recoveryActions.innerHTML = `
          <div style="font-size:0.8rem;color:var(--text-muted);margin-bottom:0.8rem;">
            ${readiness.level === 'blocked'
              ? 'This report is blocked by missing facts. Return to the intake form and complete the highlighted fields.'
              : 'This report can be strengthened. Return to the intake form and add the highlighted evidence fields.'}
          </div>
          <button type="button" id="completeMissingFactsBtn" class="btn btn-outline" style="border-radius:0;padding:0.75rem 1.2rem;border:1px solid var(--accent-color);color:var(--accent-color);">
            Complete Missing Facts
          </button>
        `;

        const button = document.getElementById('completeMissingFactsBtn');
        if (button) {
          button.addEventListener('click', () => {
            writeWorkflowState(ORDER_KEY, JSON.stringify(orderData));
            writeWorkflowState(RECOVERY_KEY, JSON.stringify({
              ...recoveryState,
              message: readiness.level === 'blocked'
                ? 'Complete the highlighted fields before OrcaTrade can safely issue a final verdict.'
                : 'Complete the highlighted fields to strengthen the next report and reduce provisional risk.',
            }));
            window.location.href = 'index.html#complianceForm';
          });
        }
      } else {
        recoveryActions.style.display = 'none';
        recoveryActions.innerHTML = '';
      }
    }
  }

  // Regulation cards
  const container = el('regulationsContainer');
  let html = '';

  (res.checkedRegulations || []).forEach(reg => {
    const fullName = REG_FULL_NAMES[reg.regulation] || reg.regulation;
    const hasFindings = reg.findings && reg.findings.length > 0;
    const hasActions  = reg.requiredActions && reg.requiredActions.length > 0;
    const fr = reg.financialRisk || {};

    html += `
    <div class="reg-card glass-panel">
      <div class="reg-card-header">
        <div>
          <div style="font-size:0.68rem;font-weight:700;text-transform:uppercase;letter-spacing:0.16em;color:var(--text-muted);margin-bottom:0.35rem;">${esc(reg.regulation)}</div>
          <h3 class="reg-title" style="font-size:1rem;margin-bottom:0.5rem;">${esc(fullName)}</h3>
          <div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;margin-bottom:0.5rem;">
            ${applicabilityPill(reg.applicabilityStatus)}
            ${reg.futureApplicabilityDate ? `<span style="font-size:0.72rem;color:var(--text-muted);">Relevant date: ${esc(reg.futureApplicabilityDate)}</span>` : ''}
          </div>
          <div style="font-size:0.78rem;color:var(--text-muted);">${esc(reg.applicabilityReason)}</div>
        </div>
        <div>${statusPill(reg.status)}</div>
      </div>

      ${(reg.missingFacts && reg.missingFacts.length > 0) ? `
      <div style="font-size:0.8rem;background:rgba(200,140,50,0.07);border:1px solid rgba(200,140,50,0.2);padding:0.8rem 1rem;margin:1rem 0;">
        <strong style="color:#c98f3a;">Missing facts:</strong> ${reg.missingFacts.map(esc).join(', ')}
      </div>` : ''}

      ${(reg.readinessActions && reg.readinessActions.length > 0) ? `
      <div style="margin-bottom:1rem;">
        <div style="font-size:0.72rem;font-weight:700;text-transform:uppercase;letter-spacing:0.14em;color:#7ea5d8;margin-bottom:0.55rem;">Readiness Actions</div>
        <div style="font-size:0.82rem;color:var(--text-muted);line-height:1.65;">
          ${reg.readinessActions.map(action => `<div style="margin-bottom:0.35rem;">• ${esc(action)}</div>`).join('')}
        </div>
      </div>` : ''}

        ${(reg.confidence || reg.nextDecisionAction || (reg.evidenceSignals && reg.evidenceSignals.length > 0)) ? `
      <div style="font-size:0.78rem;color:var(--text-muted);border-top:1px solid var(--border-color);padding-top:0.8rem;margin-bottom:1rem;">
        ${reg.confidence ? `<div style="margin-bottom:0.35rem;"><strong style="color:var(--text-primary);">Decision confidence:</strong> ${esc(reg.confidence)}</div>` : ''}
        ${reg.nextDecisionAction ? `<div style="margin-bottom:0.35rem;"><strong style="color:var(--text-primary);">Next decision action:</strong> ${esc(reg.nextDecisionAction)}</div>` : ''}
        ${(reg.evidenceSignals && reg.evidenceSignals.length > 0) ? `<div><strong style="color:var(--text-primary);">Signals used:</strong> ${reg.evidenceSignals.map(esc).join(' · ')}</div>` : ''}
      </div>` : ''}

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:0.45rem 0.8rem;font-size:0.76rem;color:var(--text-muted);margin-bottom:1rem;">
        <div><strong style="color:var(--text-primary);">Manual review:</strong> ${reg.requiresManualReview ? 'Required' : 'Not required'}</div>
        <div><strong style="color:var(--text-primary);">Geolocation ready:</strong> ${reg.regulation === 'EUDR' ? triStateLabel(orderData.geolocationAvailable) : 'N/A'}</div>
        <div><strong style="color:var(--text-primary);">Due-diligence ready:</strong> ${reg.regulation === 'EUDR' ? triStateLabel(orderData.dueDiligenceStatement) : 'N/A'}</div>
        <div><strong style="color:var(--text-primary);">CBAM declarant:</strong> ${reg.regulation === 'CBAM' ? triStateLabel(orderData.authorisedDeclarant) : 'N/A'}</div>
        <div><strong style="color:var(--text-primary);">Supplier emissions:</strong> ${reg.regulation === 'CBAM' ? triStateLabel(orderData.supplierEmissionsData) : 'N/A'}</div>
        <div><strong style="color:var(--text-primary);">CN / HS code:</strong> ${esc(orderData.cnCode || orderData.hsCode || 'Not provided')}</div>
      </div>

      ${reg.keyObligation ? `<div style="font-style:italic;font-size:0.88rem;color:var(--text-muted);border-left:2px solid var(--accent-color);padding-left:0.9rem;margin:1rem 0;">${esc(reg.keyObligation)}</div>` : ''}
      ${reg.currentGap && reg.currentGap !== 'N/A' ? `<div style="font-size:0.85rem;background:rgba(200,70,70,0.07);border:1px solid rgba(200,70,70,0.2);padding:0.8rem 1rem;margin-bottom:1rem;"><strong style="color:#c95050;">Gap identified:</strong> ${esc(reg.currentGap)}</div>` : ''}

      ${hasFindings ? `
      <div style="margin-bottom:1.2rem;">
        <div style="font-size:0.72rem;font-weight:700;text-transform:uppercase;letter-spacing:0.14em;color:var(--text-muted);margin-bottom:0.75rem;">Findings</div>
        ${reg.findings.map(f => `
          <div class="finding-row" style="padding:0.85rem 0;border-bottom:1px solid var(--border-color);">
            <div style="display:flex;align-items:flex-start;gap:0.75rem;flex-wrap:wrap;margin-bottom:0.4rem;">
              ${severityBadge(f.severity)}
              <span style="font-size:0.8rem;color:var(--text-muted);font-style:italic;">${esc(f.article)}</span>
            </div>
            <div style="font-size:0.9rem;margin-bottom:0.3rem;">${esc(f.finding)}</div>
            <div style="font-size:0.8rem;color:var(--text-muted);">${esc(f.legalImplication)}</div>
          </div>`).join('')}
      </div>` : ''}

      ${hasActions ? `
      <div style="margin-bottom:1.2rem;">
        <div style="font-size:0.72rem;font-weight:700;text-transform:uppercase;letter-spacing:0.14em;color:var(--accent-color);margin-bottom:0.75rem;">Required Actions</div>
        ${reg.requiredActions.map(a => `
          <div style="padding:0.9rem;background:rgba(184,190,200,0.04);border:1px solid var(--border-color);margin-bottom:0.6rem;">
            <div style="display:flex;align-items:center;gap:0.6rem;margin-bottom:0.5rem;">
              <span style="font-size:0.72rem;font-weight:700;color:var(--accent-color);min-width:1.6rem;">0${a.step}</span>
              <span style="font-size:0.9rem;font-weight:500;">${esc(a.action)}</span>
            </div>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:0.4rem 1.2rem;font-size:0.78rem;color:var(--text-muted);padding-left:2.2rem;">
              ${a.documentRequired ? `<div><strong style="color:var(--text-primary);">Document:</strong> ${esc(a.documentRequired)}</div>` : ''}
              ${a.portal ? `<div><strong style="color:var(--text-primary);">Portal:</strong> ${esc(a.portal)}</div>` : ''}
              ${a.deadline ? `<div><strong style="color:#c95050;">Deadline:</strong> ${esc(a.deadline)}</div>` : ''}
              ${a.estimatedCostEur ? `<div><strong style="color:var(--text-primary);">Est. cost:</strong> ${esc(a.estimatedCostEur)}</div>` : ''}
              ${a.estimatedHours ? `<div><strong style="color:var(--text-primary);">Est. hours:</strong> ${esc(a.estimatedHours)}h</div>` : ''}
            </div>
          </div>`).join('')}
      </div>` : ''}

      <div class="financial-risk-box" style="background:rgba(0,0,0,0.25);border:1px solid var(--border-color);padding:1rem 1.2rem;margin-top:0.5rem;">
        <div style="font-size:0.72rem;font-weight:700;text-transform:uppercase;letter-spacing:0.14em;color:var(--text-muted);margin-bottom:0.75rem;">Financial Risk — ${esc(reg.legalBasis ? `per ${reg.legalBasis.split(' of the ')[0]}` : reg.regulation)}</div>
        <div style="display:flex;gap:2rem;flex-wrap:wrap;margin-bottom:0.75rem;">
          <div><div style="font-size:0.7rem;color:var(--text-muted);">Minimum fine</div><div style="font-size:1.1rem;font-weight:600;color:${fr.minimumFineEur > 0 ? '#c95050' : 'var(--text-muted)'};">${fmtEur(fr.minimumFineEur)}</div></div>
          <div><div style="font-size:0.7rem;color:var(--text-muted);">Maximum fine</div><div style="font-size:1.1rem;font-weight:600;color:${fr.maximumFineEur > 0 ? '#c95050' : 'var(--text-muted)'};">${fmtEur(fr.maximumFineEur)}</div></div>
        </div>
        ${fr.calculationExplained ? `<div style="font-size:0.8rem;color:var(--text-muted);font-style:italic;margin-bottom:0.5rem;">${esc(fr.calculationExplained)}</div>` : ''}
        ${fr.additionalRisks && fr.additionalRisks.length > 0 ? `<div style="font-size:0.78rem;color:var(--text-muted);">${fr.additionalRisks.map(r => `<span style="display:inline-block;margin-right:0.75rem;">• ${esc(r)}</span>`).join('')}</div>` : ''}
      </div>

      ${reg.complianceDeadline ? `<div style="font-size:0.78rem;color:var(--text-muted);margin-top:0.75rem;"><strong>Compliance deadline:</strong> ${esc(reg.complianceDeadline)}</div>` : ''}
    </div>`;
  });

  container.innerHTML = html;

  // Priority actions
  const prioList = el('priorityList');
  if (res.priorityActions && res.priorityActions.length > 0) {
    prioList.innerHTML = res.priorityActions.map(a => `
      <div class="prio-action" style="margin-bottom:1rem;padding:1rem;background:rgba(184,190,200,0.04);border:1px solid var(--border-color);">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:0.5rem;margin-bottom:0.5rem;">
          <div style="display:flex;align-items:center;gap:0.75rem;">
            <div class="prio-num" style="min-width:1.8rem;height:1.8rem;display:flex;align-items:center;justify-content:center;border:1px solid var(--accent-color);font-size:0.8rem;font-weight:700;color:var(--accent-color);">${a.rank}</div>
            <span style="font-weight:500;">${esc(a.action)}</span>
          </div>
          ${urgencyBadge(a.urgency)}
        </div>
        <div style="display:flex;gap:1.5rem;flex-wrap:wrap;font-size:0.78rem;color:var(--text-muted);padding-left:2.55rem;">
          ${a.estimatedCostEur ? `<span><strong style="color:var(--text-primary);">Cost:</strong> ${esc(a.estimatedCostEur)}</span>` : ''}
          ${a.consequenceIfIgnored ? `<span><strong style="color:#c95050;">If ignored:</strong> ${esc(a.consequenceIfIgnored)}</span>` : ''}
        </div>
      </div>`).join('');
  } else {
    el('priorityCard').style.display = 'none';
  }

  // Total financial exposure
  const exp = res.totalFinancialExposure;
  if (exp && (exp.minimumEur || exp.maximumEur)) {
    el('exposureCard').style.display = 'block';
    el('exposureMin').textContent = fmtEur(exp.minimumEur);
    el('exposureMax').textContent = fmtEur(exp.maximumEur);
    if (exp.calculationBreakdown) el('exposureBreakdown').textContent = exp.calculationBreakdown;
  }

  // Disclaimer
  if (res.disclaimer) {
    el('disclaimer').textContent = res.disclaimer;
    el('disclaimerBox').style.display = 'block';
  }

  // Footer report ID
  const footerRid = el('footerReportId');
  if (footerRid) footerRid.textContent = reportId;
}
