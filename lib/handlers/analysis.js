const crypto = require('crypto');
const { consumeRateLimit } = require('../intelligence/runtime-store');
const { streamAnthropicMessage } = require('../ai/model-runtime');
const { search, searchHybrid, getChunkById } = require('../intelligence/retrieval');
const {
  ETS_PRICE_SNAPSHOT,
  determineCbamApplicability,
  calculateCertificateExposure,
  calculatePenaltyExposure,
  buildCbamTimeline,
  buildCarbonPriceCredit,
  buildEvidenceGaps,
} = require('../intelligence/cbam-analysis');
const {
  determineEudrApplicability,
  getCountryRiskIndicative,
  buildEudrTimeline,
  buildEudrEvidenceGaps,
  getEudrSizeImplication,
  buildEudrPenaltyExposure,
} = require('../intelligence/eudr-analysis');
const {
  determineReachApplicability,
  buildReachEvidenceGaps,
  buildReachPenaltyNote,
} = require('../intelligence/reach-analysis');
const {
  determineCeApplicability,
  buildCeEvidenceGaps,
  buildCePenaltyNote,
} = require('../intelligence/ce-analysis');

const { MODELS } = require('../ai/models');
const ANALYSIS_MODEL = MODELS.AGENT;
const ANALYSIS_TIMEOUT_MS = 45000;
const ANALYSIS_MAX_TOKENS = 1800;

const SECTION_MARKER = /^===\s*([a-zA-Z][a-zA-Z0-9_]*)\s*===\s*$/;

function cleanString(value, max = 240) {
  return String(value || '').trim().slice(0, max);
}

function parsePositiveNumber(value) {
  const num = Number(String(value).replace(/[^\d.\-]/g, ''));
  return Number.isFinite(num) && num > 0 ? num : null;
}

function normaliseInput(body = {}) {
  return {
    company: cleanString(body.company),
    importerEntity: cleanString(body.importerEntity || body.entity),
    productCategory: cleanString(body.productCategory),
    productDescription: cleanString(body.productDescription),
    originCountry: cleanString(body.originCountry || body.origin, 80).toUpperCase().slice(0, 2) ||
      cleanString(body.originCountry || body.origin, 80),
    supplier: cleanString(body.supplier),
    hsCode: cleanString(body.hsCode || body.cnCode, 16),
    importValueEur: parsePositiveNumber(body.importValueEur || body.importValue),
    importVolumeTonnes: parsePositiveNumber(body.importVolumeTonnes || body.tonnesGoods),
    globalTurnoverEur: parsePositiveNumber(body.globalTurnoverEur || body.annualTurnover),
    authorisedDeclarant: body.authorisedDeclarant === true,
    asOfDate: cleanString(body.asOfDate, 10) || new Date().toISOString().slice(0, 10),
  };
}

function inferTonnesFromValue(importValueEur, categoryKey) {
  if (!importValueEur) return null;
  const reference = {
    cement: 110,
    iron_and_steel: 850,
    aluminium: 2600,
    fertilisers: 450,
    hydrogen: 4000,
    electricity: 70,
  }[categoryKey];
  if (!reference) return null;
  return Math.round(importValueEur / reference);
}

function openStream(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
}

function emit(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function emitSection(res, id, payload, meta = {}) {
  emit(res, { type: 'section', id, payload, ...meta });
}

function emitNarrativeDelta(res, sectionId, text) {
  emit(res, { type: 'narrative-delta', id: sectionId, text });
}

function emitNarrativeStart(res, sectionId) {
  emit(res, { type: 'narrative-start', id: sectionId });
}

function emitNarrativeEnd(res, sectionId) {
  emit(res, { type: 'narrative-end', id: sectionId });
}

function emitDone(res) {
  emit(res, { type: 'done' });
  res.end();
}

function buildCitationCards(chunkIds) {
  const seen = new Set();
  const cards = [];
  for (const id of chunkIds) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const chunk = getChunkById(id);
    if (!chunk) continue;
    cards.push({
      id: chunk.id,
      regulationId: chunk.regulationId,
      regulationLabel: chunk.regulation.shortName,
      article: chunk.article,
      title: chunk.title,
      summary: chunk.summary,
      verbatim: chunk.verbatim,
      citation: chunk.citation,
      sourceUrl: chunk.source_url,
      confidence: chunk.confidence,
    });
  }
  return cards;
}

function buildRetrievalContext(input, regulationIds) {
  const ids = (regulationIds && regulationIds.length) ? regulationIds : ['cbam', 'eudr', 'reach', 'ce'];
  const queryParts = [input.productCategory, input.productDescription];

  if (ids.includes('cbam')) {
    queryParts.push('penalty surrender certificate authorised declarant verifier embedded emissions');
  }
  if (ids.includes('eudr')) {
    queryParts.push('deforestation-free geolocation due diligence statement risk assessment');
  }
  if (ids.includes('reach')) {
    queryParts.push('SVHC candidate list Annex XVII restriction safety data sheet importer obligations');
  }
  if (ids.includes('ce')) {
    queryParts.push('CE marking declaration of conformity technical file authorised representative notified body');
  }

  const query = queryParts.filter(Boolean).join(' ');
  // Hybrid (BM25 + pgvector semantic) when RAG is configured; pure BM25 otherwise.
  // Returns a promise — callers await.
  return searchHybrid(query, { topK: 12, regulationIds: ids });
}

function buildSystemPrompt(regulationsInScope) {
  const scopeList = regulationsInScope.length
    ? regulationsInScope.map(r => r.toUpperCase()).join(', ')
    : 'CBAM, EUDR, REACH, and CE';
  return `You are an EU trade-compliance analyst writing an import compliance brief for an EU importer. The regulations in scope for this case: ${scopeList}. You are not a chatbot. You write in the register of a regulatory consultant: precise, terse, never speculative.

ABSOLUTE RULES
- Never assert a regulatory obligation, date, or numeric figure that is not present in the provided REGULATION CHUNKS or COMPUTED NUMBERS. If something would require a fact you do not have, say so explicitly and stop.
- Every regulatory claim ends with a citation in the form [chunk-id], referencing one of the provided chunks (e.g. [cbam-art-26]).
- Never invent CN codes, country emissions data, or carbon prices. If a number is not in COMPUTED NUMBERS, do not produce one.
- Use UK English. EUR figures in the form €179,100. Never round in a way that hides the calculation already shown to the user.
- Speak directly to the importer. No throat-clearing. No "as an AI". No bullet-point dump for the executive summary.

OUTPUT FORMAT
You will output exactly five sections, in order, each preceded by a marker line. Marker lines are on their own line, no blank lines before them. Format:

=== executive ===
<one-paragraph executive summary, 4-6 sentences. Plain prose. Reference at least one computed number.>

=== applicabilityNarrative ===
<one-paragraph explanation of why CBAM applies (or does not), naming the product category and country, citing the relevant chunk. 3-5 sentences.>

=== exposureNarrative ===
<one-paragraph framing of the financial exposure already computed: certificate cost, penalty risk if non-compliant. Reference the central figure and the scenario range. Cite Art. 26 for penalties. 3-5 sentences.>

=== evidenceNarrative ===
<one-paragraph framing of the evidence gaps already computed. Name the supplier if provided. Stress fail-closed: missing evidence means the importer cannot self-certify ready. 3-5 sentences.>

=== actions ===
<a JSON array of 4 to 6 ranked actions. Each item: {"rank": N, "title": "...", "owner": "...", "deadline": "YYYY-MM-DD or human-readable", "why": "...", "citations": ["chunk-id"]}. Output valid JSON, nothing before or after the array.>

End with no trailing commentary.`;
}

function buildUserPrompt({ input, cbam, eudr, reach, ce, retrievedChunks }) {
  const chunkBlock = retrievedChunks.map(hit => {
    const chunk = hit.chunk;
    return `[${chunk.id}] ${chunk.citation} — ${chunk.title}\n${chunk.summary}`;
  }).join('\n\n');

  const computedBlock = JSON.stringify({
    inputs: input,
    cbam: cbam ? {
      applies: cbam.applicability.applies,
      categoryKey: cbam.applicability.categoryKey,
      reason: cbam.applicability.reason,
      citation: cbam.applicability.citation,
      confidence: cbam.applicability.confidence,
      exposure: cbam.exposure ? {
        tonnesGoods: cbam.exposure.tonnesGoods,
        tonnesEmissionsCentral: Math.round(cbam.exposure.tonnesEmissions.central),
        certificateCostEurCentral: cbam.exposure.certificateCostEur.central,
        certificateCostEurLow: cbam.exposure.certificateCostEur.low,
        certificateCostEurHigh: cbam.exposure.certificateCostEur.high,
        etsPriceEurPerTonne: cbam.exposure.etsPrice.eurPerTonne,
        etsPriceAsOf: cbam.exposure.etsPrice.asOf,
      } : null,
      penalty: cbam.penalty ? {
        ratePerTonneEur: cbam.penalty.ratePerTonneEur,
        penaltyEur: cbam.penalty.penaltyEur,
        scenario: cbam.penalty.scenario,
      } : null,
      evidenceGaps: cbam.evidenceGaps.map(gap => ({ title: gap.title, severity: gap.severity, citation: gap.citation })),
      carbonPriceCredit: cbam.carbonPriceCredit,
    } : null,
    eudr: eudr ? {
      applies: eudr.applicability.applies,
      commodityKey: eudr.applicability.commodityKey,
      reason: eudr.applicability.reason,
      citation: eudr.applicability.citation,
      confidence: eudr.applicability.confidence,
      countryRisk: eudr.countryRisk,
      sizeImplication: eudr.sizeImplication,
      penalty: eudr.penalty ? {
        penaltyCeilingEur: eudr.penalty.penaltyCeilingEur,
        rate: eudr.penalty.rate,
      } : null,
      evidenceGaps: eudr.evidenceGaps.map(gap => ({ title: gap.title, severity: gap.severity, citation: gap.citation })),
    } : null,
    reach: reach ? {
      applies: reach.applicability.applies,
      categoryKey: reach.applicability.categoryKey,
      categoryLabel: reach.applicability.categoryLabel,
      reason: reach.applicability.reason,
      commonConcerns: reach.applicability.commonConcerns,
      citation: reach.applicability.citation,
      confidence: reach.applicability.confidence,
      penaltyNote: reach.penaltyNote ? { note: reach.penaltyNote.note, citation: reach.penaltyNote.citation } : null,
      evidenceGaps: reach.evidenceGaps.map(gap => ({ title: gap.title, severity: gap.severity, citation: gap.citation })),
    } : null,
    ce: ce ? {
      applies: ce.applicability.applies,
      productClassKey: ce.applicability.productClassKey,
      productClassLabel: ce.applicability.productClassLabel,
      reason: ce.applicability.reason,
      directives: (ce.applicability.directives || []).map(d => ({ shortName: d.shortName, instrument: d.instrument, moduleNote: d.moduleNote })),
      citation: ce.applicability.citation,
      confidence: ce.applicability.confidence,
      penaltyNote: ce.penaltyNote ? { note: ce.penaltyNote.note, citation: ce.penaltyNote.citation } : null,
      evidenceGaps: ce.evidenceGaps.map(gap => ({ title: gap.title, severity: gap.severity, citation: gap.citation })),
    } : null,
  }, null, 2);

  return `IMPORTER CASE
${JSON.stringify(input, null, 2)}

REGULATION CHUNKS (you may cite ONLY these chunk-ids — they include both CBAM and EUDR articles)
${chunkBlock}

COMPUTED NUMBERS (treat as ground truth; do not recompute)
${computedBlock}

Now write the five-section report. If both CBAM and EUDR apply, cover both — name them explicitly and use the appropriate citations. If only one applies, focus on that one. Do not invent obligations from regulations not in scope. Be specific to this importer.`;
}

class NarrativeStreamRouter {
  constructor(res) {
    this.res = res;
    this.currentSection = null;
    this.lineBuffer = '';
    this.activeSections = new Set();
  }

  ingest(text) {
    this.lineBuffer += text;
    let newlineIndex = this.lineBuffer.indexOf('\n');
    while (newlineIndex !== -1) {
      const line = this.lineBuffer.slice(0, newlineIndex);
      this.lineBuffer = this.lineBuffer.slice(newlineIndex + 1);
      this.processLine(line, true);
      newlineIndex = this.lineBuffer.indexOf('\n');
    }
    this.processLine(this.lineBuffer, false);
    this.lineBuffer = '';
  }

  processLine(line, hasNewline) {
    const markerMatch = SECTION_MARKER.exec(line.trim());
    if (markerMatch) {
      this.closeCurrent();
      this.currentSection = markerMatch[1];
      this.activeSections.add(this.currentSection);
      emitNarrativeStart(this.res, this.currentSection);
      return;
    }

    if (!this.currentSection) {
      return;
    }

    const text = hasNewline ? line + '\n' : line;
    if (text) {
      emitNarrativeDelta(this.res, this.currentSection, text);
    }

    if (!hasNewline) {
      this.lineBuffer = '';
    }
  }

  closeCurrent() {
    if (this.currentSection) {
      emitNarrativeEnd(this.res, this.currentSection);
      this.currentSection = null;
    }
  }

  finish() {
    if (this.lineBuffer && this.currentSection) {
      emitNarrativeDelta(this.res, this.currentSection, this.lineBuffer);
      this.lineBuffer = '';
    }
    this.closeCurrent();
  }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  const rate = await consumeRateLimit('analysis', ip, 6, 60000);
  if (rate.limited) {
    return res.status(429).json({ error: 'Too many analyses requested. Please wait a moment.' });
  }

  const input = normaliseInput(req.body || {});
  if (!input.productCategory && !input.productDescription) {
    return res.status(400).json({ error: 'productCategory or productDescription is required.' });
  }

  const reportId = `cbam_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
  const generatedAt = new Date().toISOString();

  openStream(res);

  emitSection(res, 'meta', {
    reportId,
    generatedAt,
    asOfDate: input.asOfDate,
    regulation: { id: 'cbam', shortName: 'CBAM', longName: 'Carbon Border Adjustment Mechanism', instrument: 'Regulation (EU) 2023/956' },
    confidence: {
      regulationCorpus: 'summary',
      regulationCorpusNote: 'Corpus uses summarised articles; verbatim text is the next upgrade. Article numbers and citations are accurate; legal interpretation requires the official text.',
      defaultEmissions: 'indicative',
      etsPrice: 'snapshot',
      etsPriceAsOf: ETS_PRICE_SNAPSHOT.asOf,
    },
  });

  emitSection(res, 'inputs', input);

  // ── CBAM analysis ─────────────────────────────────
  const cbamApplicability = determineCbamApplicability({
    productCategory: input.productCategory,
    productDescription: input.productDescription,
    originCountry: input.originCountry,
    hsCode: input.hsCode,
  });
  emitSection(res, 'applicability', { regulationId: 'cbam', ...cbamApplicability });

  let cbam = null;
  if (cbamApplicability.applies) {
    const tonnesGoods = input.importVolumeTonnes || inferTonnesFromValue(input.importValueEur, cbamApplicability.categoryKey);
    const cbamExposure = tonnesGoods ? calculateCertificateExposure({ tonnesGoods, categoryKey: cbamApplicability.categoryKey }) : null;
    const cbamPenalty = cbamExposure ? calculatePenaltyExposure({ tonnesEmissions: cbamExposure.tonnesEmissions.central, isAuthorisedDeclarant: input.authorisedDeclarant }) : null;
    const cbamEvidenceGaps = buildEvidenceGaps({
      categoryKey: cbamApplicability.categoryKey,
      importerEntity: input.importerEntity || input.company,
      supplier: input.supplier,
      originCountry: input.originCountry,
      asOfDate: input.asOfDate,
      authorisedDeclarant: input.authorisedDeclarant,
    });
    const cbamCarbonCredit = buildCarbonPriceCredit(input.originCountry, cbamExposure ? cbamExposure.tonnesEmissions.central : 0);

    cbam = {
      applicability: cbamApplicability,
      exposure: cbamExposure,
      penalty: cbamPenalty,
      evidenceGaps: cbamEvidenceGaps,
      carbonPriceCredit: cbamCarbonCredit,
    };

    emitSection(res, 'exposure', cbamExposure ? {
      regulationId: 'cbam',
      tonnesGoods: cbamExposure.tonnesGoods,
      tonnesGoodsInferred: !input.importVolumeTonnes,
      intensity: cbamExposure.intensity,
      tonnesEmissions: cbamExposure.tonnesEmissions,
      etsPrice: cbamExposure.etsPrice,
      certificateCostEur: cbamExposure.certificateCostEur,
      calc: cbamExposure.calc,
    } : { regulationId: 'cbam', unavailable: true, reason: 'Provide importValueEur or importVolumeTonnes to compute CBAM exposure.' });

    emitSection(res, 'penalty', { regulationId: 'cbam', ...(cbamPenalty || {}) });
    emitSection(res, 'evidenceGaps', { regulationId: 'cbam', items: cbamEvidenceGaps });
    emitSection(res, 'carbonPriceCredit', cbamCarbonCredit);
  }

  // ── EUDR analysis ─────────────────────────────────
  const eudrApplicability = determineEudrApplicability({
    productCategory: input.productCategory,
    productDescription: input.productDescription,
    originCountry: input.originCountry,
    importerEntity: input.importerEntity || input.company,
  });
  emitSection(res, 'eudr-applicability', { regulationId: 'eudr', ...eudrApplicability });

  let eudr = null;
  if (eudrApplicability.applies) {
    const sizeImplication = getEudrSizeImplication(input.globalTurnoverEur);
    const isSME = sizeImplication ? ['micro', 'small'].includes(sizeImplication.size) : false;
    const eudrEvidenceGaps = buildEudrEvidenceGaps({
      commodityKey: eudrApplicability.commodityKey,
      importerEntity: input.importerEntity || input.company,
      supplier: input.supplier,
      originCountry: input.originCountry,
      isSME,
    });
    const countryRisk = getCountryRiskIndicative(input.originCountry);
    const eudrPenalty = buildEudrPenaltyExposure({ globalTurnoverEur: input.globalTurnoverEur });

    eudr = {
      applicability: eudrApplicability,
      countryRisk,
      sizeImplication,
      isSME,
      evidenceGaps: eudrEvidenceGaps,
      penalty: eudrPenalty,
    };

    emitSection(res, 'eudr-exposure', {
      regulationId: 'eudr',
      countryRisk,
      sizeImplication,
      penalty: eudrPenalty,
    });
    emitSection(res, 'eudr-evidenceGaps', { regulationId: 'eudr', items: eudrEvidenceGaps });
  }

  // ── REACH analysis ────────────────────────────────
  const reachApplicability = determineReachApplicability({
    productCategory: input.productCategory,
    productDescription: input.productDescription,
    originCountry: input.originCountry,
  });
  emitSection(res, 'reach-applicability', { regulationId: 'reach', ...reachApplicability });

  let reach = null;
  if (reachApplicability.applies === true || reachApplicability.applies === 'maybe') {
    const reachEvidenceGaps = buildReachEvidenceGaps({
      categoryKey: reachApplicability.categoryKey,
      importerEntity: input.importerEntity || input.company,
      supplier: input.supplier,
      originCountry: input.originCountry,
    });
    const reachPenaltyNote = buildReachPenaltyNote({ destinationCountry: input.destinationCountry });
    reach = {
      applicability: reachApplicability,
      evidenceGaps: reachEvidenceGaps,
      penaltyNote: reachPenaltyNote,
    };
    emitSection(res, 'reach-evidenceGaps', { regulationId: 'reach', items: reachEvidenceGaps });
    emitSection(res, 'reach-penalty', { regulationId: 'reach', ...reachPenaltyNote });
  }

  // ── CE analysis ───────────────────────────────────
  const ceApplicability = determineCeApplicability({
    productCategory: input.productCategory,
    productDescription: input.productDescription,
    originCountry: input.originCountry,
  });
  emitSection(res, 'ce-applicability', { regulationId: 'ce', ...ceApplicability });

  let ce = null;
  if (ceApplicability.applies === true) {
    const ceEvidenceGaps = buildCeEvidenceGaps({
      productClassKey: ceApplicability.productClassKey,
      directives: ceApplicability.directives,
      importerEntity: input.importerEntity || input.company,
      supplier: input.supplier,
      originCountry: input.originCountry,
    });
    const cePenaltyNote = buildCePenaltyNote();
    ce = {
      applicability: ceApplicability,
      evidenceGaps: ceEvidenceGaps,
      penaltyNote: cePenaltyNote,
    };
    emitSection(res, 'ce-evidenceGaps', { regulationId: 'ce', items: ceEvidenceGaps });
    emitSection(res, 'ce-penalty', { regulationId: 'ce', ...cePenaltyNote });
  }

  // ── Combined timeline ─────────────────────────────
  const cbamTimeline = buildCbamTimeline({ asOfDate: input.asOfDate });
  const eudrTimeline = eudr ? buildEudrTimeline({ asOfDate: input.asOfDate, isSME: eudr.isSME }) : [];
  const combinedTimeline = [...cbamTimeline, ...eudrTimeline].sort((a, b) => a.date.localeCompare(b.date));
  emitSection(res, 'timeline', { events: combinedTimeline });

  // ── Citations from both corpora ───────────────────
  const activeRegulationIds = [cbam ? 'cbam' : null, eudr ? 'eudr' : null, reach ? 'reach' : null, ce ? 'ce' : null].filter(Boolean);
  const retrievedChunks = await buildRetrievalContext(input, activeRegulationIds);
  emitSection(res, 'citations', { items: buildCitationCards(retrievedChunks.map(hit => hit.chunk.id)) });

  // ── Bail out if nothing applies ───────────────────
  if (!cbam && !eudr && !reach && !ce) {
    emitSection(res, 'narrative', {
      fallback: `None of CBAM, EUDR, REACH, or CE appears to apply to this case. ${cbamApplicability.reason} ${eudrApplicability.reason} ${reachApplicability.reason} ${ceApplicability.reason}`,
    });
    return emitDone(res);
  }

  if (!(process.env.ANTHROPIC_API_KEY || process.env.ORCATRADE_OS_API)) {
    emitSection(res, 'narrative', {
      fallback: 'Narrative generation requires ANTHROPIC_API_KEY. Deterministic sections above are complete and citation-grounded.',
    });
    return emitDone(res);
  }

  const regulationsInScope = activeRegulationIds;
  const router = new NarrativeStreamRouter(res);

  try {
    await streamAnthropicMessage({
      apiKey: (process.env.ANTHROPIC_API_KEY || process.env.ORCATRADE_OS_API),
      model: ANALYSIS_MODEL,
      maxTokens: ANALYSIS_MAX_TOKENS,
      system: buildSystemPrompt(regulationsInScope),
      messages: [{
        role: 'user',
        content: buildUserPrompt({ input, cbam, eudr, reach, ce, retrievedChunks }),
      }],
      timeoutMs: ANALYSIS_TIMEOUT_MS,
      retries: 0,
      onText: async text => {
        router.ingest(text);
      },
    });
    router.finish();
  } catch (error) {
    console.error('Analysis narrative error:', error);
    router.finish();
    emit(res, { type: 'narrative-error', message: 'Narrative generation failed. Deterministic sections are unaffected.' });
  }

  emitDone(res);
};
