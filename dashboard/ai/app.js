// /dashboard/ai/ — AI cost dashboard (Sprint BG-6.5).
//
// Reads ai_call events via /api/audit?type=ai_call (same token-gating
// pattern as the audit + leads dashboards). Aggregates client-side
// into per-agent and per-prompt-version spend.

(function () {
  'use strict';

  var STORAGE_KEY = 'orcatrade.ai-dashboard.token';

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

  function fmtCents(c) {
    if (!Number.isFinite(c)) return '—';
    if (c < 100) return c + 'c';
    return '€' + (c / 100).toFixed(2);
  }
  function fmtTs(iso) {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleString('en-GB', { hour12: false }); }
    catch (_) { return iso; }
  }

  function aggregate(events) {
    var totalCents = 0;
    var totalInTokens = 0;
    var totalOutTokens = 0;
    var byAgent = {};        // agent → { cents, calls }
    var byPromptVersion = {}; // 'agent:vN' → { cents, calls }
    var oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    var inWeek = 0;
    for (var i = 0; i < events.length; i++) {
      var e = events[i];
      if (e.type !== 'ai_call') continue;
      var cents = Number(e.costCents) || 0;
      totalCents += cents;
      totalInTokens += Number(e.inputTokens) || 0;
      totalOutTokens += Number(e.outputTokens) || 0;
      if (e.at && Date.parse(e.at) >= oneWeekAgo) inWeek += cents;

      var agent = e.agent || 'unknown';
      if (!byAgent[agent]) byAgent[agent] = { cents: 0, calls: 0 };
      byAgent[agent].cents += cents;
      byAgent[agent].calls++;

      var pvKey = agent + ':' + (e.promptVersion || '?');
      if (!byPromptVersion[pvKey]) byPromptVersion[pvKey] = { cents: 0, calls: 0 };
      byPromptVersion[pvKey].cents += cents;
      byPromptVersion[pvKey].calls++;
    }
    return {
      totalCents, totalInTokens, totalOutTokens, inWeek,
      callCount: events.filter(function (e) { return e.type === 'ai_call'; }).length,
      meanCostCents: 0,  // filled below
      byAgent, byPromptVersion,
    };
  }

  function renderStats(agg) {
    var mean = agg.callCount ? Math.round(agg.totalCents / agg.callCount) : 0;
    var meanLatency = '—';
    el('stats').innerHTML = (
      '<div class="stat"><div class="num">' + fmtCents(agg.totalCents) + '</div><div class="label">Total spend (period)</div></div>'
      + '<div class="stat"><div class="num warn">' + fmtCents(agg.inWeek) + '</div><div class="label">Last 7 days</div></div>'
      + '<div class="stat"><div class="num">' + agg.callCount + '</div><div class="label">AI calls</div></div>'
      + '<div class="stat"><div class="num">' + fmtCents(mean) + '</div><div class="label">Mean / call</div></div>'
      + '<div class="stat"><div class="num">' + (agg.totalInTokens + agg.totalOutTokens).toLocaleString('en-GB') + '</div><div class="label">Tokens (in + out)</div></div>'
    );
  }

  function renderBars(hostId, breakdown) {
    var host = el(hostId);
    var entries = Object.entries(breakdown).sort(function (a, b) { return b[1].cents - a[1].cents; });
    if (!entries.length) {
      host.innerHTML = '<div class="empty">No ai_call events yet.</div>';
      return;
    }
    var max = entries[0][1].cents || 1;
    var rows = entries.map(function (e) {
      var name = e[0];
      var cents = e[1].cents;
      var calls = e[1].calls;
      var pct = Math.max(2, (cents / max) * 100);
      return (
        '<div class="bar-row">'
        + '<div class="name">' + escapeHtml(name) + '</div>'
        + '<div class="bar" style="width:' + pct + '%"></div>'
        + '<div class="val">' + fmtCents(cents) + ' · ' + calls + '</div>'
        + '</div>'
      );
    });
    host.innerHTML = rows.join('');
  }

  function renderTopCalls(events) {
    var calls = events.filter(function (e) { return e.type === 'ai_call'; });
    calls.sort(function (a, b) { return (b.costCents || 0) - (a.costCents || 0); });
    var top = calls.slice(0, 10);
    if (!top.length) {
      el('topCalls').innerHTML = '<div class="empty">No ai_call events yet.</div>';
      return;
    }
    var rows = [
      '<table class="calls"><thead><tr>'
      + '<th>When</th><th>Agent</th><th>v</th><th>Model</th>'
      + '<th>In</th><th>Out</th><th>Cached</th>'
      + '<th class="cost">Cost</th><th class="latency">Latency</th>'
      + '</tr></thead><tbody>'
    ];
    for (var i = 0; i < top.length; i++) {
      var c = top[i];
      rows.push(
        '<tr>'
        + '<td>' + escapeHtml(fmtTs(c.at)) + '</td>'
        + '<td>' + escapeHtml(c.agent || '') + '</td>'
        + '<td>' + escapeHtml(c.promptVersion || '—') + '</td>'
        + '<td>' + escapeHtml(c.model || '') + '</td>'
        + '<td>' + (c.inputTokens || 0).toLocaleString('en-GB') + '</td>'
        + '<td>' + (c.outputTokens || 0).toLocaleString('en-GB') + '</td>'
        + '<td>' + (c.cacheReadTokens || 0).toLocaleString('en-GB') + '</td>'
        + '<td class="cost">' + fmtCents(c.costCents) + '</td>'
        + '<td class="latency">' + (c.latencyMs || 0) + 'ms</td>'
        + '</tr>'
      );
    }
    rows.push('</tbody></table>');
    el('topCalls').innerHTML = rows.join('');
  }

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  async function refresh() {
    clearErr();
    var token = el('tokenInput').value.trim();
    if (!token) {
      showErr('Token required — paste your ORCATRADE_LEADS_TOKEN above.');
      el('stats').innerHTML = '';
      el('byAgent').innerHTML = '';
      el('byPromptVersion').innerHTML = '';
      el('topCalls').innerHTML = '';
      return;
    }
    saveToken(token);
    el('reloadBtn').disabled = true;
    try {
      var qs = new URLSearchParams({ token: token, type: 'ai_call', limit: '1000' });
      var res = await fetch('/api/audit?' + qs.toString(), { credentials: 'same-origin' });
      if (res.status === 401) {
        showErr('Unauthorized — check the token.');
        return;
      }
      if (!res.ok) {
        showErr('Fetch failed: HTTP ' + res.status);
        return;
      }
      var body = await res.json();
      var events = body.events || [];
      var agg = aggregate(events);
      renderStats(agg);
      renderBars('byAgent', agg.byAgent);
      renderBars('byPromptVersion', agg.byPromptVersion);
      renderTopCalls(events);
      el('lastChecked').textContent = 'Last checked: ' + new Date(body.asOf).toLocaleTimeString() + ' · ' + agg.callCount + ' calls';
    } catch (err) {
      showErr('Network error: ' + err.message);
    } finally {
      el('reloadBtn').disabled = false;
    }
  }

  // Browser-only bootstrap. The module is also require()'d by the test
  // suite to exercise aggregate() + fmtCents() in pure-Node — skip the
  // DOM wiring when document isn't available.
  if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', function () {
      loadToken();
      el('reloadBtn').addEventListener('click', refresh);
      el('tokenInput').addEventListener('keypress', function (ev) {
        if (ev.key === 'Enter') refresh();
      });
      if (el('tokenInput').value) refresh();
    });
  }

  // Export the aggregator for tests.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { aggregate: aggregate, fmtCents: fmtCents };
  }
})();
