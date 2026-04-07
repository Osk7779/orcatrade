const LIVE_PILLARS = {
  supply_chain: {
    key: 'supply_chain',
    label: 'Track your shipments',
    route: '/supply-chain/',
    summary: 'Shipment tracking, port conditions, and disruption forecasts across the supplier network.',
    inputs: 'company, sourcing country, destination port, active suppliers, product categories',
  },
  compliance: {
    key: 'compliance',
    label: 'Is your order compliant?',
    route: '/compliance/',
    summary: 'Order-level checks for EUDR, CBAM, and CSDDD with specific actions and risk exposure.',
    inputs: 'product category, product description, origin, supplier name, import value, company size',
  },
  factory_risk: {
    key: 'factory_risk',
    label: 'Find and score any factory',
    route: '/factory-risk/',
    summary: 'Factory search with risk, compliance, capacity, audit, and stability scoring.',
    inputs: 'factory name or product query, product category, country, risk tolerance',
  },
};

const INTENT_KEYWORDS = {
  supply_chain: [
    'shipment',
    'shipments',
    'track',
    'tracking',
    'eta',
    'port',
    'ports',
    'container',
    'containers',
    'vessel',
    'freight',
    'logistics',
    'delay',
    'delayed',
    'disruption',
    'transit',
  ],
  compliance: [
    'compliance',
    'compliant',
    'eudr',
    'cbam',
    'csddd',
    'due diligence',
    'regulation',
    'regulations',
    'article',
    'import order',
    'eu market',
    'legal',
    'document',
  ],
  factory_risk: [
    'factory',
    'factories',
    'supplier',
    'suppliers',
    'manufacturer',
    'manufacturers',
    'audit',
    'capacity',
    'stability',
    'score',
    'risk score',
    'find factory',
    'verified manufacturer',
  ],
};

function cleanText(text) {
  return String(text || '').trim();
}

function scoreIntent(text, keywords) {
  const haystack = cleanText(text).toLowerCase();
  return keywords.reduce((total, keyword) => total + (haystack.includes(keyword) ? 1 : 0), 0);
}

function detectPillarIntent(text) {
  const scores = Object.entries(INTENT_KEYWORDS).map(([key, keywords]) => ({
    key,
    score: scoreIntent(text, keywords),
  }));

  scores.sort((a, b) => b.score - a.score);
  if (!scores[0] || scores[0].score === 0) return 'triage';
  if (scores[1] && scores[1].score === scores[0].score) return 'triage';
  return scores[0].key;
}

function isCapabilityQuestion(text) {
  return /\b(what can you do|what do you do|how can you help|which pillar|live now|what is live|focus|intelligence)\b/i.test(cleanText(text));
}

// General OrcaTrade company questions that should be answered even if they
// don't map to a specific Intelligence pillar (e.g. "who are you?", "where
// are you based?", "how does sourcing work?", "what do you source?")
function isGeneralCompanyQuestion(text) {
  return /\b(orcatrade|sourcing|who are you|about you|your team|your office|contact|email|pricing|price|cost|quote|moq|minimum order|lead time|how do you|how does|what do you|where are you|warsaw|london|hong kong|ucl|co.founder|founder|jay|arman|oskar|yiu|finance|search|units|services|get in touch|reach you|hello|hi|hey|certificate|declarant|declaration|threshold|penalty|penalties|fine|fines|import|imports|importer|goods|cbam|eudr|regulation|compliance|compliant)\b/i.test(cleanText(text));
}

function isOutOfScope(text) {
  const trimmed = cleanText(text);
  if (!trimmed) return false;
  if (isCapabilityQuestion(trimmed)) return false;
  if (isGeneralCompanyQuestion(trimmed)) return false;
  if (detectPillarIntent(trimmed) !== 'triage') return false;
  return true;
}

function buildPillarMenu() {
  return [
    `1. ${LIVE_PILLARS.supply_chain.label} via ${LIVE_PILLARS.supply_chain.route}`,
    `2. ${LIVE_PILLARS.compliance.label} via ${LIVE_PILLARS.compliance.route}`,
    `3. ${LIVE_PILLARS.factory_risk.label} via ${LIVE_PILLARS.factory_risk.route}`,
  ].join('\n');
}

function buildFocusedSystemPrompt(intent) {
  const focus = LIVE_PILLARS[intent];
  const scopeBlock = Object.values(LIVE_PILLARS)
    .map(pillar => `- ${pillar.label} (${pillar.route}): ${pillar.summary}`)
    .join('\n');

  const focusBlock = focus
    ? `Current focus: ${focus.label}. Prioritise ${focus.summary.toLowerCase()} Ask for the minimum missing input only when needed: ${focus.inputs}.`
    : 'Current focus: triage between the three live pillars and route the user to the correct workflow.';

  return `You are OrcaTrade Intelligence.
You are NOT a general OrcaTrade Group chatbot. You only help with these three live pillars:
${scopeBlock}

Rules:
- Stay inside the three live pillars only.
- Never invent live data, legal facts, shipment statuses, factory audits, or scores.
- If the user has not provided the shipment/order/factory details you need, ask for the single most important missing detail instead of guessing.
- If the user is better served by the product workflow, name the exact route: /supply-chain/, /compliance/, or /factory-risk/.
- Keep replies concise, operational, and precise. Max 4 sentences unless the user asks for detail.
- If the user asks about something outside these pillars, say you are focused on the three live workflows and offer the right route.

${focusBlock}`;
}

function buildTriageReply() {
  return `I stay focused on three live OrcaTrade Intelligence workflows:\n${buildPillarMenu()}\nTell me which one you want, and I’ll keep the answer precise.`;
}

function buildOutOfScopeReply() {
  return `I’m focused on three live OrcaTrade Intelligence workflows only:\n${buildPillarMenu()}\nIf you tell me whether this is about shipments, compliance, or factory scoring, I’ll keep it precise.`;
}

function buildLocalFallbackReply(intent) {
  if (intent === 'supply_chain') {
    return `For shipment intelligence, open /supply-chain/ and enter the sourcing country, destination port, supplier count, and product categories. That workflow is focused on shipment status, port conditions, and disruption forecasts only.`;
  }

  if (intent === 'compliance') {
    return `For compliance, open /compliance/ and enter the product category, description, origin, import value, and company size. That workflow checks EUDR, CBAM, and CSDDD and returns action steps.`;
  }

  if (intent === 'factory_risk') {
    return `For factory intelligence, open /factory-risk/ and search by supplier name or product, then add the country and category filters. That workflow is focused on risk, compliance, capacity, audit, and stability scoring.`;
  }

  return buildTriageReply();
}

module.exports = {
  LIVE_PILLARS,
  buildFocusedSystemPrompt,
  buildLocalFallbackReply,
  buildOutOfScopeReply,
  buildPillarMenu,
  buildTriageReply,
  detectPillarIntent,
  isCapabilityQuestion,
  isOutOfScope,
};
