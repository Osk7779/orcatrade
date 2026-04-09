const ORDER_KEY = 'orcatradeComplianceOrder';
const RECOVERY_KEY = 'orcatradeComplianceRecovery';
const LANG = (document.documentElement.lang || 'en').slice(0, 2);
const LOCALE = LANG === 'de' ? 'de-DE' : LANG === 'pl' ? 'pl-PL' : 'en-GB';
const TEXT = {
  en: {
    labels: {
      yes: 'Yes',
      no: 'No',
      unknown: 'Unknown',
      compliant: 'COMPLIANT',
      atRisk: 'AT RISK',
      nonCompliant: 'NON-COMPLIANT',
      notApplicable: 'NOT APPLICABLE',
      activeNow: 'ACTIVE NOW',
      futureScope: 'FUTURE SCOPE',
      missingFacts: 'MISSING FACTS',
      outOfScope: 'OUT OF SCOPE',
      evidenceBacked: 'EVIDENCE-BACKED',
      provisional: 'PROVISIONAL',
      blocked: 'BLOCKED',
      screeningOnly: 'SCREENING ONLY',
      whatIsMissing: 'What is missing',
      reportFailed: 'Report generation failed',
      tryAgain: 'Try again',
      product: 'Product',
      companySize: 'Company size',
      productDescription: 'Product description',
      origin: 'Country of origin',
      employeeCount: 'Exact employee count',
      globalTurnover: 'Global turnover',
      geolocationAvailable: 'Plot-level geolocation evidence',
      dueDiligenceStatement: 'Due-diligence statement',
      supplierEmissionsData: 'Supplier emissions data',
      authorisedDeclarant: 'Authorised declarant status',
      cnCode: 'CN / HS code',
      notProvided: 'Not provided',
      noReadinessSummary: 'The backend did not return a readiness summary.',
      finalDecisionBlocked: 'Final verdict blocked until the missing critical facts are provided.',
      screeningResult: 'This is a screening result because no regulation is currently active.',
      backendCanIssue: 'The backend can issue a current verdict on the provided facts.',
      ruleOnly: 'Rule-only fallback report',
      structuredEvidence: 'Structured evidence-backed decision',
      initialScreening: 'Initial regulatory screening',
      structuredDecision: 'Structured decision with missing evidence or unresolved gaps',
      requiredFactsNotProvided: 'Required facts not provided',
      stateOutOfScope: 'Out of scope on current facts',
      stateFuture: 'Future readiness only',
      stateEligible: 'Final verdict can be issued',
      stateMissing: 'Missing critical facts',
      noAdditionalEvidence: 'No additional evidence requirement returned.',
      blockedHelp: 'This report is blocked by missing facts. Return to the intake form and complete the highlighted fields.',
      provisionalHelp: 'This report can be strengthened. Return to the intake form and add the highlighted evidence fields.',
      completeFacts: 'Complete Missing Facts',
      blockedMessage: 'Complete the highlighted fields before OrcaTrade can safely issue a final verdict.',
      provisionalMessage: 'Complete the highlighted fields to strengthen the next report and reduce provisional risk.',
      findings: 'Findings',
      readinessActions: 'Readiness Actions',
      decisionConfidence: 'Decision confidence:',
      nextDecisionAction: 'Next decision action:',
      signalsUsed: 'Signals used:',
      manualReview: 'Manual review:',
      required: 'Required',
      notRequired: 'Not required',
      geolocationReady: 'Geolocation ready:',
      dueDiligenceReady: 'Due-diligence ready:',
      cbamDeclarant: 'CBAM declarant:',
      supplierEmissions: 'Supplier emissions:',
      cnCodeDisplay: 'CN / HS code:',
      keyObligationGap: 'Gap identified:',
      document: 'Document:',
      portal: 'Portal:',
      deadline: 'Deadline:',
      estimatedCost: 'Est. cost:',
      estimatedHours: 'Est. hours:',
      financialRisk: 'Financial Risk',
      minimumFine: 'Minimum fine',
      maximumFine: 'Maximum fine',
      cost: 'Cost:',
      ifIgnored: 'If ignored:',
      complianceDeadline: 'Compliance deadline:',
      reportPrefix: 'OrcaTrade-Compliance-',
    },
    loadingSteps: [
      'Checking EUDR tracing requirements…',
      'Verifying CBAM sector coverage…',
      'Scanning CSDDD thresholds…',
      'Cross-referencing regulatory database…',
      'Calculating financial exposure…',
      'Generating compliance report…',
    ],
  },
  de: {
    labels: {
      yes: 'Ja',
      no: 'Nein',
      unknown: 'Unbekannt',
      compliant: 'KONFORM',
      atRisk: 'RISIKO',
      nonCompliant: 'NICHT KONFORM',
      notApplicable: 'NICHT ANWENDBAR',
      activeNow: 'AKTIV',
      futureScope: 'ZUKÜNFTIG RELEVANT',
      missingFacts: 'FEHLENDE FAKTEN',
      outOfScope: 'AUSSERHALB DES UMFANGS',
      evidenceBacked: 'NACHWEISGESTÜTZT',
      provisional: 'VORLÄUFIG',
      blocked: 'BLOCKIERT',
      screeningOnly: 'NUR SCREENING',
      whatIsMissing: 'Was fehlt',
      reportFailed: 'Berichtserstellung fehlgeschlagen',
      tryAgain: 'Erneut versuchen',
      product: 'Produkt',
      companySize: 'Unternehmensgröße',
      productDescription: 'Produktbeschreibung',
      origin: 'Ursprungsland',
      employeeCount: 'Genaue Mitarbeiterzahl',
      globalTurnover: 'Weltweiter Umsatz',
      geolocationAvailable: 'Geolokalisierungsnachweise auf Flächenebene',
      dueDiligenceStatement: 'Sorgfaltspflichterklärung',
      supplierEmissionsData: 'Lieferantenemissionen',
      authorisedDeclarant: 'Status als zugelassener Anmelder',
      cnCode: 'CN / HS-Code',
      notProvided: 'Nicht angegeben',
      noReadinessSummary: 'Das Backend hat keine Zusammenfassung der Entscheidungsreife zurückgegeben.',
      finalDecisionBlocked: 'Eine Endentscheidung ist blockiert, bis die kritischen fehlenden Fakten vorliegen.',
      screeningResult: 'Dies ist ein Screening-Ergebnis, weil aktuell keine Regulierung aktiv ist.',
      backendCanIssue: 'Das Backend kann auf Basis der vorliegenden Fakten ein aktuelles Urteil ausgeben.',
      ruleOnly: 'Regelbasierter Fallback-Bericht',
      structuredEvidence: 'Strukturierte nachweisgestützte Entscheidung',
      initialScreening: 'Erstes regulatorisches Screening',
      structuredDecision: 'Strukturierte Entscheidung mit fehlenden Nachweisen oder offenen Lücken',
      requiredFactsNotProvided: 'Erforderliche Fakten wurden nicht angegeben',
      stateOutOfScope: 'Nach aktuellem Kenntnisstand außerhalb des Umfangs',
      stateFuture: 'Nur zukünftige Bereitschaft',
      stateEligible: 'Endurteil kann erteilt werden',
      stateMissing: 'Kritische Fakten fehlen',
      noAdditionalEvidence: 'Keine weiteren Nachweisanforderungen zurückgegeben.',
      blockedHelp: 'Dieser Bericht ist wegen fehlender Fakten blockiert. Kehren Sie zum Eingabeformular zurück und ergänzen Sie die markierten Felder.',
      provisionalHelp: 'Dieser Bericht kann gestärkt werden. Kehren Sie zum Eingabeformular zurück und ergänzen Sie die markierten Nachweisfelder.',
      completeFacts: 'Fehlende Fakten ergänzen',
      blockedMessage: 'Vervollständigen Sie die markierten Felder, bevor OrcaTrade sicher ein Endurteil ausgeben kann.',
      provisionalMessage: 'Vervollständigen Sie die markierten Felder, um den nächsten Bericht zu stärken und das vorläufige Risiko zu senken.',
      findings: 'Feststellungen',
      readinessActions: 'Bereitschaftsmaßnahmen',
      decisionConfidence: 'Entscheidungssicherheit:',
      nextDecisionAction: 'Nächste Entscheidungsaktion:',
      signalsUsed: 'Verwendete Signale:',
      manualReview: 'Manuelle Prüfung:',
      required: 'Erforderlich',
      notRequired: 'Nicht erforderlich',
      geolocationReady: 'Geolokalisierung bereit:',
      dueDiligenceReady: 'Sorgfaltspflichterklärung bereit:',
      cbamDeclarant: 'CBAM-Anmelder:',
      supplierEmissions: 'Lieferantenemissionen:',
      cnCodeDisplay: 'CN / HS-Code:',
      keyObligationGap: 'Identifizierte Lücke:',
      document: 'Dokument:',
      portal: 'Portal:',
      deadline: 'Frist:',
      estimatedCost: 'Geschätzte Kosten:',
      estimatedHours: 'Geschätzte Stunden:',
      financialRisk: 'Finanzielles Risiko',
      minimumFine: 'Mindeststrafe',
      maximumFine: 'Höchststrafe',
      cost: 'Kosten:',
      ifIgnored: 'Wenn ignoriert:',
      complianceDeadline: 'Compliance-Frist:',
      reportPrefix: 'OrcaTrade-Compliance-',
    },
    loadingSteps: [
      'EUDR-Rückverfolgbarkeit wird geprüft…',
      'CBAM-Sektorabdeckung wird verifiziert…',
      'CSDDD-Schwellenwerte werden geprüft…',
      'Regulatorische Datenbank wird abgeglichen…',
      'Finanzielle Exponierung wird berechnet…',
      'Compliance-Bericht wird erstellt…',
    ],
  },
  pl: {
    labels: {
      yes: 'Tak',
      no: 'Nie',
      unknown: 'Nieznane',
      compliant: 'ZGODNE',
      atRisk: 'RYZYKO',
      nonCompliant: 'NIEZGODNE',
      notApplicable: 'NIE DOTYCZY',
      activeNow: 'AKTYWNE TERAZ',
      futureScope: 'PRZYSZŁY ZAKRES',
      missingFacts: 'BRAKUJĄCE FAKTY',
      outOfScope: 'POZA ZAKRESEM',
      evidenceBacked: 'OPARTE NA DOWODACH',
      provisional: 'PROWIZORYCZNE',
      blocked: 'ZABLOKOWANE',
      screeningOnly: 'TYLKO SCREENING',
      whatIsMissing: 'Czego brakuje',
      reportFailed: 'Generowanie raportu nie powiodło się',
      tryAgain: 'Spróbuj ponownie',
      product: 'Produkt',
      companySize: 'Wielkość firmy',
      productDescription: 'Opis produktu',
      origin: 'Kraj pochodzenia',
      employeeCount: 'Dokładna liczba pracowników',
      globalTurnover: 'Globalne obroty',
      geolocationAvailable: 'Dowody geolokalizacji na poziomie działki',
      dueDiligenceStatement: 'Oświadczenie due diligence',
      supplierEmissionsData: 'Dane emisyjne dostawcy',
      authorisedDeclarant: 'Status upoważnionego zgłaszającego',
      cnCode: 'Kod CN / HS',
      notProvided: 'Nie podano',
      noReadinessSummary: 'Backend nie zwrócił podsumowania gotowości decyzji.',
      finalDecisionBlocked: 'Końcowy werdykt jest zablokowany do czasu dostarczenia krytycznych brakujących faktów.',
      screeningResult: 'To wynik screeningowy, ponieważ obecnie żadna regulacja nie jest aktywna.',
      backendCanIssue: 'Backend może wydać aktualny werdykt na podstawie dostarczonych faktów.',
      ruleOnly: 'Raport awaryjny oparty wyłącznie na regułach',
      structuredEvidence: 'Ustrukturyzowana decyzja oparta na dowodach',
      initialScreening: 'Wstępny screening regulacyjny',
      structuredDecision: 'Ustrukturyzowana decyzja z brakującymi dowodami lub nierozwiązanymi lukami',
      requiredFactsNotProvided: 'Nie podano wymaganych faktów',
      stateOutOfScope: 'Poza zakresem na obecnych faktach',
      stateFuture: 'Tylko gotowość na przyszłość',
      stateEligible: 'Można wydać końcowy werdykt',
      stateMissing: 'Brak krytycznych faktów',
      noAdditionalEvidence: 'Nie zwrócono dodatkowych wymagań dowodowych.',
      blockedHelp: 'Ten raport jest zablokowany przez brakujące fakty. Wróć do formularza i uzupełnij wyróżnione pola.',
      provisionalHelp: 'Ten raport można wzmocnić. Wróć do formularza i dodaj wyróżnione pola dowodowe.',
      completeFacts: 'Uzupełnij brakujące fakty',
      blockedMessage: 'Uzupełnij wyróżnione pola, zanim OrcaTrade będzie mógł bezpiecznie wydać końcowy werdykt.',
      provisionalMessage: 'Uzupełnij wyróżnione pola, aby wzmocnić kolejny raport i zmniejszyć ryzyko prowizorycznej oceny.',
      findings: 'Ustalenia',
      readinessActions: 'Działania przygotowawcze',
      decisionConfidence: 'Pewność decyzji:',
      nextDecisionAction: 'Następne działanie decyzyjne:',
      signalsUsed: 'Wykorzystane sygnały:',
      manualReview: 'Przegląd ręczny:',
      required: 'Wymagany',
      notRequired: 'Niewymagany',
      geolocationReady: 'Geolokalizacja gotowa:',
      dueDiligenceReady: 'Due diligence gotowe:',
      cbamDeclarant: 'Zgłaszający CBAM:',
      supplierEmissions: 'Emisje dostawcy:',
      cnCodeDisplay: 'Kod CN / HS:',
      keyObligationGap: 'Zidentyfikowana luka:',
      document: 'Dokument:',
      portal: 'Portal:',
      deadline: 'Termin:',
      estimatedCost: 'Szacowany koszt:',
      estimatedHours: 'Szacowane godziny:',
      financialRisk: 'Ryzyko finansowe',
      minimumFine: 'Minimalna kara',
      maximumFine: 'Maksymalna kara',
      cost: 'Koszt:',
      ifIgnored: 'Jeśli zignorowane:',
      complianceDeadline: 'Termin zgodności:',
      reportPrefix: 'OrcaTrade-Compliance-',
    },
    loadingSteps: [
      'Sprawdzanie wymogów śledzenia EUDR…',
      'Weryfikacja zakresu sektorowego CBAM…',
      'Analiza progów CSDDD…',
      'Krzyżowe sprawdzanie bazy regulacyjnej…',
      'Obliczanie ekspozycji finansowej…',
      'Generowanie raportu zgodności…',
    ],
  },
};
const t = TEXT[LANG] || TEXT.en;
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

function buildReportCacheKey(orderData) {
  return {
    company: orderData.company || '',
    email: orderData.email || '',
    productCategory: orderData.productCategory || '',
    productDescription: orderData.productDescription || '',
    origin: orderData.origin || '',
    supplierName: orderData.supplierName || '',
    importValue: orderData.importValue || '',
    companySize: orderData.companySize || '',
    employeeCount: orderData.employeeCount || '',
    globalTurnover: orderData.globalTurnover || orderData.companyTurnover || orderData.turnover || '',
    cnCode: orderData.cnCode || orderData.hsCode || '',
    geolocationAvailable: orderData.geolocationAvailable ?? '',
    dueDiligenceStatement: orderData.dueDiligenceStatement ?? '',
    supplierEmissionsData: orderData.supplierEmissionsData ?? '',
    authorisedDeclarant: orderData.authorisedDeclarant ?? '',
    euMarket: orderData.euMarket !== false,
  };
}

function readWorkflowState(key) {
  const cache = window.OrcaTradeCachePreference;
  if (cache) return cache.readWorkflowState(key);
  return window.localStorage.getItem(key);
}

function writeWorkflowState(key, value) {
  const cache = window.OrcaTradeCachePreference;
  if (cache) {
    cache.writeWorkflowState(key, value);
    return;
  }
  window.localStorage.setItem(key, value);
}

function buildRecoveryState(readiness, report) {
  const missingFacts = [];

  (Array.isArray(readiness?.missingCriticalFacts) ? readiness.missingCriticalFacts : []).forEach(item => {
    (Array.isArray(item.missingFacts) ? item.missingFacts : []).forEach(fact => missingFacts.push(fact));
  });

  (Array.isArray(report?.requiredEvidenceChecklist) ? report.requiredEvidenceChecklist : []).forEach(item => {
    (Array.isArray(item.missingCriticalFacts) ? item.missingCriticalFacts : []).forEach(fact => missingFacts.push(fact));
  });

  const fieldIds = [];
  const fieldLabels = [];

  missingFacts.forEach(fact => {
      FACT_TO_FIELD_MAP.forEach(mapping => {
        if (mapping.pattern.test(String(fact || '')) && !fieldIds.includes(mapping.fieldId)) {
          fieldIds.push(mapping.fieldId);
          fieldLabels.push(t.labels[mapping.fieldId] || mapping.fieldId);
        }
      });
  });

  if (!fieldIds.length) return null;

  return {
    fieldIds,
    fieldLabels,
  };
}

document.addEventListener('DOMContentLoaded', async () => {
  const loadingState   = document.getElementById('loadingState');
  const resultsContainer = document.getElementById('resultsContainer');
  const loadingText    = document.getElementById('loadingText');
  const cache = window.OrcaTradeCachePreference;

  const orderDataStr = readWorkflowState(ORDER_KEY);
  if (!orderDataStr) {
    window.location.href = 'index.html';
    return;
  }

  const orderData = JSON.parse(orderDataStr);
  const reportCacheKey = buildReportCacheKey(orderData);

  if (cache) {
    const cachedPayload = cache.getCachedJson('compliance-report', reportCacheKey);
    if (cachedPayload) {
      renderResults(cachedPayload, orderData);
      loadingState.style.display = 'none';
      resultsContainer.style.display = 'block';

      const dlBtn = document.getElementById('downloadBtn');
      if (dlBtn) {
        dlBtn.addEventListener('click', () => {
          const originalTitle = document.title;
          const rid = cachedPayload.reportId || 'report';
          document.title = t.labels.reportPrefix + rid;
          window.print();
          setTimeout(() => { document.title = originalTitle; }, 1000);
        });
      }

      return;
    }
  }

  // Loading animation
  const steps = t.loadingSteps;
  let stepIndex = 0;
  const interval = setInterval(() => {
    if (stepIndex < steps.length) loadingText.textContent = steps[stepIndex++];
  }, 1200);

  let payload = null;

  try {
    const res = await fetch('/api/check', {
      method: 'POST',
      headers: Object.assign(
        { 'Content-Type': 'application/json' },
        cache ? cache.getRequestHeaders() : {}
      ),
      body: orderDataStr,
    });

    if (res.ok) {
      payload = await res.json();
      if (cache) {
        cache.setCachedJson('compliance-report', reportCacheKey, payload, 10 * 60 * 1000);
      }
    } else {
      const err = await res.json().catch(() => ({}));
      console.error('API error:', err);
      showError(err.error || 'The compliance engine returned an error. Please try again.', err.details);
      clearInterval(interval);
      return;
    }
  } catch (err) {
    console.error('Fetch error:', err);
    showError('Could not reach the compliance engine. Check your connection and try again.');
    clearInterval(interval);
    return;
  }

  clearInterval(interval);
  renderResults(payload, orderData);
  loadingState.style.display = 'none';
  resultsContainer.style.display = 'block';

  // PDF download
  const dlBtn = document.getElementById('downloadBtn');
  if (dlBtn) {
    dlBtn.addEventListener('click', () => {
      const originalTitle = document.title;
      const rid = payload.reportId || 'report';
      document.title = t.labels.reportPrefix + rid;
      window.print();
      setTimeout(() => { document.title = originalTitle; }, 1000);
    });
  }
});

function showError(message, details) {
  const list = Array.isArray(details) && details.length
    ? `<div style="margin:1rem auto 2rem;max-width:42ch;text-align:left;padding:1rem;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);">
         <div style="font-size:0.72rem;letter-spacing:0.14em;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.55rem;">${t.labels.whatIsMissing}</div>
         ${details.map(item => `<div style="margin-bottom:0.35rem;color:var(--text-muted);">• ${esc(item)}</div>`).join('')}
       </div>`
    : '';

  const loadingState = document.getElementById('loadingState');
  loadingState.innerHTML = `
      <div style="text-align:center; padding:3rem;">
      <div style="font-size:2rem; margin-bottom:1rem;">⚠</div>
      <h2 style="color:var(--accent-color); margin-bottom:0.75rem;">${t.labels.reportFailed}</h2>
      <p style="color:var(--text-muted); max-width:40ch; margin:0 auto 2rem;">${message}</p>
      ${list}
      <a href="index.html" class="btn btn-outline" style="border-radius:0;border:1px solid var(--accent-color);color:var(--accent-color);padding:0.6rem 1.4rem;">${t.labels.tryAgain}</a>
    </div>`;
}

function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function fmtEur(n) {
  if (!n && n !== 0) return '—';
  return '€' + Number(n).toLocaleString(LOCALE);
}

function severityBadge(s) {
  const map = { critical:'#c94a4a', major:'#c9893a', minor:'#6f7783' };
  const col = map[s] || '#6f7783';
  return `<span style="font-size:0.68rem;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;padding:0.2rem 0.55rem;border:1px solid ${col};color:${col};">${esc(s)}</span>`;
}

function urgencyBadge(u) {
  const col = u && u.toLowerCase().includes('immediate') ? '#c94a4a'
            : u && u.toLowerCase().includes('30')        ? '#c9893a'
            : '#6f7783';
  return `<span style="font-size:0.68rem;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;padding:0.2rem 0.55rem;border:1px solid ${col};color:${col};">${esc(u)}</span>`;
}

function triStateLabel(value) {
  if (value === true || value === 'true') return t.labels.yes;
  if (value === false || value === 'false') return t.labels.no;
  return t.labels.unknown;
}

function statusPill(status) {
  const map = {
    compliant:      { label:t.labels.compliant,      bg:'rgba(80,180,100,0.12)', border:'rgba(80,180,100,0.4)', color:'#5cb884' },
    at_risk:        { label:t.labels.atRisk,         bg:'rgba(200,140,50,0.12)', border:'rgba(200,140,50,0.4)', color:'#c98f3a' },
    non_compliant:  { label:t.labels.nonCompliant,   bg:'rgba(200,70,70,0.12)',  border:'rgba(200,70,70,0.4)',  color:'#c95050' },
    not_applicable: { label:t.labels.notApplicable,  bg:'rgba(100,100,120,0.1)', border:'rgba(100,100,120,0.3)', color:'#6f7783' },
  };
  const s = map[status] || map.not_applicable;
  return `<span style="font-size:0.72rem;font-weight:700;letter-spacing:0.12em;padding:0.3rem 0.8rem;border:1px solid ${s.border};background:${s.bg};color:${s.color};">${s.label}</span>`;
}

function applicabilityPill(status) {
  const map = {
    applicable:      { label: t.labels.activeNow, bg: 'rgba(80,180,100,0.12)', border: 'rgba(80,180,100,0.4)', color: '#5cb884' },
    future_scope:    { label: t.labels.futureScope, bg: 'rgba(80,120,180,0.12)', border: 'rgba(80,120,180,0.35)', color: '#7ea5d8' },
    insufficient_data: { label: t.labels.missingFacts, bg: 'rgba(200,140,50,0.12)', border: 'rgba(200,140,50,0.35)', color: '#c98f3a' },
    not_applicable:  { label: t.labels.outOfScope, bg: 'rgba(100,100,120,0.1)', border: 'rgba(100,100,120,0.3)', color: '#6f7783' },
  };
  const s = map[status] || map.not_applicable;
  return `<span style="font-size:0.66rem;font-weight:700;letter-spacing:0.11em;padding:0.25rem 0.65rem;border:1px solid ${s.border};background:${s.bg};color:${s.color};">${s.label}</span>`;
}

function readinessPill(level) {
  const map = {
    evidence_backed: { label: t.labels.evidenceBacked, bg: 'rgba(80,180,100,0.12)', border: 'rgba(80,180,100,0.4)', color: '#5cb884' },
    provisional: { label: t.labels.provisional, bg: 'rgba(200,140,50,0.12)', border: 'rgba(200,140,50,0.4)', color: '#c98f3a' },
    blocked: { label: t.labels.blocked, bg: 'rgba(200,70,70,0.12)', border: 'rgba(200,70,70,0.4)', color: '#c95050' },
    screening_only: { label: t.labels.screeningOnly, bg: 'rgba(100,100,120,0.1)', border: 'rgba(100,100,120,0.3)', color: '#6f7783' },
  };
  const value = map[level] || map.screening_only;
  return `<span style="font-size:0.72rem;font-weight:700;letter-spacing:0.12em;padding:0.35rem 0.85rem;border:1px solid ${value.border};background:${value.bg};color:${value.color};">${value.label}</span>`;
}

const REG_FULL_NAMES = {
  EUDR:  'EU Deforestation Regulation (EU) 2023/1115',
  CBAM:  'Carbon Border Adjustment Mechanism (EU) 2023/956',
  CSDDD: 'Corporate Sustainability Due Diligence Directive (EU) 2024/1760',
};

function renderResults(res, orderData) {
  // Report ID
  const reportId = res.reportId || '—';
  const timestamp = res.timestamp ? new Date(res.timestamp).toLocaleString(LOCALE, { dateStyle:'long', timeStyle:'short' }) : new Date().toLocaleString(LOCALE);

  const el = id => document.getElementById(id);

  el('reportId').textContent      = reportId;
  el('reportTimestamp').textContent = timestamp;
  el('reportProduct').textContent   = `${orderData.productCategory || t.labels.product} — ${orderData.productDescription || ''}`;
  el('reportOrigin').textContent    = orderData.origin    || '—';
  el('reportSupplier').textContent  = orderData.supplierName || t.labels.notProvided;
  el('reportImportValue').textContent = orderData.importValue || '—';
  el('reportCompanySize').textContent = orderData.companySize || '—';
  el('reportCnCode').textContent = orderData.cnCode || orderData.hsCode || t.labels.notProvided;
  el('reportEmployeeCount').textContent = orderData.employeeCount || t.labels.notProvided;
  el('reportGlobalTurnover').textContent = orderData.globalTurnover || orderData.companyTurnover || orderData.turnover || t.labels.notProvided;

  // Overall status badge
  const badge = el('overallStatusBadge');
  badge.className = `status-large ${res.overallStatus}`;
  badge.textContent = res.overallStatus === 'compliant' ? t.labels.compliant
                    : res.overallStatus === 'at_risk'   ? t.labels.atRisk
                    : t.labels.nonCompliant;

  el('overallScoreText').textContent = res.overallScore ?? '—';

  // Executive summary
  if (res.executiveSummary) {
    el('executiveSummary').textContent = res.executiveSummary;
    el('execSummaryBox').style.display = 'block';
  }

  const readiness = res.decisionReadiness || null;
  if (readiness) {
    el('decisionReadinessCard').style.display = 'block';
    el('decisionReadinessBadge').innerHTML = readinessPill(readiness.level);
    el('decisionReadinessSummary').textContent = readiness.summary || t.labels.noReadinessSummary;
    el('decisionEligibilityText').textContent = readiness.finalDecisionEligible === false
      ? t.labels.finalDecisionBlocked
      : readiness.screeningOnly
        ? t.labels.screeningResult
        : t.labels.backendCanIssue;
    el('decisionEvidenceMode').textContent = res.reportGeneration?.mode === 'deterministic_fallback'
      ? t.labels.ruleOnly
      : readiness.level === 'evidence_backed'
        ? t.labels.structuredEvidence
        : readiness.level === 'screening_only'
          ? t.labels.initialScreening
          : t.labels.structuredDecision;

    const factsBox = el('decisionFactsBox');
    const factsList = el('decisionFactsList');
    const missingFacts = Array.isArray(readiness.missingCriticalFacts) ? readiness.missingCriticalFacts : [];
    if (missingFacts.length) {
      factsBox.style.display = 'block';
      factsList.innerHTML = missingFacts.map(item => {
        const facts = Array.isArray(item.missingFacts) ? item.missingFacts.map(esc).join(', ') : t.labels.requiredFactsNotProvided;
        return `<div style="margin-bottom:0.4rem;"><strong style="color:var(--text-primary);">${esc(item.regulation)}:</strong> ${facts}</div>`;
      }).join('');
    } else {
      factsBox.style.display = 'none';
      factsList.innerHTML = '';
    }

    const checklist = Array.isArray(res.requiredEvidenceChecklist) ? res.requiredEvidenceChecklist : [];
    el('decisionChecklist').innerHTML = checklist.map(item => {
      const state = item.applicabilityStatus === 'not_applicable'
        ? t.labels.stateOutOfScope
        : item.applicabilityStatus === 'future_scope'
          ? t.labels.stateFuture
          : item.finalDecisionEligible
            ? t.labels.stateEligible
            : t.labels.stateMissing;

      const copy = item.missingCriticalFacts && item.missingCriticalFacts.length
        ? `${t.labels.missingFacts}: ${item.missingCriticalFacts.map(esc).join(', ')}.`
        : item.nextDecisionAction
          ? esc(item.nextDecisionAction)
          : t.labels.noAdditionalEvidence;

      return `
        <div class="decision-check-item">
          <div class="decision-check-title">
            <span>${esc(item.regulation)}</span>
            ${applicabilityPill(item.applicabilityStatus)}
          </div>
          <div style="font-size:0.78rem;color:var(--text-primary);margin-bottom:0.35rem;">${esc(state)}</div>
          <div class="decision-check-copy">${copy}</div>
        </div>`;
    }).join('');

    const recoveryActions = el('decisionRecoveryActions');
    const recoveryState = buildRecoveryState(readiness, res);
    if (recoveryActions) {
      if ((readiness.level === 'blocked' || readiness.level === 'provisional') && recoveryState) {
        recoveryActions.style.display = 'block';
        recoveryActions.innerHTML = `
          <div style="font-size:0.8rem;color:var(--text-muted);margin-bottom:0.8rem;">
            ${readiness.level === 'blocked'
              ? t.labels.blockedHelp
              : t.labels.provisionalHelp}
          </div>
          <button type="button" id="completeMissingFactsBtn" class="btn btn-outline" style="border-radius:0;padding:0.75rem 1.2rem;border:1px solid var(--accent-color);color:var(--accent-color);">
            ${t.labels.completeFacts}
          </button>
        `;

        const button = document.getElementById('completeMissingFactsBtn');
        if (button) {
          button.addEventListener('click', () => {
            writeWorkflowState(ORDER_KEY, JSON.stringify(orderData));
            writeWorkflowState(RECOVERY_KEY, JSON.stringify({
              ...recoveryState,
              message: readiness.level === 'blocked'
                ? t.labels.blockedMessage
                : t.labels.provisionalMessage,
            }));
            window.location.href = 'index.html#complianceForm';
          });
        }
      } else {
        recoveryActions.style.display = 'none';
        recoveryActions.innerHTML = '';
      }
    }
  }

  // Regulation cards
  const container = el('regulationsContainer');
  let html = '';

  (res.checkedRegulations || []).forEach(reg => {
    const fullName = REG_FULL_NAMES[reg.regulation] || reg.regulation;
    const hasFindings = reg.findings && reg.findings.length > 0;
    const hasActions  = reg.requiredActions && reg.requiredActions.length > 0;
    const fr = reg.financialRisk || {};

    html += `
    <div class="reg-card glass-panel">
      <div class="reg-card-header">
        <div>
          <div style="font-size:0.68rem;font-weight:700;text-transform:uppercase;letter-spacing:0.16em;color:var(--text-muted);margin-bottom:0.35rem;">${esc(reg.regulation)}</div>
          <h3 class="reg-title" style="font-size:1rem;margin-bottom:0.5rem;">${esc(fullName)}</h3>
          <div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;margin-bottom:0.5rem;">
            ${applicabilityPill(reg.applicabilityStatus)}
            ${reg.futureApplicabilityDate ? `<span style="font-size:0.72rem;color:var(--text-muted);">Relevant date: ${esc(reg.futureApplicabilityDate)}</span>` : ''}
          </div>
          <div style="font-size:0.78rem;color:var(--text-muted);">${esc(reg.applicabilityReason)}</div>
        </div>
        <div>${statusPill(reg.status)}</div>
      </div>

      ${(reg.missingFacts && reg.missingFacts.length > 0) ? `
      <div style="font-size:0.8rem;background:rgba(200,140,50,0.07);border:1px solid rgba(200,140,50,0.2);padding:0.8rem 1rem;margin:1rem 0;">
        <strong style="color:#c98f3a;">${t.labels.missingFacts}:</strong> ${reg.missingFacts.map(esc).join(', ')}
      </div>` : ''}

      ${(reg.readinessActions && reg.readinessActions.length > 0) ? `
      <div style="margin-bottom:1rem;">
        <div style="font-size:0.72rem;font-weight:700;text-transform:uppercase;letter-spacing:0.14em;color:#7ea5d8;margin-bottom:0.55rem;">${t.labels.readinessActions}</div>
        <div style="font-size:0.82rem;color:var(--text-muted);line-height:1.65;">
          ${reg.readinessActions.map(action => `<div style="margin-bottom:0.35rem;">• ${esc(action)}</div>`).join('')}
        </div>
      </div>` : ''}

        ${(reg.confidence || reg.nextDecisionAction || (reg.evidenceSignals && reg.evidenceSignals.length > 0)) ? `
      <div style="font-size:0.78rem;color:var(--text-muted);border-top:1px solid var(--border-color);padding-top:0.8rem;margin-bottom:1rem;">
        ${reg.confidence ? `<div style="margin-bottom:0.35rem;"><strong style="color:var(--text-primary);">${t.labels.decisionConfidence}</strong> ${esc(reg.confidence)}</div>` : ''}
        ${reg.nextDecisionAction ? `<div style="margin-bottom:0.35rem;"><strong style="color:var(--text-primary);">${t.labels.nextDecisionAction}</strong> ${esc(reg.nextDecisionAction)}</div>` : ''}
        ${(reg.evidenceSignals && reg.evidenceSignals.length > 0) ? `<div><strong style="color:var(--text-primary);">${t.labels.signalsUsed}</strong> ${reg.evidenceSignals.map(esc).join(' · ')}</div>` : ''}
      </div>` : ''}

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:0.45rem 0.8rem;font-size:0.76rem;color:var(--text-muted);margin-bottom:1rem;">
        <div><strong style="color:var(--text-primary);">${t.labels.manualReview}</strong> ${reg.requiresManualReview ? t.labels.required : t.labels.notRequired}</div>
        <div><strong style="color:var(--text-primary);">${t.labels.geolocationReady}</strong> ${reg.regulation === 'EUDR' ? triStateLabel(orderData.geolocationAvailable) : 'N/A'}</div>
        <div><strong style="color:var(--text-primary);">${t.labels.dueDiligenceReady}</strong> ${reg.regulation === 'EUDR' ? triStateLabel(orderData.dueDiligenceStatement) : 'N/A'}</div>
        <div><strong style="color:var(--text-primary);">${t.labels.cbamDeclarant}</strong> ${reg.regulation === 'CBAM' ? triStateLabel(orderData.authorisedDeclarant) : 'N/A'}</div>
        <div><strong style="color:var(--text-primary);">${t.labels.supplierEmissions}</strong> ${reg.regulation === 'CBAM' ? triStateLabel(orderData.supplierEmissionsData) : 'N/A'}</div>
        <div><strong style="color:var(--text-primary);">${t.labels.cnCodeDisplay}</strong> ${esc(orderData.cnCode || orderData.hsCode || t.labels.notProvided)}</div>
      </div>

      ${reg.keyObligation ? `<div style="font-style:italic;font-size:0.88rem;color:var(--text-muted);border-left:2px solid var(--accent-color);padding-left:0.9rem;margin:1rem 0;">${esc(reg.keyObligation)}</div>` : ''}
      ${reg.currentGap && reg.currentGap !== 'N/A' ? `<div style="font-size:0.85rem;background:rgba(200,70,70,0.07);border:1px solid rgba(200,70,70,0.2);padding:0.8rem 1rem;margin-bottom:1rem;"><strong style="color:#c95050;">${t.labels.keyObligationGap}</strong> ${esc(reg.currentGap)}</div>` : ''}

      ${hasFindings ? `
      <div style="margin-bottom:1.2rem;">
        <div style="font-size:0.72rem;font-weight:700;text-transform:uppercase;letter-spacing:0.14em;color:var(--text-muted);margin-bottom:0.75rem;">${t.labels.findings}</div>
        ${reg.findings.map(f => `
          <div class="finding-row" style="padding:0.85rem 0;border-bottom:1px solid var(--border-color);">
            <div style="display:flex;align-items:flex-start;gap:0.75rem;flex-wrap:wrap;margin-bottom:0.4rem;">
              ${severityBadge(f.severity)}
              <span style="font-size:0.8rem;color:var(--text-muted);font-style:italic;">${esc(f.article)}</span>
            </div>
            <div style="font-size:0.9rem;margin-bottom:0.3rem;">${esc(f.finding)}</div>
            <div style="font-size:0.8rem;color:var(--text-muted);">${esc(f.legalImplication)}</div>
          </div>`).join('')}
      </div>` : ''}

      ${hasActions ? `
      <div style="margin-bottom:1.2rem;">
        <div style="font-size:0.72rem;font-weight:700;text-transform:uppercase;letter-spacing:0.14em;color:var(--accent-color);margin-bottom:0.75rem;">${t.labels.readinessActions}</div>
        ${reg.requiredActions.map(a => `
          <div style="padding:0.9rem;background:rgba(184,190,200,0.04);border:1px solid var(--border-color);margin-bottom:0.6rem;">
            <div style="display:flex;align-items:center;gap:0.6rem;margin-bottom:0.5rem;">
              <span style="font-size:0.72rem;font-weight:700;color:var(--accent-color);min-width:1.6rem;">0${a.step}</span>
              <span style="font-size:0.9rem;font-weight:500;">${esc(a.action)}</span>
            </div>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:0.4rem 1.2rem;font-size:0.78rem;color:var(--text-muted);padding-left:2.2rem;">
              ${a.documentRequired ? `<div><strong style="color:var(--text-primary);">${t.labels.document}</strong> ${esc(a.documentRequired)}</div>` : ''}
              ${a.portal ? `<div><strong style="color:var(--text-primary);">${t.labels.portal}</strong> ${esc(a.portal)}</div>` : ''}
              ${a.deadline ? `<div><strong style="color:#c95050;">${t.labels.deadline}</strong> ${esc(a.deadline)}</div>` : ''}
              ${a.estimatedCostEur ? `<div><strong style="color:var(--text-primary);">${t.labels.estimatedCost}</strong> ${esc(a.estimatedCostEur)}</div>` : ''}
              ${a.estimatedHours ? `<div><strong style="color:var(--text-primary);">${t.labels.estimatedHours}</strong> ${esc(a.estimatedHours)}h</div>` : ''}
            </div>
          </div>`).join('')}
      </div>` : ''}

      <div class="financial-risk-box" style="background:rgba(0,0,0,0.25);border:1px solid var(--border-color);padding:1rem 1.2rem;margin-top:0.5rem;">
        <div style="font-size:0.72rem;font-weight:700;text-transform:uppercase;letter-spacing:0.14em;color:var(--text-muted);margin-bottom:0.75rem;">${t.labels.financialRisk} — ${esc(reg.legalBasis ? `per ${reg.legalBasis.split(' of the ')[0]}` : reg.regulation)}</div>
        <div style="display:flex;gap:2rem;flex-wrap:wrap;margin-bottom:0.75rem;">
          <div><div style="font-size:0.7rem;color:var(--text-muted);">${t.labels.minimumFine}</div><div style="font-size:1.1rem;font-weight:600;color:${fr.minimumFineEur > 0 ? '#c95050' : 'var(--text-muted)'};">${fmtEur(fr.minimumFineEur)}</div></div>
          <div><div style="font-size:0.7rem;color:var(--text-muted);">${t.labels.maximumFine}</div><div style="font-size:1.1rem;font-weight:600;color:${fr.maximumFineEur > 0 ? '#c95050' : 'var(--text-muted)'};">${fmtEur(fr.maximumFineEur)}</div></div>
        </div>
        ${fr.calculationExplained ? `<div style="font-size:0.8rem;color:var(--text-muted);font-style:italic;margin-bottom:0.5rem;">${esc(fr.calculationExplained)}</div>` : ''}
        ${fr.additionalRisks && fr.additionalRisks.length > 0 ? `<div style="font-size:0.78rem;color:var(--text-muted);">${fr.additionalRisks.map(r => `<span style="display:inline-block;margin-right:0.75rem;">• ${esc(r)}</span>`).join('')}</div>` : ''}
      </div>

      ${reg.complianceDeadline ? `<div style="font-size:0.78rem;color:var(--text-muted);margin-top:0.75rem;"><strong>${t.labels.complianceDeadline}</strong> ${esc(reg.complianceDeadline)}</div>` : ''}
    </div>`;
  });

  container.innerHTML = html;

  // Priority actions
  const prioList = el('priorityList');
  if (res.priorityActions && res.priorityActions.length > 0) {
    prioList.innerHTML = res.priorityActions.map(a => `
      <div class="prio-action" style="margin-bottom:1rem;padding:1rem;background:rgba(184,190,200,0.04);border:1px solid var(--border-color);">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:0.5rem;margin-bottom:0.5rem;">
          <div style="display:flex;align-items:center;gap:0.75rem;">
            <div class="prio-num" style="min-width:1.8rem;height:1.8rem;display:flex;align-items:center;justify-content:center;border:1px solid var(--accent-color);font-size:0.8rem;font-weight:700;color:var(--accent-color);">${a.rank}</div>
            <span style="font-weight:500;">${esc(a.action)}</span>
          </div>
          ${urgencyBadge(a.urgency)}
        </div>
        <div style="display:flex;gap:1.5rem;flex-wrap:wrap;font-size:0.78rem;color:var(--text-muted);padding-left:2.55rem;">
          ${a.estimatedCostEur ? `<span><strong style="color:var(--text-primary);">${t.labels.cost}</strong> ${esc(a.estimatedCostEur)}</span>` : ''}
          ${a.consequenceIfIgnored ? `<span><strong style="color:#c95050;">${t.labels.ifIgnored}</strong> ${esc(a.consequenceIfIgnored)}</span>` : ''}
        </div>
      </div>`).join('');
  } else {
    el('priorityCard').style.display = 'none';
  }

  // Total financial exposure
  const exp = res.totalFinancialExposure;
  if (exp && (exp.minimumEur || exp.maximumEur)) {
    el('exposureCard').style.display = 'block';
    el('exposureMin').textContent = fmtEur(exp.minimumEur);
    el('exposureMax').textContent = fmtEur(exp.maximumEur);
    if (exp.calculationBreakdown) el('exposureBreakdown').textContent = exp.calculationBreakdown;
  }

  // Disclaimer
  if (res.disclaimer) {
    el('disclaimer').textContent = res.disclaimer;
    el('disclaimerBox').style.display = 'block';
  }

  // Footer report ID
  const footerRid = el('footerReportId');
  if (footerRid) footerRid.textContent = reportId;
}
