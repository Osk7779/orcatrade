// /account/orgs/sso/ — Sprint sso-oidc-v1 phase 3 client.
//
// Owner-only OIDC SSO config for an org (?org=<id>). Loads current config
// (clientSecret never returned — only "set" status), saves via POST, and
// removes via DELETE. Owner gating is enforced server-side (403 → gate).

(function () {
  'use strict';
  if (typeof document === 'undefined') return;

  var orgId = (function () {
    try { return new URLSearchParams(window.location.search).get('org') || ''; } catch (_) { return ''; }
  })();

  var els = {
    gate: document.getElementById('gate'),
    gateMsg: document.getElementById('gateMsg'),
    content: document.getElementById('content'),
    form: document.getElementById('ssoForm'),
    err: document.getElementById('err'),
    ok: document.getElementById('ok'),
    saveBtn: document.getElementById('saveBtn'),
    deleteBtn: document.getElementById('deleteBtn'),
    redirectUri: document.getElementById('redirectUri'),
    secretHint: document.getElementById('secretHint'),
  };
  var FIELDS = ['issuer', 'clientId', 'authorizationEndpoint', 'tokenEndpoint', 'jwksUri'];

  function setErr(m) { els.err.textContent = m || ''; }
  function setOk(html) { if (!html) { els.ok.hidden = true; els.ok.innerHTML = ''; return; } els.ok.hidden = false; els.ok.innerHTML = html; }

  if (!orgId) {
    els.gate.hidden = false;
    els.gateMsg.textContent = 'Open this page from your organisation (it needs an ?org= id).';
    return;
  }

  els.redirectUri.textContent = window.location.origin + '/api/auth/sso/callback';

  // Load current config (or gate on 403/401).
  fetch('/api/orgs/' + encodeURIComponent(orgId) + '/sso', { credentials: 'same-origin' })
    .then(function (r) {
      if (r.status === 401 || r.status === 403 || r.status === 404) { els.gate.hidden = false; return null; }
      return r.ok ? r.json() : null;
    })
    .then(function (data) {
      if (!data) return;
      els.content.hidden = false;
      var cfg = data.config || {};
      FIELDS.forEach(function (f) { if (cfg[f]) document.getElementById(f).value = cfg[f]; });
      if (Array.isArray(cfg.allowedDomains)) document.getElementById('allowedDomains').value = cfg.allowedDomains.join(', ');
      if (cfg.clientSecretSet) els.secretHint.textContent = 'A secret is already set. Leave blank to keep it.';
      if (data.configured) els.deleteBtn.hidden = false;
    })
    .catch(function () { els.content.hidden = false; setErr('Could not load SSO settings.'); });

  els.form.addEventListener('submit', function (e) {
    e.preventDefault();
    setErr(''); setOk('');
    var body = {};
    FIELDS.forEach(function (f) { body[f] = document.getElementById(f).value.trim(); });
    var secret = document.getElementById('clientSecret').value;
    if (secret) body.clientSecret = secret;
    var domains = document.getElementById('allowedDomains').value.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    if (domains.length) body.allowedDomains = domains;

    els.saveBtn.disabled = true; els.saveBtn.textContent = 'Saving…';
    fetch('/api/orgs/' + encodeURIComponent(orgId) + '/sso', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (resp) {
        els.saveBtn.disabled = false; els.saveBtn.textContent = 'Save SSO config';
        if (resp.ok && resp.j.ok) {
          els.deleteBtn.hidden = false;
          setOk('SSO saved ✓ Your team can sign in at:<br><code>' + escapeHtml(resp.j.initiateUrl || '') + '</code>');
        } else {
          setErr((resp.j && resp.j.error) || 'Could not save SSO config.');
        }
      })
      .catch(function () { els.saveBtn.disabled = false; els.saveBtn.textContent = 'Save SSO config'; setErr('Network error.'); });
  });

  els.deleteBtn.addEventListener('click', function () {
    if (!confirm('Remove SSO for this organisation? Members will fall back to email/password + magic-link.')) return;
    els.deleteBtn.disabled = true;
    fetch('/api/orgs/' + encodeURIComponent(orgId) + '/sso', { method: 'DELETE', credentials: 'same-origin' })
      .then(function (r) { return r.ok; })
      .then(function (ok) {
        els.deleteBtn.disabled = false;
        if (ok) { els.form.reset(); els.deleteBtn.hidden = true; setOk('SSO removed.'); }
        else setErr('Could not remove SSO.');
      })
      .catch(function () { els.deleteBtn.disabled = false; setErr('Network error.'); });
  });

  function escapeHtml(s) { var d = document.createElement('div'); d.textContent = String(s == null ? '' : s); return d.innerHTML; }
})();
