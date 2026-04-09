document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('complianceForm');
  const cache = window.OrcaTradeCachePreference;
  const lang = (document.documentElement.lang || 'en').slice(0, 2);
  const copy = {
    en: {
      labels: {
        cnCode: 'CN / HS code',
        authorisedDeclarant: 'Authorised declarant status',
        supplierEmissionsData: 'Supplier emissions data',
        geolocationAvailable: 'Plot-level geolocation evidence',
        dueDiligenceStatement: 'Due-diligence statement',
        globalTurnover: 'Global turnover',
        employeeCount: 'Exact employee count',
        companySize: 'Company size',
        origin: 'Country of origin',
        productDescription: 'Product description',
      },
      cbamReason: 'Required for likely CBAM-covered goods.',
      eudrReason: 'Required for likely EUDR-covered goods.',
      cbamTitle: 'CBAM evidence required for this goods profile',
      cbamCopy: 'These goods look CBAM-adjacent, so OrcaTrade now requires classification and importer-emissions readiness facts before you can run the strongest report.',
      eudrTitle: 'EUDR evidence required for this goods profile',
      eudrCopy: 'These goods look EUDR-adjacent, so OrcaTrade now requires geolocation and due-diligence readiness facts before you can run the strongest report.',
      multiTitle: 'Multiple evidence gates are active for this goods profile',
      multiCopy: 'These goods trigger both customs and sustainability evidence checks. Complete the highlighted fields so OrcaTrade can avoid a weaker provisional result.',
      recoveryTitle: 'Recovery guidance is active',
      recoveryCopy: 'OrcaTrade restored your previous order details. Complete the highlighted fields below to strengthen the next report.',
      recoveryNoticeTitle: 'Continue from missing facts',
      recoveryNoticeFallback: 'OrcaTrade highlighted the fields it still needs before the next run can be stronger.',
      submit: 'Analyzing...',
    },
    de: {
      labels: {
        cnCode: 'CN / HS-Code',
        authorisedDeclarant: 'Status als zugelassener Anmelder',
        supplierEmissionsData: 'Emissionsdaten des Lieferanten',
        geolocationAvailable: 'Geolokalisierungsnachweise auf Flächenebene',
        dueDiligenceStatement: 'Sorgfaltspflichterklärung',
        globalTurnover: 'Weltweiter Umsatz',
        employeeCount: 'Genaue Mitarbeiterzahl',
        companySize: 'Unternehmensgröße',
        origin: 'Ursprungsland',
        productDescription: 'Produktbeschreibung',
      },
      cbamReason: 'Erforderlich für wahrscheinlich CBAM-pflichtige Waren.',
      eudrReason: 'Erforderlich für wahrscheinlich EUDR-pflichtige Waren.',
      cbamTitle: 'CBAM-Nachweise für dieses Warenprofil erforderlich',
      cbamCopy: 'Diese Waren wirken CBAM-nah. OrcaTrade benötigt daher Klassifizierungs- und Emissionsbereitschaftsfakten des Importeurs, bevor der stärkste Bericht möglich ist.',
      eudrTitle: 'EUDR-Nachweise für dieses Warenprofil erforderlich',
      eudrCopy: 'Diese Waren wirken EUDR-nah. OrcaTrade benötigt daher Geolokalisierungs- und Sorgfaltspflichtnachweise, bevor der stärkste Bericht möglich ist.',
      multiTitle: 'Mehrere Nachweis-Gates sind für dieses Warenprofil aktiv',
      multiCopy: 'Diese Waren lösen sowohl Zoll- als auch Nachhaltigkeitsprüfungen aus. Vervollständigen Sie die markierten Felder, damit OrcaTrade ein schwächeres vorläufiges Ergebnis vermeiden kann.',
      recoveryTitle: 'Wiederherstellungshinweise sind aktiv',
      recoveryCopy: 'OrcaTrade hat Ihre vorherigen Bestelldaten wiederhergestellt. Ergänzen Sie die markierten Felder unten, um den nächsten Bericht zu stärken.',
      recoveryNoticeTitle: 'Mit fehlenden Fakten fortfahren',
      recoveryNoticeFallback: 'OrcaTrade hat die Felder markiert, die vor dem nächsten stärkeren Lauf noch fehlen.',
      submit: 'Analysiere...',
    },
    pl: {
      labels: {
        cnCode: 'Kod CN / HS',
        authorisedDeclarant: 'Status upoważnionego zgłaszającego',
        supplierEmissionsData: 'Dane emisyjne dostawcy',
        geolocationAvailable: 'Dowody geolokalizacji na poziomie działki',
        dueDiligenceStatement: 'Oświadczenie due diligence',
        globalTurnover: 'Globalne obroty',
        employeeCount: 'Dokładna liczba pracowników',
        companySize: 'Wielkość firmy',
        origin: 'Kraj pochodzenia',
        productDescription: 'Opis produktu',
      },
      cbamReason: 'Wymagane dla towarów prawdopodobnie objętych CBAM.',
      eudrReason: 'Wymagane dla towarów prawdopodobnie objętych EUDR.',
      cbamTitle: 'Dowody CBAM wymagane dla tego profilu towaru',
      cbamCopy: 'Te towary wyglądają na zbliżone do zakresu CBAM, więc OrcaTrade wymaga teraz klasyfikacji oraz informacji o gotowości emisyjnej importera, zanim uruchomi najmocniejszy raport.',
      eudrTitle: 'Dowody EUDR wymagane dla tego profilu towaru',
      eudrCopy: 'Te towary wyglądają na zbliżone do zakresu EUDR, więc OrcaTrade wymaga teraz geolokalizacji i gotowości oświadczenia due diligence, zanim uruchomi najmocniejszy raport.',
      multiTitle: 'Dla tego profilu towaru aktywne są wielokrotne bramki dowodowe',
      multiCopy: 'Te towary uruchamiają zarówno kontrole celne, jak i środowiskowe. Uzupełnij wyróżnione pola, aby OrcaTrade uniknął słabszego wyniku prowizorycznego.',
      recoveryTitle: 'Aktywne są wskazówki odzyskiwania',
      recoveryCopy: 'OrcaTrade przywrócił poprzednie dane zamówienia. Uzupełnij wyróżnione pola poniżej, aby wzmocnić kolejny raport.',
      recoveryNoticeTitle: 'Kontynuuj od brakujących faktów',
      recoveryNoticeFallback: 'OrcaTrade zaznaczył pola, których nadal potrzebuje przed kolejnym, mocniejszym uruchomieniem.',
      submit: 'Analiza...',
    },
  };
  const t = copy[lang] || copy.en;

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
    { pattern: /cn\s*\/?\s*hs|goods classification|classification/i, fieldId: 'cnCode' },
    { pattern: /authori[sz]ed.*declarant|declarant status/i, fieldId: 'authorisedDeclarant' },
    { pattern: /supplier emissions|embedded emissions|emissions data/i, fieldId: 'supplierEmissionsData' },
    { pattern: /geolocation|polygon|plot-level/i, fieldId: 'geolocationAvailable' },
    { pattern: /due[- ]?diligence statement|due diligence/i, fieldId: 'dueDiligenceStatement' },
    { pattern: /global turnover|turnover/i, fieldId: 'globalTurnover' },
    { pattern: /employee count/i, fieldId: 'employeeCount' },
    { pattern: /company size|operator size/i, fieldId: 'companySize' },
    { pattern: /country of origin|origin/i, fieldId: 'origin' },
    { pattern: /product description|commodity classification|goods description/i, fieldId: 'productDescription' },
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
      title = t.cbamTitle;
      copy = t.cbamCopy;
      chips.push(t.labels.cnCode, t.labels.authorisedDeclarant, t.labels.supplierEmissionsData);
    }

    if (needs.eudr) {
      title = title ? t.multiTitle : t.eudrTitle;
      copy = needs.cbam
        ? t.multiCopy
        : t.eudrCopy;
      chips.push(t.labels.geolocationAvailable, t.labels.dueDiligenceStatement);
    }

    if (!needs.cbam && !needs.eudr) {
      if (recoveryData && Array.isArray(recoveryData.fieldLabels) && recoveryData.fieldLabels.length) {
        title = t.recoveryTitle;
        copy = t.recoveryCopy;
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
      <div class="notice-title">${t.recoveryNoticeTitle}</div>
      <div class="notice-copy">${recoveryData.message || t.recoveryNoticeFallback}</div>
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
      setFieldRequirement(fieldId, needs.cbam, t.cbamReason);
    });
    DYNAMIC_FIELDS.eudr.forEach(fieldId => {
      setFieldRequirement(fieldId, needs.eudr, t.eudrReason);
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
          fieldLabels.push(t.labels[mapping.fieldId] || mapping.fieldId);
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
    submitBtn.innerHTML = t.submit + ' <span style="display:inline-block;animation:spin 1s linear infinite;margin-left:0.5rem">⭮</span>';
    submitBtn.disabled = true;

    window.location.href = 'check.html';
  });

  window.OrcaTradeComplianceForm = {
    buildRecoveryDataFromFacts,
  };
});
