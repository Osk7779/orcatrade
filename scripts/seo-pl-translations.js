// Polish translations for the programmatic SEO page generator.
//
// We don't ship machine-translated marketing copy — for the deeper guides
// (long descriptive blocks) we'd need a native Polish reviewer. But for
// the sourcing pages, the bulk of content is calculator data + standardised
// labels, which translate cleanly with a curated dictionary. This file is
// the Polish term set; long-form sentences are restructured per Polish
// register conventions in the generator's PL branch.

const COUNTRY_PL = {
  CN: 'Chiny',
  VN: 'Wietnam',
  IN: 'Indie',
  BD: 'Bangladesz',
  TR: 'Turcja',
  HK: 'Hongkong',
  // EU destinations
  DE: 'Niemcy',
  PL: 'Polska',
  NL: 'Holandia',
  FR: 'Francja',
  IT: 'Włochy',
  ES: 'Hiszpania',
  AT: 'Austria',
  BE: 'Belgia',
  CZ: 'Czechy',
  GR: 'Grecja',
};

const COUNTRY_PL_GENITIVE = {
  CN: 'Chin',
  VN: 'Wietnamu',
  IN: 'Indii',
  BD: 'Bangladeszu',
  TR: 'Turcji',
  HK: 'Hongkongu',
};

const REGION_PL = {
  'East Asia':         'Azja Wschodnia',
  'Southeast Asia':    'Azja Południowo-Wschodnia',
  'South Asia':        'Azja Południowa',
  'Near Europe':       'Bliska Europa',
};

const CATEGORY_PL = {
  apparel:     { label: 'Odzież i tekstylia', genitive: 'odzieży i tekstyliów', description: 'Dzianiny, tkaniny i gotowa odzież' },
  electronics: { label: 'Elektronika użytkowa', genitive: 'elektroniki użytkowej', description: 'Audio, drobne AGD, akcesoria' },
  furniture:   { label: 'Meble i drewno', genitive: 'mebli', description: 'Meble z drewna litego, płytowe, tapicerowane' },
  toys:        { label: 'Zabawki', genitive: 'zabawek', description: 'Pluszowe, plastikowe, drewniane i elektroniczne' },
  cosmetics:   { label: 'Kosmetyki', genitive: 'kosmetyków', description: 'Pielęgnacja skóry, włosów, produkty z opakowaniem' },
  homeware:    { label: 'Artykuły gospodarstwa domowego', genitive: 'artykułów AGD i kuchennych', description: 'Akcesoria kuchenne, szkło, ceramika' },
  footwear:    { label: 'Obuwie', genitive: 'obuwia', description: 'Skórzane, sportowe, casual, techniczne' },
  machinery:   { label: 'Maszyny i przemysł', genitive: 'maszyn lekkich', description: 'Maszyny lekkie, komponenty, narzędzia' },
};

const RISK_LABEL_PL = {
  low:    'niskie',
  medium: 'średnie',
  high:   'wysokie',
};

// Field labels reused across pages
const LABEL_PL = {
  fobIndex:               'Wskaźnik FOB vs Chiny',
  productionLeadTime:     'Czas produkcji',
  seaTransit:             'Transport morski',
  totalLeadTime:          'Łączny czas dostawy',
  minMoq:                 'Minimalne MOQ',
  typicalMoq:             'Typowe MOQ',
  qualityRisk:            'Ryzyko jakości',
  ipRisk:                 'Ryzyko IP',
  weeks:                  'tyg.',
  units:                  'szt.',
  whereExcels:            'Gdzie się sprawdza',
  whereWatch:             'Na co uważać',
  countryContext:         'Kontekst kraju',
  qualityIpRisk:          'Ryzyko jakości i własności intelektualnej',
  sampleSuppliers:        'Przykładowi dostawcy',
  city:                   'Miasto',
  specialty:              'Specjalność',
  sampleLeadTimeCol:      'Czas próbki',
  costAndLeadAtAGlance:   'Koszt i czas dostawy',
  compareWithOthers:      'Porównanie z innymi krajami',
  nextAction:             'Następny krok',
  runComparison:          'Uruchom Sourcing Agenta',
  runComparisonText:      'Sourcing Agent porównuje wszystkie 5 krajów na cenie, ryzyku jakości, ryzyku IP i czasie dostawy dla Twojej kategorii i MOQ.',
  region:                 'Region',
  homeBreadcrumb:         'Strona główna',
  guidesBreadcrumb:       'Przewodniki',
  sourcingBreadcrumb:     'Sourcing',
  sourcingGuide:          'Przewodnik sourcing',
};

module.exports = {
  COUNTRY_PL,
  COUNTRY_PL_GENITIVE,
  REGION_PL,
  CATEGORY_PL,
  RISK_LABEL_PL,
  LABEL_PL,
};
