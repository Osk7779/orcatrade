// /dashboard/audit/ — admin event-by-event browser (Sprint BG-5.3).
//
// Token persists in sessionStorage so a reload doesn't kick the admin
// back to typing it. Same pattern as /dashboard/leads/.

(function () {
  'use strict';

  var STORAGE_KEY = 'orcatrade.audit.token';

  function el(id) { return document.getElementById(id); }

  function showErr(msg) {
    var e = el('errBanner');
    e.textContent = msg;
    e.hidden = false;
  }
  function clearErr() { el('errBanner').hidden = true; }

  function loadToken() {
    try {
      var saved = window.sessionStorage.getItem(STORAGE_KEY);
      if (saved) el('tokenInput').value = saved;
    } catch (_) {}
  }
  function saveToken(v) {
    try { window.sessionStorage.setItem(STORAGE_KEY, v); } catch (_) {}
  }

  function fmtTs(iso) {
    if (!iso) return '—';
    try {
      var d = new Date(iso);
      return d.toLocaleString('en-GB', { hour12: false });
    } catch (_) { return iso; }
  }

  function summarisePayload(evt) {
    // Strip identity fields + 'at' + 'type' — what remains is the payload.
    var rest = {};
    for (var k in evt) {
      if (k === 'at' || k === 'type' || k === 'emailHash' || k === 'pseudonymised' || k === 'pseudonymisedAt') continue;
      rest[k] = evt[k];
    }
    var parts = [];
    for (var k2 in rest) {
      var v = rest[k2];
      if (v == null) continue;
      if (typeof v === 'object') {
        // Inline a short summary (don't dump full JSON in the cell)
        var s = JSON.stringify(v);
        if (s.length > 60) s = s.slice(0, 57) + '…';
        parts.push(k2 + '=' + s);
      } else {
        parts.push(k2 + '=' + String(v));
      }
    }
    return parts.join(' · ');
  }

  function computeStats(events) {
    var byType = {};
    var withEmail = 0;
    var withinDay = 0;
    var oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    for (var i = 0; i < events.length; i++) {
      var e = events[i];
      byType[e.type] = (byType[e.type] || 0) + 1;
      if (e.emailHash) withEmail++;
      if (e.at && Date.parse(e.at) >= oneDayAgo) withinDay++;
    }
    return { byType: byType, withEmail: withEmail, withinDay: withinDay };
  }

  function renderStats(events) {
    var stats = computeStats(events);
    var distinct = Object.keys(stats.byType).length;
    el('stats').innerHTML = (
      '<div class="stat"><div class="num">' + events.length + '</div><div class="label">Events shown</div></div>'
      + '<div class="stat"><div class="num">' + stats.withinDay + '</div><div class="label">Last 24h</div></div>'
      + '<div class="stat"><div class="num">' + distinct + '</div><div class="label">Distinct event types</div></div>'
      + '<div class="stat"><div class="num">' + stats.withEmail + '</div><div class="label">With email hash</div></div>'
    );
  }

  function renderTable(events) {
    if (!events.length) {
      el('tableHost').innerHTML = '<div class="empty">No events to show for this filter.</div>';
      return;
    }
    var rows = [
      '<table class="events">'
      + '<thead><tr>'
      + '<th>When</th><th>Type</th><th>Email hash</th><th>Payload</th>'
      + '</tr></thead><tbody>'
    ];
    for (var i = 0; i < events.length; i++) {
      var e = events[i];
      var typeCell = 't-' + (e.type || '').replace(/[^a-z0-9_-]/gi, '');
      var hashCell = e.emailHash ? '<code>' + e.emailHash + '</code>' : '—';
      var payload = summarisePayload(e);
      rows.push(
        '<tr>'
        + '<td>' + escapeHtml(fmtTs(e.at)) + '</td>'
        + '<td class="' + typeCell + '">' + escapeHtml(e.type || '') + '</td>'
        + '<td class="hash">' + hashCell + '</td>'
        + '<td class="payload" title="' + escapeHtml(payload) + '">' + escapeHtml(payload) + '</td>'
        + '</tr>'
      );
    }
    rows.push('</tbody></table>');
    el('tableHost').innerHTML = rows.join('');
  }

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function refreshTypeFilterOptions(allowedTypes, currentValue) {
    var sel = el('typeFilter');
    if (!allowedTypes || !allowedTypes.length) return;
    var existing = Array.from(sel.options).map(function (o) { return o.value; });
    // Already populated — leave the existing selection in place.
    if (existing.length > 1) return;
    for (var i = 0; i < allowedTypes.length; i++) {
      var opt = document.createElement('option');
      opt.value = allowedTypes[i];
      opt.textContent = allowedTypes[i];
      sel.appendChild(opt);
    }
    if (currentValue) sel.value = currentValue;
  }

  // silent=true skips the "Token required" error on cold load when the
  // admin is signed in but hasn't pasted a token (Sprint admin-session-auth).
  async function refresh(silent) {
    clearErr();
    var token = el('tokenInput').value.trim();
    if (token) saveToken(token);
    var type = el('typeFilter').value || '';
    var limit = Number(el('limitInput').value) || 200;
    var qs = new URLSearchParams({ limit: String(limit) });
    if (token) qs.set('token', token);
    if (type) qs.set('type', type);
    el('reloadBtn').disabled = true;
    try {
      var res = await fetch('/api/audit?' + qs.toString(), { credentials: 'same-origin' });
      if (res.status === 401) {
        if (!silent) {
          showErr(token ? 'Unauthorized — check the token.' : 'Token required — paste your ORCATRADE_LEADS_TOKEN above.');
          el('stats').innerHTML = '';
          el('tableHost').innerHTML = '';
        }
        return false;
      }
      if (!res.ok) {
        if (!silent) showErr('Audit fetch failed: HTTP ' + res.status);
        return false;
      }
      var body = await res.json();
      refreshTypeFilterOptions(body.allowedTypes, type);
      renderStats(body.events || []);
      renderTable(body.events || []);
      el('lastChecked').textContent = 'Last checked: ' + new Date(body.asOf).toLocaleTimeString() + ' · ' + body.returned + ' of ' + (body.events || []).length;
      return true;
    } catch (err) {
      if (!silent) showErr('Network error: ' + err.message);
      return false;
    } finally {
      el('reloadBtn').disabled = false;
    }
  }

  // Sprint audit-csv-export-v1 — same auth path as the Reload button.
  // Cookie-first via credentials: same-origin; falls back to the token
  // input + sessionStorage cache if the operator pasted one. Fetches
  // the full CSV via Blob and triggers a hidden-<a> click using the
  // server-suggested filename. Disabled while in flight.
  function exportCsv() {
    var btn = el('exportCsvBtn');
    if (!btn) return;
    var token = (el('tokenInput').value || '').trim();
    var type = el('typeFilter').value || '';
    var qs = new URLSearchParams({ format: 'csv', limit: '5000' });
    if (token) qs.set('token', token);
    if (type) qs.set('type', type);
    btn.disabled = true;
    var orig = btn.textContent;
    btn.textContent = 'Exporting…';
    fetch('/api/audit?' + qs.toString(), { credentials: 'same-origin' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.blob().then(function (blob) {
          var match = (r.headers.get('content-disposition') || '').match(/filename="([^"]+)"/);
          var filename = match ? match[1] : 'orcatrade-audit.csv';
          var objectUrl = URL.createObjectURL(blob);
          var a = document.createElement('a');
          a.href = objectUrl; a.download = filename; a.style.display = 'none';
          document.body.appendChild(a);
          a.click();
          setTimeout(function () {
            document.body.removeChild(a);
            URL.revokeObjectURL(objectUrl);
          }, 0);
        });
      })
      .catch(function (err) {
        showErr('CSV export failed: ' + (err && err.message ? err.message : 'unknown'));
      })
      .then(function () {
        btn.disabled = false;
        btn.textContent = orig;
      });
  }

  document.addEventListener('DOMContentLoaded', function () {
    loadToken();
    el('reloadBtn').addEventListener('click', function () { refresh(false); });
    el('typeFilter').addEventListener('change', function () { refresh(false); });
    el('tokenInput').addEventListener('keypress', function (ev) {
      if (ev.key === 'Enter') refresh(false);
    });
    var exportBtn = el('exportCsvBtn');
    if (exportBtn) exportBtn.addEventListener('click', exportCsv);
    // Sprint admin-session-auth — try cookie auth silently; if it works,
    // the dashboard renders without the operator pasting a token.
    refresh(true);
  });
})();
