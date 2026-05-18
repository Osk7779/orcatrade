// Saved-plans listing page client.
//   1. GET /api/plans
//   2. If 401 → show sign-in CTA
//   3. If 200 + empty → show empty state
//   4. If 200 + populated → render cards with Open / Delete actions
//
// Uses the share-codec encoder to build a `/start/?p=<base64>` link
// from each saved plan's inputs. We embed a minimal copy of the codec
// (same algorithm as start/app.js) to avoid pulling the wizard's full JS.

(function () {
  'use strict';

  // ── Mini share-codec (copy of start/app.js encodeShareInputs) ──
  var SHARE_KEYS = [
    'productCategory', 'originCountry', 'destinationCountry',
    'customsValueEur', 'weightKg', 'linesCount', 'urgencyWeeks',
    'monthlyOrders', 'avgUnitsPerOrder', 'avgPalletsHeld', 'avgOrderWeightKg',
    'claimPreferential', 'hsCode', 'moq', 'targetFobUnitEur',
    'quoteCurrency', 'paymentTermsDays',
    'shipmentsPerYear', 'waccPct', 'daysInInventory', 'daysReceivable',
  ];

  function encodeShareInputs(inputs) {
    var minimal = {};
    SHARE_KEYS.forEach(function (k) {
      if (inputs[k] !== undefined && inputs[k] !== null && inputs[k] !== '') minimal[k] = inputs[k];
    });
    var json = JSON.stringify(minimal);
    var bytes = new TextEncoder().encode(json);
    var binary = '';
    for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function buildPlanUrl(record) {
    return '/start/?p=' + encodeShareInputs(record.inputs);
  }

  // ── Element refs ────────────────────────────────────

  var loadingEl = document.getElementById('plans-loading');
  var listEl = document.getElementById('plans-list');
  var emptyEl = document.getElementById('plans-empty');
  var signinEl = document.getElementById('plans-signin');

  function show(el) { el.hidden = false; }
  function hide(el) { el.hidden = true; }
  function escapeHtml(s) {
    var div = document.createElement('div');
    div.textContent = String(s == null ? '' : s);
    return div.innerHTML;
  }
  function fmtDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toISOString().slice(0, 10);
  }
  function fmtEur(n) {
    if (!Number.isFinite(Number(n))) return '';
    return '€' + Math.round(Number(n)).toLocaleString('en-IE');
  }
  function driverLabel(d) {
    return ({ duty: 'duty', vat: 'VAT', transport: 'freight', brokerage: 'brokerage' }[d]) || 'pricing';
  }

  // ── Sprint BG-1.5: per-user calibration card ────────────
  //
  // Mirror of lib/actuals.js#summariseActuals — kept thin enough to
  // inline. (We don't ship the full lib to the browser, and the math
  // is small.) Tests for the canonical version live in test/actuals
  // alongside the lib; an integration-level test pins this version
  // against the same shape.

  function summariseActuals(plans) {
    var safe = Array.isArray(plans) ? plans : [];
    var totalEstCents = 0, totalActCents = 0;
    var weightedSumPct = 0, weightTotal = 0;
    var withActuals = 0, over = 0, under = 0, onTarget = 0;
    safe.forEach(function (p) {
      if (!p || !p.actual || !p.actualVariance) return;
      var v = p.actualVariance;
      var estCents = Math.round(Number(v.estimateEur || 0) * 100);
      var actCents = Math.round(Number(v.actualEur || 0) * 100);
      // Only count plans that contribute to the math — mirrors
      // lib/actuals.js#summariseActuals.
      if (estCents <= 0) return;
      withActuals++;
      totalEstCents += estCents;
      totalActCents += actCents;
      weightedSumPct += Number(v.deltaPct || 0) * estCents;
      weightTotal += estCents;
      if (v.direction === 'over') over++;
      else if (v.direction === 'under') under++;
      else onTarget++;
    });
    return {
      planCount: safe.length,
      withActuals: withActuals,
      totalEstimateEur: totalEstCents / 100,
      totalActualEur: totalActCents / 100,
      totalDeltaEur: (totalActCents - totalEstCents) / 100,
      avgVariancePct: weightTotal > 0 ? Math.round((weightedSumPct / weightTotal) * 10) / 10 : null,
      byDirection: { over: over, under: under, onTarget: onTarget },
    };
  }

  function renderCalibrationCard(summary) {
    // Empty state — N=0 plans. Don't show anything; the empty-state
    // panel below handles that copy.
    if (summary.planCount === 0) return '';

    // Pre-actuals state — plans saved but none logged yet. The
    // motivational call to action; the card is shown so the user
    // sees the loop EXISTS before they engage with it.
    if (summary.withActuals === 0) {
      return '<div class="calibration-card dir-neutral">' +
          '<div class="cal-kicker">Reality check</div>' +
          '<h2>Help us sharpen your future estimates</h2>' +
          '<p class="cal-headline">' +
            escapeHtml('You have ' + summary.planCount + ' saved plan' +
              (summary.planCount === 1 ? '' : 's') +
              ' — but no logged outcomes yet. After your next shipment lands, click') +
            ' <strong>+ Log actual outcome</strong> ' +
            escapeHtml('on the matching plan. The bigger your sample, the more accurate OrcaTrade gets for you.') +
          '</p>' +
        '</div>';
    }

    // Live state. Direction-coloured border picks up the cumulative
    // bias: if you're consistently coming in under estimate, that's
    // green; over, amber.
    var dir = 'neutral';
    if (summary.avgVariancePct != null) {
      if (summary.avgVariancePct >= 0.5) dir = 'over';
      else if (summary.avgVariancePct <= -0.5) dir = 'under';
    }
    var headline;
    if (summary.avgVariancePct == null || Math.abs(summary.avgVariancePct) < 0.5) {
      headline = 'Across the plans you\'ve logged outcomes for, your estimates have been spot-on on average.';
    } else if (summary.avgVariancePct > 0) {
      headline = 'Across your logged outcomes, real landed costs have come in ' +
        summary.avgVariancePct + '% over OrcaTrade\'s estimate on a value-weighted basis. ' +
        'That\'s where the calculator is currently optimistic for your category mix.';
    } else {
      headline = 'Across your logged outcomes, real landed costs have come in ' +
        Math.abs(summary.avgVariancePct) + '% under OrcaTrade\'s estimate on a value-weighted basis. ' +
        'OrcaTrade has been running conservative for your category mix — your real costs are coming in lower.';
    }

    var deltaSign = summary.totalDeltaEur > 0 ? '+' : '';
    var byDir = summary.byDirection;
    var directionSummary;
    var pieces = [];
    if (byDir.under > 0) pieces.push(byDir.under + ' under-budget');
    if (byDir.onTarget > 0) pieces.push(byDir.onTarget + ' on target');
    if (byDir.over > 0) pieces.push(byDir.over + ' over-budget');
    directionSummary = pieces.join(' · ');

    return '<div class="calibration-card dir-' + dir + '">' +
        '<div class="cal-kicker">Your calibration story</div>' +
        '<h2>How your estimates match reality</h2>' +
        '<p class="cal-headline">' + escapeHtml(headline) + '</p>' +
        '<div class="cal-stats">' +
          '<div class="cal-stat">' +
            '<span class="cal-stat-label">Plans saved</span>' +
            '<span class="cal-stat-value">' + summary.planCount + '</span>' +
          '</div>' +
          '<div class="cal-stat">' +
            '<span class="cal-stat-label">Outcomes logged</span>' +
            '<span class="cal-stat-value">' + summary.withActuals + ' of ' + summary.planCount + '</span>' +
          '</div>' +
          '<div class="cal-stat">' +
            '<span class="cal-stat-label">Total estimated</span>' +
            '<span class="cal-stat-value">' + fmtEur(summary.totalEstimateEur) + '</span>' +
          '</div>' +
          '<div class="cal-stat">' +
            '<span class="cal-stat-label">Total actual</span>' +
            '<span class="cal-stat-value">' + fmtEur(summary.totalActualEur) +
              ' <span style="font-size: 0.78rem; color: rgba(255,255,255,0.5);">(' + deltaSign + fmtEur(summary.totalDeltaEur) + ')</span>' +
            '</span>' +
          '</div>' +
        '</div>' +
        (directionSummary
          ? '<div class="cal-foot">Outcome split: ' + escapeHtml(directionSummary) + '.</div>'
          : '') +
      '</div>';
  }

  function showCalibration(records) {
    var el = document.getElementById('plans-calibration');
    if (!el) return;
    var summary = summariseActuals(records);
    var html = renderCalibrationCard(summary);
    if (!html) { el.hidden = true; return; }
    el.innerHTML = html;
    el.hidden = false;
  }

  // ── Sprint BG-1.4: actuals capture + variance badge ────────
  //
  // Two states per plan:
  //   - No actual logged → "Log actual outcome" toggle + inline form
  //   - Actual logged    → variance badge + edit/clear controls
  //
  // The form, the badge, and the toggle all share the same per-card
  // <div class="plan-actual"> wrapper so toggling between states only
  // needs to swap that wrapper's innerHTML.

  function renderActualForm(record) {
    // Pre-fill the EUR input with the existing actual (if any) so an
    // "edit" flow doesn't lose data.
    var preEur = '';
    if (record.actual && Number.isFinite(record.actual.landedCents)) {
      preEur = (record.actual.landedCents / 100).toFixed(2);
    }
    var preNotes = (record.actual && record.actual.notes) || '';
    return '<div class="actual-form" data-actual-form>' +
        '<label>Total landed cost actually paid (EUR)</label>' +
        '<input type="number" min="0.01" step="0.01" data-actual-input placeholder="e.g. 28450.00" value="' + escapeHtml(preEur) + '" />' +
        '<label>Notes (optional)</label>' +
        '<textarea data-actual-notes placeholder="What drove the variance? Surprise duty? Freight surge?">' + escapeHtml(preNotes) + '</textarea>' +
        '<div class="form-actions">' +
          '<button type="button" class="primary" data-actual-save>Save outcome</button>' +
          '<button type="button" data-actual-cancel>Cancel</button>' +
          '<span class="err" data-actual-err></span>' +
        '</div>' +
      '</div>';
  }

  function renderVarianceBadge(record) {
    var v = record.actualVariance;
    if (!v) return '';
    var cls = 'plan-variance ' + (v.direction === 'over' ? 'over' : (v.direction === 'under' ? 'under' : 'flat'));
    var arrow = v.direction === 'over' ? '▲' : (v.direction === 'under' ? '▼' : '·');
    var headline;
    if (v.direction === 'on-target' || Math.abs(v.deltaPct) < 0.5) {
      headline = 'Actual landed cost matched the estimate.';
    } else {
      var word = v.direction === 'over' ? 'over' : 'under';
      var pctSign = v.deltaPct > 0 ? '+' : '';
      headline = 'Actual landed cost came in ' + word + ' the estimate by ' +
        pctSign + v.deltaPct + '% (' + fmtEur(Math.abs(v.deltaEur)) + ').' +
        (v.significant ? '' : '');
    }
    var notesHtml = record.actual && record.actual.notes
      ? '<div class="notes">"' + escapeHtml(record.actual.notes) + '"</div>'
      : '';
    return '<div class="' + cls + '">' +
        '<span class="variance-arrow">' + arrow + '</span>' +
        '<span class="variance-headline">' + escapeHtml(headline) + '</span>' +
        '<span class="variance-numbers">' +
          'estimated ' + fmtEur(v.estimateEur) + ' · actual ' + fmtEur(v.actualEur) +
        '</span>' +
        notesHtml +
        '<div class="variance-controls">' +
          '<button type="button" data-action="actual-edit">Edit</button>' +
          '<button type="button" data-action="actual-clear">Clear</button>' +
        '</div>' +
      '</div>';
  }

  // ── Shares-v1: share pane per plan card ──────────────
  //
  // Two states:
  //   - No share active   → "Share this plan" toggle button
  //   - Share active      → URL + Copy + Revoke + view count
  // The toggle expands the pane inline; revoking collapses it back
  // to the toggle. Same delegated-listener pattern as the actuals UI.

  function buildShareUrl(code) {
    return window.location.origin + '/share/' + code;
  }

  function renderSharePane(record) {
    if (record.share && record.share.code) {
      var url = buildShareUrl(record.share.code);
      var views = Number(record.share.viewCount) || 0;
      var lastView = record.share.lastViewedAt ? ' · last view ' + fmtDate(record.share.lastViewedAt) : '';
      return '<div class="plan-share" data-plan-share>'
        + '<div class="share-pane is-open">'
          + '<div class="share-headline">Share link active · anyone with this URL can view</div>'
          + '<div class="share-url-row">'
            + '<input class="share-url" type="text" value="' + escapeHtml(url) + '" readonly />'
            + '<button type="button" data-action="share-copy">Copy</button>'
            + '<button type="button" class="danger" data-action="share-revoke">Revoke</button>'
          + '</div>'
          + '<div class="share-meta"><strong>' + views + '</strong> view'
          + (views === 1 ? '' : 's') + escapeHtml(lastView) + '</div>'
          + '<div class="err" data-share-err></div>'
        + '</div>'
      + '</div>';
    }
    return '<div class="plan-share" data-plan-share>'
      + '<button type="button" class="share-toggle" data-action="share-create">→ Share this plan</button>'
    + '</div>';
  }

  // Initial render of the actual area — either the badge, or the
  // "Log actual outcome" toggle, plus a (closed) form ready to open.
  function renderActualBlock(record) {
    if (record.actualVariance) {
      return '<div class="plan-actual" data-plan-actual>' +
        renderVarianceBadge(record) +
        renderActualForm(record) +
      '</div>';
    }
    return '<div class="plan-actual" data-plan-actual>' +
        '<button type="button" class="actual-toggle" data-action="actual-open">+ Log actual outcome</button>' +
        renderActualForm(record) +
      '</div>';
  }

  // Diff badge: only render when we have both a saved snapshot and a recomputed
  // total. Significance threshold (≥5%) comes from the server.
  function renderDelta(r) {
    if (!r.delta || !r.snapshot || !r.current) return '';
    var d = r.delta;
    var direction = d.landedDeltaEur > 0 ? 'up' : (d.landedDeltaEur < 0 ? 'down' : 'flat');
    var cls = 'delta-' + direction + (d.significant ? ' delta-significant' : '');
    var arrow = direction === 'up' ? '▲' : (direction === 'down' ? '▼' : '·');
    var sign = d.landedDeltaEur > 0 ? '+' : '';
    var pctSign = d.landedDeltaPct > 0 ? '+' : '';
    var headline;
    if (direction === 'flat' || Math.abs(d.landedDeltaEur) < 1) {
      headline = 'Pricing steady since you saved this';
    } else {
      headline = 'Landed cost ' + (direction === 'up' ? 'up' : 'down') +
        ' ' + sign + fmtEur(d.landedDeltaEur) + ' (' + pctSign + d.landedDeltaPct + '%)' +
        (d.primaryDriver ? ' — ' + driverLabel(d.primaryDriver) + ' moved most' : '');
    }
    var savedLine = 'Saved at ' + fmtEur(r.snapshot.perShipmentLandedTotal) +
      ' · now ' + fmtEur(r.current.perShipmentLandedTotal);
    return '<div class="plan-delta ' + cls + '">' +
        '<span class="delta-arrow">' + arrow + '</span>' +
        '<span class="delta-text">' + escapeHtml(headline) + '</span>' +
        '<span class="delta-sub">' + escapeHtml(savedLine) + '</span>' +
      '</div>';
  }

  // ── Render ──────────────────────────────────────────

  function renderList(records) {
    if (!records.length) {
      hide(loadingEl);
      show(emptyEl);
      return;
    }
    // Sprint BG-1.5 — calibration card above the list. Same payload,
    // so no extra fetch. Hidden on no-records by showCalibration itself.
    showCalibration(records);
    listEl.innerHTML = records.map(function (r) {
      var url = buildPlanUrl(r);
      return '<div class="plan-card" data-plan-id="' + escapeHtml(r.id) + '">' +
        '<div class="plan-info">' +
          '<div class="plan-label">' + escapeHtml(r.label || '(unnamed plan)') + '</div>' +
          '<div class="plan-meta">' + escapeHtml(r.id) + ' · saved ' + escapeHtml(fmtDate(r.savedAt)) + '</div>' +
          renderDelta(r) +
          renderActualBlock(r) +
          renderSharePane(r) +
        '</div>' +
        '<div class="plan-actions">' +
          '<a href="' + url + '">Open</a>' +
          '<button type="button" class="delete-btn" data-action="delete">Delete</button>' +
        '</div>' +
      '</div>';
    }).join('');
    hide(loadingEl);
    show(listEl);

    // Wire delete buttons
    listEl.querySelectorAll('.delete-btn[data-action="delete"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var card = btn.closest('.plan-card');
        var planId = card.getAttribute('data-plan-id');
        if (!confirm('Delete this saved plan?')) return;
        btn.disabled = true;
        btn.textContent = '...';
        fetch('/api/plans/' + encodeURIComponent(planId), {
          method: 'DELETE',
          credentials: 'same-origin',
        }).then(function (r) {
          if (r.ok) {
            card.style.display = 'none';
          } else {
            btn.disabled = false;
            btn.textContent = 'Delete';
          }
        }).catch(function () {
          btn.disabled = false;
          btn.textContent = 'Delete';
        });
      });
    });

    // ── Sprint BG-1.4: wire the actuals controls ──────────
    // One delegated listener on the list, dispatching by data-action.
    // Saves a per-card listener fan-out + survives DOM swaps inside
    // the .plan-actual wrapper after a save / clear.
    listEl.addEventListener('click', function (e) {
      var actionEl = e.target.closest('[data-action]');
      if (!actionEl) return;
      var card = actionEl.closest('.plan-card');
      if (!card) return;
      var planId = card.getAttribute('data-plan-id');
      var action = actionEl.getAttribute('data-action');

      if (action === 'actual-open' || action === 'actual-edit') {
        // Open the form, hide the toggle button.
        var form = card.querySelector('[data-actual-form]');
        if (form) form.classList.add('is-open');
        var toggle = card.querySelector('.actual-toggle');
        if (toggle) toggle.style.display = 'none';
        var input = card.querySelector('[data-actual-input]');
        if (input) input.focus();
        return;
      }
      if (action === 'actual-clear') {
        if (!confirm('Remove the logged actual outcome for this plan?')) return;
        fetch('/api/plans/' + encodeURIComponent(planId) + '/actual', {
          method: 'DELETE', credentials: 'same-origin',
        }).then(function (r) { return r.ok ? r.json() : null; })
          .then(function (data) {
            if (data && data.ok && data.plan) replaceActualBlock(card, data.plan);
          });
        return;
      }
      // Shares-v1 — create / copy / revoke ───────────────
      if (action === 'share-create') {
        actionEl.disabled = true;
        actionEl.textContent = 'Generating…';
        fetch('/api/plans/' + encodeURIComponent(planId) + '/share', {
          method: 'POST', credentials: 'same-origin',
        }).then(function (r) { return r.ok ? r.json() : null; })
          .then(function (data) {
            if (data && data.ok && data.share && data.share.code) {
              replaceShareBlock(card, {
                share: data.share,
              });
            } else {
              actionEl.disabled = false;
              actionEl.textContent = '→ Share this plan';
            }
          });
        return;
      }
      if (action === 'share-copy') {
        var input = card.querySelector('input.share-url');
        if (!input) return;
        var url = input.value;
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(url).then(function () {
            actionEl.textContent = 'Copied ✓';
            setTimeout(function () { actionEl.textContent = 'Copy'; }, 1400);
          }).catch(function () { input.select(); });
        } else {
          input.select();
        }
        return;
      }
      if (action === 'share-revoke') {
        if (!confirm('Revoke this share link?\n\nThe URL will stop working for new openings. People who already followed it may still see the plan from their browser history.')) return;
        actionEl.disabled = true;
        actionEl.textContent = 'Revoking…';
        fetch('/api/plans/' + encodeURIComponent(planId) + '/share', {
          method: 'DELETE', credentials: 'same-origin',
        }).then(function (r) {
          if (r.ok) {
            // Re-render the share area as the "Share this plan" toggle.
            replaceShareBlock(card, { share: null });
          } else {
            actionEl.disabled = false;
            actionEl.textContent = 'Revoke';
          }
        });
        return;
      }
    });

    listEl.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-actual-cancel]');
      if (!btn) return;
      var card = btn.closest('.plan-card');
      var form = card.querySelector('[data-actual-form]');
      if (form) form.classList.remove('is-open');
      var toggle = card.querySelector('.actual-toggle');
      if (toggle) toggle.style.display = '';
    });

    listEl.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-actual-save]');
      if (!btn) return;
      var card = btn.closest('.plan-card');
      var planId = card.getAttribute('data-plan-id');
      var input = card.querySelector('[data-actual-input]');
      var notes = card.querySelector('[data-actual-notes]');
      var err = card.querySelector('[data-actual-err]');
      var eur = parseFloat(input && input.value);
      if (!(eur > 0)) {
        if (err) err.textContent = 'Enter a positive EUR amount.';
        return;
      }
      if (err) err.textContent = '';
      btn.disabled = true; btn.textContent = 'Saving…';
      fetch('/api/plans/' + encodeURIComponent(planId) + '/actual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ landedEur: eur, notes: notes ? notes.value : '' }),
      }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (resp) {
          btn.disabled = false; btn.textContent = 'Save outcome';
          if (resp.ok && resp.j && resp.j.plan) {
            replaceActualBlock(card, resp.j.plan);
          } else if (err) {
            err.textContent = (resp.j && resp.j.error) || 'Could not save outcome.';
          }
        })
        .catch(function (e2) {
          btn.disabled = false; btn.textContent = 'Save outcome';
          if (err) err.textContent = 'Network error: ' + (e2.message || 'unknown');
        });
    });
  }

  // Swap the .plan-actual wrapper of a card with a freshly-rendered
  // version reflecting the new plan record (with/without variance).
  function replaceActualBlock(card, record) {
    var existing = card.querySelector('[data-plan-actual]');
    if (!existing) return;
    var temp = document.createElement('div');
    temp.innerHTML = renderActualBlock(record);
    var fresh = temp.firstChild;
    existing.parentNode.replaceChild(fresh, existing);
  }

  // Same pattern for the share wrapper — replaceable in place after
  // create/revoke so the rest of the card stays untouched.
  function replaceShareBlock(card, record) {
    var existing = card.querySelector('[data-plan-share]');
    if (!existing) return;
    var temp = document.createElement('div');
    temp.innerHTML = renderSharePane(record);
    var fresh = temp.firstChild;
    existing.parentNode.replaceChild(fresh, existing);
  }

  // ── Init ────────────────────────────────────────────

  fetch('/api/plans', { credentials: 'same-origin' })
    .then(function (r) {
      if (r.status === 401) {
        hide(loadingEl);
        show(signinEl);
        return null;
      }
      return r.ok ? r.json() : null;
    })
    .then(function (data) {
      if (!data) return;
      renderList(Array.isArray(data.plans) ? data.plans : []);
    })
    .catch(function () {
      hide(loadingEl);
      show(signinEl);
    });
})();
