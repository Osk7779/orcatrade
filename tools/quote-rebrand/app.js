'use strict';

// Quote Studio client (Sprint quote-rebrand-v1). Drives the two-step flow:
//   1. upload supplier PDF → POST /api/quote-rebrand {action:'extract'}
//   2. review/edit rows + pick margin + meta → POST {action:'generate'} → PDF
//
// Auth mirrors the audit dashboard: session cookie first (credentials), with an
// optional admin token pasted into the token field as a query-param fallback.

(function () {
  var STORAGE_KEY = 'orcatrade.quote-rebrand.token';
  var el = function (id) { return document.getElementById(id); };
  var pdfBase64 = null;
  var lastObjectUrl = null;

  // ── token persistence ────────────────────────────────────────────────
  try {
    var saved = localStorage.getItem(STORAGE_KEY);
    if (saved) el('tokenInput').value = saved;
  } catch (_) {}
  el('tokenInput').addEventListener('change', function () {
    try { localStorage.setItem(STORAGE_KEY, el('tokenInput').value.trim()); } catch (_) {}
    probeAccess(); // a freshly-pasted token may unlock the tool
  });

  function apiUrl() {
    var token = el('tokenInput').value.trim();
    return '/api/quote-rebrand' + (token ? ('?token=' + encodeURIComponent(token)) : '');
  }

  function showGlobalErr(msg) {
    el('globalErr').innerHTML = msg ? '<div class="err">' + escapeHtml(msg) + '</div>' : '';
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  // ── Access gate ───────────────────────────────────────────────────────
  // Probe the team-only API on load (and whenever a token is entered). The
  // tool panels stay hidden until access is confirmed, so the page never
  // exposes the quoting UI to anyone who isn't on the OrcaTrade team.
  function setLocked(message) {
    el('panelUpload').hidden = true;
    el('panelReview').hidden = true;
    el('gateBody').innerHTML = message;
  }
  function setUnlocked(email) {
    el('gateBody').innerHTML = '<span style="color:#7ed28a">✓ Signed in' +
      (email ? (' as ' + escapeHtml(email)) : ' (token)') + '. You have Quote Studio access.</span>';
    el('panelUpload').hidden = false;
  }

  async function probeAccess() {
    el('gateBody').textContent = 'Checking access…';
    try {
      var res = await fetch(apiUrl(), { method: 'GET', credentials: 'same-origin' });
      var data = null; try { data = await res.json(); } catch (_) {}
      if (res.ok && data && data.authed) {
        setUnlocked(data.email);
        return;
      }
      if (res.status === 503) {
        setLocked('Quote Studio is not yet configured on the server. Ask an administrator to add your email to <code>ORCATRADE_QUOTE_STUDIO_EMAILS</code>.');
        return;
      }
      setLocked('This is an OrcaTrade team tool. <a href="/account/" style="color:#b8bec8">Sign in</a> with your OrcaTrade account, or paste a valid admin token above. If you are signed in and still see this, your email is not on the Quote Studio team list.');
    } catch (_) {
      setLocked('Could not reach the server to verify access. Check your connection and reload.');
    }
  }

  // ── Step 1: file selection ────────────────────────────────────────────
  var dz = el('dropzone');
  var fileInput = el('fileInput');
  dz.addEventListener('click', function () { fileInput.click(); });
  dz.addEventListener('dragover', function (e) { e.preventDefault(); dz.classList.add('drag'); });
  dz.addEventListener('dragleave', function () { dz.classList.remove('drag'); });
  dz.addEventListener('drop', function (e) {
    e.preventDefault(); dz.classList.remove('drag');
    if (e.dataTransfer.files && e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  });
  fileInput.addEventListener('change', function () {
    if (fileInput.files && fileInput.files[0]) handleFile(fileInput.files[0]);
  });

  function handleFile(file) {
    showGlobalErr('');
    if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) {
      return showGlobalErr('Please choose a PDF file.');
    }
    if (file.size > 8 * 1024 * 1024) {
      return showGlobalErr('PDF is too large (max 8 MB).');
    }
    el('fileName').textContent = file.name + '  ·  ' + Math.round(file.size / 1024) + ' KB';
    var reader = new FileReader();
    reader.onload = function () {
      pdfBase64 = String(reader.result).replace(/^data:application\/pdf;base64,/, '');
      el('extractBtn').disabled = false;
    };
    reader.onerror = function () { showGlobalErr('Could not read that file.'); };
    reader.readAsDataURL(file);
  }

  // ── Step 1 → extract ──────────────────────────────────────────────────
  el('extractBtn').addEventListener('click', async function () {
    if (!pdfBase64) return;
    showGlobalErr('');
    var btn = el('extractBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spin"></span>Reading…';
    try {
      var res = await fetch(apiUrl(), {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'extract', pdfBase64: pdfBase64 }),
      });
      var data = await res.json();
      if (!res.ok) {
        showGlobalErr(authMessage(res.status, data.error));
        return;
      }
      populateReview(data.extraction || {});
    } catch (err) {
      showGlobalErr('Extraction request failed. Check your connection and try again.');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Read quotation';
    }
  });

  el('manualBtn').addEventListener('click', function () {
    populateReview({ lineItems: [] });
  });

  function authMessage(status, serverMsg) {
    if (status === 401) return 'Unauthorized — sign in as an admin or paste a valid token above.';
    if (status === 503) return 'Admin auth is not configured on the server.';
    return serverMsg || ('Request failed (HTTP ' + status + ').');
  }

  // ── Step 2: review form ───────────────────────────────────────────────
  function addRow(item) {
    item = item || {};
    var tr = document.createElement('tr');
    tr.innerHTML =
      '<td class="colDesc"><input type="text" class="r-desc" /></td>' +
      '<td class="colQty"><input type="text" class="r-qty" /></td>' +
      '<td class="colUnit"><input type="text" class="r-unit" placeholder="pcs" /></td>' +
      '<td class="colPrice"><input type="text" class="r-price" /></td>' +
      '<td class="colX"><button class="rmRow" title="Remove line">✕</button></td>';
    tr.querySelector('.r-desc').value = item.description || '';
    tr.querySelector('.r-qty').value = item.quantity != null ? item.quantity : '';
    tr.querySelector('.r-unit').value = item.unit || '';
    tr.querySelector('.r-price').value = item.unitPrice != null ? item.unitPrice : '';
    tr.querySelector('.rmRow').addEventListener('click', function () { tr.remove(); });
    el('linesBody').appendChild(tr);
  }

  el('addRowBtn').addEventListener('click', function () { addRow({}); });

  function populateReview(extraction) {
    el('linesBody').innerHTML = '';
    var items = Array.isArray(extraction.lineItems) ? extraction.lineItems : [];
    if (items.length === 0) addRow({});
    else items.forEach(addRow);

    if (extraction.currency) el('currencyInput').value = String(extraction.currency).toUpperCase().slice(0, 3);
    if (extraction.notes) el('notes').value = extraction.notes;

    el('panelReview').setAttribute('data-disabled', '0');
    el('panelReview').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // margin selector visual state
  el('margins').addEventListener('change', function () {
    Array.prototype.forEach.call(document.querySelectorAll('.margin-opt'), function (opt) {
      opt.classList.toggle('sel', opt.querySelector('input').checked);
    });
  });

  function collectLineItems() {
    var rows = el('linesBody').querySelectorAll('tr');
    var items = [];
    Array.prototype.forEach.call(rows, function (tr) {
      var desc = tr.querySelector('.r-desc').value.trim();
      var qty = tr.querySelector('.r-qty').value.trim();
      var unit = tr.querySelector('.r-unit').value.trim();
      var price = tr.querySelector('.r-price').value.trim();
      if (desc || qty || price) {
        items.push({ description: desc, quantity: qty, unit: unit, unitPrice: price });
      }
    });
    return items;
  }

  // ── Step 2 → generate ─────────────────────────────────────────────────
  el('generateBtn').addEventListener('click', async function () {
    showGlobalErr('');
    el('resultArea').innerHTML = '';
    var marginEl = document.querySelector('input[name="margin"]:checked');
    var payload = {
      action: 'generate',
      currency: el('currencyInput').value.trim() || 'EUR',
      marginPct: marginEl ? Number(marginEl.value) : 10,
      lineItems: collectLineItems(),
      meta: {
        quoteNumber: el('quoteNumber').value.trim(),
        validUntil: el('validUntil').value,
        issueDate: new Date().toISOString().slice(0, 10),
        customerName: el('customerName').value.trim(),
        customerAddress: el('customerAddress').value,
        notes: el('notes').value.trim(),
      },
    };

    var btn = el('generateBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spin"></span>Generating…';
    el('genStatus').textContent = '';
    try {
      var res = await fetch(apiUrl(), {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        var data = null;
        try { data = await res.json(); } catch (_) {}
        var msg = data && data.errors ? data.errors.join(' · ') : authMessage(res.status, data && data.error);
        showGlobalErr(msg);
        return;
      }
      var blob = await res.blob();
      if (lastObjectUrl) URL.revokeObjectURL(lastObjectUrl);
      lastObjectUrl = URL.createObjectURL(blob);
      var fname = 'orcatrade-' + (payload.meta.quoteNumber || 'quote').replace(/[^A-Za-z0-9_-]/g, '') + '.pdf';

      var a = document.createElement('a');
      a.href = lastObjectUrl; a.download = fname; a.textContent = '↓ Download ' + fname;
      a.className = 'btn primary'; a.style.textDecoration = 'none'; a.style.display = 'inline-block';

      el('resultArea').innerHTML = '<div class="ok">Quotation generated. ' + Math.round(blob.size / 1024) + ' KB.</div>';
      el('resultArea').appendChild(a);
      var iframe = document.createElement('iframe');
      iframe.className = 'preview'; iframe.src = lastObjectUrl;
      el('resultArea').appendChild(iframe);
    } catch (err) {
      showGlobalErr('Generation request failed. Check your connection and try again.');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Generate OrcaTrade PDF';
    }
  });

  // Resolve access as soon as the page loads.
  probeAccess();
})();
