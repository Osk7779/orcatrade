// CE marking analysis. CE is a framework, not a single regulation, so applicability is
// per-directive: detect product type → return the set of directives that apply.

const DIRECTIVES = {
  lvd: {
    id: 'lvd',
    shortName: 'LVD',
    title: 'Low Voltage Directive',
    instrument: 'Directive 2014/35/EU',
    chunkId: 'ce-lvd',
    moduleNote: 'Module A (manufacturer self-certification, no NB).',
    needsNb: false,
  },
  emc: {
    id: 'emc',
    shortName: 'EMC',
    title: 'Electromagnetic Compatibility',
    instrument: 'Directive 2014/30/EU',
    chunkId: 'ce-emc',
    moduleNote: 'Module A typical; Module B + C if non-harmonised standards used.',
    needsNb: false,
  },
  machinery: {
    id: 'machinery',
    shortName: 'Machinery',
    title: 'Machinery Regulation',
    instrument: 'Regulation (EU) 2023/1230',
    chunkId: 'ce-machinery',
    moduleNote: 'Module A for most machinery; Annex IV machinery requires Module B + C with Notified Body.',
    needsNb: 'conditional',
  },
  toy_safety: {
    id: 'toy_safety',
    shortName: 'Toy Safety',
    title: 'Toy Safety Directive',
    instrument: 'Directive 2009/48/EC',
    chunkId: 'ce-toy-safety',
    moduleNote: 'Module A where harmonised standards fully applied; Module B + C with Notified Body otherwise.',
    needsNb: 'conditional',
  },
  ppe: {
    id: 'ppe',
    shortName: 'PPE',
    title: 'Personal Protective Equipment',
    instrument: 'Regulation (EU) 2016/425',
    chunkId: 'ce-ppe',
    moduleNote: 'Category I = Module A; Category II = Module B + C2 (NB at type-exam); Category III = Module B + D/E (NB at production).',
    needsNb: true,
  },
  red: {
    id: 'red',
    shortName: 'RED',
    title: 'Radio Equipment Directive',
    instrument: 'Directive 2014/53/EU',
    chunkId: 'ce-red',
    moduleNote: 'Module A only if harmonised standards fully applied; otherwise Module B (NB type-exam) + Module C. Cybersecurity delegated acts apply from 2025-08-01.',
    needsNb: 'conditional',
  },
  rohs: {
    id: 'rohs',
    shortName: 'RoHS',
    title: 'Restriction of Hazardous Substances',
    instrument: 'Directive 2011/65/EU',
    chunkId: 'ce-rohs',
    moduleNote: 'Module A (manufacturer self-declares via DoC).',
    needsNb: false,
  },
};

// Product-class heuristics: which directives apply to which keyword cluster.
// Order matters — most specific first.
const PRODUCT_CLASSES = [
  {
    key: 'wireless_electronics',
    label: 'Wireless / radio-enabled electronics',
    keywords: ['bluetooth', 'wifi', 'wi-fi', 'wireless', 'iot', 'smart device', 'rfid', 'router', 'modem', 'wearable', 'smartwatch', 'gps tracker'],
    directives: ['red', 'emc', 'lvd', 'rohs'],
  },
  {
    key: 'electric_toy',
    label: 'Toys with electrical or electronic components',
    keywords: ['electric toy', 'electronic toy', 'rc car', 'remote control toy', 'battery operated toy'],
    directives: ['toy_safety', 'lvd', 'emc', 'rohs'],
  },
  {
    key: 'toy',
    label: 'Toys for children under 14',
    keywords: ['toy', 'toys', 'doll', 'plush', 'puzzle', 'building block', 'pacifier', 'teether', 'rattle'],
    directives: ['toy_safety'],
  },
  {
    key: 'machinery',
    label: 'Machinery and industrial equipment',
    keywords: ['machinery', 'machine tool', 'industrial machine', 'cnc', 'press', 'conveyor', 'compressor', 'pump', 'crane', 'lift', 'forklift', 'milling'],
    directives: ['machinery', 'lvd', 'emc', 'rohs'],
  },
  {
    key: 'household_appliance',
    label: 'Household appliances and consumer electrical equipment',
    keywords: ['appliance', 'kettle', 'fridge', 'refrigerator', 'washing machine', 'oven', 'microwave', 'vacuum cleaner', 'clothes iron', 'kitchen appliance', 'household appliance'],
    directives: ['lvd', 'emc', 'rohs'],
  },
  {
    key: 'lighting',
    label: 'Lighting and lamps',
    keywords: ['lamp', 'lamps', 'led light', 'lighting', 'bulb', 'luminaire', 'fixture'],
    directives: ['lvd', 'emc', 'rohs'],
  },
  {
    key: 'electronics_general',
    label: 'Electronics and electrical equipment (general)',
    keywords: ['electronic', 'electronics', 'pcb', 'circuit board', 'sensor', 'capacitor', 'connector', 'power supply', 'transformer', 'battery'],
    directives: ['lvd', 'emc', 'rohs'],
  },
  {
    key: 'ppe',
    label: 'Personal Protective Equipment',
    keywords: ['ppe', 'safety helmet', 'hard hat', 'safety boots', 'gloves', 'respirator', 'goggles', 'safety harness', 'fall arrest', 'high-visibility'],
    directives: ['ppe'],
  },
  {
    key: 'medical_device_basic',
    label: 'Medical devices (Note: governed by MDR — outside CE marking module covered here)',
    keywords: ['medical device', 'medical equipment', 'mdr'],
    directives: [],
  },
];

const NON_EU_COUNTRY_NOTE = 'Where the manufacturer is established outside the EU, the importer must verify that an Authorised Representative (AR) has been designated and is identifiable on the product or accompanying documents.';

function detectProductClass(productCategory, productDescription) {
  const haystack = [productCategory, productDescription]
    .map(text => String(text || '').toLowerCase())
    .join(' ');
  for (const def of PRODUCT_CLASSES) {
    if (def.keywords.some(keyword => haystack.includes(keyword))) {
      return { ...def, directives: def.directives.map(id => DIRECTIVES[id]).filter(Boolean) };
    }
  }
  return null;
}

function determineCeApplicability({ productCategory, productDescription, originCountry }) {
  const productClass = detectProductClass(productCategory, productDescription);

  if (!productClass) {
    return {
      applies: 'maybe',
      reason: 'Product description does not match a CE-class heuristic in the snapshot mapping. CE marking applies to a wide range of product classes governed by New Approach directives. Verify the product against the EU Commission CE-marking guidance and the directives applicable to the product class.',
      productClassKey: null,
      directives: [],
      citation: 'Regulation (EC) 765/2008 + Decision 768/2008/EC',
      confidence: 'amber',
    };
  }

  if (productClass.directives.length === 0) {
    return {
      applies: 'out_of_scope',
      reason: `${productClass.label}. This product class is not covered by the CE-marking directives modelled here — it falls under a separate EU regulatory framework (e.g. Medical Device Regulation (EU) 2017/745 for medical devices). A specific compliance pathway is required.`,
      productClassKey: productClass.key,
      productClassLabel: productClass.label,
      directives: [],
      citation: 'Regulation (EC) 765/2008',
      confidence: 'amber',
    };
  }

  const isEuOrigin = String(originCountry || '').toUpperCase() === 'EU';

  return {
    applies: true,
    reason: `Product matches CE class "${productClass.label}". The following directives apply: ${productClass.directives.map(d => `${d.shortName} (${d.instrument})`).join('; ')}. Each directive imposes its own conformity-assessment route, but the EU Declaration of Conformity, Technical File, and CE marking obligations are common.`,
    productClassKey: productClass.key,
    productClassLabel: productClass.label,
    directives: productClass.directives.map(d => ({
      id: d.id,
      shortName: d.shortName,
      title: d.title,
      instrument: d.instrument,
      chunkId: d.chunkId,
      moduleNote: d.moduleNote,
      needsNb: d.needsNb,
    })),
    citation: 'Regulation (EC) 765/2008 + Decision 768/2008/EC + product-specific directives',
    confidence: 'amber',
    confidenceNote: isEuOrigin
      ? 'EU-origin manufacturer: importer must still verify CE marking, DoC, and Technical File availability.'
      : NON_EU_COUNTRY_NOTE,
  };
}

function buildCeEvidenceGaps({ productClassKey, directives, importerEntity, supplier, originCountry }) {
  if (!directives || !directives.length) return [];

  const isEuOrigin = String(originCountry || '').toUpperCase() === 'EU';
  const anyNbRequired = directives.some(d => d.needsNb === true || d.needsNb === 'conditional');

  const gaps = [];

  gaps.push({
    type: 'doc',
    title: 'EU Declaration of Conformity (DoC) signed by manufacturer',
    severity: 'blocker',
    owner: supplier ? `Supplier ${supplier} — manufacturer signature` : 'Manufacturer signatory',
    description: `Single DoC listing all applicable directives — for this product class: ${directives.map(d => d.shortName).join(', ')}. Must include product identification, manufacturer name and address, AR if applicable, harmonised standards used, NB identifier if NB involved, signature and date. Importer must hold a copy for at least 10 years.`,
    citation: 'Decision 768/2008/EC, Annex III',
    deadline: 'Before placing on the market',
  });

  gaps.push({
    type: 'technical_file',
    title: 'Technical File — manufacturer-held documentation per directive',
    severity: 'blocker',
    owner: 'Manufacturer (or AR holds copy)',
    description: 'Risk assessment, design and manufacturing drawings, list of harmonised standards applied, test reports against harmonised standards, instructions, warnings. Retention: 10 years after last placement on market. Must be made available to market-surveillance authorities on request.',
    citation: 'Decision 768/2008/EC, Annex II',
    deadline: 'Before placing on the market',
  });

  gaps.push({
    type: 'ce_marking',
    title: 'CE marking affixed to the product (or packaging where impossible)',
    severity: 'blocker',
    owner: importerEntity ? `${importerEntity} — verify on receipt` : 'Importer verification',
    description: 'CE marking must be visible, legible, and indelible. Where a Notified Body is involved at production stage, the NB four-digit identifier must follow the CE marking. Importer must refuse goods without proper CE marking.',
    citation: 'Regulation (EC) 765/2008, Art. 30',
    deadline: 'Before placing on the market',
  });

  if (!isEuOrigin) {
    gaps.push({
      type: 'authorised_representative',
      title: 'Authorised Representative (AR) confirmation from non-EU manufacturer',
      severity: 'high',
      owner: 'Non-EU manufacturer designates EU-established AR',
      description: 'Written mandate appointing an EU-established AR. AR holds Technical File copy, cooperates with market-surveillance authorities, is identifiable on the product or in accompanying documents.',
      citation: 'Decision 768/2008/EC, Art. R3',
      deadline: 'Before first import',
    });
  }

  if (anyNbRequired) {
    const nbDirectives = directives.filter(d => d.needsNb === true || d.needsNb === 'conditional');
    gaps.push({
      type: 'notified_body',
      title: 'Notified Body certificate (where required by directive and conformity-assessment route)',
      severity: 'high',
      owner: 'Manufacturer engages NB; importer verifies the certificate',
      description: `Some directives applicable here may require Notified Body involvement: ${nbDirectives.map(d => `${d.shortName} (${d.moduleNote})`).join('; ')}. Verify NB four-digit number on the product matches the NB that issued the certificate. Search NB list at ec.europa.eu NANDO database.`,
      citation: 'Regulation (EC) 765/2008 + product-specific directive',
      deadline: 'Before placing on the market',
    });
  }

  gaps.push({
    type: 'product_documentation',
    title: 'Instructions, safety information, and labelling in the language(s) of the destination',
    severity: 'high',
    owner: importerEntity ? `${importerEntity} — verify on receipt` : 'Importer verification',
    description: 'CE-marked products must be accompanied by instructions and safety information in the official language(s) of the destination Member State(s). The manufacturer name, registered trade name, and address must be on the product (or on the packaging / accompanying documents if the product is too small).',
    citation: 'Decision 768/2008/EC, Art. R2(7) and R4(4)',
    deadline: 'Before placing on the market',
  });

  if (directives.some(d => d.id === 'rohs') || productClassKey === 'electronics_general' || productClassKey === 'wireless_electronics') {
    gaps.push({
      type: 'rohs_substances',
      title: 'RoHS substance compliance evidence (10 substances)',
      severity: 'high',
      owner: supplier ? `Supplier ${supplier} — material declarations` : 'Supplier material declarations',
      description: 'Test reports or material declarations confirming concentrations of lead, cadmium, mercury, hexavalent chromium, PBBs, PBDEs, and four phthalates (DEHP, BBP, DBP, DIBP) below 0.1% w/w in homogeneous materials (0.01% for cadmium). Verify against any applicable Annex III/IV exemptions.',
      citation: 'Directive 2011/65/EU',
      deadline: 'Before placing on the market',
    });
  }

  return gaps;
}

function buildCePenaltyNote() {
  return {
    note: 'CE penalties are set per Member State and per directive. Common consequences: market-placing prohibition, mandatory recall, fines (administrative or criminal), and import block by customs at the point of entry. Repeat or grave breaches can trigger criminal proceedings under national law.',
    citation: 'Regulation (EC) 765/2008 + national implementing legislation',
    operationalConsequences: [
      'Customs detains shipment at EU border if CE marking or DoC is missing',
      'Mandatory recall and return of non-compliant units already placed on market',
      'Prohibition from placing further units on the market until remediated',
      'Administrative fines (jurisdiction-specific, can exceed €100,000 per breach)',
      'Criminal liability for serious or repeat offences in some Member States',
      'Reputational damage and downstream-customer loss',
    ],
  };
}

module.exports = {
  DIRECTIVES,
  PRODUCT_CLASSES,
  detectProductClass,
  determineCeApplicability,
  buildCeEvidenceGaps,
  buildCePenaltyNote,
};
