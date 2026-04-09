const { consumeRateLimit, listStoredComplianceReportsByOwner } = require('../lib/intelligence/runtime-store');
const { decodeSignedTokenResource, verifyAccountAccessToken, verifyWorkspaceAccessToken } = require('../lib/intelligence/report-access');
const { applyRequestHeaders, buildRequestContext, buildRequestMeta, emitAuditEvent } = require('../lib/intelligence/request-runtime');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-OrcaTrade-Account-Token, X-OrcaTrade-Workspace-Token, X-Request-Id');
  res.setHeader('Cache-Control', 'no-store');
  const requestContext = buildRequestContext(req, 'reports');
  applyRequestHeaders(res, requestContext);

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });

  const rate = await consumeRateLimit('report-list', requestContext.ip, 30, 60000);
  res.setHeader('X-OrcaTrade-Storage-Mode', rate.storageMode);
  if (rate.limited) {
    emitAuditEvent(requestContext, 'reports.rate_limited', { storageMode: rate.storageMode });
    return res.status(429).json({ error: 'Too many requests. Please wait a moment.' });
  }

  const workspaceToken = String(
    req.query?.workspaceToken ||
    req.headers['x-orcatrade-workspace-token'] ||
    ''
  ).trim();
  const accountToken = String(
    req.query?.accountToken ||
    req.headers['x-orcatrade-account-token'] ||
    ''
  ).trim();

  const decodedFingerprint = workspaceToken
    ? decodeWorkspaceFingerprint(workspaceToken)
    : decodeOwnerFingerprint(accountToken);
  if (workspaceToken) {
    const workspaceCheck = verifyWorkspaceAccessToken(decodedFingerprint, workspaceToken);
    if (!workspaceCheck.ok) {
      return res.status(workspaceCheck.code === 'missing_workspace_token' ? 401 : 403).json({
        error: workspaceCheck.reason || 'A signed workspace token is required.',
      });
    }
    if (workspaceCheck.expiresAt) {
      res.setHeader('X-OrcaTrade-Workspace-Access-Expires-At', workspaceCheck.expiresAt);
    }
  } else {
    const accountCheck = verifyAccountAccessToken(decodedFingerprint, accountToken);
    if (!accountCheck.ok) {
      return res.status(accountCheck.code === 'missing_account_token' ? 401 : 403).json({
        error: accountCheck.reason || 'A signed account token is required.',
      });
    }
    if (accountCheck.expiresAt) {
      res.setHeader('X-OrcaTrade-Account-Access-Expires-At', accountCheck.expiresAt);
    }
  }

  const limit = Math.min(25, Math.max(1, Number(req.query?.limit) || 10));

  try {
    const result = await listStoredComplianceReportsByOwner(decodedFingerprint, { limit });
    res.setHeader('X-OrcaTrade-Storage-Mode', result.storageMode || rate.storageMode || 'memory');
    emitAuditEvent(requestContext, 'reports.listed', {
      count: Array.isArray(result.reports) ? result.reports.length : 0,
      storageMode: result.storageMode || rate.storageMode || 'memory',
    });
    return res.status(200).json({
      reports: result.reports || [],
      count: Array.isArray(result.reports) ? result.reports.length : 0,
      requestMeta: buildRequestMeta(requestContext, {
        storageMode: result.storageMode || rate.storageMode || 'memory',
      }),
    });
  } catch (error) {
    emitAuditEvent(requestContext, 'reports.failed', {
      message: String(error.message || ''),
    });
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

function decodeWorkspaceFingerprint(token) {
  const decoded = decodeSignedTokenResource(token, 'workspace');
  return decoded.ok ? String(decoded.payload?.r || '').trim() : '';
}
