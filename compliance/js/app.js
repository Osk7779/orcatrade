document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('complianceForm');
  const cache = window.OrcaTradeCachePreference;

  if (!form) return;

  const ORDER_KEY = 'orcatradeComplianceOrder';
  const RECOVERY_KEY = 'orcatradeComplianceRecovery';
  const CBAM_PATTERN = /\b(cement|iron|steel|metal|aluminium|aluminum|fertili(?:s|z)er|hydrogen|electricity)\b/i;
  const EUDR_PATTERN = /\b(wood|timber|furniture|cocoa|coffee|palm|soya|soy|beef|cattle|rubber|leather|paper|printed matter|chocolate)\b/i;
  const DYNAMIC_FIELDS = {
    cbam: ['cnCode', 'authorisedDeclarant', 'supplierEmissionsData'],
    eudr: ['geolocationAvailable', 'dueDiligenceStatement'],
  };
  const FACT_TO_FIELD_MAP = [
    { pattern: /cn\s*\/?\s*hs|goods classification|classification/i, fieldId: 'cnCode', label: 'CN / HS code' },
    { pattern: /authori[sz]ed.*declarant|declarant status/i, fieldId: 'authorisedDeclarant', label: 'Authorised declarant status' },
    { pattern: /supplier emissions|embedded emissions|emissions data/i, fieldId: 'supplierEmissionsData', label: 'Supplier emissions data' },
    { pattern: /geolocation|polygon|plot-level/i, fieldId: 'geolocationAvailable', label: 'Plot-level geolocation evidence' },
    { pattern: /due[- ]?diligence statement|due diligence/i, fieldId: 'dueDiligenceStatement', label: 'Due-diligence statement' },
    { pattern: /global turnover|turnover/i, fieldId: 'globalTurnover', label: 'Global turnover' },
    { pattern: /employee count/i, fieldId: 'employeeCount', label: 'Exact employee count' },
    { pattern: /company size|operator size/i, fieldId: 'companySize', label: 'Company size' },
    { pattern: /country of origin|origin/i, fieldId: 'origin', label: 'Country of origin' },
    { pattern: /product description|commodity classification|goods description/i, fieldId: 'productDescription', label: 'Product description' },
  ];

  function readWorkflowState(key) {
    if (cache) return cache.readWorkflowState(key);
    return window.localStorage.getItem(key);
  }

  function writeWorkflowState(key, value) {
    if (cache) {
      cache.writeWorkflowState(key, value);
      return;
    }
    window.localStorage.setItem(key, value);
  }

  function clearWorkflowState(key) {
    if (cache) {
      cache.clearWorkflowState(key);
      return;
    }
    window.localStorage.removeItem(key);
  }

  function getField(id) {
    return document.getElementById(id);
  }

  function getWrapper(id) {
    const field = getField(id);
    return field ? field.closest('.input-wrapper') : null;
  }

  function getRequirementNote(id) {
    const wrapper = getWrapper(id);
    if (!wrapper) return null;

    let note = wrapper.querySelector('.field-requirement-note');
    if (!note) {
      note = document.createElement('div');
      note.className = 'field-requirement-note';
      wrapper.appendChild(note);
    }

    return note;
  }

  function setFieldRequirement(id, required, reason) {
    const field = getField(id);
    const wrapper = getWrapper(id);
    const note = getRequirementNote(id);

    if (!field || !wrapper || !note) return;

    field.required = Boolean(required);
    field.setAttribute('aria-required', required ? 'true' : 'false');
    wrapper.classList.toggle('is-dynamic-required', Boolean(required));
    note.textContent = required ? reason : '';
    note.classList.toggle('visible', Boolean(required));
  }

  function getCurrentOrderData() {
    const formData = new FormData(form);
    const data = Object.fromEntries(
      Array.from(formData.entries()).map(([key, value]) => [key, typeof value === 'string' ? value.trim() : value])
    );
    data.euMarket = formData.has('euMarket');
    return data;
  }

  function fillFormFromSavedState(savedData) {
    if (!savedData || typeof savedData !== 'object') return;

    Object.entries(savedData).forEach(([key, value]) => {
      const field = getField(key);
      if (!field) return;

      if (field.type === 'checkbox') {
        field.checked = value !== false && value !== 'false';
        return;
      }

      field.value = value ?? '';
    });
  }

  function detectDynamicNeeds(orderData) {
    const combinedText = `${orderData.productCategory || ''} ${orderData.productDescription || ''}`.trim();
    return {
      cbam: CBAM_PATTERN.test(combinedText),
      eudr: EUDR_PATTERN.test(combinedText),
    };
  }

  function renderDynamicNotice(orderData, recoveryData) {
    const notice = document.getElementById('dynamicEvidenceNotice');
    if (!notice) return;

    const needs = detectDynamicNeeds(orderData);
    const chips = [];
    let title = '';
    let copy = '';

    if (needs.cbam) {
      title = 'CBAM evidence required for this goods profile';
      copy = 'These goods look CBAM-adjacent, so OrcaTrade now requires classification and importer-emissions readiness facts before you can run the strongest report.';
      chips.push('CN / HS code', 'Authorised declarant status', 'Supplier emissions data');
    }

    if (needs.eudr) {
      title = title ? 'Multiple evidence gates are active for this goods profile' : 'EUDR evidence required for this goods profile';
      copy = needs.cbam
        ? 'These goods trigger both customs and sustainability evidence checks. Complete the highlighted fields so OrcaTrade can avoid a weaker provisional result.'
        : 'These goods look EUDR-adjacent, so OrcaTrade now requires geolocation and due-diligence readiness facts before you can run the strongest report.';
      chips.push('Geolocation evidence', 'Due-diligence statement');
    }

    if (!needs.cbam && !needs.eudr) {
      if (recoveryData && Array.isArray(recoveryData.fieldLabels) && recoveryData.fieldLabels.length) {
        title = 'Recovery guidance is active';
        copy = 'OrcaTrade restored your previous order details. Complete the highlighted fields below to strengthen the next report.';
        chips.push(...recoveryData.fieldLabels);
      } else {
        notice.style.display = 'none';
        notice.innerHTML = '';
        return;
      }
    }

    notice.innerHTML = `
      <div class="notice-title">${title}</div>
      <div class="notice-copy">${copy}</div>
      ${chips.length ? `<div class="notice-list">${chips.map(label => `<span class="notice-chip">${label}</span>`).join('')}</div>` : ''}
    `;
    notice.style.display = 'block';
  }

  function renderRecoveryNotice(recoveryData) {
    const notice = document.getElementById('recoveryNotice');
    if (!notice) return;

    if (!recoveryData || !Array.isArray(recoveryData.fieldIds) || !recoveryData.fieldIds.length) {
      notice.style.display = 'none';
      notice.innerHTML = '';
      return;
    }

    const chips = Array.isArray(recoveryData.fieldLabels) ? recoveryData.fieldLabels : [];
    notice.innerHTML = `
      <div class="notice-title">Continue from missing facts</div>
      <div class="notice-copy">${recoveryData.message || 'OrcaTrade highlighted the fields it still needs before the next run can be stronger.'}</div>
      ${chips.length ? `<div class="notice-list">${chips.map(label => `<span class="notice-chip">${label}</span>`).join('')}</div>` : ''}
    `;
    notice.style.display = 'block';
  }

  function applyRecoveryHighlighting(recoveryData) {
    form.querySelectorAll('.input-wrapper.is-recovery-target').forEach(wrapper => {
      wrapper.classList.remove('is-recovery-target');
    });

    if (!recoveryData || !Array.isArray(recoveryData.fieldIds)) return;

    recoveryData.fieldIds.forEach(fieldId => {
      const wrapper = getWrapper(fieldId);
      if (wrapper) wrapper.classList.add('is-recovery-target');
    });
  }

  function updateDynamicRequirements(recoveryData) {
    const orderData = getCurrentOrderData();
    const needs = detectDynamicNeeds(orderData);

    DYNAMIC_FIELDS.cbam.forEach(fieldId => {
      setFieldRequirement(fieldId, needs.cbam, 'Required for likely CBAM-covered goods.');
    });
    DYNAMIC_FIELDS.eudr.forEach(fieldId => {
      setFieldRequirement(fieldId, needs.eudr, 'Required for likely EUDR-covered goods.');
    });

    renderDynamicNotice(orderData, recoveryData);
    applyRecoveryHighlighting(recoveryData);
  }

  function parseRecoveryState(raw) {
    if (!raw) return null;

    try {
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.fieldIds)) return null;
      return parsed;
    } catch (error) {
      return null;
    }
  }

  function focusRecoveryTarget(recoveryData) {
    if (!recoveryData || !Array.isArray(recoveryData.fieldIds) || !recoveryData.fieldIds.length) return;

    const firstField = getField(recoveryData.fieldIds[0]);
    if (!firstField) return;

    setTimeout(() => {
      firstField.scrollIntoView({ behavior: 'smooth', block: 'center' });
      firstField.focus({ preventScroll: true });
    }, 80);
  }

  function buildRecoveryDataFromFacts(facts) {
    const fieldIds = [];
    const fieldLabels = [];

    (Array.isArray(facts) ? facts : []).forEach(fact => {
      FACT_TO_FIELD_MAP.forEach(mapping => {
        if (mapping.pattern.test(String(fact || '')) && !fieldIds.includes(mapping.fieldId)) {
          fieldIds.push(mapping.fieldId);
          fieldLabels.push(mapping.label);
        }
      });
    });

    return { fieldIds, fieldLabels };
  }

  const savedOrderData = readWorkflowState(ORDER_KEY);
  if (savedOrderData) {
    try {
      fillFormFromSavedState(JSON.parse(savedOrderData));
    } catch (error) {
      // Ignore broken saved state and let the user continue with a blank form.
    }
  }

  let recoveryData = parseRecoveryState(readWorkflowState(RECOVERY_KEY));
  renderRecoveryNotice(recoveryData);
  updateDynamicRequirements(recoveryData);
  focusRecoveryTarget(recoveryData);

  ['productCategory', 'productDescription', 'companySize'].forEach(fieldId => {
    const field = getField(fieldId);
    if (!field) return;
    field.addEventListener('input', () => updateDynamicRequirements(recoveryData));
    field.addEventListener('change', () => updateDynamicRequirements(recoveryData));
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();

    const data = getCurrentOrderData();
    writeWorkflowState(ORDER_KEY, JSON.stringify(data));
    clearWorkflowState(RECOVERY_KEY);
    recoveryData = null;

    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.innerHTML = 'Analyzing... <span style="display:inline-block;animation:spin 1s linear infinite;margin-left:0.5rem">⭮</span>';
    submitBtn.disabled = true;

    window.location.href = 'check.html';
  });

  window.OrcaTradeComplianceForm = {
    buildRecoveryDataFromFacts,
  };
});
