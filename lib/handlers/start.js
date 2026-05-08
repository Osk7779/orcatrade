// Import Plan Builder backend.
//
// Takes a shipper profile from POST /api/start, orchestrates the four
// platform calculators (sourcing → routing → customs → warehouse) into
// a single personalised import plan, optionally sends a summary email to
// the user via Resend, and returns the structured plan as JSON for the
// wizard to render.

const { consumeRateLimit } = require('../intelligence/runtime-store');
const sourcing = require('../intelligence/sourcing-quote');
const routing = require('../intelligence/routing-quote');
const customs = require('../intelligence/customs-quote');
const warehouse = require('../intelligence/warehouse-quote');
const { encodeInputs } = require('../utils/plan-codec');
const { STRINGS: EMAIL_STRINGS, pickLocale } = require('../start-i18n');

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

function composePlan(input) {
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

  // 3. Customs
  const hsCode = input.hsCode || CATEGORY_TO_HS[productCategory] || '99';
  const customsResult = customs.calculateQuote({
    customsValueEur,
    hsCode,
    destinationCountry,
    originCountry,
    linesCount,
    claimPreferential,
  });

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
  const dutyEur = customsResult.ok ? (customsResult.quotes.find(q => q.routeKey === 'standard_clearance')?.dutyEur || 0) : 0;
  const vatEur = customsResult.ok ? (customsResult.quotes.find(q => q.routeKey === 'standard_clearance')?.vatEur || 0) : 0;
  const brokerageEur = customsResult.ok ? (customsResult.quotes.find(q => q.routeKey === 'standard_clearance')?.brokerageEur || 0) : 0;
  const perShipmentLandedTotal = transportEur + customsValueEur + dutyEur + vatEur + brokerageEur;

  return {
    ok: true,
    asOf: new Date().toISOString().slice(0, 10),
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
      warehouseMonthlyEur: recommendedHub?.totalMonthlyEur || null,
    },
  };
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
  try {
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
      console.warn(`[start] resend send failed: ${response.status} ${errText.slice(0, 200)}`);
      return { ok: false, status: response.status };
    }
    return { ok: true };
  } catch (err) {
    console.warn(`[start] resend send error: ${err.message}`);
    return { ok: false, error: err.message };
  }
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
  const plan = composePlan(body);
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

  // Structured event log for analytics (Vercel captures stdout)
  console.log(JSON.stringify({
    event: 'import_plan_generated',
    timestamp: new Date().toISOString(),
    locale,
    inputs: plan.inputs,
    landedTotal: plan.totals.perShipmentLandedTotal,
    emailProvided: !!body.email,
    emailSent: emailResult.sent,
    ip,
  }));

  return res.status(200).json({ ok: true, plan, email: emailResult });
};

module.exports.composePlan = composePlan;
module.exports.validateInput = validateInput;
module.exports.CATEGORY_TO_HS = CATEGORY_TO_HS;
