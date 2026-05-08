// /account/billing/ client (Sprint 41).
// Calls /api/billing/me to render current tier + customer status, opens
// the Stripe portal on demand, surfaces ?success=1 after a Checkout return.

(function () {
  'use strict';

  var els = {
    loading: document.getElementById('state-loading'),
    signin: document.getElementById('state-signin'),
    loaded: document.getElementById('state-loaded'),
    successMsg: document.getElementById('success-msg'),
    tierPill: document.getElementById('tier-pill'),
    email: document.getElementById('email'),
    billing: document.getElementById('billing'),
    since: document.getElementById('since'),
    source: document.getElementById('source'),
    portalBtn: document.getElementById('portal-btn'),
    err: document.getElementById('err'),
  };

  function hide(el) { el.hidden = true; }
  function show(el) { el.hidden = false; }
  function fmtDate(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toISOString().slice(0, 10);
  }
  function tierLabel(id) {
    return ({ free: 'Free', starter: 'Starter', growth: 'Growth', scale: 'Scale', enterprise: 'Enterprise' }[id]) || id;
  }

  function renderLoaded(data) {
    hide(els.loading);
    show(els.loaded);
    var params = new URLSearchParams(window.location.search);
    if (params.get('success') === '1') show(els.successMsg);

    els.tierPill.textContent = tierLabel(data.tierId);
    els.tierPill.classList.add('tier-' + (data.tierId || 'free'));
    if (data.tierId !== 'free') els.tierPill.classList.add('tier-active');
    els.email.textContent = data.email || '—';
    els.billing.textContent = data.billingCycle ? data.billingCycle : '—';
    els.since.textContent = fmtDate(data.since);
    els.source.textContent = data.source || 'default';

    if (data.hasStripeCustomer) {
      show(els.portalBtn);
      els.portalBtn.addEventListener('click', openPortal);
    }
  }

  function openPortal() {
    els.portalBtn.disabled = true;
    els.err.textContent = '';
    fetch('/api/billing/portal', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
    }).then(function (r) {
      return r.json().then(function (j) { return { status: r.status, json: j }; });
    }).then(function (out) {
      if (out.status === 200 && out.json.url) {
        window.location.href = out.json.url;
        return;
      }
      els.err.textContent = (out.json && out.json.error) || 'Could not open portal.';
      els.portalBtn.disabled = false;
    }).catch(function () {
      els.err.textContent = 'Network error.';
      els.portalBtn.disabled = false;
    });
  }

  fetch('/api/billing/me', { credentials: 'same-origin' }).then(function (r) {
    if (r.status === 401) {
      hide(els.loading);
      show(els.signin);
      return null;
    }
    return r.ok ? r.json() : null;
  }).then(function (data) {
    if (data) renderLoaded(data);
  }).catch(function () {
    hide(els.loading);
    show(els.signin);
  });
})();
