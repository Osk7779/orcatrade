// Trade Documentation Hub — shared form helpers.
// Each form's app.js calls into these and supplies its own SCENARIOS map and field schema.

(function (global) {
  'use strict';

  const COMMERCIAL_INVOICE_KEY = 'orcatrade.commercial-invoice.draft.v1';

  function setNested(obj, path, value) {
    const parts = path.split('.');
    let cursor = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      if (typeof cursor[parts[i]] !== 'object' || cursor[parts[i]] === null) cursor[parts[i]] = {};
      cursor = cursor[parts[i]];
    }
    cursor[parts[parts.length - 1]] = value;
  }

  function getNested(obj, path) {
    const parts = path.split('.');
    let cursor = obj;
    for (const part of parts) {
      if (cursor == null) return undefined;
      cursor = cursor[part];
    }
    return cursor;
  }

  function readForm(form, lineItemFields, tbodySelector) {
    const data = {};
    const inputs = form.querySelectorAll('input[name], textarea[name], select[name]');
    inputs.forEach(el => {
      const name = el.getAttribute('name');
      if (!name) return;
      let value = el.value;
      if (el.type === 'number' && value !== '') value = Number(value);
      setNested(data, name, value);
    });
    if (lineItemFields && tbodySelector) {
      data.lineItems = readLineItems(form, tbodySelector, lineItemFields);
    }
    return data;
  }

  function readLineItems(form, tbodySelector, fields) {
    const tbody = form.querySelector(tbodySelector);
    if (!tbody) return [];
    const rows = tbody.querySelectorAll('tr.line-row');
    return Array.from(rows).map(row => {
      const item = {};
      row.querySelectorAll('input').forEach(input => {
        const key = input.dataset.field;
        if (!key) return;
        const value = input.value;
        item[key] = (input.type === 'number' && value !== '') ? Number(value) : value;
      });
      return item;
    });
  }

  function applyState(form, data, opts) {
    if (!data) return;
    const inputs = form.querySelectorAll('input[name], textarea[name], select[name]');
    inputs.forEach(el => {
      const name = el.getAttribute('name');
      if (!name) return;
      const value = getNested(data, name);
      el.value = (value == null) ? '' : String(value);
    });
    if (opts && opts.tbodySelector && opts.lineColumns) {
      renderLineItems(form, opts.tbodySelector, opts.lineColumns, Array.isArray(data.lineItems) ? data.lineItems : []);
    }
  }

  function emptyLine(fields) {
    const out = {};
    fields.forEach(f => { out[f] = ''; });
    return out;
  }

  function renderLineItems(form, tbodySelector, columns, items) {
    const tbody = form.querySelector(tbodySelector);
    if (!tbody) return;
    tbody.innerHTML = '';
    const fields = columns.map(c => c.field);
    const list = items.length ? items : [emptyLine(fields)];
    list.forEach((item, i) => addLineRow(tbody, columns, item, i));
  }

  function addLineRow(tbody, columns, item, index) {
    const idx = index != null ? index : tbody.querySelectorAll('tr.line-row').length;
    const tr = document.createElement('tr');
    tr.className = 'line-row';
    const cells = [
      `<td class="num" style="font-family: 'Geist Mono', monospace; opacity: 0.55;">${idx + 1}</td>`,
    ];
    columns.forEach(col => {
      const inputType = col.type || 'text';
      const step = col.step ? ` step="${col.step}"` : '';
      const min = col.min != null ? ` min="${col.min}"` : '';
      const placeholder = col.placeholder ? ` placeholder="${col.placeholder}"` : '';
      cells.push(`<td><input data-field="${col.field}" type="${inputType}"${step}${min}${placeholder} /></td>`);
    });
    cells.push(`<td class="line-actions">
      <button type="button" class="icon-btn" data-action="duplicate" title="Duplicate line">⎘</button>
      <button type="button" class="icon-btn" data-action="remove" title="Remove line">×</button>
    </td>`);
    tr.innerHTML = cells.join('');
    Object.entries(item || {}).forEach(([k, v]) => {
      const input = tr.querySelector(`input[data-field="${k}"]`);
      if (input) input.value = (v == null) ? '' : String(v);
    });
    tbody.appendChild(tr);
  }

  function bindLineActions(form, tbodySelector, columns, onChange) {
    const tbody = form.querySelector(tbodySelector);
    tbody.addEventListener('click', e => {
      const btn = e.target.closest('.icon-btn');
      if (!btn) return;
      const row = btn.closest('tr.line-row');
      if (btn.dataset.action === 'remove') {
        if (tbody.querySelectorAll('tr.line-row').length === 1) return;
        row.remove();
      } else if (btn.dataset.action === 'duplicate') {
        const item = {};
        row.querySelectorAll('input').forEach(input => { item[input.dataset.field] = input.value; });
        const newRow = row.cloneNode(true);
        row.parentNode.insertBefore(newRow, row.nextSibling);
        newRow.querySelectorAll('input').forEach((input, i) => {
          const original = row.querySelectorAll('input')[i];
          if (original) input.value = original.value;
        });
      }
      updateRowNumbers(tbody);
      if (typeof onChange === 'function') onChange();
    });
  }

  function updateRowNumbers(tbody) {
    tbody.querySelectorAll('tr.line-row').forEach((row, i) => {
      const cell = row.querySelector('td.num');
      if (cell) cell.textContent = String(i + 1);
    });
  }

  function loadDraft(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  function saveDraft(key, state) {
    try { localStorage.setItem(key, JSON.stringify(state)); } catch {}
  }

  function clearDraft(key) {
    try { localStorage.removeItem(key); } catch {}
  }

  function importFromCommercialInvoice(fields) {
    const ci = loadDraft(COMMERCIAL_INVOICE_KEY);
    if (!ci) return null;
    const out = {};
    fields.forEach(f => {
      const value = getNested(ci, f);
      if (value !== undefined) setNested(out, f, value);
    });
    return out;
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = String(text == null ? '' : text);
    return div.innerHTML;
  }

  async function generateAndOpen({ apiEndpoint, type, data, msgEl }) {
    msgEl.classList.remove('error');
    msgEl.textContent = 'Generating…';
    try {
      const response = await fetch(apiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, data }),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        msgEl.classList.add('error');
        const errors = Array.isArray(err.errors) ? err.errors : [err.error || 'Unknown server error'];
        msgEl.innerHTML = '<b>Could not generate document:</b><ul>' + errors.map(e => `<li>${escapeHtml(e)}</li>`).join('') + '</ul>';
        return;
      }
      const html = await response.text();
      const win = window.open('', '_blank');
      if (win) {
        win.document.open();
        win.document.write(html);
        win.document.close();
        msgEl.textContent = 'Document opened in a new tab. Use the Print button to save as PDF.';
      } else {
        const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
        window.location.href = URL.createObjectURL(blob);
      }
    } catch (error) {
      console.error(error);
      msgEl.classList.add('error');
      msgEl.textContent = 'Network error: ' + (error.message || 'unknown');
    }
  }

  global.OrcaDocForm = {
    setNested, getNested,
    readForm, readLineItems, applyState,
    renderLineItems, addLineRow, bindLineActions, updateRowNumbers,
    loadDraft, saveDraft, clearDraft,
    importFromCommercialInvoice,
    escapeHtml,
    generateAndOpen,
    emptyLine,
  };
})(window);
