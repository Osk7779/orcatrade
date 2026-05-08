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

module.exports = {
  COUNTRY_DE,
  COUNTRY_DE_DATIVE,
  REGION_DE,
  CATEGORY_DE,
  RISK_LABEL_DE,
  LABEL_DE,
};
