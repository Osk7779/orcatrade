// /portfolio/ — Sprint portfolio-v1 (phase 2) client.
//
// Build a multi-line product catalogue, POST it to /api/portfolio, and
// render the aggregate (total landed cost, blended duty rate,
// consolidation saving) + a per-SKU table + the per-lane consolidation
// callout. Dropdowns are populated from GET /api/start's catalogue.

(function () {
  'use strict';

  var els = {
    lines: document.getElementById('pfLines'),
    addBtn: document.getElementById('pfAddLine'),
    genBtn: document.getElementById('pfGenerate'),
    err: document.getElementById('pfErr'),
    result: document.getElementById('pfResult'),
    template: document.getElementById('pfLineTemplate'),
  };

  var catalogue = { categories: [], origins: [], destinations: [] };
  var signedIn = false;        // set from /api/auth/me — gates the Save button
  var lastLines = null;        // lines behind the currently-rendered result
  var lastAggregate = null;    // aggregate snapshot, persisted on save

  function escapeHtml(s) {
    var d = document.createElement('div');
    d.textContent = String(s == null ? '' : s);
    return d.innerHTML;
  }
  function fmtEur(n) {
    if (!Number.isFinite(n)) return '—';
    return new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);
  }
  function setError(msg) { if (els.err) els.err.textContent = msg || ''; }

  function fillSelect(sel, items, valueKey, labelKey) {
    items.forEach(function (it) {
      var opt = document.createElement('option');
      opt.value = it[valueKey];
      opt.textContent = it[labelKey];
      sel.appendChild(opt);
    });
  }

  function addLine(prefill) {
    var node = els.template.content.firstElementChild.cloneNode(true);
    var cat = node.querySelector('.pf-cat');
    var origin = node.querySelector('.pf-origin');
    var dest = node.querySelector('.pf-dest');
    fillSelect(cat, catalogue.categories, 'key', 'label');
    fillSelect(origin, catalogue.origins, 'code', 'name');
    fillSelect(dest, catalogue.destinations, 'code', 'name');
    if (prefill) {
      if (prefill.productCategory) cat.value = prefill.productCategory;
      if (prefill.originCountry) origin.value = prefill.originCountry;
      if (prefill.destinationCountry) dest.value = prefill.destinationCountry;
      if (prefill.customsValueEur) node.querySelector('.pf-value').value = prefill.customsValueEur;
      if (prefill.weightKg) node.querySelector('.pf-weight').value = prefill.weightKg;
      if (prefill.hsCode) node.querySelector('.pf-hs').value = prefill.hsCode;
    }
    node.querySelector('.pf-remove').addEventListener('click', function () {
      // Keep at least one line on the page.
      if (els.lines.children.length > 1) node.remove();
    });
    els.lines.appendChild(node);
  }

  function collectLines() {
    var lines = [];
    Array.prototype.forEach.call(els.lines.children, function (node) {
      var value = Number(node.querySelector('.pf-value').value);
      var weight = Number(node.querySelector('.pf-weight').value);
      var cat = node.querySelector('.pf-cat').value;
      // Skip entirely-empty rows so a stray blank line doesn't error.
      if (!cat && !value && !weight) return;
      lines.push({
        productCategory: cat,
        originCountry: node.querySelector('.pf-origin').value,
        destinationCountry: node.querySelector('.pf-dest').value,
        customsValueEur: value,
        weightKg: weight,
        hsCode: node.querySelector('.pf-hs').value.trim() || undefined,
      });
    });
    return lines;
  }

  function fmtDate(iso) {
    if (!iso) return '';
    return String(iso).slice(0, 10);
  }

  function renderResult(data) {
    var agg = data.aggregate;
    var t = agg.totals;
    var html = '';

    // Drift callout (Sprint portfolio-drift-v1) — present only on a
    // refresh of a saved portfolio (data.drift). Shows how the numbers
    // moved since the user saved it.
    if (data.drift) {
      var dr = data.drift;
      var since = data.savedAt ? (' since you saved this on ' + escapeHtml(fmtDate(data.savedAt))) : '';
      var cls = dr.material ? (dr.direction === 'up' ? 'drift-up' : 'drift-down') : 'drift-flat';
      var sign = dr.landedDeltaEur > 0 ? '+' : (dr.landedDeltaEur < 0 ? '−' : '');
      var pctSign = dr.landedDeltaPct > 0 ? '+' : '';
      var msg;
      if (dr.material) {
        msg = (dr.direction === 'up' ? 'Up ' : 'Down ') + sign + fmtEur(Math.abs(dr.landedDeltaEur))
          + ' (' + pctSign + dr.landedDeltaPct.toFixed(1) + '%)' + since + '.';
        if (Math.abs(dr.blendedDutyDeltaPct) >= 0.1) {
          msg += ' Blended duty ' + (dr.blendedDutyDeltaPct > 0 ? '+' : '') + dr.blendedDutyDeltaPct.toFixed(1) + 'pp.';
        }
      } else {
        msg = 'Roughly unchanged' + since + ' (' + pctSign + dr.landedDeltaPct.toFixed(1) + '%).';
      }
      html += '<div class="pf-drift ' + cls + '"><strong>What changed:</strong> ' + msg + '</div>';
    }

    html += '<div class="pf-stats">';
    html += statTile(fmtEur(t.perShipmentLandedTotal), 'Total landed cost (per shipment cycle)', 'accent');
    html += statTile(agg.blendedDutyRatePct.toFixed(2) + '%', 'Blended duty rate across ' + agg.lineCount + ' SKU' + (agg.lineCount === 1 ? '' : 's'), '');
    html += statTile(fmtEur(t.dutyEur + t.vatEur + t.brokerageEur), 'Duty + VAT + brokerage', '');
    if (agg.consolidationSavingEur > 0) {
      html += statTile(fmtEur(agg.consolidationSavingEur), 'Saving from consolidating customs entries', 'save');
    }
    html += '</div>';

    // Per-SKU table
    html += '<h2 class="pf-section-title">Per-product breakdown</h2>';
    html += '<table class="pf-table"><thead><tr>'
      + '<th>Product</th><th>Lane</th><th class="num">Customs value</th>'
      + '<th class="num">Duty</th><th class="num">Duty %</th><th class="num">Landed</th>'
      + '</tr></thead><tbody>';
    data.lines.forEach(function (ln) {
      var inp = ln.inputs || {};
      var duty = ln.duty || {};
      var label = (inp.productCategory || '—') + (ln.hsChapterLabel ? ' · ' + ln.hsChapterLabel : '');
      html += '<tr>'
        + '<td>' + escapeHtml(label) + (inp.hsCode ? ' <span style="opacity:0.5">' + escapeHtml(inp.hsCode) + '</span>' : '') + '</td>'
        + '<td>' + escapeHtml((inp.originCountry || '?') + '→' + (inp.destinationCountry || '?')) + '</td>'
        + '<td class="num">' + fmtEur(inp.customsValueEur) + '</td>'
        + '<td class="num">' + fmtEur(ln.totals.dutyEur) + '</td>'
        + '<td class="num">' + (duty.ratePercent != null ? duty.ratePercent.toFixed(1) + '%' : '—') + '</td>'
        + '<td class="num">' + fmtEur(ln.totals.perShipmentLandedTotal) + '</td>'
        + '</tr>';
    });
    html += '<tr class="total">'
      + '<td>Total</td><td></td>'
      + '<td class="num">' + fmtEur(t.customsValueEur) + '</td>'
      + '<td class="num">' + fmtEur(t.dutyEur) + '</td>'
      + '<td class="num">' + agg.blendedDutyRatePct.toFixed(1) + '%</td>'
      + '<td class="num">' + fmtEur(t.perShipmentLandedTotal) + '</td>'
      + '</tr>';
    html += '</tbody></table>';

    // Consolidation callout — only when there's a real opportunity.
    var consolidatableLanes = agg.groups.filter(function (g) { return g.transportConsolidatable; });
    if (agg.consolidationSavingEur > 0 || consolidatableLanes.length) {
      html += '<div class="pf-consol"><h3>Consolidation opportunity</h3>';
      if (agg.consolidationSavingEur > 0) {
        html += '<p>Clearing SKUs that share a lane as a <strong>single customs entry</strong> instead of separate ones saves <strong class="save">' + fmtEur(agg.consolidationSavingEur) + '</strong> in brokerage per shipment cycle.</p>';
      }
      agg.groups.forEach(function (g) {
        if (!g.transportConsolidatable && g.brokerageSavingEur <= 0) return;
        var bits = g.lineCount + ' SKUs · ' + g.combinedWeightKg + ' kg combined';
        if (g.brokerageSavingEur > 0) bits += ' · brokerage saving <span class="save">' + fmtEur(g.brokerageSavingEur) + '</span>';
        html += '<div class="pf-lane">' + escapeHtml(g.originCountry + '→' + g.destinationCountry) + ': ' + bits + '</div>';
      });
      html += '<p style="margin-top:0.6rem; opacity:0.8;">SKUs on the same lane can also physically ship together (LCL→FCL), which can cut transport beyond the brokerage saving shown.</p>';
      html += '</div>';
    }

    // Per-line errors (invalid rows the server skipped)
    if (data.lineErrors && data.lineErrors.length) {
      html += '<div class="pf-line-errors"><strong>' + data.lineErrors.length + ' line(s) were skipped:</strong> ';
      html += data.lineErrors.map(function (e) {
        return 'row ' + (e.index + 1) + ' (' + escapeHtml((e.errors || []).join(', ')) + ')';
      }).join('; ');
      html += '</div>';
    }

    // Save block — only for signed-in users.
    if (signedIn) {
      html += '<div class="pf-save" id="pfSaveBlock">'
        + '<input type="text" id="pfLabel" placeholder="Name this portfolio (optional)" maxlength="100" />'
        + '<button type="button" class="btn btn-primary" id="pfSaveBtn">Save to my account</button>'
        + '<span id="pfSaveMsg" class="pf-save-msg"></span>'
        + '</div>';
    } else {
      html += '<p class="pf-save-hint"><a href="/account/?return=' + encodeURIComponent('/portfolio/') + '" style="color:var(--accent-color,#b8bec8)">Sign in</a> to save this portfolio to your account.</p>';
    }

    els.result.innerHTML = html;
    els.result.classList.remove('hidden');

    if (signedIn) {
      var saveBtn = document.getElementById('pfSaveBtn');
      if (saveBtn) saveBtn.addEventListener('click', savePortfolio);
    }
    els.result.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function savePortfolio() {
    var msg = document.getElementById('pfSaveMsg');
    var btn = document.getElementById('pfSaveBtn');
    var label = (document.getElementById('pfLabel').value || '').trim();
    if (!lastLines || !lastLines.length) { if (msg) msg.textContent = 'Nothing to save.'; return; }
    btn.disabled = true; btn.textContent = 'Saving…';
    fetch('/api/portfolio/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ lines: lastLines, label: label, snapshot: lastAggregate }),
    })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (resp) {
        btn.disabled = false; btn.textContent = 'Save to my account';
        if (resp.ok && resp.j.ok) {
          if (msg) { msg.textContent = 'Saved ✓ '; }
          var link = document.createElement('a');
          link.href = '/account/portfolios/';
          link.textContent = 'View saved portfolios →';
          link.style.color = 'var(--accent-color, #b8bec8)';
          if (msg) msg.appendChild(link);
          btn.disabled = true;
        } else {
          if (msg) msg.textContent = (resp.j && resp.j.error) || 'Could not save.';
        }
      })
      .catch(function () { btn.disabled = false; btn.textContent = 'Save to my account'; if (msg) msg.textContent = 'Network error.'; });
  }

  function statTile(num, label, cls) {
    return '<div class="pf-stat"><div class="num ' + (cls || '') + '">' + escapeHtml(num) + '</div><div class="label">' + escapeHtml(label) + '</div></div>';
  }

  function generate() {
    setError('');
    var lines = collectLines();
    if (!lines.length) { setError('Add at least one product with a category, value, and weight.'); return; }
    els.genBtn.disabled = true;
    els.genBtn.textContent = 'Computing…';
    fetch('/api/portfolio', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lines: lines }),
    })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }).catch(function () { return { ok: r.ok, j: {} }; }); })
      .then(function (resp) {
        els.genBtn.disabled = false;
        els.genBtn.textContent = 'Generate portfolio plan';
        if (resp.ok && resp.j.ok) {
          lastLines = lines;
          lastAggregate = resp.j.aggregate;
          renderResult(resp.j);
        } else {
          setError((resp.j && resp.j.error) || 'Could not generate the portfolio plan.');
        }
      })
      .catch(function (err) {
        els.genBtn.disabled = false;
        els.genBtn.textContent = 'Generate portfolio plan';
        setError('Network error: ' + (err.message || 'unknown'));
      });
  }

  // ── Init ─────────────────────────────────────────────
  // Are we signed in? (gates the Save button). Non-blocking.
  fetch('/api/auth/me', { credentials: 'same-origin' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) { signedIn = !!(d && d.user && d.user.email); })
    .catch(function () { /* assume signed-out */ });

  function urlParam(name) {
    try { return new URLSearchParams(window.location.search).get(name) || ''; }
    catch (_) { return ''; }
  }

  function loadLinesInto(lines) {
    els.lines.innerHTML = '';
    lines.forEach(function (ln) { addLine(ln); });
  }

  function showSharedBanner(label) {
    var b = document.createElement('div');
    b.className = 'pf-shared-banner';
    b.innerHTML = 'Viewing a shared portfolio' + (label ? ' — <strong>' + escapeHtml(label) + '</strong>' : '')
      + '. Numbers are recomputed live against today’s tariff + freight data. Edit the rows below to plan your own.';
    var shell = document.querySelector('.pf-shell');
    var hero = document.querySelector('.pf-hero');
    if (shell && hero) shell.insertBefore(b, hero.nextSibling);
  }

  fetch('/api/start', { credentials: 'omit' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (data) {
      if (data) {
        catalogue.categories = data.categories || [];
        catalogue.origins = data.origins || [];
        catalogue.destinations = data.destinations || [];
      }
      // PUBLIC shared portfolio? /portfolio/?share=<code> — anyone can view.
      var shareCode = urlParam('share');
      if (/^[a-f0-9]{10}$/.test(shareCode)) {
        fetch('/api/portfolio/shared/' + encodeURIComponent(shareCode), { credentials: 'omit' })
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (d) {
            var lines = d && Array.isArray(d.lines) ? d.lines : null;
            if (lines && lines.length) {
              showSharedBanner(d.label);
              loadLinesInto(lines);
              generate();
            } else {
              addLine(); addLine();
            }
          })
          .catch(function () { addLine(); addLine(); });
        return;
      }
      // Revisit YOUR OWN saved portfolio? /portfolio/?id=pf_… (auth required).
      // Use /refresh so we recompute against today's data AND get the
      // drift vs the snapshot saved at save time.
      var savedId = urlParam('id');
      if (/^pf_[a-f0-9]{16}$/.test(savedId)) {
        fetch('/api/portfolio/item/' + encodeURIComponent(savedId) + '/refresh', { method: 'POST', credentials: 'same-origin' })
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (d) {
            if (d && d.ok && Array.isArray(d.lines) && d.lines.length) {
              var inputLines = d.lines.map(function (l) { return l.inputs; });
              loadLinesInto(inputLines);
              lastLines = inputLines;
              lastAggregate = d.aggregate;
              renderResult(d);
            } else {
              addLine(); addLine();
            }
          })
          .catch(function () { addLine(); addLine(); });
        return;
      }
      // Seed two empty rows so the multi-product intent is obvious.
      addLine();
      addLine();
    })
    .catch(function () { addLine(); addLine(); });

  if (els.addBtn) els.addBtn.addEventListener('click', function () { addLine(); });
  if (els.genBtn) els.genBtn.addEventListener('click', generate);
})();
