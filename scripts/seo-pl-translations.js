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

// ── Routing terms ──────────────────────────────────────────
const ROUTING_LABEL_PL = {
  routingGuide:        'Przewodnik routing',
  shipFromTo:          'Jak wysłać',
  modeComparison:      'Porównanie trybów transportu',
  modeColumn:          'Tryb',
  costColumn:          'Koszt',
  transitColumn:       'Czas transportu',
  chargeableColumn:    'Waga przeliczeniowa',
  co2Column:           'CO₂',
  weightBand:          'Waga',
  recommendedMode:     'Rekomendowany tryb',
  reasoning:           'Dlaczego',
  whatNotIncluded:     'Co NIE jest w cenie',
  duty:                'Cło importowe',
  brokerage:           'Brokerage celne',
  insurance:           'Ubezpieczenie ładunku',
  lastMile:            'Dostawa ostatniej mili',
  runLiveComparison:   'Uruchom Logistics Agenta',
  runLiveComparisonText: 'Logistics Agent porównuje wszystkie cztery tryby na Twojej konkretnej wadze, objętości i pilności — oraz układa pełny plan z odprawą celną i magazynem.',
  routingBreadcrumb:   'Routing',
  asiaToEurope:        'Azja → Europa',
  railCorridorTitle:   'Korytarz kolejowy Chiny–Europa',
  railUseful:          'Kolej jest najbardziej przydatna gdy:',
  railWrong:           'Kolej jest błędnym wyborem dla:',
};

// ── Customs terms ──────────────────────────────────────────
const CUSTOMS_LABEL_PL = {
  customsGuide:        'Przewodnik celny',
  hsChapter:           'Rozdział HS',
  importInto:          'Importuj do',
  fullLandedCost:      'Pełny koszt celny',
  mfnDutyRate:         'Stawka cła MFN',
  vatRate:             'VAT',
  totalCnGoods:        'Łącznie · 25 000 € towarów z CN',
  taxAndFees:          'W tym: podatki + opłaty',
  mathLineByLine:      'Matematyka, linia po linii',
  customsValue:        'Wartość celna (CIF)',
  importDuty:          'Cło importowe',
  importVat:           'VAT importowy',
  brokerageDesc:       '45 € baza + 8 € × 4 linie',
  ensFiling:           'ENS pre-arrival',
  totalCashOut:        'Łączny wypływ gotówki',
  evftaTitle:          'Alternatywa preferencyjnego pochodzenia · Wietnam (EVFTA)',
  bondedTitle:         'Alternatywa składu celnego',
  otherDestinations:   'Inne kierunki UE · ten sam rozdział',
  destination:         'Kierunek',
  totalLandedCost:     'Łączny koszt celny',
  thisGuide:           '(ten przewodnik)',
  guideArrow:          '[przewodnik →]',
  antiDumpingTitle:    'Ryzyko anti-dumpingu · pochodzenie chińskie',
  customsBreadcrumb:   'Cła',
  runOnRealNumbers:    'Uruchom kalkulator na realnych liczbach',
  runOnRealNumbersText:'Compliance Agent oblicza matematykę dla dowolnego kodu HS, dowolnego kierunku UE, dowolnego pochodzenia (z nakładkami anti-dumping + wykrywaniem preferencyjnych FTA).',
};

const CUSTOMS_CHAPTER_PL = {
  '61': { name: 'Odzież dziana',                      slug: 'odziez-dziana' },
  '62': { name: 'Odzież tkana',                        slug: 'odziez-tkana' },
  '63': { name: 'Tekstylia domowe',                    slug: 'tekstylia-domowe' },
  '64': { name: 'Obuwie',                              slug: 'obuwie' },
  '85': { name: 'Maszyny elektryczne i elektronika',   slug: 'elektronika' },
  '94': { name: 'Meble i oświetlenie',                 slug: 'meble' },
};

// ── Warehouse terms ────────────────────────────────────────
const WAREHOUSE_LABEL_PL = {
  warehouseGuide:      'Przewodnik magazynowy',
  asEuHub:             'jako hub 3PL w UE',
  pricingCapacityFit:  'cennik, wydajność, dopasowanie',
  storagePerPallet:    'Magazynowanie · paleta/mc',
  pickBase:            'Pick · zamówienie',
  inboundPerPallet:    'Inbound · paleta',
  oneOffSetup:         'Setup jednorazowy',
  whereExcels:         'Gdzie się sprawdza',
  wherePushBack:       'Gdzie negocjować',
  sampleMonthlyCost:   'Przykładowy koszt miesięczny · 1500 zamówień',
  forTypical1500:      'Dla typowego shipperów MŚP z 1500 zamówieniami/miesiąc',
  monthlyCost:         'Koszt miesięczny',
  totalMonthly:        'Łącznie miesięcznie',
  costPerOrder:        'Koszt na zamówienie',
  vsAllSixHubs:        'vs wszystkie 6 hubów UE',
  hub:                 'Hub',
  region:              'Region',
  whatNotInCost:       'Czego nie ma w cenie',
  vasNote:             'Usługi dodatkowe (VAS) — kontrola jakości, etykietowanie, kitting, fotografia, zwroty, pakowanie prezentowe (każda od 0,15 € do 4,20 € za jednostkę/zwrot).',
  contractTerms:       'Stawki to lista mid-market. Powyżej 3000 zamówień/mc negocjuj 10–15% rabatu; powyżej 10000 zamówień, 20–25%.',
  warehouseBreadcrumb: 'Magazyny',
  runComparisonOnVolume: 'Uruchom porównanie na realnym wolumenie',
  runComparisonText:   'Logistics Agent benchmarkuje wszystkie 6 hubów na Twoim konkretnym miesięcznym wolumenie zamówień, jednostek, palet i głównym kierunku.',
};

// City names → PL form (for hub cities)
const CITY_PL = {
  'Rotterdam': 'Rotterdam',
  'Hamburg':   'Hamburg',
  'Frankfurt': 'Frankfurt',
  'Poznań':    'Poznań',
  'Prague':    'Praga',
  'Barcelona': 'Barcelona',
};

module.exports = {
  COUNTRY_PL,
  COUNTRY_PL_GENITIVE,
  REGION_PL,
  CATEGORY_PL,
  RISK_LABEL_PL,
  LABEL_PL,
  ROUTING_LABEL_PL,
  CUSTOMS_LABEL_PL,
  CUSTOMS_CHAPTER_PL,
  WAREHOUSE_LABEL_PL,
  CITY_PL,
};
