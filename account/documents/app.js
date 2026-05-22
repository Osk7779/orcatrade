// /account/documents/ — Sprint document-ui-v1 client.
// Lists the signed-in user's saved plans + the document types, then POSTs
// { type, fromPlanId } to /api/documents and opens the rendered draft in a new
// tab. Mirrors the auth-gating pattern of the other account pages.
(function () {
  'use strict';

  var els = {
    authNeeded: document.getElementById('authNeeded'),
    content: document.getElementById('content'),
    form: document.getElementById('form'),
    empty: document.getElementById('empty'),
    planSelect: document.getElementById('planSelect'),
    typeSelect: document.getElementById('typeSelect'),
    typeHint: document.getElementById('typeHint'),
    generate: document.getElementById('generate'),
    err: document.getElementById('err'),
  };

  var TYPE_DESCRIPTIONS = {};

  function showError(msg) {
    els.err.hidden = false;
    els.err.textContent = msg;
  }
  function clearError() {
    els.err.hidden = true;
    els.err.textContent = '';
  }

  function planLabel(plan) {
    var inp = plan.inputs || {};
    var route = (inp.originCountry || '?') + '→' + (inp.destinationCountry || '?');
    return (plan.label || plan.id) + ' · ' + (inp.productCategory || 'goods') + ' · ' + route;
  }

  async function loadPlans() {
    var resp = await fetch('/api/plans', { credentials: 'same-origin' });
    if (resp.status === 401) { els.authNeeded.hidden = false; return null; }
    els.content.hidden = false;
    if (!resp.ok) { showError('Could not load your plans (HTTP ' + resp.status + ').'); return null; }
    var data = await resp.json();
    return (data && data.plans) || [];
  }

  async function loadTypes() {
    var resp = await fetch('/api/documents', { credentials: 'same-origin' });
    if (!resp.ok) return [];
    var data = await resp.json();
    return (data && data.types) || [];
  }

  function fillSelect(select, items, valueKey, labelFn) {
    select.innerHTML = '';
    items.forEach(function (it) {
      var opt = document.createElement('option');
      opt.value = it[valueKey];
      opt.textContent = labelFn(it);
      select.appendChild(opt);
    });
  }

  function updateTypeHint() {
    els.typeHint.textContent = TYPE_DESCRIPTIONS[els.typeSelect.value] || '';
  }

  async function generate() {
    clearError();
    var type = els.typeSelect.value;
    var fromPlanId = els.planSelect.value;
    if (!type || !fromPlanId) { showError('Pick a plan and a document type.'); return; }
    els.generate.disabled = true;
    els.generate.textContent = 'Generating…';
    try {
      var resp = await fetch('/api/documents', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: type, fromPlanId: fromPlanId }),
      });
      if (!resp.ok) {
        var body = null;
        try { body = await resp.json(); } catch (_) { /* non-JSON */ }
        showError((body && body.error) ? body.error : ('Generation failed (HTTP ' + resp.status + ').'));
        return;
      }
      var html = await resp.text();
      var win = window.open('', '_blank');
      if (win) { win.document.open(); win.document.write(html); win.document.close(); }
      else { showError('Pop-up blocked — allow pop-ups to open the document.'); }
    } catch (err) {
      showError('Network error: ' + (err && err.message ? err.message : 'unknown'));
    } finally {
      els.generate.disabled = false;
      els.generate.textContent = 'Generate draft →';
    }
  }

  async function init() {
    try {
      var plans = await loadPlans();
      if (plans === null) return; // auth / error already surfaced
      if (!plans.length) { els.empty.hidden = false; return; }

      var types = await loadTypes();
      types.forEach(function (t) { TYPE_DESCRIPTIONS[t.id] = t.description || ''; });

      fillSelect(els.planSelect, plans, 'id', planLabel);
      fillSelect(els.typeSelect, types, 'id', function (t) { return t.label; });
      updateTypeHint();
      els.typeSelect.addEventListener('change', updateTypeHint);
      els.generate.addEventListener('click', generate);
      els.form.hidden = false;
    } catch (err) {
      els.content.hidden = false;
      showError('Network error: ' + (err && err.message ? err.message : 'unknown'));
    }
  }

  init();
})();
