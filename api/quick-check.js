const { cleanString } = require('../lib/intelligence/catalog');
const { getCachedValue, setCachedValue } = require('../lib/intelligence/cache-store');
const { determineRegulationApplicability, resolveAsOfDate, RULE_VERSION } = require('../lib/intelligence/compliance');

const QUICK_CHECK_CACHE_TTL_MS = 15 * 60 * 1000;

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-OrcaTrade-Cache-Preference');
}

function getCachePreference(req) {
  const value = cleanString(req.headers['x-orcatrade-cache-preference']).toLowerCase();
  return value === 'all' || value === 'reject' ? value : 'essential';
}

function canUseQuickCheckCache(preference) {
  return preference === 'all';
}

function normaliseQuickCheckInput(orderData = {}) {
  return {
    ruleVersion: RULE_VERSION,
    asOfDate: resolveAsOfDate(orderData),
    productCategory: cleanString(orderData.productCategory).toLowerCase(),
    origin: cleanString(orderData.origin).toLowerCase(),
    importValue: cleanString(orderData.importValue).toLowerCase(),
  };
}

function buildDetermination(applicability) {
  const values = Object.values(applicability);
  return {
    activeNow: values.filter(item => item.applicabilityStatus === 'applicable').map(item => item.regulation),
    futureScope: values.filter(item => item.applicabilityStatus === 'future_scope').map(item => item.regulation),
    blocked: values.filter(item => item.applicabilityStatus === 'insufficient_data').map(item => item.regulation),
  };
}

function buildStatus(applicability) {
  const determination = buildDetermination(applicability);
  if (determination.activeNow.length || determination.blocked.length) {
    return 'at_risk';
  }
  return 'not_applicable';
}

function buildFallbackVerdict({ productCategory = '', origin = '' }, applicability) {
  const determination = buildDetermination(applicability);
  const activeNow = determination.activeNow;
  const futureScope = determination.futureScope;
  const blocked = determination.blocked;

  if (!activeNow.length && !futureScope.length && !blocked.length) {
    return `Based on the product category, no regulation is currently confirmed in scope for ${productCategory || 'these goods'} from ${origin || 'the stated origin'}. Run a full report only if the goods classification, importer profile, or legal timing changes.`;
  }

  if (blocked.length) {
    const firstBlocked = Object.values(applicability).find(item => item.applicabilityStatus === 'insufficient_data');
    return `${blocked.join(' and ')} cannot be cleared safely yet for ${productCategory || 'these goods'} from ${origin || 'the stated origin'} because key facts are missing. The most urgent action is to provide ${firstBlocked?.missingFacts?.join(', ') || 'the missing classification and company-threshold facts'} before relying on a compliance verdict.`;
  }

  if (activeNow.length) {
    const keyObligation = applicability.CBAM.applicabilityStatus === 'applicable'
      ? 'confirm Annex I scope and line up supplier emissions and declarant-ready evidence'
      : applicability.EUDR.applicabilityStatus === 'applicable'
        ? 'collect the due-diligence evidence and geolocation data required for EUDR-covered goods'
        : 'confirm the company-level due-diligence threshold and governance obligations';

    return `${activeNow.join(' and ')} are currently live for ${productCategory || 'these goods'} from ${origin || 'the stated origin'}. The key obligation is to ${keyObligation}, and the single most urgent action is to run the full compliance report before relying on this import flow.`;
  }

  const firstFuture = Object.values(applicability).find(item => item.applicabilityStatus === 'future_scope');
  return `${futureScope.join(' and ')} look relevant for ${productCategory || 'these goods'} from ${origin || 'the stated origin'}, but the binding date is still ahead${firstFuture?.futureApplicabilityDate ? ` (${firstFuture.futureApplicabilityDate})` : ''}. The urgent action is to prepare the evidence workflow now so the importer is ready before go-live.`;
}

function buildCta(status, applicability) {
  const determination = buildDetermination(applicability);
  return status === 'at_risk' || status === 'non_compliant' || determination.futureScope.length
    ? 'Run a full compliance report'
    : '';
}

module.exports = async function handler(req, res) {
  setCors(res);

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const {
    productCategory = '',
    origin = '',
    importValue = '',
  } = req.body || {};
  const cachePreference = getCachePreference(req);

  const orderData = {
    productCategory,
    productDescription: '',
    origin,
    importValue,
    companySize: '',
  };

  const applicability = determineRegulationApplicability(orderData);
  const status = buildStatus(applicability);
  const cacheInput = normaliseQuickCheckInput(orderData);

  if (canUseQuickCheckCache(cachePreference)) {
    const cached = getCachedValue('quick-check', cacheInput);
    if (cached) {
      res.setHeader('X-OrcaTrade-Cache', 'HIT');
      return res.status(200).json(cached.value);
    }
  }

  if (!process.env.ORCATRADE_OS_API) {
    const fallbackPayload = {
      verdict: buildFallbackVerdict(orderData, applicability),
      status,
      cta: buildCta(status, applicability),
      determination: buildDetermination(applicability),
    };

    if (canUseQuickCheckCache(cachePreference)) {
      setCachedValue('quick-check', cacheInput, fallbackPayload, QUICK_CHECK_CACHE_TTL_MS);
      res.setHeader('X-OrcaTrade-Cache', 'MISS');
    } else {
      res.setHeader('X-OrcaTrade-Cache', 'BYPASS');
    }

    return res.status(200).json(fallbackPayload);
  }

  try {
    const applicableRegulations = Object.entries(applicability)
      .filter(([, value]) => value.applicable)
      .map(([key]) => key)
      .join(', ') || 'None';

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ORCATRADE_OS_API,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 160,
        system: 'You are OrcaTrade Intelligence. Return a 2-3 sentence compliance verdict for the given product/origin. State which regulations apply, the key obligation, and the single most urgent action. Be direct and specific. No markdown.',
        messages: [
          {
            role: 'user',
            content: `Product category: ${productCategory || 'Not provided'}
Country of origin: ${origin || 'Not provided'}
Annual import value: ${importValue || 'Not provided'}
Pre-check applicability: ${applicableRegulations}
EUDR reason: ${applicability.EUDR.applicabilityReason}
CBAM reason: ${applicability.CBAM.applicabilityReason}
CSDDD reason: ${applicability.CSDDD.applicabilityReason}`,
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Quick check Anthropic error:', errorText);
      const fallbackPayload = {
        verdict: buildFallbackVerdict(orderData, applicability),
        status,
        cta: buildCta(status, applicability),
        determination: buildDetermination(applicability),
      };

      if (canUseQuickCheckCache(cachePreference)) {
        setCachedValue('quick-check', cacheInput, fallbackPayload, QUICK_CHECK_CACHE_TTL_MS);
        res.setHeader('X-OrcaTrade-Cache', 'MISS');
      } else {
        res.setHeader('X-OrcaTrade-Cache', 'BYPASS');
      }

      return res.status(200).json(fallbackPayload);
    }

    const data = await response.json();
    const verdict = String(data.content?.[0]?.text || '').trim() || buildFallbackVerdict(orderData, applicability);

    const payload = {
      verdict,
      status,
      cta: buildCta(status, applicability),
      determination: buildDetermination(applicability),
    };

    if (canUseQuickCheckCache(cachePreference)) {
      setCachedValue('quick-check', cacheInput, payload, QUICK_CHECK_CACHE_TTL_MS);
      res.setHeader('X-OrcaTrade-Cache', 'MISS');
    } else {
      res.setHeader('X-OrcaTrade-Cache', 'BYPASS');
    }

    return res.status(200).json(payload);
  } catch (error) {
    console.error('Quick check handler error:', error);
    const fallbackPayload = {
      verdict: buildFallbackVerdict(orderData, applicability),
      status,
      cta: buildCta(status, applicability),
      determination: buildDetermination(applicability),
    };

    if (canUseQuickCheckCache(cachePreference)) {
      setCachedValue('quick-check', cacheInput, fallbackPayload, QUICK_CHECK_CACHE_TTL_MS);
      res.setHeader('X-OrcaTrade-Cache', 'MISS');
    } else {
      res.setHeader('X-OrcaTrade-Cache', 'BYPASS');
    }

    return res.status(200).json(fallbackPayload);
  }
};
