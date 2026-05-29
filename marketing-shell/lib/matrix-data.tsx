// Shared metadata for the four matrix templates (customs, sourcing,
// routing, warehouse). Each template combines a commodity, an origin or
// a destination from this file into a generated guide page.
//
// The point of keeping the data here is editorial discipline: change
// the commodity's MFN headline once, every customs guide for that
// commodity reflects it on next build.

export interface Commodity {
  slug: string;
  short: string; // 'Electronics'
  chapter: string; // 'HS chapter 85'
  mfn: string; // headline MFN range / typical
  regimes: { name: string; href: string }[];
  notes: string;
}

export interface Destination {
  code: string; // 'de'
  short: string; // 'DE'
  name: string; // 'Germany'
  port: string; // 'Port of Hamburg'
  customsHouse: string;
  language: string;
  notes: string;
}

export interface Origin {
  code: string; // 'cn'
  short: string; // 'CN'
  name: string; // 'China'
  frameworks: { name: string; href: string; note: string }[];
  notes: string;
}

export interface WarehouseCity {
  slug: string;
  short: string; // 'Rotterdam'
  name: string;
  country: string;
  bonded: boolean;
  laneFit: string;
  operatorTypes: string[];
  notes: string;
}

export const COMMODITIES: Commodity[] = [
  {
    slug: 'electronics',
    short: 'Electronics',
    chapter: 'HS chapter 85',
    mfn: '0%–4.7% headline; many lines zero under WTO ITA',
    regimes: [
      { name: 'CE LVD/EMC/RED', href: '/guides/compliance/ce-lvd-emc-red' },
      { name: 'RoHS', href: '/guides/compliance/rohs' },
      { name: 'WEEE', href: '/guides/compliance/weee' },
    ],
    notes:
      'Most consumer electronics fall under the Information Technology Agreement and enter duty-free. CE conformity, RoHS self-declaration and WEEE producer registration are non-negotiable.',
  },
  {
    slug: 'footwear',
    short: 'Footwear',
    chapter: 'HS chapter 64',
    mfn: '8%–17% depending on upper material',
    regimes: [
      { name: 'Footwear labelling 94/11/EC', href: '/guides/compliance/footwear-labelling' },
      { name: 'GPSR', href: '/guides/compliance/gpsr' },
      { name: 'REACH', href: '/guides/compliance/reach' },
    ],
    notes:
      'Classification by upper material drives the rate. Per-pair labelling under 94/11/EC at the point of sale. Anti-dumping has historically hit certain leather-upper lines.',
  },
  {
    slug: 'furniture',
    short: 'Furniture',
    chapter: 'HS chapter 94',
    mfn: '0%–5.7%; many lines zero',
    regimes: [
      { name: 'EUDR (wood-based)', href: '/guides/compliance/eudr' },
      { name: 'GPSR', href: '/guides/compliance/gpsr' },
      { name: 'REACH', href: '/guides/compliance/reach' },
    ],
    notes:
      'Wood-based furniture is in EUDR scope: due-diligence statements with plot-level geolocation. Upholstery hits flammability standards in the destination state.',
  },
  {
    slug: 'home-textiles',
    short: 'Home textiles',
    chapter: 'HS chapter 63',
    mfn: '8%–12% typical',
    regimes: [
      { name: 'REACH SVHC', href: '/guides/compliance/reach' },
      { name: 'GPSR', href: '/guides/compliance/gpsr' },
    ],
    notes:
      'Care-label REACH-trigger substances are the most common surprise. Preferential origin under EBA (Bangladesh) and EVFTA (Vietnam) drops the duty to zero with the right documentation.',
  },
  {
    slug: 'knitted-apparel',
    short: 'Knitted apparel',
    chapter: 'HS chapter 61',
    mfn: '12% headline',
    regimes: [
      { name: 'REACH (dyes, finishings)', href: '/guides/compliance/reach' },
      { name: 'GPSR', href: '/guides/compliance/gpsr' },
    ],
    notes:
      'Origin matters more than headline rate. EBA from Bangladesh and EVFTA from Vietnam drop the rate to zero with the REX statement; China sits at full 12% MFN.',
  },
  {
    slug: 'woven-apparel',
    short: 'Woven apparel',
    chapter: 'HS chapter 62',
    mfn: '11.5%–12%',
    regimes: [
      { name: 'REACH (dyes, finishings)', href: '/guides/compliance/reach' },
      { name: 'GPSR', href: '/guides/compliance/gpsr' },
    ],
    notes:
      'Same origin dynamic as knitted apparel. The classification line between knitted and woven (technique, not look) drives chapter and rate.',
  },
];

export const SOURCING_COMMODITIES: Commodity[] = [
  ...COMMODITIES,
  {
    slug: 'apparel',
    short: 'Apparel',
    chapter: 'HS chapters 61 + 62',
    mfn: '11.5%–12% MFN',
    regimes: [
      { name: 'REACH', href: '/guides/compliance/reach' },
      { name: 'GPSR', href: '/guides/compliance/gpsr' },
    ],
    notes:
      'Both knitted (61) and woven (62) on the same supplier brief.',
  },
  {
    slug: 'cosmetics',
    short: 'Cosmetics',
    chapter: 'HS chapter 33',
    mfn: '0% MFN; compliance is the cost',
    regimes: [
      { name: 'Cosmetics Regulation 1223/2009', href: '/guides/compliance/cosmetics' },
      { name: 'REACH', href: '/guides/compliance/reach' },
    ],
    notes:
      'Responsible Person + PIF + CPNP before any unit reaches shelf. Three to six months of compliance overlay alone.',
  },
  {
    slug: 'homeware',
    short: 'Homeware',
    chapter: 'HS chapter 39 + 73 + 94',
    mfn: '0%–6.5%',
    regimes: [
      { name: 'GPSR', href: '/guides/compliance/gpsr' },
      { name: 'REACH', href: '/guides/compliance/reach' },
      { name: 'PPWR', href: '/guides/compliance/ppwr' },
    ],
    notes:
      'Multi-chapter sourcing brief; classification matters at line level. PPWR begins to bite on packaging material thresholds.',
  },
  {
    slug: 'machinery',
    short: 'Machinery',
    chapter: 'HS chapters 84 + 85',
    mfn: '0%–4.5%',
    regimes: [
      { name: 'CE Machinery', href: '/guides/compliance/ce-machinery' },
      { name: 'CE EMC', href: '/guides/compliance/ce-lvd-emc-red' },
    ],
    notes:
      'EUKFTA gives zero duty from Korea; EVFTA from Vietnam. CE conformity unchanged by either.',
  },
  {
    slug: 'toys',
    short: 'Toys',
    chapter: 'HS chapter 95',
    mfn: '0%–4.7%',
    regimes: [
      { name: 'Toy Safety Directive', href: '/guides/compliance/toy-safety' },
      { name: 'GPSR', href: '/guides/compliance/gpsr' },
    ],
    notes:
      'EN 71 family of standards, type approval and warning markings. The cost is the certification cycle, not the duty.',
  },
];

export const DESTINATIONS: Destination[] = [
  {
    code: 'de',
    short: 'DE',
    name: 'Germany',
    port: 'Port of Hamburg',
    customsHouse: 'Bundeszentralamt für Steuern',
    language: 'German',
    notes:
      'Hamburg is the second-busiest EU port; rail connectivity into Czechia, Poland and Austria from the quay. Frankfurt for high-value air cargo.',
  },
  {
    code: 'nl',
    short: 'NL',
    name: 'Netherlands',
    port: 'Port of Rotterdam',
    customsHouse: 'Belastingdienst Douane',
    language: 'Dutch · English',
    notes:
      'Largest EU port; common entry point for cargo onward-distributed across the Union. Rotterdam customs windows are short and busy.',
  },
  {
    code: 'pl',
    short: 'PL',
    name: 'Poland',
    port: 'Port of Gdańsk',
    customsHouse: 'Krajowa Administracja Skarbowa',
    language: 'Polish',
    notes:
      'Gdańsk has grown rapidly as the central-European gateway; Poznań is the inland distribution hub. Lower port costs than the western Hanse ports.',
  },
  {
    code: 'fr',
    short: 'FR',
    name: 'France',
    port: 'Port of Le Havre',
    customsHouse: 'Direction générale des Douanes',
    language: 'French',
    notes:
      'Le Havre serves Paris and northern France; Marseille for Mediterranean entry. Customs procedure in French unless dedicated bilingual EORI is set up.',
  },
  {
    code: 'it',
    short: 'IT',
    name: 'Italy',
    port: 'Port of Genoa',
    customsHouse: 'Agenzia delle Dogane',
    language: 'Italian',
    notes:
      'Genoa for the northwest; La Spezia for the upper Tyrrhenian; Trieste for central-eastern Europe routing. Three customs houses, three rhythms.',
  },
  {
    code: 'es',
    short: 'ES',
    name: 'Spain',
    port: 'Port of Valencia',
    customsHouse: 'Agencia Tributaria — Aduanas',
    language: 'Spanish',
    notes:
      'Valencia is the dominant Mediterranean gateway; Barcelona for the Catalan and southern-French distribution. Spanish customs documentation must be in Spanish.',
  },
];

export const ORIGINS: Origin[] = [
  {
    code: 'cn',
    short: 'CN',
    name: 'China',
    frameworks: [],
    notes:
      'No preferential framework. Anti-dumping and CVD overlay on many chapters; classification and individual-producer rates are the lever for cost reduction.',
  },
  {
    code: 'hk',
    short: 'HK',
    name: 'Hong Kong',
    frameworks: [],
    notes:
      'Re-export hub for Chinese goods; the underlying origin still determines duty. HK SAR papers do not convert Chinese origin.',
  },
  {
    code: 'vn',
    short: 'VN',
    name: 'Vietnam',
    frameworks: [{ name: 'EVFTA', href: '/guides/preferential-origin/evfta', note: 'zero duty on most chapters' }],
    notes:
      'EVFTA delivers zero duty on most consumer-goods chapters with a REX statement on the invoice.',
  },
  {
    code: 'in',
    short: 'IN',
    name: 'India',
    frameworks: [{ name: 'GSP standard', href: '/guides/preferential-origin/gsp-standard', note: 'sector graduation excludes textiles and chemicals' }],
    notes:
      'Sector graduation removed preference on many chapters; cosmetics, certain machinery and IT goods remain favourably positioned.',
  },
  {
    code: 'bd',
    short: 'BD',
    name: 'Bangladesh',
    frameworks: [{ name: 'EBA', href: '/guides/preferential-origin/eba', note: 'zero duty until LDC graduation 2026 + 3 year transitional' }],
    notes:
      'Apparel and footwear lanes are the most-used. EBA continues until 2029 under the transitional period.',
  },
  {
    code: 'tr',
    short: 'TR',
    name: 'Türkiye',
    frameworks: [{ name: 'A.TR Customs Union', href: '/guides/preferential-origin/atr', note: 'free circulation; trade defence overrides' }],
    notes:
      'A.TR for free circulation of industrial goods. Trade-defence measures on the underlying origin (typically Chinese steel) still apply.',
  },
];

export const WAREHOUSE_CITIES: WarehouseCity[] = [
  {
    slug: 'rotterdam-3pl',
    short: 'Rotterdam',
    name: 'Rotterdam',
    country: 'Netherlands',
    bonded: true,
    laneFit: 'CN, VN, IN to all EU destinations',
    operatorTypes: [
      'Bonded customs warehouses',
      'Container freight stations',
      'Cross-docking for inland distribution',
      'Cold-chain operators',
    ],
    notes:
      'Europe’s largest port. Container congestion and customs windows are the operational cost; bonded options are abundant for high-value lanes.',
  },
  {
    slug: 'hamburg-3pl',
    short: 'Hamburg',
    name: 'Hamburg',
    country: 'Germany',
    bonded: true,
    laneFit: 'CN, VN to DE, PL, CZ',
    operatorTypes: ['Bonded warehouses', 'Quay-side rail consolidation', 'Container handling'],
    notes:
      'Second-busiest European port; rail connectivity into Czechia, Poland and Austria from the quay.',
  },
  {
    slug: 'frankfurt-3pl',
    short: 'Frankfurt',
    name: 'Frankfurt',
    country: 'Germany',
    bonded: true,
    laneFit: 'HK, KR by air',
    operatorTypes: ['Air cargo handling', 'Bonded air warehouses', 'Express last-mile'],
    notes:
      'Air cargo hub. Best for high-value, low-volume electronics where lead time beats freight cost.',
  },
  {
    slug: 'barcelona-3pl',
    short: 'Barcelona',
    name: 'Barcelona',
    country: 'Spain',
    bonded: true,
    laneFit: 'CN, IN to ES, PT, IT',
    operatorTypes: ['Mediterranean container handling', 'Sea-air combination', 'Catalan inland distribution'],
    notes:
      'Mediterranean gateway. Sea-air combinations from Asia via the Suez transit; growing distribution into IT and FR.',
  },
  {
    slug: 'poznan-3pl',
    short: 'Poznań',
    name: 'Poznań',
    country: 'Poland',
    bonded: false,
    laneFit: 'CN, BD, VN to PL, DE, CZ, SK',
    operatorTypes: ['Cross-dock for last mile', 'Bulk fulfilment', 'Value-added warehousing'],
    notes:
      'Central-European distribution hub. Strongest for apparel, footwear and consumer goods bound for DE and the Visegrád four.',
  },
  {
    slug: 'prague-3pl',
    short: 'Prague',
    name: 'Prague',
    country: 'Czech Republic',
    bonded: false,
    laneFit: 'Cross-dock from DE, PL gateways',
    operatorTypes: ['Cross-docking', 'Last-mile road distribution'],
    notes:
      'Land-locked, rail- and road-served. Best for cross-docking and last-mile distribution into CZ, SK, AT and HU.',
  },
];
