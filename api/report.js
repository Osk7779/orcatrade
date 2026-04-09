const { consumeRateLimit, getStoredComplianceReportById } = require('../lib/intelligence/runtime-store');
const { attachReportAccess, verifyAccountAccessToken, verifyReportAccessToken } = require('../lib/intelligence/report-access');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-OrcaTrade-Report-Token, X-OrcaTrade-Account-Token');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  const rate = await consumeRateLimit('report-retrieval', ip, 30, 60000);
  res.setHeader('X-OrcaTrade-Storage-Mode', rate.storageMode);
  if (rate.limited) {
    return res.status(429).json({ error: 'Too many requests. Please wait a moment.' });
  }

  const reportId = String(req.query?.reportId || '').trim();
  if (!reportId) {
    return res.status(400).json({ error: 'reportId is required' });
  }

  const accessToken = String(
    req.query?.accessToken ||
    req.headers['x-orcatrade-report-token'] ||
    ''
  ).trim();
  const accessCheck = verifyReportAccessToken(reportId, accessToken);
  if (!accessCheck.ok) {
    return res.status(accessCheck.code === 'missing_token' ? 401 : 403).json({
      error: accessCheck.reason || 'Signed report access is required.',
    });
  }

  try {
    const stored = await getStoredComplianceReportById(reportId);
    if (!stored || !stored.report) {
      return res.status(404).json({ error: 'Report not found' });
    }

    const ownerFingerprint = String(stored.report?.reportOwnership?.ownerFingerprint || '').trim();
    if (ownerFingerprint) {
      const accountToken = String(
        req.query?.accountToken ||
        req.headers['x-orcatrade-account-token'] ||
        ''
      ).trim();
      const accountCheck = verifyAccountAccessToken(ownerFingerprint, accountToken);
      if (!accountCheck.ok) {
        return res.status(accountCheck.code === 'missing_account_token' ? 401 : 403).json({
          error: accountCheck.reason || 'A signed account token is required for this report.',
        });
      }
      if (accountCheck.expiresAt) {
        res.setHeader('X-OrcaTrade-Account-Access-Expires-At', accountCheck.expiresAt);
      }
    }

    const deliveryReport = attachReportAccess(stored.report);
    res.setHeader('X-OrcaTrade-Storage-Mode', stored.storageMode || 'memory');
    res.setHeader('X-OrcaTrade-Report-Access-Mode', deliveryReport.reportAccess?.mode || 'disabled');
    if (accessCheck.expiresAt) {
      res.setHeader('X-OrcaTrade-Report-Access-Expires-At', accessCheck.expiresAt);
    }

    return res.status(200).json(deliveryReport);
  } catch (error) {
    console.error('Report retrieval error:', error);
    return res.status(500).json({ error: 'Failed to retrieve report' });
  }
};
