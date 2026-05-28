// /dashboard/funnel/ — wizard step-by-step funnel + drop-off.
// Reads wizard_step_completed events from /api/audit and aggregates them
// into a 6-step funnel (1=start, 6=submit). Token gate + sessionStorage
// persistence mirror /dashboard/audit/ and /dashboard/leads/.

(function () {
  'use strict';

  var STORAGE_KEY = 'orcatrade.funnel.token';
  var STEP_LABELS = {
    1: '1 · product / origin / dest',
    2: '2 · value + quantity',
    3: '3 · weight + lines',
    4: '4 · urgency',
    5: '5 · compliance flags',
    6: '6 · review & submit',
  };

  function el(id) { return document.getElementById(id); }
  function showErr(msg) { el('errBanner').textContent = msg; el('errBanner').hidden = false; }
  function clearErr() { el('errBanner').hidden = true; }

  function loadToken() {
    try { var v = window.sessionStorage.getItem(STORAGE_KEY); if (v) el('tokenInput').value = v; } catch (_) {}
  }
  function saveToken(v) {
    try { window.sessionStorage.setItem(STORAGE_KEY, v); } catch (_) {}
  }

  // Tally how many distinct "sessions" reached each step. A session is the
  // implicit (emailHash || ip || at-prefix) bucket — wizard_step_completed
  // carries no session id, so we approximate with the row identity fields.
  // Submit is action === 'submit' on any step (step 6 in practice).
  function aggregate(events) {
    var stepCount = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
    var submitted = 0;
    for (var i = 0; i < events.length; i++) {
      var e = events[i] || {};
      var step = Number(e.step);
      if (step >= 1 && step <= 6) stepCount[step]++;
      if (String(e.action || '').toLowerCase() === 'submit') submitted++;
    }
    return { stepCount: stepCount, submitted: submitted };
  }

  function pct(n, d) {
    if (!d || d <= 0) return null;
    return Math.round((n / d) * 1000) / 10;
  }

  function render(events) {
    var agg = aggregate(events);
    var c = agg.stepCount;
    var step1 = c[1] || 0;
    var submitted = agg.submitted;

    el('sessionsValue').textContent = step1.toLocaleString('en-GB');
    el('sessionsSub').textContent = events.length.toLocaleString('en-GB') + ' events';

    el('submittedValue').textContent = submitted.toLocaleString('en-GB');
    var conv = pct(submitted, step1);
    el('completionValue').textContent = conv == null ? '—' : (conv + '%');
    el('submittedSub').textContent = conv == null ? '' : ((step1 - submitted).toLocaleString('en-GB') + ' did not finish');

    // Step-by-step funnel + drop-off per step.
    var max = Math.max(1, c[1] || 1);
    var rowsHtml = '';
    var worstDrop = { step: '—', pct: -1 };
    for (var s = 1; s <= 6; s++) {
      var cur = c[s] || 0;
      var prev = s === 1 ? cur : (c[s - 1] || 0);
      var dropAbs = Math.max(0, prev - cur);
      var dropPct = pct(dropAbs, prev);
      var width = Math.round((cur / max) * 100);
      if (s > 1 && dropPct != null && dropPct > worstDrop.pct) {
        worstDrop = { step: 'step ' + (s - 1) + '→' + s, pct: dropPct };
      }
      rowsHtml += '' +
        '<div class="step">' +
          '<span class="label">' + STEP_LABELS[s] + '</span>' +
          '<div class="bar-track"><div class="bar-fill" style="width:' + width + '%"></div></div>' +
          '<span class="count">' + cur.toLocaleString('en-GB') + '</span>' +
          '<span class="drop ' + (s === 1 || dropPct == null || dropPct < 25 ? 'ok' : '') + '">' + (s === 1 || dropPct == null ? '' : ('−' + dropPct + '%')) + '</span>' +
        '</div>';
    }
    el('funnel').innerHTML = rowsHtml;

    if (worstDrop.pct >= 0) {
      el('worstStepValue').textContent = worstDrop.step;
      el('worstStepSub').textContent = '−' + worstDrop.pct + '% drop';
    }

    el('metaLine').textContent = 'Source: /api/audit?type=wizard_step_completed · ' + events.length + ' events returned (limit 5000)';
  }

  async function load() {
    var token = (el('tokenInput').value || '').trim();
    if (!token) { showErr('Token required.'); return; }
    saveToken(token);
    clearErr();

    try {
      var qs = new URLSearchParams();
      qs.set('type', 'wizard_step_completed');
      qs.set('limit', '5000');
      qs.set('token', token);
      var res = await fetch('/api/audit?' + qs.toString(), { headers: { 'X-Admin-Token': token } });
      if (res.status === 401) { showErr('Unauthorized — check the token.'); return; }
      if (!res.ok) { showErr('HTTP ' + res.status); return; }
      var body = await res.json();
      if (!body || !Array.isArray(body.events)) { showErr('Unexpected response.'); return; }
      el('tokenForm').hidden = true;
      el('content').hidden = false;
      render(body.events);
    } catch (err) {
      showErr(String((err && err.message) || err));
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    loadToken();
    el('tokenSubmit').addEventListener('click', load);
    el('tokenInput').addEventListener('keydown', function (e) { if (e.key === 'Enter') load(); });
    if (el('tokenInput').value) load();
  });
})();
