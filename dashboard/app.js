// Dashboard frontend — runs the activity aggregator over localStorage and renders panels.

(function () {
  'use strict';

  // Inline copy of the aggregator (the same code lives in lib/dashboard/state-aggregator.js
  // for unit testing under Node; this is the browser-side mirror).

  const ACTIVITY_KEYS = {
    commercialInvoice: { key: 'orcatrade.commercial-invoice.draft.v1', kind: 'document', label: 'Commercial Invoice', route: '../documents/commercial-invoice/' },
    packingList: { key: 'orcatrade.packing-list.draft.v1', kind: 'document', label: 'Packing List', route: '../documents/packing-list/' },
    proformaInvoice: { key: 'orcatrade.proforma-invoice.draft.v1', kind: 'document', label: 'Proforma Invoice', route: '../documents/proforma-invoice/' },
    certificateOfOrigin: { key: 'orcatrade.certificate-of-origin.draft.v1', kind: 'document', label: 'Certificate of Origin', route: '../documents/certificate-of-origin/' },
    insuranceQuote: { key: 'orcatrade.insurance-quote.draft.v1', kind: 'quote', label: 'Insurance quote', route: '../insurance/quote/' },
    sampleRequest: { key: 'orcatrade.sample-request.draft.v1', kind: 'quote', label: 'Sample request', route: '../samples/request/' },
    returnsQuote: { key: 'orcatrade.returns-quote.draft.v1', kind: 'quote', label: 'Returns quote', route: '../returns/quote/' },
  };

  function readJson(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = String(text == null ? '' : text);
    return div.innerHTML;
  }

  function fmtEur(value) {
    if (value == null || Number.isNaN(Number(value))) return null;
    return new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(Number(value));
  }

  function describeDocument(data) {
    if (!data || typeof data !== 'object') return null;
    const parts = [];
    if (data.invoiceNumber) parts.push(escapeHtml(data.invoiceNumber));
    if (data.exporter && data.exporter.companyName) parts.push(`exporter ${escapeHtml(data.exporter.companyName)}`);
    if (data.consignee && data.consignee.companyName) parts.push(`buyer ${escapeHtml(data.consignee.companyName)}`);
    const items = Array.isArray(data.lineItems) ? data.lineItems.length : 0;
    if (items) parts.push(`${items} line${items === 1 ? '' : 's'}`);
    return parts.length ? parts.join(' · ') : 'Empty draft';
  }

  function describeInsurance(data) {
    if (!data || typeof data !== 'object') return null;
    const parts = [];
    if (data.cargoValueEur) parts.push(`${fmtEur(data.cargoValueEur)} cargo`);
    if (data.transportMode) parts.push(escapeHtml(data.transportMode.replace(/_/g, ' ')));
    if (data.originCountry && data.destinationCountry) parts.push(`${escapeHtml(data.originCountry)} → ${escapeHtml(data.destinationCountry)}`);
    if (data.goodsType) parts.push(escapeHtml(data.goodsType));
    return parts.length ? parts.join(' · ') : 'Quote draft';
  }

  function describeSamples(data) {
    if (!data || typeof data !== 'object') return null;
    const parts = [];
    if (data.supplierCount) parts.push(`${data.supplierCount} supplier${data.supplierCount === 1 ? '' : 's'}`);
    if (data.totalWeightKg) parts.push(`${data.totalWeightKg} kg`);
    if (data.destinationCountry) parts.push(`→ ${escapeHtml(data.destinationCountry)}`);
    if (data.express) parts.push('express');
    if (data.rushTurnaround) parts.push('rush');
    return parts.length ? parts.join(' · ') : 'Request draft';
  }

  function describeReturns(data) {
    if (!data || typeof data !== 'object') return null;
    const parts = [];
    if (data.piecesCount) parts.push(`${data.piecesCount} pcs`);
    if (data.totalWeightKg) parts.push(`${data.totalWeightKg} kg`);
    if (data.declaredValueEur) parts.push(`${fmtEur(data.declaredValueEur)} value`);
    if (data.category) parts.push(escapeHtml(data.category));
    return parts.length ? parts.join(' · ') : 'Returns draft';
  }

  function describeFor(name, data) {
    if (name === 'commercialInvoice' || name === 'packingList' || name === 'proformaInvoice' || name === 'certificateOfOrigin') return describeDocument(data);
    if (name === 'insuranceQuote') return describeInsurance(data);
    if (name === 'sampleRequest') return describeSamples(data);
    if (name === 'returnsQuote') return describeReturns(data);
    return null;
  }

  function buildActivity() {
    const items = [];
    for (const [name, def] of Object.entries(ACTIVITY_KEYS)) {
      const data = readJson(def.key);
      if (!data) continue;
      items.push({ name, kind: def.kind, label: def.label, route: def.route, description: describeFor(name, data) });
    }
    return items;
  }

  function timeOfDayGreeting() {
    const hour = new Date().getHours();
    if (hour < 5) return 'Working late';
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    if (hour < 22) return 'Good evening';
    return 'Working late';
  }

  function renderActivityRows(items) {
    if (!items.length) {
      return '<div class="panel-empty">No drafts yet. Save any form on the platform and it shows up here.</div>';
    }
    return `<div class="activity-list">${items.map(item => `
      <a class="activity-row" href="${item.route}">
        <div>
          <div class="activity-label">${escapeHtml(item.label)}</div>
          <div class="activity-meta">${item.description || 'Draft'}</div>
        </div>
        <span class="activity-cta">Open →</span>
      </a>
    `).join('')}</div>`;
  }

  function renderQuickActions(target) {
    const actions = [
      { icon: '∇', title: 'Run an EU compliance brief', sub: 'CBAM + EUDR + REACH + CE in one report', href: '../analysis/' },
      { icon: '↗', title: 'Talk to the Compliance Agent', sub: 'Tool-using AI with citations', href: '../agent/' },
      { icon: '∮', title: 'Insurance quote in 90 seconds', sub: 'Marine cargo, ICC A/B/C, partner brokers', href: '../insurance/quote/' },
      { icon: '∮', title: 'Verify a buyer', sub: 'Public-registry scoring + credit-band signals', href: '../buyer-verification/check/' },
      { icon: '≡', title: 'Generate a Commercial Invoice', sub: 'Customs-grade, printable, signable', href: '../documents/commercial-invoice/' },
      { icon: '∮', title: 'Plan a returns case', sub: 'Three routes ranked by cost vs recovery', href: '../returns/quote/' },
    ];
    target.innerHTML = actions.map(a => `
      <a class="quick-action" href="${a.href}">
        <span class="qa-icon">${a.icon}</span>
        <div>
          <div class="qa-title">${escapeHtml(a.title)}</div>
          <div class="qa-sub">${escapeHtml(a.sub)}</div>
        </div>
        <span class="qa-arrow">→</span>
      </a>
    `).join('');
  }

  function renderStats(activity) {
    const docs = activity.filter(a => a.kind === 'document').length;
    const quotes = activity.filter(a => a.kind === 'quote').length;
    const stats = [
      { label: 'Total drafts', value: activity.length, sub: 'Across all forms in this browser' },
      { label: 'Document drafts', value: docs, sub: 'Commercial invoice, packing list, proforma, CoO' },
      { label: 'Active quotes', value: quotes, sub: 'Insurance, samples, returns' },
      { label: 'Plan tier', value: 'Free', sub: 'Upgrade for unlimited usage' },
    ];
    document.getElementById('stats-row').innerHTML = stats.map(s => `
      <div class="stat-cell">
        <div class="stat-label">${escapeHtml(s.label)}</div>
        <div class="stat-value">${escapeHtml(String(s.value))}</div>
        <div class="stat-sub">${escapeHtml(s.sub)}</div>
      </div>
    `).join('');
  }

  // Bootstrap
  const session = window.OrcaAuth.requireSession();
  if (!session) return;

  document.getElementById('topbar-workspace').textContent = session.workspaceName;
  document.getElementById('topbar-user').textContent = `${session.name} · ${session.email} · ${session.role}`;
  document.getElementById('sidebar-user-name').textContent = session.name;
  document.getElementById('sidebar-user-email').textContent = session.email;

  document.getElementById('greeting-title').textContent = `${timeOfDayGreeting()}, ${session.name.split(' ')[0]}.`;
  document.getElementById('greeting-sub').textContent = 'Here\'s what you have in flight across the platform.';

  document.getElementById('signout-btn').addEventListener('click', () => {
    window.OrcaAuth.signOut();
    window.location.href = './login/';
  });

  const activity = buildActivity();
  renderStats(activity);
  document.getElementById('documents-panel').innerHTML = renderActivityRows(activity.filter(a => a.kind === 'document'));
  document.getElementById('quotes-panel').innerHTML = renderActivityRows(activity.filter(a => a.kind === 'quote'));
  renderQuickActions(document.getElementById('quick-actions'));
})();
