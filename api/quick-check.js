const { determineRegulationApplicability } = require('../lib/intelligence/compliance');

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function buildStatus(applicability) {
  if (applicability.EUDR.applicable || applicability.CBAM.applicable || applicability.CSDDD.applicable) {
    return 'at_risk';
  }
  return 'not_applicable';
}

function buildFallbackVerdict({ productCategory = '', origin = '' }, applicability) {
  const applicableRegulations = [];

  if (applicability.CBAM.applicable) applicableRegulations.push('CBAM');
  if (applicability.EUDR.applicable) applicableRegulations.push('EUDR');
  if (applicability.CSDDD.applicable) applicableRegulations.push('CSDDD');

  if (applicableRegulations.length === 0) {
    return `Based on the product category, this shipment does not clearly fall within CBAM or EUDR scope. You can proceed, but run a full report if the goods classification or importer profile changes.`;
  }

  const keyObligation = applicability.CBAM.applicable
    ? 'confirm Annex I scope and line up supplier emissions and declarant-ready evidence'
    : applicability.EUDR.applicable
      ? 'collect the due diligence evidence and geolocation data required for EUDR-covered goods'
      : 'confirm the importer-level due diligence threshold and operating obligations';

  return `${applicableRegulations.join(' and ')} may apply to ${productCategory || 'these goods'} from ${origin || 'the stated origin'}. The key obligation is to ${keyObligation}, and the most urgent next step is to run a full compliance report before relying on this shipment classification.`;
}

function buildCta(status) {
  return status === 'at_risk' || status === 'non_compliant'
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

  const orderData = {
    productCategory,
    productDescription: '',
    origin,
    importValue,
    companySize: '',
  };

  const applicability = determineRegulationApplicability(orderData);
  const status = buildStatus(applicability);

  if (!process.env.ORCATRADE_OS_API) {
    return res.status(200).json({
      verdict: buildFallbackVerdict(orderData, applicability),
      status,
      cta: buildCta(status),
    });
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
      return res.status(200).json({
        verdict: buildFallbackVerdict(orderData, applicability),
        status,
        cta: buildCta(status),
      });
    }

    const data = await response.json();
    const verdict = String(data.content?.[0]?.text || '').trim() || buildFallbackVerdict(orderData, applicability);

    return res.status(200).json({
      verdict,
      status,
      cta: buildCta(status),
    });
  } catch (error) {
    console.error('Quick check handler error:', error);
    return res.status(200).json({
      verdict: buildFallbackVerdict(orderData, applicability),
      status,
      cta: buildCta(status),
    });
  }
};
