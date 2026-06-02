// Generate static SEO pages for 8 curated example import plans.
//
// Each example takes a real wizard input set, runs composePlan, then renders
// a static HTML page summarising the key numbers + cross-links to the
// relevant H0 guides. A "Open in the Import Plan Builder" CTA deep-links to
// the wizard with the inputs encoded in the share permalink.
//
// Why this exists:
// - Sales conversations and procurement evaluators need concrete "here is
//   what the wizard produces for a real importer" artefacts.
// - The numbers are calculator-grounded — same composePlan that the live
//   wizard uses — so the examples can never go stale relative to the
//   underlying intelligence.
// - Each page is crawlable (server-rendered HTML), driving SEO traffic to
//   long-tail queries like "Bangladesh apparel EBA zero duty example" or
//   "China e-bike landed cost example".
//
// Output: 8 detail pages × 3 locales + 1 index per locale = 27 pages.

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SITE_URL = 'https://orcatrade.pl';
const TODAY = new Date().toISOString().slice(0, 10);

const { composePlan } = require('../lib/handlers/start');
const { encodeInputs } = require('../lib/utils/plan-codec');

// ── Helpers ────────────────────────────────────────────

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function fmtEur(amount) {
  if (amount == null || !Number.isFinite(Number(amount))) return '€0';
  return '€' + Math.round(Number(amount)).toLocaleString('en-IE');
}

function wizardPermalink(inputs, locale) {
  const encoded = encodeInputs(inputs);
  const wizardPath = locale === 'en' ? '/start/' : `/${locale}/start/`;
  return `${wizardPath}?p=${encoded}`;
}

// ── 8 curated examples ────────────────────────────────

const EXAMPLES = [
  {
    slug: 'polish-apparel-importer-from-china',
    inputs: {
      productCategory: 'apparel',
      originCountry: 'CN',
      destinationCountry: 'PL',
      customsValueEur: 25000,
      weightKg: 800,
      linesCount: 4,
      shipmentsPerYear: 12,
      monthlyOrders: 500,
    },
    headlines: {
      en: 'Polish e-commerce importing apparel from China — €25k shipment landed cost breakdown',
      pl: 'Polski sklep e-commerce importujący odzież z Chin — rozbicie kosztu landed €25 tys.',
      de: 'Polnischer E-Commerce-Importeur von Bekleidung aus China — €25.000 Sendung landed cost',
    },
    intros: {
      en: 'A Polish e-commerce founder ordering 800 kg of cotton apparel monthly from a Guangzhou supplier. Customs value €25,000 per shipment, 12 shipments/year. The classic SME entry case — no preferential pathway from China, full 12% MFN duty applies, no anti-dumping measures on apparel. The wizard composes the full landed cost and surfaces alternative origins where preferential pathways would save the duty.',
      pl: 'Polski założyciel e-commerce zamawia 800 kg odzieży bawełnianej miesięcznie u dostawcy z Guangzhou. Wartość celna €25 000 na przesyłkę, 12 przesyłek rocznie. Klasyczny przypadek wejścia MŚP — brak ścieżki preferencyjnej z Chin, pełne 12% MFN, brak środków antydumpingowych na odzież. Kreator komponuje pełny landed cost i pokazuje alternatywne pochodzenia, gdzie pochodzenie preferencyjne oszczędziłoby cło.',
      de: 'Ein polnischer E-Commerce-Gründer bestellt monatlich 800 kg Baumwollbekleidung von einem Lieferanten in Guangzhou. Zollwert €25.000 pro Sendung, 12 Sendungen/Jahr. Der klassische KMU-Einstiegsfall — kein Präferenzpfad aus China, voller 12% MFN-Zoll gilt, keine Antidumpingmaßnahmen auf Bekleidung. Der Wizard erstellt die vollständige Landed Cost und zeigt alternative Ursprungsländer auf, wo der Präferenzursprung den Zoll sparen würde.',
    },
    tags: ['apparel', 'CN→PL', 'no preferential', '12% MFN'],
  },
  {
    slug: 'bangladesh-apparel-eba-zero-duty',
    inputs: {
      productCategory: 'apparel',
      originCountry: 'BD',
      destinationCountry: 'PL',
      customsValueEur: 50000,
      weightKg: 1500,
      linesCount: 4,
      claimPreferential: true,
      shipmentsPerYear: 12,
      monthlyOrders: 800,
    },
    headlines: {
      en: 'Bangladesh apparel under EBA — zero EU duty with valid REX statement',
      pl: 'Odzież z Bangladeszu w ramach EBA — zerowe cło UE z ważnym REX',
      de: 'Bekleidung aus Bangladesch unter EBA — null EU-Zoll mit gültigem REX',
    },
    intros: {
      en: 'A Polish brand sourcing 1.5t of woven cotton apparel monthly from Dhaka. Bangladesh is an LDC under "Everything But Arms" — the supplier registers with REX and issues a Statement on Origin. The wizard shows the duty drop from 12% MFN to 0% (€6,000 saving per €50,000 shipment). Bangladesh graduates from LDC status in 2026 with a 3-year transitional period; EBA continues until 2029.',
      pl: 'Polska marka zaopatruje się w 1,5 t tkanej odzieży bawełnianej miesięcznie z Dhaki. Bangladesz to LDC objęty "Everything But Arms" — dostawca rejestruje się w REX i wystawia Oświadczenie o pochodzeniu. Kreator pokazuje spadek cła z 12% MFN do 0% (oszczędność €6 000 na przesyłce €50 000). Bangladesz wychodzi ze statusu LDC w 2026 z 3-letnim okresem przejściowym; EBA kontynuowane do 2029.',
      de: 'Eine polnische Marke bezieht monatlich 1,5 t gewebte Baumwollbekleidung aus Dhaka. Bangladesch ist als LDC unter "Everything But Arms" — der Lieferant registriert sich bei REX und stellt eine Origin-Erklärung aus. Der Wizard zeigt den Zollabfall von 12% MFN auf 0% (Ersparnis €6.000 pro €50.000-Sendung). Bangladesch verlässt 2026 den LDC-Status mit einer 3-jährigen Übergangsphase; EBA läuft bis 2029.',
    },
    tags: ['apparel', 'BD→PL', 'EBA preferential', '€6k saving'],
  },
  {
    slug: 'vietnam-electronics-evfta-zero-duty',
    inputs: {
      productCategory: 'electronics',
      originCountry: 'VN',
      destinationCountry: 'DE',
      customsValueEur: 50000,
      weightKg: 200,
      linesCount: 2,
      claimPreferential: true,
      shipmentsPerYear: 6,
      monthlyOrders: 200,
    },
    headlines: {
      en: 'Vietnam consumer electronics under EVFTA — zero duty + RoHS/WEEE/CE compliance stack',
      pl: 'Elektronika konsumencka z Wietnamu w ramach EVFTA — zerowe cło + stos zgodności RoHS/WEEE/CE',
      de: 'Konsumelektronik aus Vietnam unter EVFTA — null Zoll + RoHS/WEEE/CE-Compliance-Stack',
    },
    intros: {
      en: 'A German importer sourcing 200 kg of bluetooth speakers from a Hanoi supplier. EU-Vietnam FTA gives zero duty with a REX origin declaration on the invoice. But the goods enter chapters 85, triggering CE LVD/EMC/RED + RoHS + WEEE producer registration. The wizard surfaces all four compliance regimes with importer obligations alongside the duty saving.',
      pl: 'Niemiecki importer zaopatruje się w 200 kg głośników bluetooth od dostawcy z Hanoi. EVFTA daje zerowe cło z deklaracją pochodzenia REX na fakturze. Ale towary należą do działu 85, co uruchamia CE LVD/EMC/RED + RoHS + rejestrację producenta WEEE. Kreator pokazuje wszystkie cztery reżimy zgodności z obowiązkami importera obok oszczędności cła.',
      de: 'Ein deutscher Importeur bezieht 200 kg Bluetooth-Lautsprecher von einem Lieferanten in Hanoi. Das EU-Vietnam-FTA gewährt null Zoll mit einer REX-Ursprungserklärung auf der Rechnung. Doch die Ware fällt in Kapitel 85, was CE LVD/EMC/RED + RoHS + WEEE-Herstellerregistrierung auslöst. Der Wizard zeigt alle vier Compliance-Regime mit Importeur-Pflichten neben der Zollersparnis.',
    },
    tags: ['electronics', 'VN→DE', 'EVFTA', 'CE+RoHS+WEEE'],
  },
  {
    slug: 'chinese-ebike-importer-87pct-combined-ad-cvd',
    inputs: {
      productCategory: 'machinery',
      originCountry: 'CN',
      destinationCountry: 'PL',
      customsValueEur: 100000,
      weightKg: 1500,
      hsCode: '8711.60',
      linesCount: 1,
      shipmentsPerYear: 6,
    },
    headlines: {
      en: 'Chinese e-bike importer hit by 87% combined AD+CVD — full landed cost analysis',
      pl: 'Importer e-bike z Chin obciążony 87% połączonego AD+CVD — pełna analiza landed cost',
      de: 'Chinesischer E-Bike-Importeur mit 87% kombiniertem AD+CVD — vollständige Landed-Cost-Analyse',
    },
    intros: {
      en: 'A Polish reseller importing pedal-assist e-bikes from a Shenzhen supplier, €100,000 customs value per shipment. The wizard surfaces both EU measures: AD 70.1% (Reg. 2019/73) plus CVD 17.2% (Reg. 2019/72) — a combined 87.3% on top of the 10% MFN. €97,300 of duty per €100,000 shipment, before VAT. Importers who plan against MFN-only numbers go bankrupt at the port. The matrix shows VN as a viable alternative origin under EVFTA at 0%.',
      pl: 'Polski reseller importuje rowery elektryczne ze wspomaganiem od dostawcy z Shenzhen, wartość celna €100 000 na przesyłkę. Kreator pokazuje oba środki UE: AD 70,1% (Reg. 2019/73) plus CVD 17,2% (Reg. 2019/72) — łącznie 87,3% nad 10% MFN. €97 300 cła na €100 000 przesyłki, przed VAT. Importerzy planujący tylko na MFN bankrutują w porcie. Macierz pokazuje VN jako realną alternatywę w ramach EVFTA przy 0%.',
      de: 'Ein polnischer Wiederverkäufer importiert Pedelec-E-Bikes von einem Lieferanten in Shenzhen, Zollwert €100.000 pro Sendung. Der Wizard zeigt beide EU-Maßnahmen: AD 70,1% (Verord. 2019/73) plus CVD 17,2% (Verord. 2019/72) — kombiniert 87,3% zusätzlich zum 10% MFN. €97.300 Zoll pro €100.000-Sendung, vor EUSt. Importeure, die mit MFN-Zahlen planen, gehen am Hafen pleite. Die Matrix zeigt VN als gangbare Alternative unter EVFTA bei 0%.',
    },
    tags: ['e-bikes', 'CN→PL', 'AD+CVD', '€97k duty'],
  },
  {
    slug: 'cn-aluminium-cbam-plus-32pct-ad',
    inputs: {
      productCategory: 'machinery',
      originCountry: 'CN',
      destinationCountry: 'DE',
      customsValueEur: 75000,
      weightKg: 5000,
      hsCode: '7610.10',
      linesCount: 2,
      shipmentsPerYear: 8,
    },
    headlines: {
      en: 'Aluminium extrusions from China — CBAM declarant status + 32% anti-dumping duty',
      pl: 'Aluminiowe profile wyciskane z Chin — status zgłaszającego CBAM + 32% cło antydumpingowe',
      de: 'Aluminium-Strangpressteile aus China — CBAM-Anmelder-Status + 32% Antidumpingzoll',
    },
    intros: {
      en: 'A German window-frame fabricator sourcing aluminium extrusions from a Foshan supplier, €75,000 per shipment. Two stacked obligations: 32% AD duty (Reg. 2021/546) on top of 6% MFN, AND CBAM declarant status (active definitive period from Jan 2026). Importer must register as authorised CBAM declarant, file annual emissions declaration, and from 2026 buy CBAM certificates priced against EU ETS settlement. The wizard quantifies both.',
      pl: 'Niemiecki producent ram okiennych zaopatruje się w profile aluminiowe od dostawcy z Foshan, €75 000 na przesyłkę. Dwa nakładające się obowiązki: 32% cło AD (Reg. 2021/546) nad 6% MFN ORAZ status zgłaszającego CBAM (aktywny okres ostateczny od stycznia 2026). Importer musi zarejestrować się jako uprawniony zgłaszający CBAM, składać roczną deklarację emisji, a od 2026 kupować świadectwa CBAM po cenie rozliczenia EU ETS. Kreator kwantyfikuje oba.',
      de: 'Ein deutscher Fensterrahmen-Hersteller bezieht Aluminium-Strangpressteile von einem Lieferanten in Foshan, €75.000 pro Sendung. Zwei gestapelte Pflichten: 32% AD-Zoll (Verord. 2021/546) zusätzlich zu 6% MFN UND CBAM-Anmelder-Status (aktiver definitiver Zeitraum seit Januar 2026). Der Importeur muss sich als berechtigter CBAM-Anmelder registrieren, jährliche Emissionserklärung einreichen und ab 2026 CBAM-Zertifikate zum EU-ETS-Abrechnungspreis kaufen. Der Wizard quantifiziert beides.',
    },
    tags: ['aluminium', 'CN→DE', 'AD+CBAM', '€24k duty'],
  },
  {
    slug: 'turkey-cold-rolled-steel-atr-with-ad',
    inputs: {
      productCategory: 'machinery',
      originCountry: 'TR',
      destinationCountry: 'DE',
      customsValueEur: 100000,
      weightKg: 8000,
      hsCode: '7209.16',
      linesCount: 2,
      claimPreferential: true,
      shipmentsPerYear: 12,
    },
    headlines: {
      en: 'Türkiye cold-rolled steel — A.TR Customs Union does NOT waive 23.3% anti-dumping',
      pl: 'Stal walcowana na zimno z Turcji — A.TR Unia Celna NIE znosi 23,3% antydumpingu',
      de: 'Kaltgewalzter Stahl aus der Türkei — A.TR-Zollunion hebt 23,3% Antidumping NICHT auf',
    },
    intros: {
      en: 'A common procurement misconception: importers assume A.TR Customs Union means zero duty on Turkish industrial goods. True for MFN — but trade defence overrides preferential origin. Reg. 2022/802 imposes 23.3% AD on TR cold-rolled steel. With A.TR, MFN drops from 7% to 0%, but the 23.3% AD applies on top. Importers who plan against "0% under A.TR" without checking TARIC for AD measures discover the cost at clearance.',
      pl: 'Częste nieporozumienie zakupowe: importerzy zakładają, że Unia Celna A.TR oznacza zerowe cło na tureckie towary przemysłowe. Prawda dla MFN — ale środki ochrony handlu mają pierwszeństwo nad pochodzeniem preferencyjnym. Reg. 2022/802 nakłada 23,3% AD na stal walcowaną na zimno z TR. Z A.TR MFN spada z 7% na 0%, ale 23,3% AD nadal obowiązuje. Importerzy planujący na "0% w ramach A.TR" bez sprawdzania TARIC odkrywają koszt przy odprawie.',
      de: 'Ein häufiges Beschaffungs-Missverständnis: Importeure nehmen an, A.TR-Zollunion bedeute null Zoll auf türkische Industriegüter. Stimmt für MFN — aber Handelsschutz hat Vorrang vor Präferenzursprung. Verord. 2022/802 erlegt 23,3% AD auf TR-Kaltwalzstahl. Mit A.TR sinkt MFN von 7% auf 0%, aber 23,3% AD gilt zusätzlich. Importeure, die mit "0% unter A.TR" planen, ohne TARIC zu prüfen, entdecken die Kosten bei der Abfertigung.',
    },
    tags: ['steel', 'TR→DE', 'A.TR + AD', 'overlap nuance'],
  },
  {
    slug: 'cosmetics-india-reach-cosmetics-regulation',
    inputs: {
      productCategory: 'cosmetics',
      originCountry: 'IN',
      destinationCountry: 'DE',
      customsValueEur: 30000,
      weightKg: 600,
      hsCode: '3304.99',
      linesCount: 6,
      claimPreferential: true,
      shipmentsPerYear: 6,
    },
    headlines: {
      en: 'Cosmetics from India — Responsible Person, CPNP notification, REACH SVHC + GSP standard',
      pl: 'Kosmetyki z Indii — Responsible Person, zgłoszenie CPNP, REACH SVHC + GSP standard',
      de: 'Kosmetik aus Indien — Verantwortliche Person, CPNP-Notifizierung, REACH SVHC + GSP standard',
    },
    intros: {
      en: 'An importer bringing a face-care line from a Mumbai supplier, €30,000 per shipment. Cosmetics chapter 33 triggers Cosmetics Regulation 1223/2009: every product needs an EU Responsible Person, a Product Information File, and CPNP notification before market placement. REACH applies for SVHC checks. India\'s GSP standard provides ~30% duty reduction (no zero-rate). The compliance overlay alone often delays the first shipment 3–6 months.',
      pl: 'Importer wprowadza linię pielęgnacji twarzy od dostawcy z Mumbaju, €30 000 na przesyłkę. Kosmetyki dział 33 uruchamiają Rozporządzenie Kosmetyczne 1223/2009: każdy produkt potrzebuje Responsible Person UE, Dossier Produktu i zgłoszenia CPNP przed wprowadzeniem na rynek. REACH stosuje się do kontroli SVHC. GSP standard Indii daje ~30% redukcji cła (bez zerowej stawki). Sama warstwa zgodności często opóźnia pierwszą przesyłkę o 3–6 miesięcy.',
      de: 'Ein Importeur bringt eine Gesichtspflegelinie von einem Lieferanten in Mumbai, €30.000 pro Sendung. Kosmetik Kapitel 33 löst die Kosmetikverordnung 1223/2009 aus: jedes Produkt benötigt eine EU-Verantwortliche Person, ein Produktinformations-Dossier und eine CPNP-Notifizierung vor Marktzulassung. REACH gilt für SVHC-Prüfungen. Indiens GSP-Standard gewährt ~30% Zollreduktion (keine Nullrate). Die Compliance-Überlagerung allein verzögert die Erstsendung oft 3–6 Monate.',
    },
    tags: ['cosmetics', 'IN→DE', 'GSP + Cosmetics + REACH'],
  },
  {
    slug: 'south-korea-machinery-eukfta-zero-duty',
    inputs: {
      productCategory: 'machinery',
      originCountry: 'KR',
      destinationCountry: 'PL',
      customsValueEur: 80000,
      weightKg: 4000,
      hsCode: '8479.89',
      linesCount: 1,
      claimPreferential: true,
      shipmentsPerYear: 4,
    },
    headlines: {
      en: 'South Korean machinery via EUKFTA — zero duty + CE Machinery Regulation 2023/1230',
      pl: 'Maszyny z Korei Południowej w ramach EUKFTA — zerowe cło + Rozporządzenie Maszyny CE 2023/1230',
      de: 'Maschinen aus Südkorea unter EUKFTA — null Zoll + CE-Maschinenverordnung 2023/1230',
    },
    intros: {
      en: 'A Polish manufacturer importing specialised industrial machinery from a Busan supplier, €80,000 per machine, quarterly shipments. EUKFTA in force since 2011 — full 0% on industrial goods with origin declaration on invoice (REX, no minimum value). The CE Machinery Regulation 2023/1230 obligation: Declaration of Conformity, technical file retained for 10 years, Annex IV machinery requires notified-body certification. Clean FTA path with disciplined compliance.',
      pl: 'Polski producent importuje specjalistyczne maszyny przemysłowe od dostawcy z Busan, €80 000 za maszynę, kwartalne przesyłki. EUKFTA obowiązuje od 2011 — pełne 0% na towary przemysłowe z deklaracją pochodzenia na fakturze (REX, bez minimum). Obowiązek Rozporządzenia Maszyny CE 2023/1230: Deklaracja Zgodności, dokumentacja techniczna przez 10 lat, maszyny z Aneksu IV wymagają certyfikacji jednostki notyfikowanej. Czysta ścieżka FTA z dyscyplinowaną zgodnością.',
      de: 'Ein polnischer Hersteller importiert spezialisierte Industriemaschinen von einem Lieferanten in Busan, €80.000 pro Maschine, vierteljährliche Sendungen. EUKFTA in Kraft seit 2011 — volle 0% auf Industriegüter mit Ursprungserklärung auf der Rechnung (REX, kein Mindestwert). Die CE-Maschinenverordnung 2023/1230-Pflicht: Konformitätserklärung, technische Akte 10 Jahre aufbewahren, Anhang-IV-Maschinen erfordern Notified-Body-Zertifizierung. Sauberer FTA-Pfad mit disziplinierter Compliance.',
    },
    tags: ['machinery', 'KR→PL', 'EUKFTA', 'CE Machinery'],
  },
];

// ── i18n ───────────────────────────────────────────────

const STRINGS = {
  en: {
    breadcrumbHome: 'Home', breadcrumbExamples: 'Examples',
    headerKicker: 'Worked example · live calculator',
    statDuty: 'Duty %', statDutyEur: 'Duty per shipment',
    statLanded: 'Landed cost / shipment', statAnnual: 'Annual landed cost (×12)',
    statSavingPref: 'Saving via preferential', statRegimes: 'Compliance regimes triggered',
    secNumbers: 'The numbers',
    secAnalysis: 'What the wizard surfaces',
    bulletAd: (count, top) => count > 0
      ? `${count} active EU trade-defence measure${count > 1 ? 's' : ''} on this HS code + origin (top: ${top.type} ${top.rateTypicalPct}% on ${top.description}, ${top.citation}).`
      : 'No active EU trade-defence measures on this HS code + origin.',
    bulletPref: (regime) => regime
      ? `Preferential origin: ${regime.name}. Required document: ${regime.document}.`
      : 'No preferential origin pathway from this country with the EU.',
    bulletCompliance: (count, top) => count > 0
      ? `${count} EU regulatory regime${count > 1 ? 's' : ''} applicable (top severity: ${top.name}).`
      : 'No high-severity compliance regimes triggered for this category.',
    bulletFx: 'Customs value is in EUR. Add a quoteCurrency in the wizard to surface FX risk on supplier payments.',
    bulletTco: (annual, ccc) => `Annual landed cost ≈ ${annual}. Cash conversion cycle ≈ ${ccc} days at default 60d inventory + supplier terms.`,
    secCta: 'Open the full plan in the wizard',
    secCtaBody: 'Every number above came from the same await composePlan() output that powers the live wizard. Click below to open this exact scenario in the Import Plan Builder — fully interactive, with sensitivity analysis, share permalinks, and PDF export.',
    ctaButton: 'Open this plan in the wizard →',
    secAlternatives: 'Try a related example',
    indexTitle: 'Worked import-plan examples — calculator-grounded scenarios',
    indexDescription: 'Eight curated import scenarios (apparel, electronics, machinery, cosmetics, e-bikes, steel, aluminium) showing landed cost, trade defence, preferential origin, and compliance overlay computed from the same calculators that power the OrcaTrade wizard.',
    indexHeadline: 'Worked examples — eight real import scenarios',
    indexBody: 'Each example is generated from the same calculators the live wizard uses. Click any one to see the full plan or open it directly in the Import Plan Builder.',
    sourceFooter: () => `Snapshot ${TODAY}. Numbers regenerate when the underlying calculators update.`,
  },
  pl: {
    breadcrumbHome: 'Strona główna', breadcrumbExamples: 'Przykłady',
    headerKicker: 'Przykład · żywy kalkulator',
    statDuty: 'Cło %', statDutyEur: 'Cło na przesyłkę',
    statLanded: 'Landed cost / przesyłkę', statAnnual: 'Roczny landed (×12)',
    statSavingPref: 'Oszczędność preferencyjna', statRegimes: 'Reżimy zgodności',
    secNumbers: 'Liczby',
    secAnalysis: 'Co pokazuje kreator',
    bulletAd: (count, top) => count > 0
      ? `${count} aktywn${count > 1 ? 'e środki' : 'y środek'} ochrony handlu UE na tym kodzie HS + pochodzeniu (najwyższy: ${top.type} ${top.rateTypicalPct}% na ${top.description}, ${top.citation}).`
      : 'Brak aktywnych środków ochrony handlu UE na tym kodzie HS + pochodzeniu.',
    bulletPref: (regime) => regime
      ? `Pochodzenie preferencyjne: ${regime.name}. Wymagany dokument: ${regime.document}.`
      : 'Brak ścieżki preferencyjnego pochodzenia z tego kraju z UE.',
    bulletCompliance: (count, top) => count > 0
      ? `${count} reżim${count > 1 ? 'y' : ''} regulacyjnych UE ma zastosowanie (najwyższy priorytet: ${top.name}).`
      : 'Brak reżimów zgodności o wysokim priorytecie dla tej kategorii.',
    bulletFx: 'Wartość celna w EUR. Dodaj quoteCurrency w kreatorze, aby zobaczyć ryzyko FX dla płatności do dostawcy.',
    bulletTco: (annual, ccc) => `Roczny landed cost ≈ ${annual}. Cykl konwersji gotówki ≈ ${ccc} dni przy domyślnych 60 dniach magazynu i terminach dostawcy.`,
    secCta: 'Otwórz pełny plan w kreatorze',
    secCtaBody: 'Każda liczba powyżej pochodzi z tego samego wyjścia await composePlan(), które zasila kreator. Kliknij poniżej, aby otworzyć ten dokładny scenariusz w Import Plan Builder — w pełni interaktywny, z analizą wrażliwości, linkami współdzielenia i eksportem PDF.',
    ctaButton: 'Otwórz ten plan w kreatorze →',
    secAlternatives: 'Wypróbuj powiązany przykład',
    indexTitle: 'Przykłady planów importu — scenariusze oparte na kalkulatorach',
    indexDescription: 'Osiem wybranych scenariuszy importu (odzież, elektronika, maszyny, kosmetyki, e-bike, stal, aluminium) pokazujących landed cost, środki ochrony handlu, pochodzenie preferencyjne i nakładkę zgodności obliczone z tych samych kalkulatorów, które zasilają kreator OrcaTrade.',
    indexHeadline: 'Przykłady — osiem rzeczywistych scenariuszy importu',
    indexBody: 'Każdy przykład jest wygenerowany z tych samych kalkulatorów, których używa żywy kreator. Kliknij dowolny, aby zobaczyć pełny plan lub otworzyć go bezpośrednio w Import Plan Builder.',
    sourceFooter: () => `Snapshot ${TODAY}. Liczby regenerują się, gdy zaktualizowane zostaną kalkulatory.`,
  },
  de: {
    breadcrumbHome: 'Startseite', breadcrumbExamples: 'Beispiele',
    headerKicker: 'Berechnungsbeispiel · live Kalkulator',
    statDuty: 'Zollsatz %', statDutyEur: 'Zoll pro Sendung',
    statLanded: 'Landed Cost / Sendung', statAnnual: 'Jährlich Landed (×12)',
    statSavingPref: 'Präferenz-Ersparnis', statRegimes: 'Compliance-Regime',
    secNumbers: 'Die Zahlen',
    secAnalysis: 'Was der Wizard zeigt',
    bulletAd: (count, top) => count > 0
      ? `${count} aktive EU-Handelsschutzmaßnahme${count > 1 ? 'n' : ''} auf diesem HS-Code + Ursprung (Spitze: ${top.type} ${top.rateTypicalPct}% auf ${top.description}, ${top.citation}).`
      : 'Keine aktiven EU-Handelsschutzmaßnahmen auf diesem HS-Code + Ursprung.',
    bulletPref: (regime) => regime
      ? `Präferenzursprung: ${regime.name}. Erforderliches Dokument: ${regime.document}.`
      : 'Kein Präferenzursprungs-Pfad aus diesem Land mit der EU.',
    bulletCompliance: (count, top) => count > 0
      ? `${count} EU-Regulierungsregime${count > 1 ? '' : ''} betroffen (höchste Priorität: ${top.name}).`
      : 'Keine Compliance-Regime mit hoher Priorität für diese Kategorie ausgelöst.',
    bulletFx: 'Zollwert in EUR. Geben Sie quoteCurrency im Wizard an, um FX-Risiko auf Lieferantenzahlungen zu sehen.',
    bulletTco: (annual, ccc) => `Jährliche Landed Cost ≈ ${annual}. Cash-Conversion-Cycle ≈ ${ccc} Tage bei Standard 60d Lager + Lieferantenkonditionen.`,
    secCta: 'Vollständigen Plan im Wizard öffnen',
    secCtaBody: 'Jede Zahl oben stammt aus derselben await composePlan()-Ausgabe, die den Live-Wizard antreibt. Klicken Sie unten, um genau dieses Szenario im Import Plan Builder zu öffnen — vollständig interaktiv, mit Sensitivitätsanalyse, Share-Permalinks und PDF-Export.',
    ctaButton: 'Diesen Plan im Wizard öffnen →',
    secAlternatives: 'Verwandtes Beispiel ausprobieren',
    indexTitle: 'Importplan-Berechnungsbeispiele — Kalkulator-basierte Szenarien',
    indexDescription: 'Acht kuratierte Importszenarien (Bekleidung, Elektronik, Maschinen, Kosmetik, E-Bikes, Stahl, Aluminium), die Landed Cost, Handelsschutz, Präferenzursprung und Compliance-Überlagerung zeigen, berechnet aus denselben Kalkulatoren, die den OrcaTrade-Wizard antreiben.',
    indexHeadline: 'Berechnungsbeispiele — acht echte Importszenarien',
    indexBody: 'Jedes Beispiel wird aus denselben Kalkulatoren generiert, die der Live-Wizard verwendet. Klicken Sie auf eines, um den vollständigen Plan zu sehen oder direkt im Import Plan Builder zu öffnen.',
    sourceFooter: () => `Snapshot ${TODAY}. Zahlen werden bei Kalkulator-Updates neu berechnet.`,
  },
};

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
    .ex-shell { max-width: 880px; margin: 0 auto; padding: 3rem 1.5rem 6rem; position: relative; z-index: 1; }
    .breadcrumbs { font-family: 'Geist Mono', monospace; font-size: 0.74rem; letter-spacing: 0.12em; text-transform: uppercase; color: rgba(255,255,255,0.5); margin-bottom: 1.4rem; }
    .breadcrumbs a { color: rgba(255,255,255,0.7); text-decoration: none; }
    .kicker { font-family: 'Geist Mono', monospace; font-size: 0.72rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.18em; color: rgba(184,168,114,0.95); margin-bottom: 0.8rem; }
    h1 { font-family: 'Cormorant Garant', Georgia, serif; font-size: clamp(1.9rem, 3.5vw + 0.6rem, 2.7rem); font-weight: 600; line-height: 1.15; letter-spacing: -0.02em; color: rgba(255,255,255,0.97); margin-bottom: 1.4rem; }
    h2 { font-family: 'Cormorant Garant', Georgia, serif; font-size: 1.4rem; font-weight: 600; color: rgba(255,255,255,0.95); margin: 2.4rem 0 0.8rem; }
    p { font-size: 0.98rem; line-height: 1.7; color: rgba(255,255,255,0.82); margin-bottom: 1em; max-width: 70ch; }
    .ex-tags { display: flex; gap: 0.4rem; flex-wrap: wrap; margin-bottom: 1rem; }
    .ex-tags .tag { font-family: 'Geist Mono', monospace; font-size: 0.66rem; letter-spacing: 0.14em; text-transform: uppercase; padding: 0.18rem 0.55rem; background: rgba(184,190,200,0.08); color: rgba(184,190,200,0.85); border-radius: 1px; }
    .ex-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1px; background: rgba(255,255,255,0.07); border: 1px solid rgba(255,255,255,0.07); margin: 1.5rem 0; }
    @media (max-width: 700px) { .ex-stats { grid-template-columns: repeat(2, 1fr); } }
    .ex-stat { background: #0d0f14; padding: 1rem 1.2rem; }
    .ex-stat .num { font-family: 'Cormorant Garant', serif; font-size: 1.4rem; font-weight: 700; color: rgba(255,255,255,0.97); line-height: 1; letter-spacing: -0.02em; }
    .ex-stat .label { font-family: 'Geist Mono', monospace; font-size: 0.66rem; letter-spacing: 0.14em; text-transform: uppercase; color: rgba(255,255,255,0.5); margin-top: 0.4rem; }
    .ex-bullets { list-style: none; padding: 0; margin: 1.2rem 0; display: grid; gap: 0.6rem; }
    .ex-bullets li { padding: 0.7rem 1rem; background: rgba(255,255,255,0.03); border-left: 2px solid rgba(184,190,200,0.4); font-size: 0.92rem; line-height: 1.55; color: rgba(255,255,255,0.82); }
    .cta-block { margin: 2.5rem 0 1rem; padding: 1.6rem 1.8rem; background: linear-gradient(135deg, rgba(184,168,114,0.08), rgba(184,190,200,0.03)); border: 1px solid rgba(200, 168, 90, 0.3); text-align: center; }
    .cta-block h3 { font-family: 'Cormorant Garant', Georgia, serif; font-size: 1.3rem; font-weight: 600; color: rgba(255,255,255,0.97); margin: 0 0 0.5rem; }
    .cta-block p { font-size: 0.92rem; color: rgba(255,255,255,0.75); max-width: 56ch; margin: 0 auto 1rem; }
    .cta-block a.cta-btn { display: inline-block; padding: 0.85rem 1.5rem; background: var(--accent-color, #b8bec8); color: #0a0912; font-size: 0.78rem; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; text-decoration: none; }
    .other-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.6rem; margin-top: 1rem; }
    @media (max-width: 700px) { .other-grid { grid-template-columns: 1fr; } }
    .other-card { background: rgba(13, 15, 20, 0.5); padding: 0.9rem 1.1rem; border: 1px solid rgba(255,255,255,0.07); text-decoration: none; }
    .other-card:hover { border-color: rgba(255,255,255,0.18); }
    .other-card h4 { font-family: 'Cormorant Garant', Georgia, serif; font-size: 1rem; color: rgba(255,255,255,0.95); margin: 0 0 0.3rem; }
    .other-card p { font-size: 0.78rem; color: rgba(255,255,255,0.6); margin: 0; max-width: none; }
    .as-of-footer { font-size: 0.78rem; color: rgba(255,255,255,0.45); margin-top: 3rem; padding-top: 1.4rem; border-top: 1px solid rgba(255,255,255,0.07); font-style: italic; }
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
      <article class="ex-shell">
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

async function generateExamplePage(example, locale) {
  const t = STRINGS[locale];
  const localePrefix = locale === 'en' ? '' : `/${locale}`;
  const canonical = `${SITE_URL}${localePrefix}/examples/${example.slug}/`;
  const title = `${example.headlines[locale]} | OrcaTrade`;
  const description = example.intros[locale].slice(0, 200);

  const plan = await composePlan(example.inputs);
  if (!plan.ok) return null;

  const dutyPct = plan.customs.duty.ratePercent;
  const dutyEur = plan.totals.dutyEur;
  const landed = plan.totals.perShipmentLandedTotal;
  const annualLanded = plan.tco?.main?.annualNetCostWithWarehouse || (landed * (example.inputs.shipmentsPerYear || 12));
  const savingPref = plan.customs?.preferentialSavingEur || 0;
  const regimes = plan.compliance?.regimes || [];
  const tdMeasures = plan.customs?.tradeDefenceMeasures || [];

  const ctaUrl = wizardPermalink(example.inputs, locale);

  // Other examples (excluding current)
  const others = EXAMPLES.filter(e => e.slug !== example.slug).slice(0, 4);
  const othersHtml = others.map(o => `
    <a class="other-card" href="${localePrefix}/examples/${o.slug}/">
      <h4>${escapeHtml(o.headlines[locale])}</h4>
      <p>${o.tags.map(escapeHtml).join(' · ')}</p>
    </a>
  `).join('');

  const breadcrumbs = `<div class="breadcrumbs">
    <a href="${localePrefix}/">${t.breadcrumbHome}</a> /
    <a href="${localePrefix}/examples/">${t.breadcrumbExamples}</a>
  </div>`;

  const tagsHtml = example.tags.map(t2 => `<span class="tag">${escapeHtml(t2)}</span>`).join('');

  const body = `
    ${breadcrumbs}
    <p class="kicker">${t.headerKicker}</p>
    <h1>${escapeHtml(example.headlines[locale])}</h1>
    <div class="ex-tags">${tagsHtml}</div>
    <p>${escapeHtml(example.intros[locale])}</p>

    <h2>${t.secNumbers}</h2>
    <div class="ex-stats">
      <div class="ex-stat"><div class="num">${dutyPct.toFixed(1)}%</div><div class="label">${t.statDuty}</div></div>
      <div class="ex-stat"><div class="num">${fmtEur(dutyEur)}</div><div class="label">${t.statDutyEur}</div></div>
      <div class="ex-stat"><div class="num">${fmtEur(landed)}</div><div class="label">${t.statLanded}</div></div>
      <div class="ex-stat"><div class="num">${fmtEur(annualLanded)}</div><div class="label">${t.statAnnual}</div></div>
      <div class="ex-stat"><div class="num">${savingPref > 0 ? fmtEur(savingPref) : '—'}</div><div class="label">${t.statSavingPref}</div></div>
      <div class="ex-stat"><div class="num">${regimes.length}</div><div class="label">${t.statRegimes}</div></div>
    </div>

    <h2>${t.secAnalysis}</h2>
    <ul class="ex-bullets">
      <li>${t.bulletAd(tdMeasures.length, tdMeasures[0])}</li>
      <li>${t.bulletPref(plan.customs?.preferentialApplied || plan.customs?.preferentialAvailable)}</li>
      <li>${t.bulletCompliance(regimes.length, regimes[0])}</li>
      <li>${t.bulletTco(fmtEur(annualLanded), plan.workingCapital?.ccc ?? 0)}</li>
      <li>${t.bulletFx}</li>
    </ul>

    <div class="cta-block">
      <h3>${t.secCta}</h3>
      <p>${t.secCtaBody}</p>
      <a class="cta-btn" href="${ctaUrl}">${t.ctaButton}</a>
    </div>

    <h2>${t.secAlternatives}</h2>
    <div class="other-grid">${othersHtml}</div>

    <p class="as-of-footer">${t.sourceFooter()}</p>
  `;

  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: example.headlines[locale],
    description,
    author: { '@type': 'Organization', name: 'OrcaTrade Group' },
    datePublished: TODAY,
    dateModified: TODAY,
  });

  const hreflangAlternates = ['en', 'pl', 'de'].map(loc => ({
    lang: loc,
    href: `${SITE_URL}${loc === 'en' ? '' : `/${loc}`}/examples/${example.slug}/`,
  })).concat([{ lang: 'x-default', href: `${SITE_URL}/examples/${example.slug}/` }]);

  return {
    canonical,
    relPath: `${locale === 'en' ? '' : locale + '/'}examples/${example.slug}/index.html`,
    html: pageShell({ locale, title, description, canonical, jsonLd, body, hreflangAlternates }),
    hreflangAlternates,
  };
}

// ── Index page ────────────────────────────────────────

function generateIndexPage(locale) {
  const t = STRINGS[locale];
  const localePrefix = locale === 'en' ? '' : `/${locale}`;
  const canonical = `${SITE_URL}${localePrefix}/examples/`;

  const breadcrumbs = `<div class="breadcrumbs">
    <a href="${localePrefix}/">${t.breadcrumbHome}</a> /
    ${t.breadcrumbExamples}
  </div>`;

  const cards = EXAMPLES.map(e => `
    <a class="other-card" href="${localePrefix}/examples/${e.slug}/">
      <h4>${escapeHtml(e.headlines[locale])}</h4>
      <p>${e.tags.map(escapeHtml).join(' · ')}</p>
    </a>
  `).join('');

  const body = `
    ${breadcrumbs}
    <p class="kicker">${t.headerKicker}</p>
    <h1>${t.indexHeadline}</h1>
    <p>${t.indexBody}</p>
    <div class="other-grid" style="grid-template-columns: 1fr 1fr; margin-top: 1.5rem;">${cards}</div>
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
    href: `${SITE_URL}${loc === 'en' ? '' : `/${loc}`}/examples/`,
  })).concat([{ lang: 'x-default', href: `${SITE_URL}/examples/` }]);

  return {
    canonical,
    relPath: `${locale === 'en' ? '' : locale + '/'}examples/index.html`,
    html: pageShell({
      locale,
      title: `${t.indexTitle} | OrcaTrade`,
      description: t.indexDescription,
      canonical, jsonLd, body, hreflangAlternates,
    }),
    hreflangAlternates,
  };
}

// ── Build ────────────────────────────────────────────

async function build() {
  const generated = [];
  for (const locale of ['en', 'pl', 'de']) {
    // EN /examples/ now serves from marketing-shell. Only emit the
    // per-locale static index for PL and DE (which still own those
    // pages until the marketing-shell port lands). The EN static
    // index used to live at examples/index.html; it's been archived
    // to examples/legacy/index.html.
    if (locale !== 'en') {
      const idx = generateIndexPage(locale);
      fs.mkdirSync(path.dirname(path.join(ROOT, idx.relPath)), { recursive: true });
      fs.writeFileSync(path.join(ROOT, idx.relPath), idx.html, 'utf8');
      generated.push(idx);
    }
    for (const example of EXAMPLES) {
      const page = await generateExamplePage(example, locale);
      if (!page) continue;
      fs.mkdirSync(path.dirname(path.join(ROOT, page.relPath)), { recursive: true });
      fs.writeFileSync(path.join(ROOT, page.relPath), page.html, 'utf8');
      generated.push(page);
    }
  }
  return generated;
}

if (require.main === module) {
  build().then(generated => {
    console.log(`Generated ${generated.length} example-plan pages.`);
  });
}

module.exports = { build, generateExamplePage, generateIndexPage, EXAMPLES, STRINGS };
