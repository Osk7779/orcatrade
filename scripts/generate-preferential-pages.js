// Generate one SEO guide page per EU preferential-origin regime + key
// origin pivot, in three locales.
//
// Two layers:
//   - Regime pages: /guides/preferential-origin/<regime>/ (one per regime)
//     EBA, GSP+, GSP standard, EVFTA, EUKFTA, EUJEPA, ATR
//   - Origin pivots: /guides/preferential-origin/from-<country>/
//     BD, VN, KR, JP, TR, IN, PK — the most-searched single-country pivots
//
// Each page covers: regime name, legal basis, required document
// (EUR.1 / REX / Form A discontinued / A.TR), eligibility, worked example,
// "what if I don't have the document" warning, CTA into wizard with
// origin + claimPreferential=true pre-loaded.
//
// Output: 14 unique pages × 3 locales = 42 pages, plus 1 index per locale = 45.

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SITE_URL = 'https://orcatrade.pl';
const TODAY = new Date().toISOString().slice(0, 10);

const customs = require('../lib/intelligence/customs-quote');
const { encodeInputs } = require('../lib/utils/plan-codec');
const preferential = require('../lib/intelligence/data/preferential-origin');

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

const ORIGIN_NAMES = { BD: 'Bangladesh', VN: 'Vietnam', KR: 'South Korea', JP: 'Japan', TR: 'Türkiye', IN: 'India', PK: 'Pakistan', LK: 'Sri Lanka' };
const ORIGIN_NAMES_PL = { BD: 'Bangladesz', VN: 'Wietnam', KR: 'Korea Południowa', JP: 'Japonia', TR: 'Turcja', IN: 'Indie', PK: 'Pakistan', LK: 'Sri Lanka' };
const ORIGIN_NAMES_DE = { BD: 'Bangladesch', VN: 'Vietnam', KR: 'Südkorea', JP: 'Japan', TR: 'Türkei', IN: 'Indien', PK: 'Pakistan', LK: 'Sri Lanka' };

// ── Regime catalogue (anchor data for each guide) ──────

const REGIMES = [
  {
    slug: 'eba',
    code: 'EBA',
    name: 'EBA — Everything But Arms',
    document: 'REX statement on origin (Form A discontinued in 2017)',
    primaryOrigins: ['BD', 'KH', 'MM', 'NP', 'LA', 'BF'],
    sampleOrigin: 'BD',
    sampleHsCode: '6203.42',
    sampleCategory: 'apparel',
    headline: 'Zero EU import duty on every product (except arms) for Least Developed Countries with valid REX statement.',
    keyDates: 'Bangladesh graduates from LDC status in 2026 with a 3-year transitional period — EBA benefits continue until 2029. Cambodia and Myanmar are subject to partial preference withdrawal.',
  },
  {
    slug: 'gsp-plus',
    code: 'GSP_PLUS',
    name: 'GSP+ — Generalised Scheme of Preferences Plus',
    document: 'REX statement on origin',
    primaryOrigins: ['PK', 'LK', 'BO', 'MN', 'KG', 'PH'],
    sampleOrigin: 'PK',
    sampleHsCode: '6203.42',
    sampleCategory: 'apparel',
    headline: 'Zero EU duty on most covered products for vulnerable economies that ratify core human rights and labour conventions.',
    keyDates: 'GSP+ status is reviewed periodically; beneficiaries must remain compliant with 27 international conventions on labour, human rights, environment, and good governance.',
  },
  {
    slug: 'gsp-standard',
    code: 'GSP_STANDARD',
    name: 'GSP standard — Generalised Scheme of Preferences',
    document: 'REX statement on origin',
    primaryOrigins: ['IN', 'ID', 'KE', 'NG'],
    sampleOrigin: 'IN',
    sampleHsCode: '6203.42',
    sampleCategory: 'apparel',
    headline: 'Partial duty reduction (~3.5pp typical) on covered "non-sensitive" products for developing-country exporters.',
    keyDates: 'India has graduated out of GSP for textiles (chapters 50-63), copper, plastics, organic chemicals — verify TARIC for the specific HS line.',
  },
  {
    slug: 'evfta',
    code: 'EVFTA',
    name: 'EU-Vietnam Free Trade Agreement (EVFTA)',
    document: 'REX origin declaration on invoice (statement on origin), or EUR.1 for shipments > €6,000',
    primaryOrigins: ['VN'],
    sampleOrigin: 'VN',
    sampleHsCode: '8517.62',
    sampleCategory: 'electronics',
    headline: 'Zero duty on most goods by 2025-2027, with phased reduction for sensitive categories (textiles, fish).',
    keyDates: 'In force since August 2020. Most goods reach 0% by 2025-2027. Textile chapters 61-62 carry stricter rules of origin requiring fabric to come from VN, EU, or KR.',
  },
  {
    slug: 'eukfta',
    code: 'EUKFTA',
    name: 'EU-South Korea FTA (EUKFTA)',
    document: 'Origin declaration on invoice (REX) for shipments any value; EUR.1 not used',
    primaryOrigins: ['KR'],
    sampleOrigin: 'KR',
    sampleHsCode: '8528.72',
    sampleCategory: 'electronics',
    headline: 'Zero duty on almost all industrial goods since 2016.',
    keyDates: 'In force since July 2011. Full 0% reached for almost all industrial goods by 2016.',
  },
  {
    slug: 'eujepa',
    code: 'EUJEPA',
    name: 'EU-Japan Economic Partnership Agreement (EUJEPA)',
    document: 'Statement on origin (self-certification) for any value; supporting evidence required',
    primaryOrigins: ['JP'],
    sampleOrigin: 'JP',
    sampleHsCode: '8703.23',
    sampleCategory: 'machinery',
    headline: 'Zero duty on most industrial goods by 2024-2026; some agricultural still phased.',
    keyDates: 'In force since February 2019. Most industrial goods at 0% by 2024-2026.',
  },
  {
    slug: 'atr',
    code: 'ATR',
    name: 'EU-Türkiye Customs Union (A.TR.1)',
    document: 'A.TR movement certificate (replaces — not supplements — origin proof for Customs Union goods)',
    primaryOrigins: ['TR'],
    sampleOrigin: 'TR',
    sampleHsCode: '7318.15',
    sampleCategory: 'machinery',
    headline: 'Free circulation of industrial goods (HS chapters 25-99) between EU and Türkiye since 1996.',
    keyDates: 'In force since 31 December 1995. Excludes agricultural products (chapters 01-24) and ECSC steel products. Trade-defence measures (e.g. anti-dumping on TR cold-rolled steel) override the Customs Union.',
  },
];

const ORIGIN_PIVOTS = [
  { code: 'BD', regime: 'eba', sampleHsCode: '6203.42', sampleCategory: 'apparel' },
  { code: 'VN', regime: 'evfta', sampleHsCode: '8517.62', sampleCategory: 'electronics' },
  { code: 'KR', regime: 'eukfta', sampleHsCode: '8528.72', sampleCategory: 'electronics' },
  { code: 'JP', regime: 'eujepa', sampleHsCode: '8703.23', sampleCategory: 'machinery' },
  { code: 'TR', regime: 'atr', sampleHsCode: '7318.15', sampleCategory: 'machinery' },
  { code: 'IN', regime: 'gsp-standard', sampleHsCode: '3304.99', sampleCategory: 'cosmetics' },
  { code: 'PK', regime: 'gsp-plus', sampleHsCode: '6203.42', sampleCategory: 'apparel' },
];

// ── i18n ───────────────────────────────────────────────

const STRINGS = {
  en: {
    metaSiteSuffix: '| OrcaTrade',
    breadcrumbHome: 'Home',
    breadcrumbGuides: 'Guides',
    breadcrumbPreferential: 'Preferential origin',
    headerKicker: 'EU Preferential Origin Regime',
    pivotHeaderKicker: (origin) => `Importing from ${ORIGIN_NAMES[origin]} — preferential duty pathway`,
    titleRegime: (r) => `${r.name} — duty pathway, required document, worked example`,
    titlePivot: (origin, regime) => `Preferential duty for imports from ${ORIGIN_NAMES[origin]}: ${regime.name}`,
    metaDescRegime: (r) => `${r.name}. Document: ${r.document}. ${r.headline} Includes a worked landed-cost example and a deep-link into the OrcaTrade plan builder.`,
    metaDescPivot: (origin, r) => `Importing from ${ORIGIN_NAMES[origin]} into the EU? You may qualify for ${r.name} — zero or reduced duty with the right document. Worked example + deep-link into OrcaTrade plan builder.`,
    sectionHowItWorks: 'How it works',
    sectionHowItWorksRegime: (r) => `${r.headline} ${r.keyDates ? r.keyDates : ''}`,
    sectionDocument: 'Required document',
    sectionDocumentBody: (r) => `To claim under <strong>${r.name}</strong>, the importer must present: <strong>${r.document}</strong>. Without the document, the EU customs broker applies the standard MFN rate — no exception.`,
    sectionEligibility: 'Origin eligibility',
    sectionEligibilityBody: (r) => {
      const list = r.primaryOrigins.map(c => ORIGIN_NAMES[c] || c).join(', ');
      return `Eligible origins under this regime include: ${list}. Verify TARIC for additional countries; the EU's GSP/EBA/GSP+ list is reviewed periodically.`;
    },
    sectionExample: 'Worked example: €50,000 customs value',
    sectionExampleBody: (e, r) =>
      `Imagine you are importing €${e.customsValueEur.toLocaleString('en-IE')} of ${e.categoryName} from ${ORIGIN_NAMES[e.origin]} into the EU. Without ${r.code} (no document presented): MFN duty rate <strong>${e.mfnRatePct.toFixed(1)}%</strong> = ${fmtEur(e.dutyEurNoPref)}. With ${r.code} (valid ${e.documentShort}): preferential rate <strong>${e.dutyRatePctWithPref.toFixed(1)}%</strong> = ${fmtEur(e.dutyEurWithPref)}. <strong>Saving: ${fmtEur(e.savingEur)}</strong>.`,
    exampleColScenario: 'Scenario',
    exampleColDuty: 'Duty rate',
    exampleColDutyEur: 'Duty amount',
    exampleScenarioMfn: (regimeCode) => `Without ${regimeCode} (MFN)`,
    exampleScenarioPref: (regimeCode) => `With ${regimeCode} (preferential)`,
    sectionWarning: 'No document = no preferential rate',
    sectionWarningBody: 'A common mistake: importers assume their origin is enough. The EU customs broker needs the actual origin document on file before clearance. If your supplier hasn\'t set up REX registration or won\'t issue EUR.1, you pay full MFN — and the duty is non-recoverable. Confirm document availability before signing your first PO.',
    sectionTradeDefence: 'Trade defence overrides',
    sectionTradeDefenceBody: 'Preferential origin reduces or eliminates the MFN duty, but does NOT waive anti-dumping or countervailing duties. A Türkiye cold-rolled steel shipment cleared under A.TR still pays the 23.3% AD measure on top of 0% MFN. Verify TARIC for active trade defence on your specific HS line.',
    ctaTitle: 'Build your full plan with this regime applied',
    ctaBody: 'Six questions, all four calculators (sourcing, routing, customs, warehouse), full landed cost — with the preferential pathway already claimed. Free.',
    ctaButton: 'Build my plan with preferential origin claimed →',
    indexTitle: 'EU preferential origin regimes — duty pathway database',
    indexDescription: 'Active EU preferential origin regimes (EBA, GSP, FTAs, Customs Union) with required documents, origin coverage, and worked landed-cost examples.',
    indexHeadline: 'EU preferential origin pathways',
    indexBody: 'Below are the EU preferential origin regimes — the legal pathways that let importers claim zero or reduced duty when sourcing from specific origins with the right document.',
    indexColRegime: 'Regime',
    indexColScope: 'Coverage',
    indexColDocument: 'Document',
    indexSubheadingPivots: 'Country pivots',
    sourceFooter: () => `Snapshot reviewed ${TODAY}. Preferential regimes are amended periodically. Verify on TARIC before commercial commitments.`,
    categoryName: { apparel: 'apparel', electronics: 'electronics', machinery: 'machinery', cosmetics: 'cosmetics' },
  },
  pl: {
    metaSiteSuffix: '| OrcaTrade',
    breadcrumbHome: 'Strona główna',
    breadcrumbGuides: 'Poradniki',
    breadcrumbPreferential: 'Pochodzenie preferencyjne',
    headerKicker: 'Reżim preferencyjnego pochodzenia UE',
    pivotHeaderKicker: (origin) => `Import z ${ORIGIN_NAMES_PL[origin]} — ścieżka preferencyjna`,
    titleRegime: (r) => `${r.name} — ścieżka cła, wymagany dokument, przykład`,
    titlePivot: (origin, regime) => `Cło preferencyjne dla importu z ${ORIGIN_NAMES_PL[origin]}: ${regime.name}`,
    metaDescRegime: (r) => `${r.name}. Dokument: ${r.document}. ${r.headline} Zawiera przykład kosztu landed i bezpośredni link do kreatora planu OrcaTrade.`,
    metaDescPivot: (origin, r) => `Importujesz z ${ORIGIN_NAMES_PL[origin]} do UE? Możesz kwalifikować się do ${r.name} — zerowe lub obniżone cło z odpowiednim dokumentem. Przykład + bezpośredni link do kreatora OrcaTrade.`,
    sectionHowItWorks: 'Jak to działa',
    sectionHowItWorksRegime: (r) => `${r.headline} ${r.keyDates ? r.keyDates : ''}`,
    sectionDocument: 'Wymagany dokument',
    sectionDocumentBody: (r) => `Aby skorzystać z <strong>${r.name}</strong>, importer musi przedstawić: <strong>${r.document}</strong>. Bez dokumentu agencja celna UE stosuje standardową stawkę MFN — bez wyjątków.`,
    sectionEligibility: 'Uprawnione pochodzenie',
    sectionEligibilityBody: (r) => {
      const list = r.primaryOrigins.map(c => ORIGIN_NAMES_PL[c] || ORIGIN_NAMES[c] || c).join(', ');
      return `Uprawnione kraje pochodzenia w ramach tego reżimu: ${list}. Sprawdź TARIC dla dodatkowych krajów; lista UE GSP/EBA/GSP+ jest okresowo aktualizowana.`;
    },
    sectionExample: 'Przykład: wartość celna €50 000',
    sectionExampleBody: (e, r) =>
      `Wyobraź sobie, że importujesz €${e.customsValueEur.toLocaleString('pl-PL')} ${e.categoryName} z ${ORIGIN_NAMES_PL[e.origin] || e.origin} do UE. Bez ${r.code} (brak dokumentu): stawka MFN <strong>${e.mfnRatePct.toFixed(1)}%</strong> = ${fmtEur(e.dutyEurNoPref)}. Z ${r.code} (ważny ${e.documentShort}): stawka preferencyjna <strong>${e.dutyRatePctWithPref.toFixed(1)}%</strong> = ${fmtEur(e.dutyEurWithPref)}. <strong>Oszczędność: ${fmtEur(e.savingEur)}</strong>.`,
    exampleColScenario: 'Scenariusz',
    exampleColDuty: 'Stawka cła',
    exampleColDutyEur: 'Kwota cła',
    exampleScenarioMfn: (regimeCode) => `Bez ${regimeCode} (MFN)`,
    exampleScenarioPref: (regimeCode) => `Z ${regimeCode} (preferencyjne)`,
    sectionWarning: 'Brak dokumentu = brak stawki preferencyjnej',
    sectionWarningBody: 'Częsty błąd: importerzy zakładają, że samo pochodzenie wystarczy. Agencja celna UE potrzebuje rzeczywistego dokumentu pochodzenia w aktach przed odprawą. Jeśli Twój dostawca nie ma rejestracji REX lub nie wystawi EUR.1, płacisz pełne MFN — a cło jest niezwracalne. Potwierdź dostępność dokumentu przed podpisaniem pierwszego PO.',
    sectionTradeDefence: 'Środki ochrony handlu mają pierwszeństwo',
    sectionTradeDefenceBody: 'Pochodzenie preferencyjne redukuje lub eliminuje cło MFN, ale NIE znosi ceł antydumpingowych ani wyrównawczych. Przesyłka stali walcowanej na zimno z Turcji odprawiona z A.TR nadal płaci środek AD 23,3% dodatkowo do 0% MFN. Sprawdź TARIC dla aktywnych środków ochrony handlu na konkretnej linii HS.',
    ctaTitle: 'Zbuduj pełny plan z zastosowanym tym reżimem',
    ctaBody: 'Sześć pytań, cztery kalkulatory (sourcing, transport, odprawa, magazyn), pełny landed cost — z już zadeklarowaną ścieżką preferencyjną. Bezpłatnie.',
    ctaButton: 'Zbuduj mój plan z pochodzeniem preferencyjnym →',
    indexTitle: 'Reżimy preferencyjnego pochodzenia UE — baza ścieżek cła',
    indexDescription: 'Aktywne reżimy preferencyjnego pochodzenia UE (EBA, GSP, FTA, Unia Celna) z wymaganymi dokumentami, zakresem pochodzenia i przykładami landed cost.',
    indexHeadline: 'Ścieżki preferencyjnego pochodzenia UE',
    indexBody: 'Poniżej znajdują się reżimy preferencyjnego pochodzenia UE — prawne ścieżki pozwalające importerom zadeklarować zerowe lub obniżone cło przy sourcing z określonych pochodzeń z odpowiednim dokumentem.',
    indexColRegime: 'Reżim',
    indexColScope: 'Zakres',
    indexColDocument: 'Dokument',
    indexSubheadingPivots: 'Wg kraju',
    sourceFooter: () => `Snapshot przejrzany ${TODAY}. Reżimy preferencyjne są okresowo zmieniane. Zweryfikuj w TARIC przed zobowiązaniami handlowymi.`,
    categoryName: { apparel: 'odzieży', electronics: 'elektroniki', machinery: 'maszyn', cosmetics: 'kosmetyków' },
  },
  de: {
    metaSiteSuffix: '| OrcaTrade',
    breadcrumbHome: 'Startseite',
    breadcrumbGuides: 'Leitfäden',
    breadcrumbPreferential: 'Präferenzursprung',
    headerKicker: 'EU-Präferenzursprungsregime',
    pivotHeaderKicker: (origin) => `Import aus ${ORIGIN_NAMES_DE[origin]} — Präferenz-Pfad`,
    titleRegime: (r) => `${r.name} — Zollpfad, erforderliches Dokument, Rechenbeispiel`,
    titlePivot: (origin, regime) => `Präferenzzoll für Importe aus ${ORIGIN_NAMES_DE[origin]}: ${regime.name}`,
    metaDescRegime: (r) => `${r.name}. Dokument: ${r.document}. ${r.headline} Inklusive Berechnungsbeispiel und Direktlink zum OrcaTrade Plan-Builder.`,
    metaDescPivot: (origin, r) => `Importieren aus ${ORIGIN_NAMES_DE[origin]} in die EU? Sie qualifizieren sich möglicherweise für ${r.name} — null oder reduzierter Zoll mit dem richtigen Dokument. Beispiel + Direktlink zum OrcaTrade-Builder.`,
    sectionHowItWorks: 'Wie es funktioniert',
    sectionHowItWorksRegime: (r) => `${r.headline} ${r.keyDates ? r.keyDates : ''}`,
    sectionDocument: 'Erforderliches Dokument',
    sectionDocumentBody: (r) => `Um <strong>${r.name}</strong> in Anspruch zu nehmen, muss der Importeur folgendes vorlegen: <strong>${r.document}</strong>. Ohne das Dokument wendet der EU-Zollagent den Standard-MFN-Satz an — ohne Ausnahme.`,
    sectionEligibility: 'Berechtigte Ursprungsländer',
    sectionEligibilityBody: (r) => {
      const list = r.primaryOrigins.map(c => ORIGIN_NAMES_DE[c] || ORIGIN_NAMES[c] || c).join(', ');
      return `Berechtigte Ursprungsländer unter diesem Regime: ${list}. TARIC prüfen für weitere Länder; die EU-GSP/EBA/GSP+-Liste wird periodisch überprüft.`;
    },
    sectionExample: 'Berechnungsbeispiel: €50.000 Zollwert',
    sectionExampleBody: (e, r) =>
      `Stellen Sie sich vor, Sie importieren €${e.customsValueEur.toLocaleString('de-DE')} ${e.categoryName} aus ${ORIGIN_NAMES_DE[e.origin] || e.origin} in die EU. Ohne ${r.code} (kein Dokument vorgelegt): MFN-Satz <strong>${e.mfnRatePct.toFixed(1)}%</strong> = ${fmtEur(e.dutyEurNoPref)}. Mit ${r.code} (gültiges ${e.documentShort}): Präferenzsatz <strong>${e.dutyRatePctWithPref.toFixed(1)}%</strong> = ${fmtEur(e.dutyEurWithPref)}. <strong>Ersparnis: ${fmtEur(e.savingEur)}</strong>.`,
    exampleColScenario: 'Szenario',
    exampleColDuty: 'Zollsatz',
    exampleColDutyEur: 'Zollbetrag',
    exampleScenarioMfn: (regimeCode) => `Ohne ${regimeCode} (MFN)`,
    exampleScenarioPref: (regimeCode) => `Mit ${regimeCode} (Präferenz)`,
    sectionWarning: 'Kein Dokument = kein Präferenzsatz',
    sectionWarningBody: 'Häufiger Fehler: Importeure nehmen an, der Ursprung allein reiche aus. Der EU-Zollagent benötigt das tatsächliche Ursprungsdokument vor der Abfertigung. Wenn Ihr Lieferant keine REX-Registrierung hat oder kein EUR.1 ausstellt, zahlen Sie vollen MFN — und der Zoll ist nicht erstattungsfähig. Bestätigen Sie die Dokumentenverfügbarkeit vor der ersten Bestellung.',
    sectionTradeDefence: 'Handelsschutz hat Vorrang',
    sectionTradeDefenceBody: 'Präferenzursprung reduziert oder eliminiert den MFN-Zoll, hebt jedoch NICHT Antidumping- oder Ausgleichszölle auf. Eine Sendung kaltgewalzten Stahls aus der Türkei mit A.TR-Abfertigung zahlt weiterhin die AD-Maßnahme von 23,3% zusätzlich zu 0% MFN. TARIC für aktive Handelsschutzmaßnahmen auf Ihrer spezifischen HS-Linie prüfen.',
    ctaTitle: 'Vollständigen Plan mit diesem Regime erstellen',
    ctaBody: 'Sechs Fragen, vier Kalkulatoren (Sourcing, Transport, Zoll, Lager), vollständige Landed Costs — mit bereits beanspruchtem Präferenzpfad. Kostenlos.',
    ctaButton: 'Plan mit Präferenzursprung erstellen →',
    indexTitle: 'EU-Präferenzursprungsregime — Zollpfad-Datenbank',
    indexDescription: 'Aktive EU-Präferenzursprungsregime (EBA, GSP, FTA, Zollunion) mit erforderlichen Dokumenten, Ursprungsabdeckung und Berechnungsbeispielen.',
    indexHeadline: 'EU-Präferenzursprungs-Pfade',
    indexBody: 'Unten finden Sie die EU-Präferenzursprungsregime — die rechtlichen Pfade, die Importeuren ermöglichen, null oder reduzierten Zoll zu beanspruchen, wenn sie aus bestimmten Ursprungsländern mit dem richtigen Dokument sourcen.',
    indexColRegime: 'Regime',
    indexColScope: 'Abdeckung',
    indexColDocument: 'Dokument',
    indexSubheadingPivots: 'Nach Land',
    sourceFooter: () => `Snapshot überprüft am ${TODAY}. Präferenzregime werden periodisch geändert. Vor verbindlichen Bestellungen in TARIC prüfen.`,
    categoryName: { apparel: 'Bekleidung', electronics: 'Elektronik', machinery: 'Maschinen', cosmetics: 'Kosmetik' },
  },
};

// Document short-form for example body
function documentShort(documentString) {
  if (/REX/.test(documentString)) return 'REX';
  if (/EUR\.1/.test(documentString)) return 'EUR.1';
  if (/A\.TR/.test(documentString)) return 'A.TR';
  if (/Form A/.test(documentString)) return 'Form A';
  return 'document';
}

// Compute the MFN-vs-preferential example for a given regime sample
function buildExampleData(regime, locale) {
  const customsValueEur = 50000;
  const dest = locale === 'de' ? 'DE' : 'PL';
  const mfn = customs.calculateQuote({
    customsValueEur,
    hsCode: regime.sampleHsCode,
    destinationCountry: dest,
    originCountry: regime.sampleOrigin,
    linesCount: 4,
    claimPreferential: false,
  });
  const pref = customs.calculateQuote({
    customsValueEur,
    hsCode: regime.sampleHsCode,
    destinationCountry: dest,
    originCountry: regime.sampleOrigin,
    linesCount: 4,
    claimPreferential: true,
  });
  if (!mfn.ok || !pref.ok) return null;
  const dutyEurNoPref = mfn.quotes.find(q => q.routeKey === 'standard_clearance').dutyEur;
  const dutyEurWithPref = pref.quotes.find(q => q.routeKey === 'standard_clearance').dutyEur;
  const savingEur = Math.max(0, dutyEurNoPref - dutyEurWithPref);
  const t = STRINGS[locale];
  return {
    customsValueEur,
    origin: regime.sampleOrigin,
    categoryName: t.categoryName[regime.sampleCategory] || regime.sampleCategory,
    mfnRatePct: mfn.duty.mfnRatePercent,
    dutyEurNoPref,
    dutyRatePctWithPref: pref.duty.ratePercent,
    dutyEurWithPref,
    savingEur,
    documentShort: documentShort(regime.document),
  };
}

function wizardShareUrl(regime, locale) {
  const inputs = {
    productCategory: regime.sampleCategory,
    originCountry: regime.sampleOrigin,
    destinationCountry: locale === 'de' ? 'DE' : 'PL',
    customsValueEur: 50000,
    weightKg: 1500,
    hsCode: regime.sampleHsCode,
    claimPreferential: true,
  };
  const encoded = encodeInputs(inputs);
  const wizardPath = locale === 'en' ? '/start/' : `/${locale}/start/`;
  return `${wizardPath}?p=${encoded}`;
}

// ── Page shell ─────────────────────────────────────────

function pageShell({ locale, title, description, canonical, jsonLd, body, hreflangAlternates }) {
  const ogImage = `${SITE_URL}/og-1200x630.png`;
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
    .kicker { font-family: 'Geist Mono', monospace; font-size: 0.72rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.18em; color: rgba(95, 181, 107, 0.95); margin-bottom: 0.8rem; }
    h1 { font-family: 'Cormorant Garant', Georgia, serif; font-size: clamp(1.9rem, 3.5vw + 0.6rem, 2.8rem); font-weight: 600; line-height: 1.15; letter-spacing: -0.02em; color: rgba(255,255,255,0.97); margin-bottom: 1.4rem; }
    h2 { font-family: 'Cormorant Garant', Georgia, serif; font-size: 1.45rem; font-weight: 600; color: rgba(255,255,255,0.95); margin: 2.5rem 0 0.8rem; line-height: 1.25; }
    p { font-size: 0.98rem; line-height: 1.75; color: rgba(255,255,255,0.82); margin-bottom: 1.1em; max-width: 70ch; }
    code { font-family: 'Geist Mono', monospace; font-size: 0.88rem; background: rgba(184,190,200,0.08); padding: 0.1rem 0.45rem; color: rgba(220, 224, 232, 1); border-radius: 2px; }
    .example-table { width: 100%; border-collapse: collapse; margin: 1.4rem 0; font-size: 0.92rem; }
    .example-table th { font-family: 'Geist Mono', monospace; font-size: 0.66rem; letter-spacing: 0.14em; text-transform: uppercase; color: rgba(255,255,255,0.55); padding: 0.6rem 0.85rem; text-align: left; border-bottom: 1px solid rgba(255,255,255,0.12); font-weight: 500; }
    .example-table td { padding: 0.55rem 0.85rem; border-bottom: 1px solid rgba(255,255,255,0.07); color: rgba(255,255,255,0.85); font-family: 'Geist Mono', monospace; }
    .example-table td:first-child { font-family: inherit; color: rgba(255,255,255,0.7); }
    .example-table tr.saving td { font-weight: 600; color: #7ed28a; padding-top: 0.7rem; border-top: 1px solid rgba(80, 180, 100, 0.3); border-bottom: none; }
    .doc-callout { background: rgba(80, 180, 100, 0.05); border-left: 3px solid rgba(95, 181, 107, 0.85); padding: 1rem 1.3rem; margin: 1.5rem 0; }
    .warn-callout { background: rgba(201, 80, 80, 0.04); border-left: 3px solid rgba(232, 128, 128, 0.7); padding: 1rem 1.3rem; margin: 1.5rem 0; font-size: 0.94rem; }
    .td-callout { background: rgba(200, 168, 90, 0.04); border-left: 3px solid rgba(200, 168, 90, 0.7); padding: 1rem 1.3rem; margin: 1.5rem 0; font-size: 0.94rem; }
    .cta-block { margin: 2.5rem 0 1rem; padding: 1.6rem 1.8rem; background: linear-gradient(135deg, rgba(95, 181, 107, 0.08), rgba(184,190,200,0.03)); border: 1px solid rgba(95, 181, 107, 0.3); text-align: center; }
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

// ── Detail page generator ──────────────────────────────

function generateRegimePage(regime, locale) {
  const t = STRINGS[locale];
  const localePrefix = locale === 'en' ? '' : `/${locale}`;
  const canonical = `${SITE_URL}${localePrefix}/guides/preferential-origin/${regime.slug}/`;
  const title = `${t.titleRegime(regime)} ${t.metaSiteSuffix}`;
  const description = t.metaDescRegime(regime);

  const example = buildExampleData(regime, locale);

  const breadcrumbs = `<div class="breadcrumbs">
    <a href="${localePrefix}/">${t.breadcrumbHome}</a> /
    <a href="${localePrefix}/guides/">${t.breadcrumbGuides}</a> /
    <a href="${localePrefix}/guides/preferential-origin/">${t.breadcrumbPreferential}</a>
  </div>`;

  const exampleTable = example ? `
    <table class="example-table">
      <thead>
        <tr><th>${t.exampleColScenario}</th><th>${t.exampleColDuty}</th><th>${t.exampleColDutyEur}</th></tr>
      </thead>
      <tbody>
        <tr><td>${t.exampleScenarioMfn(regime.code)}</td><td>${example.mfnRatePct.toFixed(1)}%</td><td>${fmtEur(example.dutyEurNoPref)}</td></tr>
        <tr><td>${t.exampleScenarioPref(regime.code)}</td><td>${example.dutyRatePctWithPref.toFixed(1)}%</td><td>${fmtEur(example.dutyEurWithPref)}</td></tr>
        <tr class="saving"><td>Saving</td><td>—</td><td>${fmtEur(example.savingEur)}</td></tr>
      </tbody>
    </table>
  ` : '';

  const ctaUrl = wizardShareUrl(regime, locale);

  const body = `
    ${breadcrumbs}
    <p class="kicker">${t.headerKicker}</p>
    <h1>${escapeHtml(t.titleRegime(regime))}</h1>

    <h2>${t.sectionHowItWorks}</h2>
    <p>${t.sectionHowItWorksRegime(regime)}</p>

    <h2>${t.sectionDocument}</h2>
    <div class="doc-callout"><p>${t.sectionDocumentBody(regime)}</p></div>

    <h2>${t.sectionEligibility}</h2>
    <p>${t.sectionEligibilityBody(regime)}</p>

    <h2>${t.sectionExample}</h2>
    <p>${t.sectionExampleBody(example, regime)}</p>
    ${exampleTable}

    <h2>${t.sectionWarning}</h2>
    <div class="warn-callout"><p>${t.sectionWarningBody}</p></div>

    <h2>${t.sectionTradeDefence}</h2>
    <div class="td-callout"><p>${t.sectionTradeDefenceBody}</p></div>

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
        headline: t.titleRegime(regime),
        description,
        about: { '@type': 'GovernmentService', name: regime.name, jurisdiction: 'European Union' },
        author: { '@type': 'Organization', name: 'OrcaTrade Group' },
        datePublished: TODAY,
        dateModified: TODAY,
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: t.breadcrumbHome, item: `${SITE_URL}${localePrefix}/` },
          { '@type': 'ListItem', position: 2, name: t.breadcrumbGuides, item: `${SITE_URL}${localePrefix}/guides/` },
          { '@type': 'ListItem', position: 3, name: t.breadcrumbPreferential, item: `${SITE_URL}${localePrefix}/guides/preferential-origin/` },
          { '@type': 'ListItem', position: 4, name: regime.name, item: canonical },
        ],
      },
    ],
  });

  const hreflangAlternates = ['en', 'pl', 'de'].map(loc => ({
    lang: loc,
    href: `${SITE_URL}${loc === 'en' ? '' : `/${loc}`}/guides/preferential-origin/${regime.slug}/`,
  })).concat([{ lang: 'x-default', href: `${SITE_URL}/guides/preferential-origin/${regime.slug}/` }]);

  return {
    canonical,
    relPath: `${locale === 'en' ? '' : locale + '/'}guides/preferential-origin/${regime.slug}/index.html`,
    html: pageShell({ locale, title, description, canonical, jsonLd, body, hreflangAlternates }),
    hreflangAlternates,
  };
}

function generatePivotPage(pivot, locale) {
  const t = STRINGS[locale];
  const regime = REGIMES.find(r => r.slug === pivot.regime);
  if (!regime) throw new Error(`No regime ${pivot.regime} for pivot ${pivot.code}`);
  const originLower = pivot.code.toLowerCase();
  const localePrefix = locale === 'en' ? '' : `/${locale}`;
  const canonical = `${SITE_URL}${localePrefix}/guides/preferential-origin/from-${originLower}/`;
  const title = `${t.titlePivot(pivot.code, regime)} ${t.metaSiteSuffix}`;
  const description = t.metaDescPivot(pivot.code, regime);

  // Override the regime's sample with the pivot's sample so the example
  // matches the page's framing.
  const pivotRegime = { ...regime, sampleHsCode: pivot.sampleHsCode, sampleCategory: pivot.sampleCategory, sampleOrigin: pivot.code };
  const example = buildExampleData(pivotRegime, locale);

  const breadcrumbs = `<div class="breadcrumbs">
    <a href="${localePrefix}/">${t.breadcrumbHome}</a> /
    <a href="${localePrefix}/guides/">${t.breadcrumbGuides}</a> /
    <a href="${localePrefix}/guides/preferential-origin/">${t.breadcrumbPreferential}</a>
  </div>`;

  const exampleTable = example ? `
    <table class="example-table">
      <thead>
        <tr><th>${t.exampleColScenario}</th><th>${t.exampleColDuty}</th><th>${t.exampleColDutyEur}</th></tr>
      </thead>
      <tbody>
        <tr><td>${t.exampleScenarioMfn(regime.code)}</td><td>${example.mfnRatePct.toFixed(1)}%</td><td>${fmtEur(example.dutyEurNoPref)}</td></tr>
        <tr><td>${t.exampleScenarioPref(regime.code)}</td><td>${example.dutyRatePctWithPref.toFixed(1)}%</td><td>${fmtEur(example.dutyEurWithPref)}</td></tr>
        <tr class="saving"><td>Saving</td><td>—</td><td>${fmtEur(example.savingEur)}</td></tr>
      </tbody>
    </table>
  ` : '';

  const ctaUrl = wizardShareUrl(pivotRegime, locale);

  const body = `
    ${breadcrumbs}
    <p class="kicker">${t.pivotHeaderKicker(pivot.code)}</p>
    <h1>${escapeHtml(t.titlePivot(pivot.code, regime))}</h1>

    <h2>${t.sectionHowItWorks}</h2>
    <p>${t.sectionHowItWorksRegime(regime)}</p>

    <h2>${t.sectionDocument}</h2>
    <div class="doc-callout"><p>${t.sectionDocumentBody(regime)}</p></div>

    <h2>${t.sectionExample}</h2>
    <p>${t.sectionExampleBody(example, regime)}</p>
    ${exampleTable}

    <h2>${t.sectionWarning}</h2>
    <div class="warn-callout"><p>${t.sectionWarningBody}</p></div>

    <h2>${t.sectionTradeDefence}</h2>
    <div class="td-callout"><p>${t.sectionTradeDefenceBody}</p></div>

    <div class="cta-block">
      <h3>${t.ctaTitle}</h3>
      <p>${t.ctaBody}</p>
      <a class="cta-btn" href="${ctaUrl}">${t.ctaButton}</a>
    </div>

    <p class="as-of-footer">${t.sourceFooter()}</p>
  `;

  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: t.titlePivot(pivot.code, regime),
    description,
    about: { '@type': 'GovernmentService', name: regime.name, jurisdiction: 'European Union' },
    author: { '@type': 'Organization', name: 'OrcaTrade Group' },
    datePublished: TODAY,
    dateModified: TODAY,
  });

  const hreflangAlternates = ['en', 'pl', 'de'].map(loc => ({
    lang: loc,
    href: `${SITE_URL}${loc === 'en' ? '' : `/${loc}`}/guides/preferential-origin/from-${originLower}/`,
  })).concat([{ lang: 'x-default', href: `${SITE_URL}/guides/preferential-origin/from-${originLower}/` }]);

  return {
    canonical,
    relPath: `${locale === 'en' ? '' : locale + '/'}guides/preferential-origin/from-${originLower}/index.html`,
    html: pageShell({ locale, title, description, canonical, jsonLd, body, hreflangAlternates }),
    hreflangAlternates,
  };
}

function generateIndexPage(locale) {
  const t = STRINGS[locale];
  const localePrefix = locale === 'en' ? '' : `/${locale}`;
  const canonical = `${SITE_URL}${localePrefix}/guides/preferential-origin/`;

  const breadcrumbs = `<div class="breadcrumbs">
    <a href="${localePrefix}/">${t.breadcrumbHome}</a> /
    <a href="${localePrefix}/guides/">${t.breadcrumbGuides}</a> /
    ${t.breadcrumbPreferential}
  </div>`;

  const regimeRows = REGIMES.map(r => {
    const scope = r.primaryOrigins.slice(0, 5).map(c => ORIGIN_NAMES[c] || c).join(', ');
    return `<tr>
      <td><a href="${localePrefix}/guides/preferential-origin/${r.slug}/">${escapeHtml(r.name)}</a></td>
      <td>${escapeHtml(scope)}</td>
      <td><code>${escapeHtml(documentShort(r.document))}</code></td>
    </tr>`;
  }).join('\n');

  const pivotRows = ORIGIN_PIVOTS.map(p => {
    const regime = REGIMES.find(r => r.slug === p.regime);
    return `<tr>
      <td><a href="${localePrefix}/guides/preferential-origin/from-${p.code.toLowerCase()}/">${escapeHtml(ORIGIN_NAMES[p.code] || p.code)}</a></td>
      <td>${escapeHtml(regime.name)}</td>
      <td><code>${escapeHtml(documentShort(regime.document))}</code></td>
    </tr>`;
  }).join('\n');

  const body = `
    ${breadcrumbs}
    <p class="kicker">${t.headerKicker}</p>
    <h1>${t.indexHeadline}</h1>
    <p>${t.indexBody}</p>

    <h2>${t.indexHeadline}</h2>
    <table class="regimes-table">
      <thead>
        <tr><th>${t.indexColRegime}</th><th>${t.indexColScope}</th><th>${t.indexColDocument}</th></tr>
      </thead>
      <tbody>${regimeRows}</tbody>
    </table>

    <h2>${t.indexSubheadingPivots}</h2>
    <table class="regimes-table">
      <thead>
        <tr><th>${t.indexColScope}</th><th>${t.indexColRegime}</th><th>${t.indexColDocument}</th></tr>
      </thead>
      <tbody>${pivotRows}</tbody>
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
    href: `${SITE_URL}${loc === 'en' ? '' : `/${loc}`}/guides/preferential-origin/`,
  })).concat([{ lang: 'x-default', href: `${SITE_URL}/guides/preferential-origin/` }]);

  return {
    canonical,
    relPath: `${locale === 'en' ? '' : locale + '/'}guides/preferential-origin/index.html`,
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

    for (const regime of REGIMES) {
      const page = generateRegimePage(regime, locale);
      fs.mkdirSync(path.dirname(path.join(ROOT, page.relPath)), { recursive: true });
      fs.writeFileSync(path.join(ROOT, page.relPath), page.html, 'utf8');
      generated.push(page);
    }

    for (const pivot of ORIGIN_PIVOTS) {
      const page = generatePivotPage(pivot, locale);
      fs.mkdirSync(path.dirname(path.join(ROOT, page.relPath)), { recursive: true });
      fs.writeFileSync(path.join(ROOT, page.relPath), page.html, 'utf8');
      generated.push(page);
    }
  }
  return generated;
}

if (require.main === module) {
  const generated = build();
  console.log(`Generated ${generated.length} preferential-origin pages.`);
}

module.exports = { build, generateRegimePage, generatePivotPage, generateIndexPage, REGIMES, ORIGIN_PIVOTS, STRINGS };
