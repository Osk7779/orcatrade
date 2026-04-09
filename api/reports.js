const { consumeRateLimit, listStoredComplianceReportsByOwner } = require('../lib/intelligence/runtime-store');
const { verifyAccountAccessToken } = require('../lib/intelligence/report-access');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-OrcaTrade-Account-Token');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  const rate = await consumeRateLimit('report-list', ip, 30, 60000);
  res.setHeader('X-OrcaTrade-Storage-Mode', rate.storageMode);
  if (rate.limited) {
    return res.status(429).json({ error: 'Too many requests. Please wait a moment.' });
  }

  const accountToken = String(
    req.query?.accountToken ||
    req.headers['x-orcatrade-account-token'] ||
    ''
  ).trim();

  const decodedFingerprint = decodeOwnerFingerprint(accountToken);
  const accountCheck = verifyAccountAccessToken(decodedFingerprint, accountToken);
  if (!accountCheck.ok) {
    return res.status(accountCheck.code === 'missing_account_token' ? 401 : 403).json({
      error: accountCheck.reason || 'A signed account token is required.',
    });
  }

  const limit = Math.min(25, Math.max(1, Number(req.query?.limit) || 10));

  try {
    const result = await listStoredComplianceReportsByOwner(decodedFingerprint, { limit });
    res.setHeader('X-OrcaTrade-Storage-Mode', result.storageMode || rate.storageMode || 'memory');
    if (accountCheck.expiresAt) {
      res.setHeader('X-OrcaTrade-Account-Access-Expires-At', accountCheck.expiresAt);
    }
    return res.status(200).json({
      reports: result.reports || [],
      count: Array.isArray(result.reports) ? result.reports.length : 0,
    });
  } catch (error) {
    console.error('Report list retrieval error:', error);
    return res.status(500).json({ error: 'Failed to retrieve reports' });
  }
};

function decodeOwnerFingerprint(token) {
  const normalized = String(token || '').trim();
  const parts = normalized.split('.');
  if (parts.length !== 3) return '';

  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return String(payload?.r || '').trim();
  } catch (error) {
    return '';
  }
}
