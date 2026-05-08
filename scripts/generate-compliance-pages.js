// Generate one SEO guide page per EU compliance regime, in three locales.
//
// Reads lib/intelligence/data/eu-compliance.js (Sprint C database) and produces
// /guides/compliance/<regime-slug>/ for each of: CBAM, EUDR, REACH,
// CE_MACHINERY, CE_LVD_EMC_RED, ROHS, WEEE, BATTERY, TOY_SAFETY,
// COSMETICS, GPSR, PPWR, FOOTWEAR_LABELLING (13 regimes).
//
// Each page targets long-tail compliance queries: "CBAM aluminum importer
// requirements", "EUDR cocoa due diligence statement", "RoHS electronics
// declaration of conformity", "EU battery passport 2027".
//
// Output: 13 detail pages × 3 locales + 1 index per locale = 42 pages.

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SITE_URL = 'https://orcatrade.pl';
const TODAY = new Date().toISOString().slice(0, 10);

const compliance = require('../lib/intelligence/data/eu-compliance');
const customs = require('../lib/intelligence/customs-quote');
const { encodeInputs } = require('../lib/utils/plan-codec');

// ── Helpers ────────────────────────────────────────────

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtEur(amount) {
  return '€' + Math.round(amount).toLocaleString('en-IE');
}

function regimeSlug(id) {
  return id.toLowerCase().replace(/_/g, '-');
}

// Sample import that triggers each regime — used for the worked example.
// Picks an HS prefix that the regime's first trigger matches.
function sampleImportForRegime(regime) {
  if (regime.triggerType === 'universal') {
    return { hsCode: '6203.42', origin: 'CN', category: 'apparel' };
  }
  if (regime.triggerType === 'category') {
    const cat = regime.triggers[0].category;
    const HS = { apparel: '6203.42', electronics: '8517.62', furniture: '9403.30', toys: '9503.00', cosmetics: '3304.99', homeware: '6911.10', footwear: '6403.99' };
    return { hsCode: HS[cat] || '6203.42', origin: 'CN', category: cat };
  }
  // hsPrefix or hsChapter
  const firstTrigger = regime.triggers[0];
  const prefix = String(firstTrigger.hsPrefix).replace(/[^0-9]/g, '');
  const hsCode = prefix.padEnd(6, '0').slice(0, 8);
  // Map prefix to a plausible category for share-link routing
  const chapter = prefix.slice(0, 2);
  const category = ({ '72': 'machinery', '73': 'machinery', '76': 'machinery', '85': 'electronics', '84': 'machinery', '90': 'electronics', '95': 'toys', '33': 'cosmetics', '64': 'footwear', '4011': 'machinery', '8506': 'electronics', '8507': 'electronics' })[chapter] || 'machinery';
  return { hsCode, origin: 'CN', category };
}

function wizardShareUrl(regime, locale) {
  const sample = sampleImportForRegime(regime);
  const inputs = {
    productCategory: sample.category,
    originCountry: sample.origin,
    destinationCountry: locale === 'de' ? 'DE' : 'PL',
    customsValueEur: 50000,
    weightKg: 1500,
    hsCode: sample.hsCode,
  };
  const encoded = encodeInputs(inputs);
  const wizardPath = locale === 'en' ? '/start/' : `/${locale}/start/`;
  return `${wizardPath}?p=${encoded}`;
}

// Collect HS coverage display from the regime's triggers
function coverageList(regime) {
  if (regime.triggerType === 'universal') return ['All consumer goods entering the EU market'];
  if (regime.triggerType === 'category') return regime.triggers.map(t => t.label);
  return regime.triggers.slice(0, 8).map(t => `${t.hsPrefix} — ${t.label}`);
}

// ── i18n ───────────────────────────────────────────────

const STRINGS = {
  en: {
    metaSiteSuffix: '| OrcaTrade',
    breadcrumbHome: 'Home',
    breadcrumbGuides: 'Guides',
    breadcrumbCompliance: 'EU compliance',
    headerKicker: 'EU Regulatory Regime',
    title: (r) => `${r.name} — importer obligations + worked example`,
    metaDesc: (r) => `${r.name}. ${r.status}. Importer must do: ${r.importerObligation.slice(0, 140)}... Worked example with HS coverage and deep-link into OrcaTrade plan builder.`,
    sectionHowItApplies: 'How it applies',
    sectionStatus: 'Status',
    sectionStatusBody: (r) => `Status: <strong>${r.status}</strong>.${r.keyDates ? ' Key dates: ' + r.keyDates : ''}`,
    sectionObligation: 'What you must do as the importer',
    sectionCoverage: 'What goods are covered',
    sectionExample: 'Worked example: a typical shipment that triggers',
    sectionExampleBody: (r, sample) => `A €50,000 shipment of ${sample.category} (HS <code>${sample.hsCode}</code>) from ${sample.origin} into the EU triggers <strong>${r.name}</strong>. The customs duty + VAT are calculated as normal — but on top of that, the importer must satisfy the obligations above before the goods can be placed on the EU market.`,
    sectionWarning: 'Non-compliance is not a duty event — it is a market-access event',
    sectionWarningBody: 'A common misunderstanding: importers focus on duty + VAT and treat compliance as a tickbox. EU customs increasingly hold goods at the border for missing documentation (DDS for EUDR, CBAM declarant status for steel/aluminium, EU Responsible Person for cosmetics). Holds become storage charges; storage charges become forced re-export. Validate before booking the freight.',
    sectionRelated: 'Related OrcaTrade resources',
    sectionRelatedBody: (r) => `For deeper guidance: <a href="${r.deeperGuide}">read our long-form ${r.name} guide</a>. The Import Plan Builder surfaces this regime automatically when your HS code matches; the wizard CTA below tells you what shipping practice to follow.`,
    ctaTitle: 'See whether this regime applies to your specific shipment',
    ctaBody: 'Six questions, all four calculators (sourcing, routing, customs, warehouse), full landed cost — with this regime flagged on your specific HS code if applicable.',
    ctaButton: 'Build my plan with this regime checked →',
    indexTitle: 'EU compliance regimes — importer obligation database',
    indexDescription: 'Active EU regulatory regimes (CBAM, EUDR, REACH, CE marking, RoHS, WEEE, Battery, Toy Safety, Cosmetics, GPSR, PPWR, Footwear). Each entry: importer obligations, status, HS coverage, worked example.',
    indexHeadline: 'EU compliance regimes for importers',
    indexBody: 'Below are the EU regulatory regimes most likely to bite SME importers. Each entry has its own deep page with importer obligations, key dates, HS coverage, and a worked example.',
    indexColRegime: 'Regime',
    indexColSeverity: 'Priority',
    indexColStatus: 'Status',
    severityHigh: 'High',
    severityMedium: 'Medium',
    severityLow: 'Standard',
    sourceFooter: () => `Snapshot reviewed ${TODAY}. Regulations evolve quickly; verify current status before commercial commitments.`,
  },
  pl: {
    metaSiteSuffix: '| OrcaTrade',
    breadcrumbHome: 'Strona główna',
    breadcrumbGuides: 'Poradniki',
    breadcrumbCompliance: 'Zgodność UE',
    headerKicker: 'Reżim regulacyjny UE',
    title: (r) => `${r.name} — obowiązki importera + przykład`,
    metaDesc: (r) => `${r.name}. ${r.status}. Importer musi: ${r.importerObligation.slice(0, 140)}... Przykład z zakresem HS i bezpośrednim linkiem do kreatora OrcaTrade.`,
    sectionHowItApplies: 'Jak ma zastosowanie',
    sectionStatus: 'Status',
    sectionStatusBody: (r) => `Status: <strong>${r.status}</strong>.${r.keyDates ? ' Kluczowe daty: ' + r.keyDates : ''}`,
    sectionObligation: 'Co musisz zrobić jako importer',
    sectionCoverage: 'Jakie towary są objęte',
    sectionExample: 'Przykład: typowa przesyłka, która uruchamia',
    sectionExampleBody: (r, sample) => `Przesyłka €50 000 ${sample.category} (HS <code>${sample.hsCode}</code>) z ${sample.origin} do UE uruchamia <strong>${r.name}</strong>. Cło i VAT są obliczane normalnie — ale dodatkowo importer musi spełnić powyższe obowiązki, zanim towar zostanie wprowadzony na rynek UE.`,
    sectionWarning: 'Brak zgodności to nie problem cła — to problem dostępu do rynku',
    sectionWarningBody: 'Częste nieporozumienie: importerzy koncentrują się na cle i VAT, a zgodność traktują jako formalność. Urząd celny UE coraz częściej zatrzymuje towary na granicy z powodu braku dokumentów (DDS dla EUDR, status zgłaszającego CBAM dla stali/aluminium, EU Responsible Person dla kosmetyków). Zatrzymanie staje się opłatą za przechowywanie; opłata za przechowywanie staje się przymusowym re-eksportem. Sprawdź przed rezerwacją frachtu.',
    sectionRelated: 'Powiązane zasoby OrcaTrade',
    sectionRelatedBody: (r) => `Pogłębione informacje: <a href="${r.deeperGuide}">przeczytaj nasz pełny poradnik ${r.name}</a>. Import Plan Builder automatycznie sygnalizuje ten reżim, gdy Twój kod HS pasuje; CTA kreatora poniżej powie Ci, jaką praktykę wysyłkową stosować.`,
    ctaTitle: 'Sprawdź, czy ten reżim ma zastosowanie do Twojej konkretnej przesyłki',
    ctaBody: 'Sześć pytań, cztery kalkulatory (sourcing, transport, odprawa, magazyn), pełny landed cost — z tym reżimem oznaczonym na Twoim konkretnym kodzie HS, jeśli ma zastosowanie.',
    ctaButton: 'Zbuduj mój plan z tym reżimem sprawdzonym →',
    indexTitle: 'Reżimy zgodności UE — baza obowiązków importera',
    indexDescription: 'Aktywne reżimy regulacyjne UE (CBAM, EUDR, REACH, oznakowanie CE, RoHS, WEEE, Baterie, Bezpieczeństwo zabawek, Kosmetyki, GPSR, PPWR, Obuwie). Każdy wpis: obowiązki importera, status, zakres HS, przykład.',
    indexHeadline: 'Reżimy zgodności UE dla importerów',
    indexBody: 'Poniżej znajdują się reżimy regulacyjne UE najczęściej dotykające importerów MŚP. Każdy wpis ma własną stronę z obowiązkami importera, kluczowymi datami, zakresem HS i przykładem.',
    indexColRegime: 'Reżim',
    indexColSeverity: 'Priorytet',
    indexColStatus: 'Status',
    severityHigh: 'Wysoki',
    severityMedium: 'Średni',
    severityLow: 'Standard',
    sourceFooter: () => `Snapshot przejrzany ${TODAY}. Regulacje ewoluują szybko; sprawdź bieżący status przed zobowiązaniami handlowymi.`,
  },
  de: {
    metaSiteSuffix: '| OrcaTrade',
    breadcrumbHome: 'Startseite',
    breadcrumbGuides: 'Leitfäden',
    breadcrumbCompliance: 'EU-Compliance',
    headerKicker: 'EU-Regulierungsregime',
    title: (r) => `${r.name} — Importeur-Pflichten + Berechnungsbeispiel`,
    metaDesc: (r) => `${r.name}. ${r.status}. Importeur muss: ${r.importerObligation.slice(0, 140)}... Beispiel mit HS-Abdeckung und Direktlink zum OrcaTrade Plan-Builder.`,
    sectionHowItApplies: 'Wie es angewendet wird',
    sectionStatus: 'Status',
    sectionStatusBody: (r) => `Status: <strong>${r.status}</strong>.${r.keyDates ? ' Wichtige Termine: ' + r.keyDates : ''}`,
    sectionObligation: 'Was Sie als Importeur tun müssen',
    sectionCoverage: 'Welche Waren sind betroffen',
    sectionExample: 'Berechnungsbeispiel: eine typische Sendung, die auslöst',
    sectionExampleBody: (r, sample) => `Eine Sendung von €50.000 ${sample.category} (HS <code>${sample.hsCode}</code>) aus ${sample.origin} in die EU löst <strong>${r.name}</strong> aus. Zoll und EUSt werden normal berechnet — zusätzlich muss der Importeur jedoch die oben genannten Pflichten erfüllen, bevor die Ware auf den EU-Markt gebracht werden kann.`,
    sectionWarning: 'Non-Compliance ist kein Zoll-Ereignis — es ist ein Marktzugangs-Ereignis',
    sectionWarningBody: 'Häufiges Missverständnis: Importeure konzentrieren sich auf Zoll und EUSt und behandeln Compliance als Formalität. Der EU-Zoll hält zunehmend Waren an der Grenze fest wegen fehlender Dokumente (DDS für EUDR, CBAM-Anmelder-Status für Stahl/Aluminium, EU-Verantwortliche Person für Kosmetik). Holds werden zu Lagerkosten; Lagerkosten zu erzwungenem Re-Export. Vor der Buchung der Fracht prüfen.',
    sectionRelated: 'Verwandte OrcaTrade-Ressourcen',
    sectionRelatedBody: (r) => `Für tiefere Anleitung: <a href="${r.deeperGuide}">unseren ausführlichen ${r.name} Leitfaden lesen</a>. Der Import Plan Builder zeigt dieses Regime automatisch an, wenn Ihr HS-Code passt; der Wizard-CTA unten sagt Ihnen, welche Versandpraxis Sie befolgen sollten.`,
    ctaTitle: 'Prüfen Sie, ob dieses Regime auf Ihre spezifische Sendung zutrifft',
    ctaBody: 'Sechs Fragen, vier Kalkulatoren (Sourcing, Transport, Zoll, Lager), vollständige Landed Costs — mit diesem Regime auf Ihrem spezifischen HS-Code markiert, falls zutreffend.',
    ctaButton: 'Plan mit diesem Regime prüfen →',
    indexTitle: 'EU-Compliance-Regime — Importeur-Pflichten-Datenbank',
    indexDescription: 'Aktive EU-Regulierungsregime (CBAM, EUDR, REACH, CE-Kennzeichnung, RoHS, WEEE, Batterie, Spielzeugsicherheit, Kosmetik, GPSR, PPWR, Schuhwaren). Jeder Eintrag: Importeur-Pflichten, Status, HS-Abdeckung, Beispiel.',
    indexHeadline: 'EU-Compliance-Regime für Importeure',
    indexBody: 'Unten finden Sie die EU-Regulierungsregime, die KMU-Importeure am häufigsten betreffen. Jeder Eintrag hat eine eigene tiefe Seite mit Importeur-Pflichten, wichtigen Terminen, HS-Abdeckung und Beispiel.',
    indexColRegime: 'Regime',
    indexColSeverity: 'Priorität',
    indexColStatus: 'Status',
    severityHigh: 'Hoch',
    severityMedium: 'Mittel',
    severityLow: 'Standard',
    sourceFooter: () => `Snapshot überprüft am ${TODAY}. Regulierungen entwickeln sich schnell; vor verbindlichen Bestellungen aktuellen Status prüfen.`,
  },
};

// ── Page shell ─────────────────────────────────────────

function pageShell({ locale, title, description, canonical, jsonLd, body, hreflangAlternates }) {
  const ogImage = `${SITE_URL}/orcatrade_logo.png`;
  const hreflangTags = (hreflangAlternates || []).map(a =>
    `<link rel="alternate" hreflang="${a.lang}" href="${a.href}" />`
  ).join('\n  ');
  return `<!DOCTYPE html>
<html lang="${locale}">
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(title)}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="description" content="${escapeHtml(description)}" />
  <link rel="canonical" href="${canonical}" />
  ${hreflangTags}
  <meta property="og:type" content="article" />
  <meta property="og:title" content="${escapeHtml(title)}" />
  <meta property="og:description" content="${escapeHtml(description)}" />
  <meta property="og:url" content="${canonical}" />
  <meta property="og:image" content="${ogImage}" />
  <link rel="preconnect" href="https://fonts.googleapis.com"/>
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garant:wght@400;500;600;700&family=Geist+Mono&display=swap" rel="stylesheet"/>
  <link href="https://cdn.jsdelivr.net/npm/geist@1.3.0/dist/fonts/geist-sans/style.css" rel="stylesheet"/>
  <link rel="stylesheet" href="/css/styles.css">
  <style>
    .guide-shell { max-width: 880px; margin: 0 auto; padding: 3rem 1.5rem 6rem; position: relative; z-index: 1; }
    .breadcrumbs { font-family: 'Geist Mono', monospace; font-size: 0.74rem; letter-spacing: 0.12em; text-transform: uppercase; color: rgba(255,255,255,0.5); margin-bottom: 1.4rem; }
    .breadcrumbs a { color: rgba(255,255,255,0.7); text-decoration: none; }
    .breadcrumbs a:hover { color: rgba(255,255,255,0.95); }
    .kicker { font-family: 'Geist Mono', monospace; font-size: 0.72rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.18em; color: rgba(140, 180, 220, 0.95); margin-bottom: 0.8rem; }
    h1 { font-family: 'Cormorant Garant', Georgia, serif; font-size: clamp(1.9rem, 3.5vw + 0.6rem, 2.8rem); font-weight: 600; line-height: 1.15; letter-spacing: -0.02em; color: rgba(255,255,255,0.97); margin-bottom: 1.4rem; }
    h2 { font-family: 'Cormorant Garant', Georgia, serif; font-size: 1.45rem; font-weight: 600; color: rgba(255,255,255,0.95); margin: 2.5rem 0 0.8rem; line-height: 1.25; }
    p { font-size: 0.98rem; line-height: 1.75; color: rgba(255,255,255,0.82); margin-bottom: 1.1em; max-width: 70ch; }
    ul { color: rgba(255,255,255,0.8); padding-left: 1.5rem; line-height: 1.75; margin-bottom: 1em; }
    code { font-family: 'Geist Mono', monospace; font-size: 0.88rem; background: rgba(184,190,200,0.08); padding: 0.1rem 0.45rem; color: rgba(220, 224, 232, 1); border-radius: 2px; }
    a { color: var(--accent-color, #b8bec8); }
    .obligation-callout { background: rgba(140, 180, 220, 0.05); border-left: 3px solid rgba(140, 180, 220, 0.85); padding: 1rem 1.3rem; margin: 1.5rem 0; }
    .obligation-callout p { margin: 0; }
    .warn-callout { background: rgba(201, 80, 80, 0.04); border-left: 3px solid rgba(232, 128, 128, 0.7); padding: 1rem 1.3rem; margin: 1.5rem 0; font-size: 0.94rem; }
    .related-callout { background: rgba(184, 190, 200, 0.04); border-left: 3px solid rgba(184, 190, 200, 0.6); padding: 1rem 1.3rem; margin: 1.5rem 0; font-size: 0.92rem; }
    .cta-block { margin: 2.5rem 0 1rem; padding: 1.6rem 1.8rem; background: linear-gradient(135deg, rgba(140, 180, 220, 0.08), rgba(184, 190, 200, 0.03)); border: 1px solid rgba(140, 180, 220, 0.3); text-align: center; }
    .cta-block h3 { font-family: 'Cormorant Garant', Georgia, serif; font-size: 1.3rem; font-weight: 600; color: rgba(255,255,255,0.97); margin: 0 0 0.5rem; }
    .cta-block p { font-size: 0.92rem; color: rgba(255,255,255,0.75); max-width: 56ch; margin: 0 auto 1rem; }
    .cta-block a.cta-btn { display: inline-block; padding: 0.85rem 1.5rem; background: var(--accent-color, #b8bec8); color: #0a0912; font-size: 0.78rem; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; text-decoration: none; }
    .cta-block a.cta-btn:hover { filter: brightness(1.08); }
    .as-of-footer { font-size: 0.78rem; color: rgba(255,255,255,0.45); margin-top: 3rem; padding-top: 1.4rem; border-top: 1px solid rgba(255,255,255,0.07); font-style: italic; }
    .regimes-table { width: 100%; border-collapse: collapse; font-size: 0.9rem; margin-top: 1.5rem; }
    .regimes-table thead th { font-family: 'Geist Mono', monospace; font-size: 0.66rem; letter-spacing: 0.14em; text-transform: uppercase; color: rgba(255,255,255,0.55); padding: 0.65rem 0.8rem; border-bottom: 1px solid rgba(255,255,255,0.12); text-align: left; font-weight: 500; }
    .regimes-table tbody td { padding: 0.65rem 0.8rem; border-bottom: 1px solid rgba(255,255,255,0.05); color: rgba(255,255,255,0.85); }
    .regimes-table tbody tr:hover { background: rgba(255,255,255,0.02); }
    .regimes-table a { color: rgba(220, 224, 232, 1); text-decoration: none; }
    .regimes-table a:hover { color: rgba(255,255,255,0.97); }
    .sev-badge { display: inline-block; font-family: 'Geist Mono', monospace; font-size: 0.66rem; letter-spacing: 0.14em; text-transform: uppercase; padding: 0.15rem 0.5rem; border-radius: 1px; }
    .sev-badge.sev-high { color: #e88080; background: rgba(201, 80, 80, 0.12); }
    .sev-badge.sev-medium { color: rgba(220, 188, 110, 1); background: rgba(200, 168, 90, 0.1); }
    .sev-badge.sev-low { color: rgba(184, 190, 200, 0.85); background: rgba(184, 190, 200, 0.06); }
    @media (max-width: 700px) { .regimes-table { font-size: 0.82rem; } .regimes-table thead { display: none; } .regimes-table tbody tr { display: block; padding: 0.8rem 0; border-bottom: 1px solid rgba(255,255,255,0.07); } .regimes-table tbody td { display: block; padding: 0.2rem 0; border: none; } }
  </style>
  <script type="application/ld+json">${jsonLd}</script>
</head>
<body>
  <div class="aurora" aria-hidden="true">
    <div class="aurora-blob b1"></div>
    <div class="aurora-blob b2"></div>
    <div class="aurora-blob b3"></div>
  </div>
  <div class="page">
    <header data-site-header></header>
    <main>
      <article class="guide-shell">
        ${body}
      </article>
    </main>
    <footer style="position: relative; z-index: 1;">
      <div class="footer-inner">
        <span>© <span id="year"></span> OrcaTrade Group.</span>
        <span><a href="/">Back to OrcaTrade Group</a></span>
      </div>
    </footer>
  </div>
  <script src="/js/cache-preferences.js"></script>
  <script src="/js/site-nav.js"></script>
  <script src="/js/main.js"></script>
  <script>document.getElementById('year').textContent = new Date().getFullYear();</script>
</body>
</html>`;
}

// ── Detail page ────────────────────────────────────────

function generateDetailPage(regime, locale) {
  const t = STRINGS[locale];
  const slug = regimeSlug(regime.id);
  const localePrefix = locale === 'en' ? '' : `/${locale}`;
  const canonical = `${SITE_URL}${localePrefix}/guides/compliance/${slug}/`;
  const title = `${t.title(regime)} ${t.metaSiteSuffix}`;
  const description = t.metaDesc(regime);

  const sample = sampleImportForRegime(regime);
  const ctaUrl = wizardShareUrl(regime, locale);
  const coverage = coverageList(regime);

  const breadcrumbs = `<div class="breadcrumbs">
    <a href="${localePrefix}/">${t.breadcrumbHome}</a> /
    <a href="${localePrefix}/guides/">${t.breadcrumbGuides}</a> /
    <a href="${localePrefix}/guides/compliance/">${t.breadcrumbCompliance}</a>
  </div>`;

  const coverageItemsHtml = coverage.map(c => `<li>${escapeHtml(c)}</li>`).join('\n');

  const body = `
    ${breadcrumbs}
    <p class="kicker">${t.headerKicker} · <span class="sev-badge sev-${regime.severity}">${t['severity' + regime.severity.charAt(0).toUpperCase() + regime.severity.slice(1)] || regime.severity}</span></p>
    <h1>${escapeHtml(t.title(regime))}</h1>

    <h2>${t.sectionStatus}</h2>
    <p>${t.sectionStatusBody(regime)}</p>

    <h2>${t.sectionObligation}</h2>
    <div class="obligation-callout"><p>${escapeHtml(regime.importerObligation)}</p></div>

    <h2>${t.sectionCoverage}</h2>
    <ul>
      ${coverageItemsHtml}
    </ul>

    <h2>${t.sectionExample}</h2>
    <p>${t.sectionExampleBody(regime, sample)}</p>

    <h2>${t.sectionWarning}</h2>
    <div class="warn-callout"><p>${t.sectionWarningBody}</p></div>

    <h2>${t.sectionRelated}</h2>
    <div class="related-callout"><p>${t.sectionRelatedBody(regime)}</p></div>

    <div class="cta-block">
      <h3>${t.ctaTitle}</h3>
      <p>${t.ctaBody}</p>
      <a class="cta-btn" href="${ctaUrl}">${t.ctaButton}</a>
    </div>

    <p class="as-of-footer">${t.sourceFooter()}</p>
  `;

  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Article',
        headline: t.title(regime),
        description,
        about: { '@type': 'Legislation', name: regime.name, jurisdiction: 'European Union' },
        author: { '@type': 'Organization', name: 'OrcaTrade Group' },
        datePublished: TODAY,
        dateModified: TODAY,
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: t.breadcrumbHome, item: `${SITE_URL}${localePrefix}/` },
          { '@type': 'ListItem', position: 2, name: t.breadcrumbGuides, item: `${SITE_URL}${localePrefix}/guides/` },
          { '@type': 'ListItem', position: 3, name: t.breadcrumbCompliance, item: `${SITE_URL}${localePrefix}/guides/compliance/` },
          { '@type': 'ListItem', position: 4, name: regime.name, item: canonical },
        ],
      },
    ],
  });

  const hreflangAlternates = ['en', 'pl', 'de'].map(loc => ({
    lang: loc,
    href: `${SITE_URL}${loc === 'en' ? '' : `/${loc}`}/guides/compliance/${slug}/`,
  })).concat([{ lang: 'x-default', href: `${SITE_URL}/guides/compliance/${slug}/` }]);

  return {
    canonical,
    relPath: `${locale === 'en' ? '' : locale + '/'}guides/compliance/${slug}/index.html`,
    html: pageShell({ locale, title, description, canonical, jsonLd, body, hreflangAlternates }),
    hreflangAlternates,
  };
}

// ── Index page ────────────────────────────────────────

function generateIndexPage(locale) {
  const t = STRINGS[locale];
  const localePrefix = locale === 'en' ? '' : `/${locale}`;
  const canonical = `${SITE_URL}${localePrefix}/guides/compliance/`;

  // Sort by severity (high first), then alphabetically
  const order = { high: 0, medium: 1, low: 2 };
  const sorted = [...compliance.REGIMES].sort((a, b) => {
    const sevDiff = (order[a.severity] ?? 9) - (order[b.severity] ?? 9);
    if (sevDiff !== 0) return sevDiff;
    return a.name.localeCompare(b.name);
  });

  const breadcrumbs = `<div class="breadcrumbs">
    <a href="${localePrefix}/">${t.breadcrumbHome}</a> /
    <a href="${localePrefix}/guides/">${t.breadcrumbGuides}</a> /
    ${t.breadcrumbCompliance}
  </div>`;

  const rows = sorted.map(r => {
    const slug = regimeSlug(r.id);
    const sevLabel = t['severity' + r.severity.charAt(0).toUpperCase() + r.severity.slice(1)] || r.severity;
    return `<tr>
      <td><a href="${localePrefix}/guides/compliance/${slug}/">${escapeHtml(r.name)}</a></td>
      <td><span class="sev-badge sev-${r.severity}">${sevLabel}</span></td>
      <td>${escapeHtml(r.status)}</td>
    </tr>`;
  }).join('\n');

  const body = `
    ${breadcrumbs}
    <p class="kicker">${t.headerKicker}</p>
    <h1>${t.indexHeadline}</h1>
    <p>${t.indexBody}</p>
    <table class="regimes-table">
      <thead>
        <tr>
          <th>${t.indexColRegime}</th>
          <th>${t.indexColSeverity}</th>
          <th>${t.indexColStatus}</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="as-of-footer">${t.sourceFooter()}</p>
  `;

  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: t.indexHeadline,
    description: t.indexDescription,
    url: canonical,
  });

  const hreflangAlternates = ['en', 'pl', 'de'].map(loc => ({
    lang: loc,
    href: `${SITE_URL}${loc === 'en' ? '' : `/${loc}`}/guides/compliance/`,
  })).concat([{ lang: 'x-default', href: `${SITE_URL}/guides/compliance/` }]);

  return {
    canonical,
    relPath: `${locale === 'en' ? '' : locale + '/'}guides/compliance/index.html`,
    html: pageShell({
      locale,
      title: `${t.indexTitle} ${t.metaSiteSuffix}`,
      description: t.indexDescription,
      canonical,
      jsonLd,
      body,
      hreflangAlternates,
    }),
    hreflangAlternates,
  };
}

// ── Build ────────────────────────────────────────────

function build() {
  const generated = [];
  for (const locale of ['en', 'pl', 'de']) {
    const idx = generateIndexPage(locale);
    fs.mkdirSync(path.dirname(path.join(ROOT, idx.relPath)), { recursive: true });
    fs.writeFileSync(path.join(ROOT, idx.relPath), idx.html, 'utf8');
    generated.push(idx);

    for (const regime of compliance.REGIMES) {
      const page = generateDetailPage(regime, locale);
      fs.mkdirSync(path.dirname(path.join(ROOT, page.relPath)), { recursive: true });
      fs.writeFileSync(path.join(ROOT, page.relPath), page.html, 'utf8');
      generated.push(page);
    }
  }
  return generated;
}

if (require.main === module) {
  const generated = build();
  console.log(`Generated ${generated.length} compliance pages.`);
}

module.exports = { build, generateDetailPage, generateIndexPage, STRINGS };
