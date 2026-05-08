// German translations for the programmatic SEO page generator.
// Sie-form for register; standard German trade vocabulary.

const COUNTRY_DE = {
  CN: 'China',
  VN: 'Vietnam',
  IN: 'Indien',
  BD: 'Bangladesch',
  TR: 'Türkei',
  HK: 'Hongkong',
  // EU destinations
  DE: 'Deutschland',
  PL: 'Polen',
  NL: 'Niederlande',
  FR: 'Frankreich',
  IT: 'Italien',
  ES: 'Spanien',
  AT: 'Österreich',
  BE: 'Belgien',
  CZ: 'Tschechien',
};

const COUNTRY_DE_DATIVE = {
  CN: 'aus China',
  VN: 'aus Vietnam',
  IN: 'aus Indien',
  BD: 'aus Bangladesch',
  TR: 'aus der Türkei',
  HK: 'aus Hongkong',
};

const REGION_DE = {
  'East Asia':         'Ostasien',
  'Southeast Asia':    'Südostasien',
  'South Asia':        'Südasien',
  'Near Europe':       'Nahes Europa',
};

const CATEGORY_DE = {
  apparel:     { label: 'Bekleidung & Textilien', accusative: 'Bekleidung & Textilien', description: 'Strick-, Web- und konfektionierte Bekleidung' },
  electronics: { label: 'Konsumelektronik', accusative: 'Konsumelektronik', description: 'Audio-Geräte, Kleinhaushaltsgeräte, Zubehör' },
  furniture:   { label: 'Möbel & Holzwaren', accusative: 'Möbel', description: 'Massivholz-, Platten-, gepolsterte Möbel' },
  toys:        { label: 'Spielzeug', accusative: 'Spielzeug', description: 'Plüsch, Kunststoff, Holz, elektronisches Spielzeug' },
  cosmetics:   { label: 'Kosmetik & Pflege', accusative: 'Kosmetik', description: 'Hautpflege, Haarpflege, verpackungsorientierte Produkte' },
  homeware:    { label: 'Haushaltswaren & Küche', accusative: 'Haushaltswaren', description: 'Küchengeräte, Glaswaren, Keramik, Wohnaccessoires' },
  footwear:    { label: 'Schuhwaren', accusative: 'Schuhwaren', description: 'Leder, Sport, Casual, technische Schuhe' },
  machinery:   { label: 'Maschinen & Industrie', accusative: 'Industriemaschinen', description: 'Leichte Industriemaschinen, Komponenten, Werkzeuge' },
};

const RISK_LABEL_DE = {
  low:    'gering',
  medium: 'mittel',
  high:   'hoch',
};

const LABEL_DE = {
  fobIndex:               'FOB-Index vs. China',
  productionLeadTime:     'Produktionszeit',
  seaTransit:             'Seefracht',
  totalLeadTime:          'Gesamte Lieferzeit',
  minMoq:                 'Mindest-MOQ',
  typicalMoq:             'Typische MOQ',
  qualityRisk:            'Qualitätsrisiko',
  ipRisk:                 'IP-Risiko',
  weeks:                  'Wo.',
  units:                  'Stk.',
  whereExcels:            'Wo das Land glänzt',
  whereWatch:             'Worauf achten',
  countryContext:         'Länderkontext',
  qualityIpRisk:          'Qualitäts- und IP-Risiko',
  sampleSuppliers:        'Beispiellieferanten',
  city:                   'Stadt',
  specialty:              'Spezialität',
  sampleLeadTimeCol:      'Musterzeit',
  costAndLeadAtAGlance:   'Kosten und Lieferzeit auf einen Blick',
  compareWithOthers:      'Vergleich mit anderen Herkunftsländern',
  nextAction:             'Nächster Schritt',
  runComparison:          'Sourcing Agent öffnen',
  runComparisonText:      'Der Sourcing Agent vergleicht alle 5 Länder anhand Kosten, Qualitätsrisiko, IP-Risiko und Lieferzeit für Ihre Kategorie und MOQ.',
  region:                 'Region',
  homeBreadcrumb:         'Startseite',
  guidesBreadcrumb:       'Leitfäden',
  sourcingBreadcrumb:     'Sourcing',
  sourcingGuide:          'Sourcing-Leitfaden',
  related:                'Verwandte Leitfäden',
};

// ── Routing terms ──────────────────────────────────────────
const ROUTING_LABEL_DE = {
  routingGuide:        'Routing-Leitfaden',
  shipFromTo:          'So versenden Sie',
  modeComparison:      'Vergleich der Transportmodi',
  modeColumn:          'Modus',
  costColumn:          'Kosten',
  transitColumn:       'Transitzeit',
  chargeableColumn:    'Frachtgewicht',
  co2Column:           'CO₂',
  weightBand:          'Gewicht',
  recommendedMode:     'Empfohlener Modus',
  reasoning:           'Begründung',
  whatNotIncluded:     'Was NICHT in den Kosten enthalten ist',
  duty:                'Einfuhrzoll',
  brokerage:           'Zollabwicklung',
  insurance:           'Frachtversicherung',
  lastMile:            'Letzte-Meile-Lieferung',
  runLiveComparison:   'Logistics Agent öffnen',
  runLiveComparisonText: 'Der Logistics Agent vergleicht alle vier Modi anhand Ihres konkreten Gewichts, Volumens und Ihrer Dringlichkeit — und erstellt einen vollständigen Plan mit Zoll und Lager.',
  routingBreadcrumb:   'Routing',
  asiaToEurope:        'Asien → Europa',
  railCorridorTitle:   'Der China-Europa-Schienenkorridor',
  railUseful:          'Schiene ist am sinnvollsten, wenn:',
  railWrong:           'Schiene ist die falsche Wahl für:',
};

// ── Customs terms ──────────────────────────────────────────
const CUSTOMS_LABEL_DE = {
  customsGuide:        'Zoll-Leitfaden',
  hsChapter:           'HS-Kapitel',
  importInto:          'Import nach',
  fullLandedCost:      'Vollständige Landed-Cost-Berechnung',
  mfnDutyRate:         'MFN-Zollsatz',
  vatRate:             'MwSt.',
  totalCnGoods:        'Gesamt · 25.000 € CN-Ware',
  taxAndFees:          'Davon: Steuern + Gebühren',
  mathLineByLine:      'Die Mathematik, Zeile für Zeile',
  customsValue:        'Zollwert (CIF)',
  importDuty:          'Einfuhrzoll',
  importVat:           'Einfuhr-MwSt.',
  brokerageDesc:       '45 € Basis + 8 € × 4 Zeilen',
  ensFiling:           'ENS Voranmeldung',
  totalCashOut:        'Gesamter Liquiditätsabfluss',
  evftaTitle:          'Präferenzieller Ursprung · Vietnam (EVFTA)',
  bondedTitle:         'Zolllageralternative',
  otherDestinations:   'Andere EU-Bestimmungen · gleiches Kapitel',
  destination:         'Bestimmungsland',
  totalLandedCost:     'Landed-Cost gesamt',
  thisGuide:           '(dieser Leitfaden)',
  guideArrow:          '[Leitfaden →]',
  antiDumpingTitle:    'Anti-Dumping-Risiko · CN-Ursprung',
  customsBreadcrumb:   'Zoll',
  runOnRealNumbers:    'Calculator mit Ihren realen Zahlen ausführen',
  runOnRealNumbersText:'Der Compliance Agent berechnet die Mathematik für jeden HS-Code, jede EU-Destination, jeden Ursprung (mit Anti-Dumping-Overlay + präferenzieller FTA-Erkennung).',
};

const CUSTOMS_CHAPTER_DE = {
  '61': { name: 'Gewirkte Bekleidung',                slug: 'gewirkte-bekleidung' },
  '62': { name: 'Gewebte Bekleidung',                  slug: 'gewebte-bekleidung' },
  '63': { name: 'Heimtextilien',                       slug: 'heimtextilien' },
  '64': { name: 'Schuhwaren',                          slug: 'schuhwaren' },
  '85': { name: 'Elektrische Maschinen & Elektronik',  slug: 'elektronik' },
  '94': { name: 'Möbel und Beleuchtung',               slug: 'moebel' },
};

// ── Warehouse terms ────────────────────────────────────────
const WAREHOUSE_LABEL_DE = {
  warehouseGuide:      'Lager-Leitfaden',
  asEuHub:             'als EU-3PL-Hub',
  pricingCapacityFit:  'Preise, Kapazität, Eignung',
  storagePerPallet:    'Lagerung · Palette/Monat',
  pickBase:            'Pick · Auftrag',
  inboundPerPallet:    'Wareneingang · Palette',
  oneOffSetup:         'Einmaliges Setup',
  whereExcels:         'Wo dieser Hub glänzt',
  wherePushBack:       'Wo Sie verhandeln sollten',
  sampleMonthlyCost:   'Beispielhafte Monatskosten · 1500 Aufträge',
  forTypical1500:      'Für einen typischen KMU-Versender mit 1500 Aufträgen/Monat',
  monthlyCost:         'Monatskosten',
  totalMonthly:        'Gesamt monatlich',
  costPerOrder:        'Kosten pro Auftrag',
  vsAllSixHubs:        'vs. alle 6 EU-Hubs',
  hub:                 'Hub',
  region:              'Region',
  whatNotInCost:       'Was nicht in den Kosten enthalten ist',
  vasNote:             'Mehrwertdienste (VAS) — QC-Inspektion, Etikettierung, Kitting, Fotografie, Retourenbearbeitung, Geschenkverpackung (jeweils 0,15 € bis 4,20 € pro Einheit/Retoure).',
  contractTerms:       'Die Sätze sind Mid-Market-Listenpreise. Über 3.000 Aufträge/Monat verhandeln Sie 10–15% Rabatt; über 10.000 Aufträge sind 20–25% üblich.',
  warehouseBreadcrumb: 'Lager',
  runComparisonOnVolume: 'Vergleich auf Ihrem realen Volumen ausführen',
  runComparisonText:   'Der Logistics Agent benchmarkt alle 6 Hubs anhand Ihres konkreten monatlichen Auftragsvolumens, Ihrer Einheiten, Paletten und Hauptdestination.',
};

// City names → DE form
const CITY_DE = {
  'Rotterdam': 'Rotterdam',
  'Hamburg':   'Hamburg',
  'Frankfurt': 'Frankfurt',
  'Poznań':    'Posen',
  'Prague':    'Prag',
  'Barcelona': 'Barcelona',
};

module.exports = {
  COUNTRY_DE,
  COUNTRY_DE_DATIVE,
  REGION_DE,
  CATEGORY_DE,
  RISK_LABEL_DE,
  LABEL_DE,
  ROUTING_LABEL_DE,
  CUSTOMS_LABEL_DE,
  CUSTOMS_CHAPTER_DE,
  WAREHOUSE_LABEL_DE,
  CITY_DE,
};
