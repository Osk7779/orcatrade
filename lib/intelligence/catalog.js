const COUNTRY_CITIES = {
  China: ['Shenzhen', 'Dongguan', 'Guangzhou', 'Suzhou', 'Ningbo', 'Tianjin', 'Qingdao', 'Foshan'],
  Vietnam: ['Ho Chi Minh City', 'Binh Duong', 'Hai Phong', 'Da Nang', 'Bac Ninh', 'Dong Nai'],
  India: ['Pune', 'Chennai', 'Ahmedabad', 'Coimbatore', 'Surat', 'Gurugram'],
  Indonesia: ['Jakarta', 'Surabaya', 'Bandung', 'Semarang', 'Bekasi', 'Tangerang'],
  Bangladesh: ['Dhaka', 'Chattogram', 'Gazipur', 'Narayanganj', 'Khulna', 'Sylhet'],
  Thailand: ['Bangkok', 'Rayong', 'Chonburi', 'Samut Prakan', 'Ayutthaya', 'Pathum Thani'],
  Malaysia: ['Penang', 'Johor Bahru', 'Klang', 'Shah Alam', 'Kuala Lumpur', 'Ipoh'],
  Taiwan: ['Taichung', 'Tainan', 'Kaohsiung', 'Taoyuan', 'Hsinchu', 'New Taipei'],
  'South Korea': ['Busan', 'Incheon', 'Daegu', 'Ulsan', 'Gwangju', 'Suwon'],
};

const COUNTRY_ROUTE_CONTEXT = {
  China: {
    transitHub: 'Singapore',
    routeDescription: 'South China Sea -> Strait of Malacca -> Indian Ocean -> Suez Canal -> Mediterranean -> destination',
    shippingLines: ['MSC', 'Maersk', 'CMA CGM', 'COSCO', 'Evergreen'],
    disruptionThemes: ['South China Sea Typhoon Season', 'Suez Canal Slot Pressure'],
  },
  Vietnam: {
    transitHub: 'Singapore',
    routeDescription: 'South China Sea -> Strait of Malacca -> Indian Ocean -> Suez Canal -> Mediterranean -> destination',
    shippingLines: ['CMA CGM', 'MSC', 'Hapag-Lloyd', 'Maersk'],
    disruptionThemes: ['South China Sea Weather Delays', 'Singapore Congestion'],
  },
  India: {
    transitHub: 'Jebel Ali',
    routeDescription: 'Arabian Sea -> Gulf of Aden -> Red Sea -> Suez Canal -> Mediterranean -> destination',
    shippingLines: ['MSC', 'Maersk', 'ONE', 'CMA CGM'],
    disruptionThemes: ['Arabian Sea Weather Windows', 'Suez Canal Southbound Restrictions'],
  },
  Bangladesh: {
    transitHub: 'Colombo',
    routeDescription: 'Bay of Bengal -> Indian Ocean -> Red Sea -> Suez Canal -> Mediterranean -> destination',
    shippingLines: ['MSC', 'Maersk', 'CMA CGM', 'Hapag-Lloyd'],
    disruptionThemes: ['Monsoon Port Delays', 'Colombo Feeder Congestion'],
  },
  Indonesia: {
    transitHub: 'Singapore',
    routeDescription: 'Java Sea -> Strait of Malacca -> Indian Ocean -> Suez Canal -> Mediterranean -> destination',
    shippingLines: ['Evergreen', 'MSC', 'CMA CGM', 'Maersk'],
    disruptionThemes: ['Java Sea Weather Disruption', 'Singapore Congestion'],
  },
  Thailand: {
    transitHub: 'Singapore',
    routeDescription: 'Gulf of Thailand -> South China Sea -> Strait of Malacca -> Indian Ocean -> Suez Canal -> destination',
    shippingLines: ['Maersk', 'MSC', 'ONE', 'CMA CGM'],
    disruptionThemes: ['Gulf of Thailand Storm Risk', 'Singapore Berth Delays'],
  },
  Malaysia: {
    transitHub: 'Port Klang',
    routeDescription: 'Strait of Malacca -> Indian Ocean -> Suez Canal -> Mediterranean -> destination',
    shippingLines: ['Maersk', 'Evergreen', 'MSC', 'CMA CGM'],
    disruptionThemes: ['Port Klang Congestion', 'Suez Canal Slot Pressure'],
  },
  Taiwan: {
    transitHub: 'Kaohsiung',
    routeDescription: 'East China Sea -> South China Sea -> Strait of Malacca -> Indian Ocean -> Suez Canal -> destination',
    shippingLines: ['Evergreen', 'Yang Ming', 'CMA CGM', 'MSC'],
    disruptionThemes: ['East Asia Weather Diversions', 'South China Sea Capacity Tightness'],
  },
  'South Korea': {
    transitHub: 'Busan',
    routeDescription: 'East China Sea -> South China Sea -> Strait of Malacca -> Indian Ocean -> Suez Canal -> destination',
    shippingLines: ['HMM', 'Maersk', 'MSC', 'ONE'],
    disruptionThemes: ['Busan Terminal Queueing', 'Suez Canal Slot Pressure'],
  },
};

const CATEGORY_SPECIALITIES = {
  'Electronics & Components': [
    'PCB assembly',
    'power supplies',
    'wire harnesses',
    'precision sensors',
    'connectors',
    'control modules',
  ],
  'Textiles & Apparel': [
    'knit garments',
    'woven apparel',
    'technical textiles',
    'performance outerwear',
    'soft accessories',
    'cut-and-sew basics',
  ],
  'Food & Beverage': [
    'private-label snacks',
    'dry ingredients',
    'beverage packaging',
    'ambient food products',
    'shelf-stable condiments',
    'retail-ready packing',
  ],
  'Packaging & Paper': [
    'corrugated cartons',
    'folding cartons',
    'paper sleeves',
    'printed labels',
    'rigid gift boxes',
    'industrial inserts',
  ],
  'Furniture & Wood': [
    'case goods',
    'wooden shelving',
    'hospitality furniture',
    'veneered panels',
    'solid wood components',
    'upholstered frames',
  ],
  'Steel & Metal Products': [
    'steel stampings',
    'precision forgings',
    'aluminium extrusions',
    'machined brackets',
    'sheet metal assemblies',
    'industrial fasteners',
  ],
  'Chemicals & Materials': [
    'industrial adhesives',
    'speciality coatings',
    'construction compounds',
    'cleaning formulations',
    'polymer compounds',
    'material blends',
  ],
  'Ceramics & Glass': [
    'tableware ceramics',
    'architectural glass',
    'industrial glassware',
    'sanitary ceramics',
    'stoneware products',
    'decorative glass components',
  ],
  'Rubber & Plastics': [
    'injection-moulded parts',
    'technical rubber seals',
    'plastic housings',
    'flexible packaging parts',
    'extruded profiles',
    'polymer fittings',
  ],
  Other: [
    'industrial components',
    'consumer products',
    'assembled goods',
    'private-label products',
    'general manufacturing',
    'export-ready items',
  ],
  Electronics: ['consumer electronics assemblies', 'control boards', 'cable systems'],
  Textiles: ['woven garments', 'technical fabrics', 'trim packs'],
  Packaging: ['printed cartons', 'paper sleeves', 'protective inserts'],
  'Steel & Metal': ['steel stampings', 'metal brackets', 'machined parts'],
  Chemicals: ['industrial chemicals', 'adhesive systems', 'coating materials'],
  Ceramics: ['ceramic tableware', 'sanitary ceramics', 'industrial ceramics'],
};

const CATEGORY_KEYWORDS = {
  'Electronics & Components': ['electronics', 'electronic', 'pcb', 'sensor', 'connector', 'cable', 'module', 'component'],
  'Textiles & Apparel': ['textile', 'apparel', 'garment', 'fabric', 'clothing', 'outerwear', 'accessory'],
  'Food & Beverage': ['food', 'beverage', 'drink', 'snack', 'condiment', 'ingredient', 'packaging'],
  'Packaging & Paper': ['packaging', 'paper', 'carton', 'label', 'box', 'insert', 'printing'],
  'Furniture & Wood': ['furniture', 'wood', 'timber', 'panel', 'veneer', 'chair', 'table', 'shelving', 'frame', 'case goods'],
  'Steel & Metal Products': ['steel', 'metal', 'aluminium', 'aluminum', 'forging', 'machining', 'sheet metal', 'fastener'],
  'Chemicals & Materials': ['chemical', 'coating', 'adhesive', 'compound', 'polymer', 'material'],
  'Ceramics & Glass': ['ceramic', 'glass', 'stoneware', 'tableware', 'sanitary'],
  'Rubber & Plastics': ['rubber', 'plastic', 'polymer', 'seal', 'moulded', 'molded', 'extruded'],
  Other: ['manufacturing', 'factory', 'supplier', 'industrial', 'product'],
  Electronics: ['electronics', 'electronic', 'pcb', 'cable', 'board'],
  Textiles: ['textile', 'garment', 'fabric', 'clothing'],
  Packaging: ['packaging', 'paper', 'carton', 'label', 'box'],
  'Steel & Metal': ['steel', 'metal', 'aluminium', 'aluminum', 'machining', 'forging'],
  Chemicals: ['chemical', 'coating', 'adhesive', 'compound'],
  Ceramics: ['ceramic', 'stoneware', 'tableware'],
};

function cleanString(value) {
  return String(value || '').trim();
}

function isKnownCountry(country) {
  return Object.prototype.hasOwnProperty.call(COUNTRY_CITIES, cleanString(country));
}

function normaliseCountry(country, fallback = 'China') {
  return isKnownCountry(country) ? cleanString(country) : fallback;
}

function isKnownFactoryCategory(category) {
  return Object.prototype.hasOwnProperty.call(CATEGORY_SPECIALITIES, cleanString(category));
}

function normaliseFactoryCategory(category, fallback = 'Other') {
  return isKnownFactoryCategory(category) ? cleanString(category) : fallback;
}

function getCategorySpecialities(category) {
  return CATEGORY_SPECIALITIES[normaliseFactoryCategory(category)] || CATEGORY_SPECIALITIES.Other;
}

function pickCategorySpeciality(category, index = 0) {
  const specialities = getCategorySpecialities(category);
  return specialities[index % specialities.length];
}

function getCategoryKeywords(category) {
  return CATEGORY_KEYWORDS[normaliseFactoryCategory(category)] || CATEGORY_KEYWORDS.Other;
}

function isCategoryCompatible(speciality, category) {
  const expectedCategory = normaliseFactoryCategory(category);
  if (expectedCategory === 'Other') return true;

  const haystack = cleanString(speciality).toLowerCase();
  if (!haystack) return false;
  if (haystack === expectedCategory.toLowerCase()) return true;

  return getCategoryKeywords(expectedCategory).some(keyword => haystack.includes(keyword)) ||
    getCategorySpecialities(expectedCategory).some(phrase => haystack.includes(phrase.toLowerCase()));
}

function isEudrCategoryText(text) {
  return /\b(wood|timber|furniture|cocoa|coffee|palm|soya|soy|beef|cattle|rubber|leather|paper|printed matter|chocolate)\b/i.test(cleanString(text));
}

function isCbamCategoryText(text) {
  return /\b(cement|iron|steel|aluminium|aluminum|fertiliser|fertiliser|fertilizer|fertilizers|electricity|hydrogen)\b/i.test(cleanString(text));
}

module.exports = {
  CATEGORY_KEYWORDS,
  CATEGORY_SPECIALITIES,
  COUNTRY_CITIES,
  COUNTRY_ROUTE_CONTEXT,
  cleanString,
  getCategoryKeywords,
  getCategorySpecialities,
  isCategoryCompatible,
  isCbamCategoryText,
  isEudrCategoryText,
  isKnownCountry,
  isKnownFactoryCategory,
  normaliseCountry,
  normaliseFactoryCategory,
  pickCategorySpeciality,
};
