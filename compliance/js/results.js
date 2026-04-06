document.addEventListener('DOMContentLoaded', async () => {
  const loadingState   = document.getElementById('loadingState');
  const resultsContainer = document.getElementById('resultsContainer');
  const loadingText    = document.getElementById('loadingText');

  const orderDataStr = localStorage.getItem('orcatradeComplianceOrder');
  if (!orderDataStr) {
    window.location.href = 'index.html';
    return;
  }

  const orderData = JSON.parse(orderDataStr);

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
      headers: { 'Content-Type': 'application/json' },
      body: orderDataStr,
    });

    if (res.ok) {
      payload = await res.json();
    } else {
      const err = await res.json().catch(() => ({}));
      console.error('API error:', err);
      showError(err.error || 'The compliance engine returned an error. Please try again.');
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

function showError(message) {
  const loadingState = document.getElementById('loadingState');
  loadingState.innerHTML = `
    <div style="text-align:center; padding:3rem;">
      <div style="font-size:2rem; margin-bottom:1rem;">⚠</div>
      <h2 style="color:var(--accent-color); margin-bottom:0.75rem;">Report generation failed</h2>
      <p style="color:var(--text-muted); max-width:40ch; margin:0 auto 2rem;">${message}</p>
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
          <div style="font-size:0.78rem;color:var(--text-muted);">${esc(reg.applicabilityReason)}</div>
        </div>
        <div>${statusPill(reg.status)}</div>
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