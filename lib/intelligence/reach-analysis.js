const REACH_THRESHOLDS = {
  registrationTonnesPerYear: 1,
  csrTonnesPerYear: 10,
  svhcConcentrationPercentWW: 0.1,
  svhcConsumerResponseDays: 45,
};

// Product categories where REACH risk is high → restrictions, SVHCs commonly found.
// This is intentionally broad; the agent should flag these as "high relevance" and
// surface specific Annex XVII / Candidate-List entries to verify against.
const HIGH_RELEVANCE_CATEGORIES = {
  electronics: {
    label: 'Electronics and electrical equipment',
    keywords: ['electronic', 'electronics', 'pcb', 'circuit board', 'cable', 'connector', 'battery', 'capacitor', 'led', 'sensor', 'motor'],
    commonConcerns: ['Lead and lead compounds', 'Cadmium', 'Mercury', 'Hexavalent chromium', 'PBBs / PBDEs', 'Phthalates (DEHP, BBP, DBP, DIBP)'],
  },
  textiles: {
    label: 'Textiles, apparel, footwear',
    keywords: ['textile', 'apparel', 'clothing', 'garment', 'fabric', 'leather', 'shoe', 'footwear', 'denim'],
    commonConcerns: ['Azo dyes (carcinogenic amines)', 'Nonylphenol ethoxylates (NPE)', 'Per- and polyfluoroalkyl substances (PFAS)', 'Chromium(VI) in leather', 'Phthalates in coatings'],
  },
  toys: {
    label: 'Toys and childcare articles',
    keywords: ['toy', 'toys', 'doll', 'plush', 'childcare', 'pacifier', 'teether'],
    commonConcerns: ['Phthalates (DEHP, BBP, DBP — Annex XVII Entry 51)', 'Lead and cadmium', 'Heavy metals in surface coatings', 'Bisphenol A (BPA) in childcare items'],
  },
  cosmetics: {
    label: 'Cosmetics and personal care',
    keywords: ['cosmetic', 'cosmetics', 'shampoo', 'lotion', 'cream', 'perfume', 'fragrance', 'soap'],
    commonConcerns: ['CMR substances (Annex XVII Entry 28-30)', 'Allergenic fragrances (Cosmetic Product Regulation interaction)', 'Microbeads / microplastics'],
  },
  furniture: {
    label: 'Furniture, mattresses, upholstery',
    keywords: ['furniture', 'mattress', 'upholstery', 'sofa', 'chair', 'cabinet', 'table'],
    commonConcerns: ['Flame retardants (TCEP, TCPP, decaBDE)', 'Formaldehyde emissions from wood-based panels', 'Phthalates in foams'],
  },
  packaging: {
    label: 'Packaging materials',
    keywords: ['packaging', 'pack', 'bottle', 'container', 'pouch', 'film', 'wrap'],
    commonConcerns: ['Heavy metals in inks', 'Bisphenols in food-contact', 'Per- and polyfluoroalkyl substances (PFAS) in coatings'],
  },
  construction: {
    label: 'Construction and building products',
    keywords: ['construction', 'building', 'paint', 'coating', 'sealant', 'adhesive', 'insulation', 'tile', 'flooring'],
    commonConcerns: ['Asbestos (banned)', 'Diisocyanates (Annex XVII Entry 74)', 'Lead chromates in pigments', 'VOC emissions'],
  },
  jewellery: {
    label: 'Jewellery and metal accessories',
    keywords: ['jewellery', 'jewelry', 'bracelet', 'necklace', 'ring', 'earring', 'watch'],
    commonConcerns: ['Lead in jewellery (Annex XVII Entry 63)', 'Cadmium (Annex XVII Entry 23)', 'Nickel release (Annex XVII Entry 27)'],
  },
};

const MEMBER_STATE_PENALTY_NOTES = {
  PL: 'Poland — Inspekcja Handlowa and Inspekcja Ochrony Środowiska enforce REACH. Administrative fines are typical; severe breaches can result in criminal liability under environmental protection law.',
  DE: 'Germany — Bundesanstalt für Arbeitsschutz und Arbeitsmedizin (BAuA) is the REACH competent authority. Federal and Länder authorities issue fines; serious violations can exceed €100,000 per breach and trigger criminal proceedings.',
  FR: 'France — DREAL and the Ministry of Ecological Transition enforce REACH. Fines can reach €750,000 for legal entities under environmental code provisions.',
  NL: 'Netherlands — Inspectie Leefomgeving en Transport (ILT) is the competent authority. Fines vary by infraction; criminal liability available for grave breaches.',
  IT: 'Italy — Ministry of Health and Carabinieri NOE enforce REACH. Penalties under Legislative Decree 133/2009.',
};

function detectReachRelevance(productCategory, productDescription) {
  const haystack = [productCategory, productDescription]
    .map(text => String(text || '').toLowerCase())
    .join(' ');
  for (const [key, def] of Object.entries(HIGH_RELEVANCE_CATEGORIES)) {
    if (def.keywords.some(keyword => haystack.includes(keyword))) {
      return { categoryKey: key, label: def.label, commonConcerns: def.commonConcerns };
    }
  }
  return null;
}

function determineReachApplicability({ productCategory, productDescription, originCountry }) {
  // REACH is broadly applicable: any imported substance, mixture, or article potentially triggers
  // some obligation. We don't gate the answer on origin (REACH applies regardless), only on
  // whether the product appears to fall within REACH's substance/mixture/article framing.
  const relevance = detectReachRelevance(productCategory, productDescription);
  const isEuOrigin = String(originCountry || '').toUpperCase() === 'EU';

  if (!relevance) {
    return {
      applies: 'maybe',
      reason: 'Product description does not match a high-relevance REACH category in the snapshot mapping. REACH still applies in principle to any imported article that contains chemical substances — verify against Safety Data Sheets and the SVHC Candidate List.',
      categoryKey: null,
      citation: 'Regulation (EC) 1907/2006, Art. 1 and Art. 7',
      confidence: 'amber',
    };
  }

  return {
    applies: true,
    reason: `Product category "${relevance.label}" is high-relevance for REACH. Common substance concerns in this category: ${relevance.commonConcerns.slice(0, 3).join('; ')}. Specific obligations depend on substance identity, concentration, and tonnage per importer per year.`,
    categoryKey: relevance.categoryKey,
    categoryLabel: relevance.label,
    commonConcerns: relevance.commonConcerns,
    citation: 'Regulation (EC) 1907/2006, Art. 1, Art. 7, and Annex XVII',
    confidence: 'amber',
    confidenceNote: isEuOrigin
      ? 'EU-origin articles still trigger REACH obligations — origin is not a determining factor for applicability.'
      : 'Non-EU origin: importer obligations apply per Art. 3(11). Confirm whether an Only Representative (Art. 8) has been appointed by the manufacturer.',
  };
}

function buildReachEvidenceGaps({ categoryKey, importerEntity, supplier, originCountry }) {
  const isEuOrigin = String(originCountry || '').toUpperCase() === 'EU';
  const gaps = [];

  gaps.push({
    type: 'sds',
    title: 'Safety Data Sheet (SDS) for each hazardous substance / mixture',
    severity: 'high',
    owner: supplier ? `Supplier ${supplier} — formulator or importer's chemical contact` : "Supplier's chemical compliance contact",
    description: 'SDS must comply with Annex II and be provided in the official language(s) of the destination Member State(s). Required where the substance/mixture is hazardous, contains an SVHC ≥ 0.1% w/w, or has Community workplace exposure limits.',
    citation: 'Regulation (EC) 1907/2006, Art. 31 and Annex II',
    deadline: 'Before placing on the market',
  });

  gaps.push({
    type: 'svhc_declaration',
    title: 'SVHC declaration from supplier (Art. 33 communication)',
    severity: 'high',
    owner: supplier ? `Supplier ${supplier}` : 'Supplier — production-side compliance',
    description: 'Written confirmation of whether any substance on the SVHC Candidate List is present at or above 0.1% w/w in any article. If yes: substance name and safe-use information. The list is updated by ECHA approximately twice a year.',
    citation: 'Regulation (EC) 1907/2006, Art. 33',
    deadline: 'Before placing on the market; refresh on each Candidate List update',
  });

  gaps.push({
    type: 'annex_xvii_compliance',
    title: 'Compliance with Annex XVII restrictions',
    severity: categoryKey ? 'high' : 'medium',
    owner: importerEntity ? `${importerEntity} — internal compliance, with supplier evidence` : 'Internal compliance',
    description: categoryKey
      ? `Annex XVII contains specific entries relevant to ${HIGH_RELEVANCE_CATEGORIES[categoryKey]?.label || 'this category'}. Supplier must confirm restricted substances are absent or below the relevant concentration limit. Test reports from accredited laboratories are typical evidence.`
      : 'Verify the product against Annex XVII restrictions. Substances of common concern: lead, cadmium, hexavalent chromium, certain phthalates, asbestos, PFOA, azo dyes.',
    citation: 'Regulation (EC) 1907/2006, Art. 67–68 and Annex XVII',
    deadline: 'Before placing on the market',
  });

  gaps.push({
    type: 'authorisation_xiv',
    title: 'Authorisation evidence for any Annex XIV substance',
    severity: 'medium',
    owner: 'Importer or upstream Only Representative',
    description: 'If the article contains a substance on Annex XIV (the Authorisation List) for an applicable use after the sunset date, an authorisation must have been granted by the Commission. Confirm with the supplier whether this applies.',
    citation: 'Regulation (EC) 1907/2006, Art. 56–59 and Annex XIV',
    deadline: 'Before placing on the market',
  });

  gaps.push({
    type: 'tonnage_assessment',
    title: 'Tonnage assessment for registration / SVHC notification',
    severity: 'medium',
    owner: importerEntity ? `${importerEntity} — internal procurement records` : 'Internal procurement',
    description: 'Track annual import tonnage of each substance per legal entity. Triggers: ≥ 1 t/yr → registration may be required (or appointed Only Representative). For SVHCs intentionally released or > 0.1% w/w in articles AND > 1 t/yr → ECHA notification under Art. 7(2).',
    citation: 'Regulation (EC) 1907/2006, Art. 5, Art. 6, and Art. 7',
    deadline: 'Annually; before placing first batch',
  });

  if (!isEuOrigin) {
    gaps.push({
      type: 'only_representative',
      title: 'Only Representative (OR) confirmation from non-EU manufacturer',
      severity: 'medium',
      owner: 'Non-EU manufacturer — appoints an OR established in the EU',
      description: 'If the non-EU manufacturer has appointed an Only Representative, the importer becomes a downstream user with reduced obligations. Confirm OR status in writing; without OR, full importer obligations apply.',
      citation: 'Regulation (EC) 1907/2006, Art. 8',
      deadline: 'Before first import',
    });
  }

  return gaps;
}

function buildReachPenaltyNote({ destinationCountry }) {
  const code = String(destinationCountry || '').toUpperCase();
  const memberStateNote = MEMBER_STATE_PENALTY_NOTES[code];
  return {
    note: 'REACH penalties are set by each Member State under Art. 126 — they vary in form (administrative fines, criminal liability) and amount. Common consequences across the EU: import block, product recall, market-placing prohibition, fines, and in serious cases criminal proceedings.',
    citation: 'Regulation (EC) 1907/2006, Art. 126',
    memberStateSpecific: memberStateNote || null,
    operationalConsequences: [
      'Import block by customs at the point of entry',
      'Mandatory product recall from the EU market',
      'Prohibition from placing further units on the market',
      'Fines (administrative or criminal, varying by Member State)',
      'Reputational harm and downstream-customer loss of confidence',
    ],
  };
}

module.exports = {
  REACH_THRESHOLDS,
  HIGH_RELEVANCE_CATEGORIES,
  MEMBER_STATE_PENALTY_NOTES,
  detectReachRelevance,
  determineReachApplicability,
  buildReachEvidenceGaps,
  buildReachPenaltyNote,
};
