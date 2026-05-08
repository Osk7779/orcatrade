// Generate one SEO guide page per active EU trade-defence measure.
//
// For each measure in lib/intelligence/data/eu-trade-defence.js:
//   - one English page at /guides/trade-defence/<slug>/
//   - one Polish page at /pl/guides/trade-defence/<slug>/
//   - one German page at /de/guides/trade-defence/<slug>/
// Plus an index page per locale at /guides/trade-defence/.
//
// Output: ~30 measures × 3 locales × (1 detail + 1 index entry) = ~93 pages.
//
// Each page uses the customs calculator to render a worked example, cites the
// EU regulation, and CTAs into the locale-correct wizard with the matched HS
// code pre-filled in the share permalink.

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SITE_URL = 'https://orcatrade.pl';
const TODAY = new Date().toISOString().slice(0, 10);

const tradeDefence = require('../lib/intelligence/data/eu-trade-defence');
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

function slug(str) {
  return String(str)
    .toLowerCase()
    .replace(/_/g, '-')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-|-$/g, '');
}

function originName(code) {
  const NAMES = { CN: 'China', VN: 'Vietnam', IN: 'India', BD: 'Bangladesh', TR: 'Türkiye', ID: 'Indonesia', EG: 'Egypt' };
  return NAMES[code] || code;
}

function originGenitivePl(code) {
  const PL = { CN: 'Chin', VN: 'Wietnamu', IN: 'Indii', BD: 'Bangladeszu', TR: 'Turcji', ID: 'Indonezji', EG: 'Egiptu' };
  return PL[code] || code;
}

function originDativeDe(code) {
  const DE = { CN: 'aus China', VN: 'aus Vietnam', IN: 'aus Indien', BD: 'aus Bangladesch', TR: 'aus der Türkei', ID: 'aus Indonesien', EG: 'aus Ägypten' };
  return DE[code] || `aus ${code}`;
}

function fmtEur(amount) {
  return '€' + Math.round(amount).toLocaleString('en-IE');
}

function workedExample(measure, locale) {
  // Use the first HS prefix from the measure to drive the customs calculator.
  const hsPrefix = Array.isArray(measure.hsPrefix) ? measure.hsPrefix[0] : measure.hsPrefix;
  // Build a 6-digit HS code by padding the prefix
  const hsCode = String(hsPrefix).replace(/[^0-9]/g, '').padEnd(6, '0').slice(0, 8);
  const origin = measure.origins[0];
  const customsValueEur = 50000;
  const dest = locale === 'pl' ? 'PL' : (locale === 'de' ? 'DE' : 'PL');

  const quote = customs.calculateQuote({
    customsValueEur,
    hsCode,
    destinationCountry: dest,
    originCountry: origin,
    linesCount: 4,
  });
  if (!quote.ok) return null;

  return {
    hsCode,
    origin,
    dest,
    customsValueEur,
    dutyRatePct: quote.duty.ratePercent,
    mfnRatePct: quote.duty.mfnRatePercent,
    dutyEur: quote.quotes.find(q => q.routeKey === 'standard_clearance').dutyEur,
    vatEur: quote.quotes.find(q => q.routeKey === 'standard_clearance').vatEur,
    brokerageEur: quote.quotes.find(q => q.routeKey === 'standard_clearance').brokerageEur,
    landedTotalCustomsOnly: customsValueEur
      + quote.quotes.find(q => q.routeKey === 'standard_clearance').dutyEur
      + quote.quotes.find(q => q.routeKey === 'standard_clearance').vatEur
      + quote.quotes.find(q => q.routeKey === 'standard_clearance').brokerageEur,
  };
}

function wizardShareUrl(measure, locale) {
  const hsPrefix = Array.isArray(measure.hsPrefix) ? measure.hsPrefix[0] : measure.hsPrefix;
  const hsCode = String(hsPrefix).replace(/[^0-9]/g, '').padEnd(6, '0').slice(0, 8);
  const inputs = {
    productCategory: 'machinery',
    originCountry: measure.origins[0],
    destinationCountry: locale === 'de' ? 'DE' : 'PL',
    customsValueEur: 50000,
    weightKg: 1500,
    hsCode,
  };
  const encoded = encodeInputs(inputs);
  const wizardPath = locale === 'en' ? '/start/' : `/${locale}/start/`;
  return `${wizardPath}?p=${encoded}`;
}

// ── i18n ─────────────────────────────────────────────────

const STRINGS = {
  en: {
    metaSiteSuffix: '| OrcaTrade',
    breadcrumbHome: 'Home',
    breadcrumbGuides: 'Guides',
    breadcrumbTradeDefence: 'Trade defence',
    headerKicker: 'EU Trade Defence Measure',
    titleAd: (m) => `Anti-dumping duty on ${m.description.toLowerCase()} from ${originName(m.origins[0])}: ${m.rateTypicalPct}%`,
    titleCvd: (m) => `Countervailing duty on ${m.description.toLowerCase()} from ${originName(m.origins[0])}: ${m.rateTypicalPct}%`,
    titleBoth: (m) => `Anti-dumping + countervailing duty on ${m.description.toLowerCase()} from ${originName(m.origins[0])}: ${m.rateTypicalPct}%`,
    metaDesc: (m) => `${m.description} from ${originName(m.origins[0])} carry an active EU ${m.type === 'CVD' ? 'countervailing' : 'anti-dumping'} duty of ${m.rateTypicalPct}% under ${m.citation}, in addition to MFN. Worked example with full landed cost.`,
    sectionRate: 'The headline rate',
    sectionRateBody: (m) => `The country-wide rate for ${m.description.toLowerCase()} from ${originName(m.origins[0])} is <strong>${m.rateTypicalPct}%</strong>${m.rateMinPct < m.rateMaxPct ? ` (named cooperating exporters as low as ${m.rateMinPct}%)` : ''}, applied <em>in addition</em> to the MFN duty rate.`,
    sectionRegulation: 'The legal basis',
    sectionRegulationBody: (m) => `The duty is imposed by <strong>${m.citation}</strong>. ${m.notes ? m.notes : ''}`,
    sectionCoverage: 'What products are covered',
    sectionCoverageBody: (m) => `HS prefix${Array.isArray(m.hsPrefix) ? 'es' : ''}: <code>${(Array.isArray(m.hsPrefix) ? m.hsPrefix : [m.hsPrefix]).join(', ')}</code>. Origin: ${m.origins.map(o => originName(o)).join(', ')}.`,
    sectionExample: 'Worked example: €50,000 customs value',
    sectionExampleBody: (e, m) => `Imagine you are importing €${e.customsValueEur.toLocaleString('en-IE')} of ${m.description.toLowerCase()} from ${originName(e.origin)} into ${e.dest}. The MFN duty for the chapter is around ${e.mfnRatePct.toFixed(1)}%. With ${m.type === 'CVD' ? 'CVD' : 'AD'} of ${m.rateTypicalPct}% layered on top, the total customs duty rate is <strong>${e.dutyRatePct.toFixed(1)}%</strong>.`,
    exampleColCustoms: 'Customs value',
    exampleColDuty: 'Customs duty (MFN + AD/CVD)',
    exampleColVat: 'Import VAT',
    exampleColBrokerage: 'Brokerage',
    exampleColTotal: 'Customs-only landed total',
    sectionVerify: 'Verify on TARIC before commitments',
    sectionVerifyBody: 'This page is a calibrated curated snapshot — the EU Trade Defence database is the legal authority. Before any commercial commitment, look up the specific 8-digit HS line on https://taric.ec.europa.eu and check named-exporter eligibility.',
    sectionAlternatives: 'What if you sourced elsewhere?',
    sectionAlternativesBody: 'Most importers of measures-affected products discover the AD/CVD only when their first shipment clears customs at a 60%+ effective duty rate. The Import Plan Builder runs the same calculation against alternative origins (VN/IN/BD/TR) so you can see the saving before signing your first PO.',
    ctaTitle: 'Build your full plan in 60 seconds',
    ctaBody: 'Six questions, all four calculators (sourcing, routing, customs, warehouse), full landed cost — with this measure already applied. Free.',
    ctaButton: 'Build my plan with this measure pre-loaded →',
    relatedTitle: 'Related',
    indexTitle: 'EU trade defence measures — anti-dumping & countervailing duty database',
    indexDescription: 'Curated snapshot of active EU anti-dumping and countervailing duty measures. Each measure cites its EU regulation, lists covered HS codes and origins, and shows a worked landed-cost example.',
    indexHeadline: 'Active EU trade defence measures',
    indexBody: 'Below are the trade-defence measures most likely to bite SME importers — concentrated on China, with notable measures from Türkiye, Indonesia, and India. Each entry shows the headline rate, the EU regulation that imposes it, and a worked example.',
    indexColMeasure: 'Measure',
    indexColOrigin: 'Origin',
    indexColType: 'Type',
    indexColRate: 'Rate',
    indexColRegulation: 'Regulation',
    sourceFooter: (asOf) => `Snapshot as of ${asOf}. Updated periodically. Verify on TARIC before commitments.`,
  },
  pl: {
    metaSiteSuffix: '| OrcaTrade',
    breadcrumbHome: 'Strona główna',
    breadcrumbGuides: 'Poradniki',
    breadcrumbTradeDefence: 'Środki ochrony handlu',
    headerKicker: 'Środek ochrony handlu UE',
    titleAd: (m) => `Cło antydumpingowe na ${m.description.toLowerCase()} z ${originGenitivePl(m.origins[0])}: ${m.rateTypicalPct}%`,
    titleCvd: (m) => `Cło wyrównawcze na ${m.description.toLowerCase()} z ${originGenitivePl(m.origins[0])}: ${m.rateTypicalPct}%`,
    titleBoth: (m) => `Cło antydumpingowe + wyrównawcze na ${m.description.toLowerCase()} z ${originGenitivePl(m.origins[0])}: ${m.rateTypicalPct}%`,
    metaDesc: (m) => `${m.description} z ${originGenitivePl(m.origins[0])} podlegają aktywnemu cłu ${m.type === 'CVD' ? 'wyrównawczemu' : 'antydumpingowemu'} UE w wysokości ${m.rateTypicalPct}% na mocy ${m.citation}, dodatkowo do MFN. Przykład z pełnym kosztem landed.`,
    sectionRate: 'Stawka nagłówkowa',
    sectionRateBody: (m) => `Stawka ogólnokrajowa dla ${m.description.toLowerCase()} z ${originGenitivePl(m.origins[0])} wynosi <strong>${m.rateTypicalPct}%</strong>${m.rateMinPct < m.rateMaxPct ? ` (wymienieni współpracujący eksporterzy nawet od ${m.rateMinPct}%)` : ''}, stosowana <em>dodatkowo</em> do stawki MFN.`,
    sectionRegulation: 'Podstawa prawna',
    sectionRegulationBody: (m) => `Cło jest nałożone przez <strong>${m.citation}</strong>. ${m.notes ? m.notes : ''}`,
    sectionCoverage: 'Jakie produkty są objęte',
    sectionCoverageBody: (m) => `Prefiks${Array.isArray(m.hsPrefix) ? 'y' : ''} HS: <code>${(Array.isArray(m.hsPrefix) ? m.hsPrefix : [m.hsPrefix]).join(', ')}</code>. Pochodzenie: ${m.origins.map(o => originName(o)).join(', ')}.`,
    sectionExample: 'Przykład: wartość celna €50 000',
    sectionExampleBody: (e, m) => `Wyobraź sobie, że importujesz €${e.customsValueEur.toLocaleString('pl-PL')} ${m.description.toLowerCase()} z ${originGenitivePl(e.origin)} do ${e.dest}. Stawka MFN dla działu wynosi około ${e.mfnRatePct.toFixed(1)}%. Po dodaniu ${m.type === 'CVD' ? 'CVD' : 'AD'} w wysokości ${m.rateTypicalPct}% łączna stawka cła wynosi <strong>${e.dutyRatePct.toFixed(1)}%</strong>.`,
    exampleColCustoms: 'Wartość celna',
    exampleColDuty: 'Cło (MFN + AD/CVD)',
    exampleColVat: 'VAT importowy',
    exampleColBrokerage: 'Agencja celna',
    exampleColTotal: 'Łączny koszt celny landed',
    sectionVerify: 'Zweryfikuj w TARIC przed zobowiązaniami',
    sectionVerifyBody: 'Ta strona to skalibrowany snapshot — autorytetem prawnym jest baza Trade Defence UE. Przed jakimkolwiek zobowiązaniem handlowym sprawdź konkretny 8-cyfrowy kod HS na https://taric.ec.europa.eu oraz uprawnienia wymienionego eksportera.',
    sectionAlternatives: 'Co jeśli sourcujesz gdzie indziej?',
    sectionAlternativesBody: 'Większość importerów produktów objętych środkami odkrywa AD/CVD dopiero gdy pierwsza przesyłka odprawiana jest po stawce 60%+. Import Plan Builder uruchamia to samo obliczenie dla alternatywnych pochodzeń (VN/IN/BD/TR), więc zobaczysz oszczędność przed podpisaniem pierwszego PO.',
    ctaTitle: 'Zbuduj pełny plan w 60 sekund',
    ctaBody: 'Sześć pytań, cztery kalkulatory (sourcing, transport, odprawa, magazyn), pełny landed cost — z tym środkiem już zastosowanym. Bezpłatnie.',
    ctaButton: 'Zbuduj mój plan z tym środkiem →',
    relatedTitle: 'Powiązane',
    indexTitle: 'Środki ochrony handlu UE — baza ceł antydumpingowych i wyrównawczych',
    indexDescription: 'Skalibrowany snapshot aktywnych środków ochrony handlu UE. Każdy środek cytuje rozporządzenie UE, wymienia objęte kody HS i pochodzenia oraz pokazuje przykładowy koszt landed.',
    indexHeadline: 'Aktywne środki ochrony handlu UE',
    indexBody: 'Poniżej znajdują się środki ochrony handlu, które najczęściej dotykają importerów MŚP — skoncentrowane na Chinach, z istotnymi środkami z Turcji, Indonezji i Indii. Każdy wpis pokazuje stawkę nagłówkową, rozporządzenie UE i przykład.',
    indexColMeasure: 'Środek',
    indexColOrigin: 'Pochodzenie',
    indexColType: 'Typ',
    indexColRate: 'Stawka',
    indexColRegulation: 'Rozporządzenie',
    sourceFooter: (asOf) => `Snapshot na dzień ${asOf}. Aktualizowany okresowo. Zweryfikuj w TARIC przed zobowiązaniami.`,
  },
  de: {
    metaSiteSuffix: '| OrcaTrade',
    breadcrumbHome: 'Startseite',
    breadcrumbGuides: 'Leitfäden',
    breadcrumbTradeDefence: 'Handelsschutz',
    headerKicker: 'EU-Handelsschutzmaßnahme',
    titleAd: (m) => `Antidumpingzoll auf ${m.description.toLowerCase()} ${originDativeDe(m.origins[0])}: ${m.rateTypicalPct}%`,
    titleCvd: (m) => `Ausgleichszoll auf ${m.description.toLowerCase()} ${originDativeDe(m.origins[0])}: ${m.rateTypicalPct}%`,
    titleBoth: (m) => `Antidumping + Ausgleichszoll auf ${m.description.toLowerCase()} ${originDativeDe(m.origins[0])}: ${m.rateTypicalPct}%`,
    metaDesc: (m) => `${m.description} ${originDativeDe(m.origins[0])} unterliegen einem aktiven EU ${m.type === 'CVD' ? 'Ausgleichszoll' : 'Antidumpingzoll'} von ${m.rateTypicalPct}% gemäß ${m.citation}, zusätzlich zum MFN. Berechnungsbeispiel mit vollständigen Landed Cost.`,
    sectionRate: 'Der Hauptsatz',
    sectionRateBody: (m) => `Der landesweite Satz für ${m.description.toLowerCase()} ${originDativeDe(m.origins[0])} beträgt <strong>${m.rateTypicalPct}%</strong>${m.rateMinPct < m.rateMaxPct ? ` (namentlich genannte kooperierende Exporteure ab ${m.rateMinPct}%)` : ''}, angewendet <em>zusätzlich</em> zum MFN-Satz.`,
    sectionRegulation: 'Rechtsgrundlage',
    sectionRegulationBody: (m) => `Der Zoll wird durch <strong>${m.citation}</strong> verhängt. ${m.notes ? m.notes : ''}`,
    sectionCoverage: 'Welche Produkte sind betroffen',
    sectionCoverageBody: (m) => `HS-Präfix${Array.isArray(m.hsPrefix) ? 'e' : ''}: <code>${(Array.isArray(m.hsPrefix) ? m.hsPrefix : [m.hsPrefix]).join(', ')}</code>. Ursprung: ${m.origins.map(o => originName(o)).join(', ')}.`,
    sectionExample: 'Berechnungsbeispiel: €50.000 Zollwert',
    sectionExampleBody: (e, m) => `Stellen Sie sich vor, Sie importieren €${e.customsValueEur.toLocaleString('de-DE')} ${m.description.toLowerCase()} ${originDativeDe(e.origin)} nach ${e.dest}. Der MFN-Satz für das Kapitel beträgt etwa ${e.mfnRatePct.toFixed(1)}%. Mit ${m.type === 'CVD' ? 'CVD' : 'AD'} von ${m.rateTypicalPct}% obendrauf beträgt der Gesamtzollsatz <strong>${e.dutyRatePct.toFixed(1)}%</strong>.`,
    exampleColCustoms: 'Zollwert',
    exampleColDuty: 'Zoll (MFN + AD/CVD)',
    exampleColVat: 'Einfuhrumsatzsteuer',
    exampleColBrokerage: 'Verzollung',
    exampleColTotal: 'Zoll-Landed-Total',
    sectionVerify: 'Vor verbindlicher Bestellung in TARIC prüfen',
    sectionVerifyBody: 'Diese Seite ist ein kalibrierter Snapshot — die EU-Handelsschutz-Datenbank ist die Rechtsautorität. Vor jeder kommerziellen Verpflichtung den spezifischen 8-stelligen HS-Code auf https://taric.ec.europa.eu prüfen und die Eignung namentlich genannter Exporteure verifizieren.',
    sectionAlternatives: 'Was wäre, wenn Sie woanders sourcen?',
    sectionAlternativesBody: 'Die meisten Importeure von maßnahmen-betroffenen Produkten entdecken den AD/CVD erst, wenn ihre erste Sendung mit einem effektiven Zollsatz von 60%+ abgefertigt wird. Der Import Plan Builder führt dieselbe Berechnung gegen alternative Ursprungsländer (VN/IN/BD/TR) durch, sodass Sie die Ersparnis sehen, bevor Sie die erste PO unterzeichnen.',
    ctaTitle: 'Vollständigen Plan in 60 Sekunden erstellen',
    ctaBody: 'Sechs Fragen, vier Kalkulatoren (Sourcing, Transport, Zoll, Lager), vollständige Landed Costs — mit dieser Maßnahme bereits angewendet. Kostenlos.',
    ctaButton: 'Plan mit dieser Maßnahme erstellen →',
    relatedTitle: 'Verwandt',
    indexTitle: 'EU-Handelsschutzmaßnahmen — Antidumping- und Ausgleichszoll-Datenbank',
    indexDescription: 'Kalibrierter Snapshot aktiver EU-Antidumping- und Ausgleichszoll-Maßnahmen. Jede Maßnahme zitiert ihre EU-Verordnung, listet betroffene HS-Codes und Ursprungsländer und zeigt ein Berechnungsbeispiel.',
    indexHeadline: 'Aktive EU-Handelsschutzmaßnahmen',
    indexBody: 'Unten finden Sie die Handelsschutzmaßnahmen, die KMU-Importeure am häufigsten betreffen — konzentriert auf China, mit bemerkenswerten Maßnahmen aus der Türkei, Indonesien und Indien. Jeder Eintrag zeigt den Hauptsatz, die EU-Verordnung und ein Beispiel.',
    indexColMeasure: 'Maßnahme',
    indexColOrigin: 'Ursprung',
    indexColType: 'Typ',
    indexColRate: 'Satz',
    indexColRegulation: 'Verordnung',
    sourceFooter: (asOf) => `Snapshot zum Stand ${asOf}. Periodisch aktualisiert. Vor verbindlicher Bestellung in TARIC prüfen.`,
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
    .kicker { font-family: 'Geist Mono', monospace; font-size: 0.72rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.18em; color: rgba(200, 168, 90, 0.95); margin-bottom: 0.8rem; }
    h1 { font-family: 'Cormorant Garant', Georgia, serif; font-size: clamp(1.9rem, 3.5vw + 0.6rem, 2.8rem); font-weight: 600; line-height: 1.15; letter-spacing: -0.02em; color: rgba(255,255,255,0.97); margin-bottom: 1.4rem; }
    h2 { font-family: 'Cormorant Garant', Georgia, serif; font-size: 1.45rem; font-weight: 600; color: rgba(255,255,255,0.95); margin: 2.5rem 0 0.8rem; line-height: 1.25; }
    p { font-size: 0.98rem; line-height: 1.75; color: rgba(255,255,255,0.82); margin-bottom: 1.1em; max-width: 70ch; }
    code { font-family: 'Geist Mono', monospace; font-size: 0.88rem; background: rgba(184,190,200,0.08); padding: 0.1rem 0.45rem; color: rgba(220, 224, 232, 1); border-radius: 2px; }
    .example-table { width: 100%; border-collapse: collapse; margin: 1.4rem 0; font-size: 0.92rem; }
    .example-table td { padding: 0.55rem 0.85rem; border-bottom: 1px solid rgba(255,255,255,0.07); color: rgba(255,255,255,0.85); font-family: 'Geist Mono', monospace; }
    .example-table td:first-child { font-family: inherit; color: rgba(255,255,255,0.7); }
    .example-table tr.total td { font-weight: 600; color: rgba(255,255,255,0.97); padding-top: 0.7rem; border-top: 1px solid rgba(184,190,200,0.3); border-bottom: none; }
    .citation-callout { background: rgba(184, 168, 114, 0.06); border-left: 3px solid rgba(200, 168, 90, 0.85); padding: 1rem 1.3rem; margin: 1.5rem 0; }
    .citation-callout p { margin-bottom: 0; }
    .verify-callout { background: rgba(120, 160, 200, 0.04); border-left: 3px solid rgba(140, 180, 220, 0.7); padding: 1rem 1.3rem; margin: 1.5rem 0; font-size: 0.9rem; }
    .cta-block { margin: 2.5rem 0 1rem; padding: 1.6rem 1.8rem; background: linear-gradient(135deg, rgba(184,168,114,0.08), rgba(184,190,200,0.03)); border: 1px solid rgba(200, 168, 90, 0.3); text-align: center; }
    .cta-block h3 { font-family: 'Cormorant Garant', Georgia, serif; font-size: 1.3rem; font-weight: 600; color: rgba(255,255,255,0.97); margin: 0 0 0.5rem; }
    .cta-block p { font-size: 0.92rem; color: rgba(255,255,255,0.75); max-width: 56ch; margin: 0 auto 1rem; }
    .cta-block a.cta-btn { display: inline-block; padding: 0.85rem 1.5rem; background: var(--accent-color, #b8bec8); color: #0a0912; font-size: 0.78rem; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; text-decoration: none; }
    .cta-block a.cta-btn:hover { filter: brightness(1.08); }
    .as-of-footer { font-size: 0.78rem; color: rgba(255,255,255,0.45); margin-top: 3rem; padding-top: 1.4rem; border-top: 1px solid rgba(255,255,255,0.07); font-style: italic; }
    .measures-table { width: 100%; border-collapse: collapse; font-size: 0.9rem; margin-top: 1.5rem; }
    .measures-table thead th { font-family: 'Geist Mono', monospace; font-size: 0.66rem; letter-spacing: 0.14em; text-transform: uppercase; color: rgba(255,255,255,0.55); padding: 0.65rem 0.8rem; border-bottom: 1px solid rgba(255,255,255,0.12); text-align: left; font-weight: 500; }
    .measures-table tbody td { padding: 0.65rem 0.8rem; border-bottom: 1px solid rgba(255,255,255,0.05); color: rgba(255,255,255,0.85); }
    .measures-table tbody tr:hover { background: rgba(255,255,255,0.02); }
    .measures-table a { color: rgba(220, 224, 232, 1); text-decoration: none; }
    .measures-table a:hover { color: rgba(255,255,255,0.97); }
    @media (max-width: 700px) { .measures-table { font-size: 0.82rem; } .measures-table thead { display: none; } .measures-table tbody tr { display: block; padding: 0.8rem 0; border-bottom: 1px solid rgba(255,255,255,0.07); } .measures-table tbody td { display: block; padding: 0.2rem 0; border: none; } }
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

// ── Detail page generator ──────────────────────────────

function generateDetailPage(measure, locale) {
  const t = STRINGS[locale];
  const measureSlug = slug(measure.id);
  const localePrefix = locale === 'en' ? '' : `/${locale}`;
  const canonical = `${SITE_URL}${localePrefix}/guides/trade-defence/${measureSlug}/`;

  const titleFn = measure.type === 'CVD' ? t.titleCvd : (measure.type === 'BOTH' ? t.titleBoth : t.titleAd);
  const title = `${titleFn(measure)} ${t.metaSiteSuffix}`;
  const description = t.metaDesc(measure);

  const example = workedExample(measure, locale);

  const breadcrumbsHtml = `<div class="breadcrumbs">
    <a href="${localePrefix}/">${t.breadcrumbHome}</a> /
    <a href="${localePrefix}/guides/">${t.breadcrumbGuides}</a> /
    <a href="${localePrefix}/guides/trade-defence/">${t.breadcrumbTradeDefence}</a>
  </div>`;

  const exampleTable = example ? `
    <table class="example-table">
      <tr><td>${t.exampleColCustoms}</td><td>${fmtEur(example.customsValueEur)}</td></tr>
      <tr><td>${t.exampleColDuty} (${example.dutyRatePct.toFixed(1)}%)</td><td>${fmtEur(example.dutyEur)}</td></tr>
      <tr><td>${t.exampleColVat}</td><td>${fmtEur(example.vatEur)}</td></tr>
      <tr><td>${t.exampleColBrokerage}</td><td>${fmtEur(example.brokerageEur)}</td></tr>
      <tr class="total"><td>${t.exampleColTotal}</td><td>${fmtEur(example.landedTotalCustomsOnly)}</td></tr>
    </table>
  ` : '';

  const ctaUrl = wizardShareUrl(measure, locale);

  const body = `
    ${breadcrumbsHtml}
    <p class="kicker">${t.headerKicker}</p>
    <h1>${titleFn(measure)}</h1>

    <h2>${t.sectionRate}</h2>
    <p>${t.sectionRateBody(measure)}</p>

    <h2>${t.sectionRegulation}</h2>
    <div class="citation-callout"><p>${t.sectionRegulationBody(measure)}</p></div>

    <h2>${t.sectionCoverage}</h2>
    <p>${t.sectionCoverageBody(measure)}</p>

    <h2>${t.sectionExample}</h2>
    <p>${t.sectionExampleBody(example, measure)}</p>
    ${exampleTable}

    <h2>${t.sectionVerify}</h2>
    <div class="verify-callout"><p>${t.sectionVerifyBody}</p></div>

    <h2>${t.sectionAlternatives}</h2>
    <p>${t.sectionAlternativesBody}</p>

    <div class="cta-block">
      <h3>${t.ctaTitle}</h3>
      <p>${t.ctaBody}</p>
      <a class="cta-btn" href="${ctaUrl}">${t.ctaButton}</a>
    </div>

    <p class="as-of-footer">${t.sourceFooter(measure.asOf)}</p>
  `;

  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Article',
        headline: titleFn(measure),
        description,
        about: { '@type': 'Legislation', name: measure.citation, legislationType: measure.type === 'CVD' ? 'Countervailing duty' : 'Anti-dumping duty', jurisdiction: 'European Union' },
        author: { '@type': 'Organization', name: 'OrcaTrade Group' },
        datePublished: TODAY,
        dateModified: measure.asOf,
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: t.breadcrumbHome, item: `${SITE_URL}${localePrefix}/` },
          { '@type': 'ListItem', position: 2, name: t.breadcrumbGuides, item: `${SITE_URL}${localePrefix}/guides/` },
          { '@type': 'ListItem', position: 3, name: t.breadcrumbTradeDefence, item: `${SITE_URL}${localePrefix}/guides/trade-defence/` },
          { '@type': 'ListItem', position: 4, name: titleFn(measure), item: canonical },
        ],
      },
    ],
  });

  const hreflangAlternates = ['en', 'pl', 'de'].map(loc => ({
    lang: loc,
    href: `${SITE_URL}${loc === 'en' ? '' : `/${loc}`}/guides/trade-defence/${measureSlug}/`,
  })).concat([{ lang: 'x-default', href: `${SITE_URL}/guides/trade-defence/${measureSlug}/` }]);

  return {
    canonical,
    relPath: `${locale === 'en' ? '' : locale + '/'}guides/trade-defence/${measureSlug}/index.html`,
    html: pageShell({ locale, title, description, canonical, jsonLd, body, hreflangAlternates }),
  };
}

// ── Index page generator ───────────────────────────────

function generateIndexPage(locale) {
  const t = STRINGS[locale];
  const localePrefix = locale === 'en' ? '' : `/${locale}`;
  const canonical = `${SITE_URL}${localePrefix}/guides/trade-defence/`;

  const measures = tradeDefence.MEASURES;
  // Group: AD by origin
  const sorted = [...measures].sort((a, b) => {
    if (a.origins[0] !== b.origins[0]) return a.origins[0].localeCompare(b.origins[0]);
    return a.description.localeCompare(b.description);
  });

  const breadcrumbs = `<div class="breadcrumbs">
    <a href="${localePrefix}/">${t.breadcrumbHome}</a> /
    <a href="${localePrefix}/guides/">${t.breadcrumbGuides}</a> /
    ${t.breadcrumbTradeDefence}
  </div>`;

  const rows = sorted.map(m => {
    const measureSlug = slug(m.id);
    const titleFn = m.type === 'CVD' ? t.titleCvd : (m.type === 'BOTH' ? t.titleBoth : t.titleAd);
    return `<tr>
      <td><a href="${localePrefix}/guides/trade-defence/${measureSlug}/">${escapeHtml(m.description)}</a></td>
      <td>${m.origins.map(o => originName(o)).join(', ')}</td>
      <td>${m.type}</td>
      <td>${m.rateTypicalPct}%</td>
      <td><code>${escapeHtml(m.citation)}</code></td>
    </tr>`;
  }).join('\n');

  const body = `
    ${breadcrumbs}
    <p class="kicker">${t.headerKicker}</p>
    <h1>${t.indexHeadline}</h1>
    <p>${t.indexBody}</p>
    <table class="measures-table">
      <thead>
        <tr>
          <th>${t.indexColMeasure}</th>
          <th>${t.indexColOrigin}</th>
          <th>${t.indexColType}</th>
          <th>${t.indexColRate}</th>
          <th>${t.indexColRegulation}</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
    <p class="as-of-footer">${t.sourceFooter(tradeDefence.ASOF)}</p>
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
    href: `${SITE_URL}${loc === 'en' ? '' : `/${loc}`}/guides/trade-defence/`,
  })).concat([{ lang: 'x-default', href: `${SITE_URL}/guides/trade-defence/` }]);

  return {
    canonical,
    relPath: `${locale === 'en' ? '' : locale + '/'}guides/trade-defence/index.html`,
    html: pageShell({
      locale,
      title: `${t.indexTitle} ${t.metaSiteSuffix}`,
      description: t.indexDescription,
      canonical,
      jsonLd,
      body,
      hreflangAlternates,
    }),
  };
}

// ── Build ────────────────────────────────────────────

function build() {
  const generated = [];
  for (const locale of ['en', 'pl', 'de']) {
    // Index
    const idx = generateIndexPage(locale);
    fs.mkdirSync(path.dirname(path.join(ROOT, idx.relPath)), { recursive: true });
    fs.writeFileSync(path.join(ROOT, idx.relPath), idx.html, 'utf8');
    generated.push(idx);

    // Detail pages
    for (const measure of tradeDefence.MEASURES) {
      const page = generateDetailPage(measure, locale);
      fs.mkdirSync(path.dirname(path.join(ROOT, page.relPath)), { recursive: true });
      fs.writeFileSync(path.join(ROOT, page.relPath), page.html, 'utf8');
      generated.push(page);
    }
  }
  return generated;
}

if (require.main === module) {
  const generated = build();
  console.log(`Generated ${generated.length} trade-defence pages.`);
}

module.exports = { build, generateDetailPage, generateIndexPage, STRINGS };
