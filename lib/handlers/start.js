// Import Plan Builder backend.
//
// Takes a shipper profile from POST /api/start, orchestrates the four
// platform calculators (sourcing → routing → customs → warehouse) into
// a single personalised import plan, optionally sends a summary email to
// the user via Resend, and returns the structured plan as JSON for the
// wizard to render.

const { consumeRateLimit } = require('../intelligence/runtime-store');
const { currentProvenance } = require('../intelligence/provenance');
const sourcing = require('../intelligence/sourcing-quote');
const routing = require('../intelligence/routing-quote');
const customs = require('../intelligence/customs-quote');
const warehouse = require('../intelligence/warehouse-quote');
const { encodeInputs } = require('../utils/plan-codec');
const { STRINGS: EMAIL_STRINGS, pickLocale } = require('../start-i18n');
const compliance = require('../intelligence/data/eu-compliance');
const fx = require('../intelligence/fx-quote');
const tco = require('../intelligence/tco-quote');
const workingCapital = require('../intelligence/working-capital');
const events = require('../events');
const log = require('../log').withContext({ handler: 'start' });
const circuit = require('../circuit');
const implementationRoadmap = require('../intelligence/implementation-roadmap');

const SITE_ORIGIN = process.env.SITE_ORIGIN || 'https://orcatrade.pl';

function localeWizardPath(locale) {
  return locale === 'en' ? '/start/' : `/${locale}/start/`;
}

// ── Validation ─────────────────────────────────────────────

function validateInput(input) {
  const errors = [];
  if (!input || typeof input !== 'object') {
    errors.push('Input must be an object');
    return { ok: false, errors };
  }

  if (!input.productCategory) errors.push('productCategory required');
  if (!input.originCountry) errors.push('originCountry required');
  if (!input.destinationCountry) errors.push('destinationCountry required');

  const customsValue = Number(input.customsValueEur);
  if (!Number.isFinite(customsValue) || customsValue <= 0) errors.push('customsValueEur must be > 0');
  if (customsValue > 10_000_000) errors.push('customsValueEur exceeds €10M (contact us for very large consignments)');

  const weight = Number(input.weightKg);
  if (!Number.isFinite(weight) || weight <= 0) errors.push('weightKg must be > 0');

  if (input.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(input.email))) {
    errors.push('email must be a valid address');
  }

  return errors.length ? { ok: false, errors } : { ok: true };
}

// ── HS-chapter mapping for category → likely chapter ───────

const CATEGORY_TO_HS = {
  apparel:     '62',  // Default to woven; could also be 61
  electronics: '85',
  furniture:   '94',
  toys:        '95',
  cosmetics:   '33',
  homeware:    '69',
  footwear:    '64',
  machinery:   '84',
};

// ── Plan composition ───────────────────────────────────────

// composePlan is async so we can run the TARIC live-rate lookup (Sprint D)
// inside the customs step. The TARIC lookup is no-op for HS codes shorter
// than 8 digits — chapter-level inputs return immediately, identical to
// the previous sync path. Concrete-HS inputs do a ~4s-max upstream call
// with KV caching, then fall back to the chapter estimator on any failure.
async function composePlan(input, { pinnedData = null } = {}) {
  const validation = validateInput(input);
  if (!validation.ok) return { ok: false, errors: validation.errors };

  const productCategory = input.productCategory;
  const originCountry = String(input.originCountry).toUpperCase();
  const destinationCountry = String(input.destinationCountry).toUpperCase();
  const customsValueEur = Number(input.customsValueEur);
  const weightKg = Number(input.weightKg);
  const linesCount = Math.max(1, Math.floor(Number(input.linesCount) || 1));
  const urgencyWeeks = Number(input.urgencyWeeks) || null;
  const monthlyOrders = Number(input.monthlyOrders) || null;
  const claimPreferential = input.claimPreferential === true || input.claimPreferential === 'true';
  const moq = Number(input.moq) || null;
  const targetFobUnitEur = Number(input.targetFobUnitEur) || null;
  const quoteCurrency = input.quoteCurrency ? String(input.quoteCurrency).toUpperCase() : 'EUR';
  const paymentTermsDays = Number(input.paymentTermsDays) || 60;
  const shipmentsPerYear = Number(input.shipmentsPerYear) || tco.DEFAULT_SHIPMENTS_PER_YEAR;
  const waccPct = Number(input.waccPct) || tco.DEFAULT_WACC_PCT;
  const daysInInventory = Number(input.daysInInventory) || tco.DEFAULT_DAYS_IN_INVENTORY;
  const daysReceivable = input.daysReceivable != null ? Number(input.daysReceivable) : workingCapital.DEFAULT_DAYS_RECEIVABLE;

  // 1. Sourcing comparison (skipped if origin already chosen and not exploring alternatives)
  const sourcingResult = sourcing.recommendCountry({
    productCategory,
    targetFobUnitEur: targetFobUnitEur || (customsValueEur / Math.max(1, moq || 1000)),
    moq: moq || 1000,
    urgencyWeeks: urgencyWeeks || 16,
    costPriority: 'balanced',
  });

  // Sourcing risk for THIS specific origin
  const sourcingRisk = sourcing.assessRisk({ productCategory, country: originCountry });

  // 2. Routing
  const routingResult = routing.calculateQuote({
    weightKg,
    volumeCbm: weightKg / 200, // rough heuristic
    originCountry,
    destinationCountry,
    urgencyDays: urgencyWeeks ? urgencyWeeks * 7 : null,
  });

  // 3. Customs — async wrapper engages TARIC live lookup when an 8+ digit
  // HS code is supplied AND an origin is known. Otherwise behaves identical
  // to the sync calculateQuote.
  const hsCode = input.hsCode || CATEGORY_TO_HS[productCategory] || '99';
  const customsResult = await customs.calculateQuoteAsync({
    customsValueEur,
    hsCode,
    destinationCountry,
    originCountry,
    linesCount,
    claimPreferential,
  }, pinnedData ? {
    // Reproducibility-v2 slice 3b: a historical recompute pins the AD/CVD
    // measures from the stored snapshot and stays fully deterministic (no live
    // TARIC — that pinning is slice 3c). Live path is untouched.
    pinnedTradeDefence: pinnedData.tradeDefence && pinnedData.tradeDefence.measures,
    useLiveTaric: false,
  } : {});

  // 4. Warehouse — only if monthly volume is provided
  let warehouseResult = null;
  if (monthlyOrders && monthlyOrders >= 100) {
    warehouseResult = warehouse.calculateQuote({
      monthlyOrders,
      avgUnitsPerOrder: Math.max(1, Number(input.avgUnitsPerOrder) || 1.5),
      avgLinesPerOrder: Math.max(1, Number(input.avgLinesPerOrder) || 1.2),
      avgPalletsHeld: Math.max(1, Number(input.avgPalletsHeld) || 50),
      avgOrderWeightKg: Math.max(0.1, Number(input.avgOrderWeightKg) || 2),
      primaryDestination: destinationCountry,
    });
  }

  // Cross-domain summary
  const recommendedMode = routingResult.ok
    ? routingResult.quotes.find(q => q.mode === routingResult.recommendation.primary)
    : null;
  const recommendedClearance = customsResult.ok
    ? (customsResult.recommendation.primary === 'standard_clearance'
        ? customsResult.quotes.find(q => q.routeKey === 'standard_clearance')
        : customsResult.quotes.find(q => q.routeKey === 'bonded_warehouse'))
    : null;
  const recommendedHub = (warehouseResult && warehouseResult.ok)
    ? warehouseResult.quotes.find(h => h.hubKey === warehouseResult.recommendation.primary)
    : null;

  const transportEur = recommendedMode?.totalEur || 0;
  const standardCustomsQuote = customsResult.ok ? customsResult.quotes.find(q => q.routeKey === 'standard_clearance') : null;
  const dutyEur = standardCustomsQuote?.dutyEur || 0;
  const vatEur = standardCustomsQuote?.vatEur || 0;
  const brokerageEur = standardCustomsQuote?.brokerageEur || 0;
  const perShipmentLandedTotal = transportEur + customsValueEur + dutyEur + vatEur + brokerageEur;
  // P&L cost net of recoverable VAT — what a VAT-registered importer actually carries.
  // Mirrors customs-quote's effectiveLandedCostEur but at the cross-domain (transport
  // included) level. ENS is a €25 line item already inside the customs result and
  // is intentionally excluded here to stay consistent with perShipmentLandedTotal's
  // composition (transport + customs + duty + vat + brokerage, no ENS).
  const effectiveLandedTotal = transportEur + customsValueEur + dutyEur + brokerageEur;

  // ── Annual TCO ────────────────────────────────────────────
  const warehouseAnnualEur = recommendedHub ? (recommendedHub.totalMonthlyEur || 0) * 12 : 0;
  const tcoResult = tco.calculateTco({
    perShipment: { customsValueEur, dutyEur, vatEur, brokerageEur, transportEur },
    shipmentsPerYear,
    waccPct,
    daysInInventory,
    warehouseAnnualEur,
  });

  // ── Origin sensitivity matrix ─────────────────────────────
  // For procurement decisions, the single most important comparison isn't
  // CN→PL vs nothing — it's CN→PL vs VN→PL vs IN→PL vs BD→PL vs TR→PL on
  // the same goods. This re-runs the customs calculator (with each origin's
  // specific MFN, AD/CVD, and preferential pathway) and the routing
  // calculator (different transit times + freight rates by region) for each
  // plausible alternative.
  const SENSITIVITY_ORIGINS = ['CN', 'VN', 'IN', 'BD', 'TR'];
  const allOrigins = new Set([originCountry, ...SENSITIVITY_ORIGINS]);
  const originMatrix = [];
  for (const origin of allOrigins) {
    const altCustoms = customs.calculateQuote({
      customsValueEur,
      hsCode,
      destinationCountry,
      originCountry: origin,
      linesCount,
      // Always assume claimPreferential=true for the alternatives so the
      // comparison shows the *best achievable* duty per origin, not a
      // pessimistic MFN-only number. The user has already opted in / out
      // for their chosen origin upstream.
      claimPreferential: true,
    });
    const altRouting = routing.calculateQuote({
      weightKg,
      volumeCbm: weightKg / 200,
      originCountry: origin,
      destinationCountry,
      urgencyDays: urgencyWeeks ? urgencyWeeks * 7 : null,
    });
    if (!altCustoms.ok || !altRouting.ok) continue;

    const altRecMode = altRouting.quotes.find(q => q.mode === altRouting.recommendation.primary);
    const altStandard = altCustoms.quotes.find(q => q.routeKey === 'standard_clearance');
    const altTransport = altRecMode?.totalEur || 0;
    const altDuty = altStandard?.dutyEur || 0;
    const altVat = altStandard?.vatEur || 0;
    const altBrokerage = altStandard?.brokerageEur || 0;
    const altLanded = altTransport + customsValueEur + altDuty + altVat + altBrokerage;
    const altEffectiveLanded = altTransport + customsValueEur + altDuty + altBrokerage;

    originMatrix.push({
      origin,
      isUserChoice: origin === originCountry,
      dutyRatePct: altCustoms.duty.ratePercent,
      transportEur: altTransport,
      transportMode: altRouting.recommendation.primary,
      transitDaysLabel: altRecMode?.transitDaysLabel || '—',
      dutyEur: altDuty,
      vatEur: altVat,
      brokerageEur: altBrokerage,
      perShipmentLandedTotal: altLanded,
      effectiveLandedTotal: altEffectiveLanded,
      // Annual estimate assumes 12 shipments/year when monthly volume is
      // provided. A real importer running 1000+ orders/month would ship more
      // often, but at this stage we keep the estimate simple and conservative.
      annualLandedTotal: monthlyOrders && monthlyOrders > 0 ? altLanded * 12 : null,
      annualEffectiveLanded: monthlyOrders && monthlyOrders > 0 ? altEffectiveLanded * 12 : null,
      preferentialApplied: altCustoms.duty.preferentialApplied?.code || null,
      tradeDefenceMeasures: (altCustoms.duty.tradeDefenceMeasures || []).map(m => ({ id: m.id, type: m.type, rateTypicalPct: m.rateTypicalPct })),
    });
  }
  // Rank by per-shipment landed total (cheapest first)
  originMatrix.sort((a, b) => a.perShipmentLandedTotal - b.perShipmentLandedTotal);

  const userOriginEntry = originMatrix.find(e => e.isUserChoice);
  const cheapestEntry = originMatrix[0];
  const sensitivitySavingEur = (userOriginEntry && cheapestEntry && cheapestEntry.origin !== userOriginEntry.origin)
    ? Math.max(0, Math.round(userOriginEntry.perShipmentLandedTotal - cheapestEntry.perShipmentLandedTotal))
    : 0;
  const sensitivitySavingPct = (userOriginEntry && sensitivitySavingEur > 0)
    ? Math.round((sensitivitySavingEur / userOriginEntry.perShipmentLandedTotal) * 100)
    : 0;

  return {
    ok: true,
    asOf: new Date().toISOString().slice(0, 10),
    // Reproducibility stamp (Sprint provenance-v1): calc version + data-snapshot
    // dates in effect. Not part of the regression snapshot (extractSnapshot is
    // a strict allowlist), so it never affects frozen numeric comparisons.
    provenance: currentProvenance(),
    inputs: {
      productCategory,
      originCountry,
      destinationCountry,
      customsValueEur,
      weightKg,
      linesCount,
      urgencyWeeks,
      monthlyOrders,
      claimPreferential,
      hsCode,
    },
    sourcing: {
      recommendation: sourcingResult.ok ? sourcingResult.recommendation : null,
      yourOriginRisk: sourcingRisk.error ? null : sourcingRisk,
      comparison: sourcingResult.ok ? sourcingResult.comparison : null,
    },
    routing: {
      recommendation: routingResult.ok ? routingResult.recommendation : null,
      modes: routingResult.ok ? routingResult.quotes : null,
      railEducation: routingResult.ok ? routingResult.railEducation : null,
      recommendedQuote: recommendedMode,
    },
    customs: {
      ok: customsResult.ok,
      duty: customsResult.ok ? customsResult.duty : null,
      vat: customsResult.ok ? customsResult.vat : null,
      standard: customsResult.ok ? customsResult.quotes.find(q => q.routeKey === 'standard_clearance') : null,
      bonded: customsResult.ok ? customsResult.quotes.find(q => q.routeKey === 'bonded_warehouse') : null,
      recommendation: customsResult.ok ? customsResult.recommendation : null,
      hsChapterLabel: customsResult.ok ? customsResult.inputs.hsChapterLabel : null,
      tradeDefenceMeasures: customsResult.ok ? (customsResult.duty.tradeDefenceMeasures || []) : [],
      preferentialApplied: customsResult.ok ? customsResult.duty.preferentialApplied : null,
      preferentialAvailable: customsResult.ok ? customsResult.duty.preferentialAvailable : null,
      preferentialSavingEur: (customsResult.ok && customsResult.duty.preferentialAvailable && customsResult.duty.preferentialAvailable.mfnReplaced)
        ? Math.round(customsValueEur * (customsResult.duty.mfnRate - customsResult.duty.preferentialAvailable.rate))
        : 0,
    },
    compliance: {
      regimes: compliance.findApplicableRegimes({ hsCode, productCategory }),
    },
    fx: quoteCurrency !== 'EUR'
      // Reproducibility-v2 slice 3a: when recomputing a historical plan, pin the
      // FX layer to the rate table from its stored snapshot so the original
      // euros reproduce. Live path (pinnedData null) is unchanged.
      ? fx.assessFxRisk({ customsValueEur, quoteCurrency, paymentTermsDays, pinnedFx: pinnedData && pinnedData.fx })
      : null,
    tco: tcoResult.ok ? tcoResult : null,
    workingCapital: tcoResult.ok ? workingCapital.calculateWorkingCapital({
      annualThroughputEur: tcoResult.main.annualCustomsValueEur,
      daysInventory: daysInInventory,
      daysReceivable,
      daysPayable: paymentTermsDays,
      waccPct,
    }) : null,
    originSensitivity: {
      matrix: originMatrix,
      cheapestOrigin: cheapestEntry?.origin || null,
      userOrigin: originCountry,
      savingEurVsUserOrigin: sensitivitySavingEur,
      savingPctVsUserOrigin: sensitivitySavingPct,
      shipmentsPerYear: monthlyOrders && monthlyOrders > 0 ? 12 : null,
    },
    warehouse: warehouseResult ? {
      ok: warehouseResult.ok,
      recommendation: warehouseResult.recommendation,
      recommendedHub,
      hubs: warehouseResult.quotes,
    } : { skipped: true, reason: 'Monthly order volume not provided — warehouse leg omitted from plan.' },
    totals: {
      transportEur,
      customsValueEur,
      dutyEur,
      vatEur,
      brokerageEur,
      perShipmentLandedTotal,
      effectiveLandedTotal,
      vatRecoverableEur: vatEur,
      warehouseMonthlyEur: recommendedHub?.totalMonthlyEur || null,
    },
  };
}

// Sprint AI: attach the implementation roadmap last, after composePlan has
// returned its base structure. Keeping this as a wrapper around the original
// keeps composePlan's signature stable for callers that don't want the
// roadmap (eg. saved-plans snapshot path that just needs totals).
async function composePlanWithRoadmap(input) {
  const plan = await composePlan(input);
  if (!plan || !plan.ok) return plan;
  plan.roadmap = implementationRoadmap.buildRoadmap(plan);
  return plan;
}

// ── Email summary via Resend ───────────────────────────────

async function sendPlanEmail({ email, name, companyName, plan, locale }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { sent: false, reason: 'RESEND_API_KEY not set; email not sent.' };
  }
  const from = process.env.RESEND_FROM || 'OrcaTrade <onboarding@resend.dev>';
  const founderInbox = process.env.ORCATRADE_LEADS_INBOX || 'leads@orcatrade.pl';

  const inputs = plan.inputs;
  const t = plan.totals;
  const lang = pickLocale(locale);
  const i18n = EMAIL_STRINGS[lang];
  const subject = i18n.subject({ inputs });
  const shareUrl = `${SITE_ORIGIN}${localeWizardPath(lang)}?p=${encodeInputs(inputs)}`;

  const userBody = i18n.userBody({ inputs, plan, totals: t, name, shareUrl, siteOrigin: SITE_ORIGIN });
  const founderBody = i18n.founderBody({ inputs, plan, totals: t, name, email, companyName, shareUrl });
  const leadSubject = i18n.leadSubject({ inputs });

  const userEmail = await resendSend({ apiKey, from, to: email, subject, text: userBody });
  const founderEmail = await resendSend({ apiKey, from, to: founderInbox, subject: leadSubject, text: founderBody });

  return { sent: userEmail.ok && founderEmail.ok, userEmail, founderEmail };
}

async function resendSend({ apiKey, from, to, subject, text }) {
  // Sprint BG-4.4: wrap Resend in the circuit. After 5 consecutive failures
  // we short-circuit subsequent calls for 30s with a documented fallback
  // (silent drop + warn log) instead of repeatedly hitting a dead upstream
  // and dragging p99 latency for every wizard submission.
  return circuit.run('resend', async () => {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to, subject, text }),
    });
    if (!response.ok) {
      const errText = await response.text();
      log.warn('resend send failed', { action: 'send_plan_email', status: response.status, upstreamErr: errText.slice(0, 200) });
      // A non-2xx is a failure for circuit-counting purposes too.
      throw new Error(`resend ${response.status}: ${errText.slice(0, 100)}`);
    }
    return { ok: true };
  }, {
    fallback: ({ shortCircuited, err }) => {
      if (shortCircuited) {
        log.warn('resend send skipped (circuit open)', { action: 'send_plan_email' });
        return { ok: false, status: 503, circuit: 'open' };
      }
      log.warn('resend send threw', { action: 'send_plan_email', err: err && err.message });
      return { ok: false, error: err && err.message };
    },
  });
}

// ── HTTP handler ───────────────────────────────────────────

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    // Catalogue endpoint — useful for the wizard's dropdowns
    return res.status(200).json({
      categories: sourcing.listCategories(),
      origins: sourcing.listCountries(),
      destinations: customs.listCountries(),
      hsChapters: customs.listHsChapters(),
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  const rate = await consumeRateLimit('start', ip, 10, 60000);
  if (rate.limited) return res.status(429).json({ error: 'Too many requests. Please wait a moment.' });

  const body = req.body || {};
  const locale = pickLocale(body.locale);
  const plan = await composePlanWithRoadmap(body);
  if (!plan.ok) {
    return res.status(400).json({ error: 'Validation failed', errors: plan.errors });
  }

  // Optional email send
  let emailResult = { sent: false, reason: 'No email provided' };
  if (body.email) {
    try {
      emailResult = await sendPlanEmail({
        email: body.email,
        name: body.name,
        companyName: body.companyName,
        plan,
        locale,
      });
    } catch (err) {
      emailResult = { sent: false, error: err.message };
    }
  }

  // Structured event log for analytics (Vercel captures stdout).
  // Sprint G: also record whether the user supplied a real HS code
  // (vs accepting the category default), how many digits they gave,
  // and which MFN source the customs calc ended up using. Lets the
  // founder see — via /dashboard/leads/ — whether the Sprint D→F
  // depth work is actually getting picked up by real users, or
  // whether everyone is staying on the chapter estimator.
  const hsCodeRaw = (body.hsCode || '').toString().replace(/\D/g, '');
  const hsCodeProvided = hsCodeRaw.length >= 6;     // 6, 8, or 10 digits
  const hsCodeLength = hsCodeProvided ? hsCodeRaw.length : 0;
  const dutyMfnSource = (plan && plan.customs && plan.customs.duty && plan.customs.duty.mfnSource) || 'chapter-estimator';

  const eventPayload = {
    locale,
    inputs: plan.inputs,
    landedTotal: plan.totals.perShipmentLandedTotal,
    emailProvided: !!body.email,
    emailSent: emailResult.sent,
    hsCodeProvided,
    hsCodeLength,
    dutyMfnSource,
    ip,
  };
  // Sprint BG-4.1: structured logging instead of the ad-hoc JSON-stringify
  // pattern. Same fields, plus level/handler/requestId/ts via the helper.
  log.withContext({ requestId: req.requestId }).info('import_plan_generated', eventPayload);
  // Durable record for the conversion-analytics dashboard.
  try { await events.record('import_plan_generated', eventPayload); } catch (_e) {}

  return res.status(200).json({ ok: true, plan, email: emailResult });
};

module.exports.composePlan = composePlan;
module.exports.validateInput = validateInput;
module.exports.CATEGORY_TO_HS = CATEGORY_TO_HS;
