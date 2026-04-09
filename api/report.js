const { consumeRateLimit, getStoredComplianceReportById } = require('../lib/intelligence/runtime-store');
const { attachReportAccess, verifyAccountAccessToken, verifyReportAccessToken, verifyWorkspaceAccessToken } = require('../lib/intelligence/report-access');
const { applyRequestHeaders, buildRequestContext, buildRequestMeta, emitAuditEvent } = require('../lib/intelligence/request-runtime');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-OrcaTrade-Report-Token, X-OrcaTrade-Account-Token, X-OrcaTrade-Workspace-Token, X-Request-Id');
  res.setHeader('Cache-Control', 'no-store');
  const requestContext = buildRequestContext(req, 'report');
  applyRequestHeaders(res, requestContext);

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });

  const rate = await consumeRateLimit('report-retrieval', requestContext.ip, 30, 60000);
  res.setHeader('X-OrcaTrade-Storage-Mode', rate.storageMode);
  if (rate.limited) {
    emitAuditEvent(requestContext, 'report.rate_limited', { storageMode: rate.storageMode });
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
      if (workspaceToken) {
        const workspaceCheck = verifyWorkspaceAccessToken(
          String(stored.report?.reportOwnership?.workspaceFingerprint || ownerFingerprint).trim(),
          workspaceToken
        );
        if (!workspaceCheck.ok) {
          return res.status(workspaceCheck.code === 'missing_workspace_token' ? 401 : 403).json({
            error: workspaceCheck.reason || 'A signed workspace token is required for this report.',
          });
        }
        if (workspaceCheck.expiresAt) {
          res.setHeader('X-OrcaTrade-Workspace-Access-Expires-At', workspaceCheck.expiresAt);
        }
      } else {
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
    }

    const deliveryReport = attachReportAccess(stored.report);
    res.setHeader('X-OrcaTrade-Storage-Mode', stored.storageMode || 'memory');
    res.setHeader('X-OrcaTrade-Report-Access-Mode', deliveryReport.reportAccess?.mode || 'disabled');
    if (accessCheck.expiresAt) {
      res.setHeader('X-OrcaTrade-Report-Access-Expires-At', accessCheck.expiresAt);
    }

    emitAuditEvent(requestContext, 'report.retrieved', {
      reportId,
      storageMode: stored.storageMode,
    });

    return res.status(200).json({
      ...deliveryReport,
      requestMeta: buildRequestMeta(requestContext, {
        storageMode: stored.storageMode || 'memory',
      }),
    });
  } catch (error) {
    emitAuditEvent(requestContext, 'report.failed', {
      reportId,
      message: String(error.message || ''),
    });
    console.error('Report retrieval error:', error);
    return res.status(500).json({ error: 'Failed to retrieve report' });
  }
};
