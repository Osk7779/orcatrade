// /dashboard/cron/ — Sprint cron-observability-v1 client.
//
// Cookie-first probe (admin email on the allowlist), token fallback
// (same pattern as /dashboard/leads + /dashboard/orgs + /dashboard/audit).

'use strict';

(function () {
  if (typeof document === 'undefined') return;

  var STORAGE_KEY = 'orca_cron_token';

  var els = {
    tokenForm: document.getElementById('token-form'),
    tokenInput: document.getElementById('token'),
    loadBtn: document.getElementById('load-btn'),
    jobs: document.getElementById('jobs'),
    err: document.getElementById('err'),
    empty: document.getElementById('empty'),
  };

  function showError(msg) {
    els.err.hidden = false;
    els.err.textContent = msg;
  }
  function clearError() {
    els.err.hidden = true;
    els.err.textContent = '';
  }

  function escapeHtml(s) {
    var d = document.createElement('div');
    d.textContent = String(s == null ? '' : s);
    return d.innerHTML;
  }

  function fmtTimestamp(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  }

  function fmtRelative(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    var diffMs = Date.now() - d.getTime();
    var s = Math.floor(diffMs / 1000);
    if (s < 60)    return s + 's ago';
    var m = Math.floor(s / 60);
    if (m < 60)    return m + 'm ago';
    var h = Math.floor(m / 60);
    if (h < 24)    return h + 'h ago';
    var dys = Math.floor(h / 24);
    return dys + 'd ago';
  }

  // Render a one-line summary from the lastRun.summary block. We only
  // surface scalars (the dispatcher stripped arrays + nested objects).
  function fmtSummary(summary) {
    if (!summary || typeof summary !== 'object') return '';
    var bits = [];
    for (var k of Object.keys(summary)) {
      var v = summary[k];
      if (v === null || v === undefined) continue;
      var t = typeof v;
      if (t === 'number' || t === 'boolean') {
        bits.push(k + ': ' + v);
      } else if (t === 'string' && v.length < 60) {
        bits.push(k + ': ' + v);
      } else if (v && typeof v === 'object' && '_len' in v) {
        bits.push(k + ': [' + v._len + ']');
      }
    }
    return bits.join(' · ');
  }

  function pillFor(job) {
    if (!job.lastRun && !job.lastError) return '<span class="pill never">never run</span>';
    var lastRunMs = job.lastRun && Date.parse(job.lastRun.completedAt) || 0;
    var lastErrMs = job.lastError && Date.parse(job.lastError.completedAt) || 0;
    if (lastErrMs > lastRunMs) return '<span class="pill error">error</span>';
    if (job.lastRun && job.lastRun.ok === false) return '<span class="pill noop">noop</span>';
    return '<span class="pill ok">ok</span>';
  }

  function renderJob(job) {
    var when = job.lastRun
      ? fmtTimestamp(job.lastRun.completedAt) + ' · ' + fmtRelative(job.lastRun.completedAt)
      : (job.lastError ? fmtTimestamp(job.lastError.completedAt) + ' · ' + fmtRelative(job.lastError.completedAt) : '—');
    var summary = job.lastRun ? fmtSummary(job.lastRun.summary) : '';
    if (job.lastRun && typeof job.lastRun.durationMs === 'number') {
      summary = summary
        ? summary + ' · ' + job.lastRun.durationMs + 'ms'
        : job.lastRun.durationMs + 'ms';
    }
    var errBlock = '';
    if (job.lastError && (!job.lastRun || Date.parse(job.lastError.completedAt) > Date.parse(job.lastRun.completedAt))) {
      errBlock = '<div class="error-detail">last error: '
        + escapeHtml(job.lastError.error || 'unknown')
        + ' (' + escapeHtml(fmtTimestamp(job.lastError.completedAt)) + ')</div>';
    }
    return '<div class="job-row">'
      + '<div class="name">' + escapeHtml(job.name) + '</div>'
      + '<div>' + pillFor(job) + '</div>'
      + '<div>'
      +   '<div class="when">' + escapeHtml(when) + '</div>'
      +   (summary ? '<div class="summary">' + escapeHtml(summary) + '</div>' : '')
      + '</div>'
      + '<div></div>'
      + errBlock
      + '</div>';
  }

  function render(data) {
    clearError();
    var jobs = (data && data.jobs) || [];
    if (jobs.length === 0) {
      els.empty.hidden = false;
      els.jobs.innerHTML = '';
      return;
    }
    els.empty.hidden = true;
    els.jobs.innerHTML = jobs.map(renderJob).join('');
  }

  async function load(silent) {
    clearError();
    var token = els.tokenInput.value.trim();
    if (token) {
      try { sessionStorage.setItem(STORAGE_KEY, token); } catch (_) {}
    }
    var url = '/api/cron-status' + (token ? '?token=' + encodeURIComponent(token) : '');
    try {
      var resp = await fetch(url, { credentials: 'same-origin' });
      if (resp.status === 401) {
        // Cookie-first failed → reveal the token form for fallback.
        els.tokenForm.hidden = false;
        if (!silent) showError(token ? 'Unauthorized — check the token.' : 'Sign in as an allowlisted admin email or paste the token.');
        return false;
      }
      if (resp.status === 503) {
        els.tokenForm.hidden = false;
        if (!silent) showError('Admin auth not configured (set ORCATRADE_ADMIN_EMAILS or ORCATRADE_LEADS_TOKEN).');
        return false;
      }
      if (!resp.ok) {
        if (!silent) showError('HTTP ' + resp.status + ' — could not load cron status.');
        return false;
      }
      var data = await resp.json();
      els.tokenForm.hidden = true;
      render(data);
      return true;
    } catch (err) {
      if (!silent) showError('Network error: ' + (err && err.message ? err.message : 'unknown'));
      return false;
    }
  }

  els.loadBtn.addEventListener('click', function () { load(false); });
  els.tokenInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') load(false);
  });

  document.addEventListener('DOMContentLoaded', function () {
    var saved = null;
    try { saved = sessionStorage.getItem(STORAGE_KEY); } catch (_) {}
    if (saved) els.tokenInput.value = saved;
    load(true);
  });
})();
