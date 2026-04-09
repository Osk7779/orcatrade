const { buildWorkspaceProfile, deriveWorkspaceFingerprint } = require('../lib/intelligence/account-context');
const {
  consumeRateLimit,
  getStoredWorkspaceByFingerprint,
  listStoredComplianceReportsByOwner,
  listStoredEvidenceBundlesByOwner,
  persistWorkspaceProfile,
} = require('../lib/intelligence/runtime-store');
const {
  createAccountAccessToken,
  createWorkspaceAccessToken,
  decodeSignedTokenResource,
  verifyAccountAccessToken,
  verifyWorkspaceAccessToken,
} = require('../lib/intelligence/report-access');
const { applyRequestHeaders, buildRequestContext, buildRequestMeta, emitAuditEvent } = require('../lib/intelligence/request-runtime');

const WORKSPACE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function cleanString(value) {
  return String(value || '').trim();
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-OrcaTrade-Workspace-Token, X-OrcaTrade-Account-Token, X-Request-Id');
  res.setHeader('Cache-Control', 'no-store');
}

function buildWorkspacePayload(workspaceRecord, requestContext, extras = {}) {
  const workspace = workspaceRecord && workspaceRecord.workspace ? workspaceRecord.workspace : {};
  return {
    workspace: {
      workspaceFingerprint: cleanString(workspace.workspaceFingerprint),
      workspaceLabel: cleanString(workspace.workspaceLabel),
      company: cleanString(workspace.company),
      emailMasked: cleanString(workspace.emailMasked),
      accountId: cleanString(workspace.accountId),
      accessRequired: Boolean(workspace.accessRequired),
    },
    storedAt: cleanString(workspaceRecord?.storedAt),
    requestMeta: buildRequestMeta(requestContext, {
      storageMode: cleanString(workspaceRecord?.storageMode) || 'memory',
    }),
    ...extras,
  };
}

function decodeWorkspaceFingerprint(workspaceToken, accountToken) {
  const workspaceDecode = decodeSignedTokenResource(workspaceToken, 'workspace');
  if (workspaceDecode.ok) return cleanString(workspaceDecode.payload?.r);

  const accountDecode = decodeSignedTokenResource(accountToken, 'compliance-account');
  if (accountDecode.ok) return cleanString(accountDecode.payload?.r);

  return '';
}

module.exports = async function handler(req, res) {
  setCors(res);
  const requestContext = buildRequestContext(req, 'workspace');
  applyRequestHeaders(res, requestContext);

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET' && req.method !== 'POST') {
    emitAuditEvent(requestContext, 'workspace.method_not_allowed', { method: req.method });
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const rate = await consumeRateLimit('workspace', requestContext.ip, 20, 60000);
  res.setHeader('X-OrcaTrade-Storage-Mode', rate.storageMode);
  if (rate.limited) {
    emitAuditEvent(requestContext, 'workspace.rate_limited', { storageMode: rate.storageMode });
    return res.status(429).json({ error: 'Too many requests. Please wait a moment.' });
  }

  try {
    if (req.method === 'POST') {
      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
        return res.status(422).json({ error: 'Request body must be a JSON object.' });
      }

      const profile = buildWorkspaceProfile(req.body);
      if (!profile.workspaceFingerprint) {
        return res.status(422).json({
          error: 'Workspace setup requires accountId, company, or work email.',
        });
      }

      const persisted = await persistWorkspaceProfile(req.body, WORKSPACE_TTL_MS);
      const workspaceToken = createWorkspaceAccessToken(profile.workspaceFingerprint);
      const accountToken = createAccountAccessToken(profile.workspaceFingerprint);

      if (workspaceToken?.mode) {
        res.setHeader('X-OrcaTrade-Workspace-Access-Mode', workspaceToken.mode);
      }
      if (workspaceToken?.expiresAt) {
        res.setHeader('X-OrcaTrade-Workspace-Access-Expires-At', workspaceToken.expiresAt);
      }

      emitAuditEvent(requestContext, 'workspace.persisted', {
        workspaceFingerprint: profile.workspaceFingerprint,
        storageMode: persisted.storageMode,
      });

      return res.status(200).json(buildWorkspacePayload(persisted, requestContext, {
        workspaceAccess: workspaceToken ? {
          enabled: true,
          mode: workspaceToken.mode,
          token: workspaceToken.token,
          expiresAt: workspaceToken.expiresAt,
          retrievalPath: `/api/workspace?workspaceToken=${encodeURIComponent(workspaceToken.token)}`,
        } : {
          enabled: false,
          mode: 'disabled',
          reason: 'Workspace signing is unavailable because no signing secret is configured.',
        },
        accountAccess: accountToken ? {
          enabled: true,
          mode: accountToken.mode,
          token: accountToken.token,
          expiresAt: accountToken.expiresAt,
          retrievalPath: `/api/reports?accountToken=${encodeURIComponent(accountToken.token)}`,
        } : {
          enabled: false,
          mode: 'disabled',
          reason: 'Account signing is unavailable because no signing secret is configured.',
        },
      }));
    }

    const workspaceToken = cleanString(
      req.query?.workspaceToken ||
      req.headers['x-orcatrade-workspace-token']
    );
    const accountToken = cleanString(
      req.query?.accountToken ||
      req.headers['x-orcatrade-account-token']
    );
    const workspaceFingerprint = deriveWorkspaceFingerprint({
      accountId: req.query?.accountId,
      company: req.query?.company,
      email: req.query?.email,
    }) || decodeWorkspaceFingerprint(workspaceToken, accountToken);

    if (!workspaceFingerprint) {
      return res.status(401).json({
        error: 'A signed workspace token or account token is required.',
      });
    }

    if (workspaceToken) {
      const check = verifyWorkspaceAccessToken(workspaceFingerprint, workspaceToken);
      if (!check.ok) {
        return res.status(check.code === 'missing_workspace_token' ? 401 : 403).json({
          error: check.reason || 'A signed workspace token is required.',
        });
      }
      if (check.expiresAt) {
        res.setHeader('X-OrcaTrade-Workspace-Access-Expires-At', check.expiresAt);
      }
    } else {
      const check = verifyAccountAccessToken(workspaceFingerprint, accountToken);
      if (!check.ok) {
        return res.status(check.code === 'missing_account_token' ? 401 : 403).json({
          error: check.reason || 'A signed account token is required.',
        });
      }
      if (check.expiresAt) {
        res.setHeader('X-OrcaTrade-Account-Access-Expires-At', check.expiresAt);
      }
    }

    const workspaceRecord = await getStoredWorkspaceByFingerprint(workspaceFingerprint);
    const reportsResult = await listStoredComplianceReportsByOwner(workspaceFingerprint, { limit: 10 });
    const evidenceResult = await listStoredEvidenceBundlesByOwner(workspaceFingerprint, { limit: 10 });

    const payload = buildWorkspacePayload(workspaceRecord || {
      workspace: {
        workspaceFingerprint,
        workspaceLabel: 'Workspace',
        company: '',
        emailMasked: '',
        accountId: '',
        accessRequired: true,
      },
      storedAt: '',
      storageMode: reportsResult.storageMode || evidenceResult.storageMode || rate.storageMode || 'memory',
    }, requestContext, {
      reports: reportsResult.reports || [],
      reportCount: Array.isArray(reportsResult.reports) ? reportsResult.reports.length : 0,
      evidenceBundles: evidenceResult.bundles || [],
      evidenceCount: Array.isArray(evidenceResult.bundles) ? evidenceResult.bundles.length : 0,
    });

    emitAuditEvent(requestContext, 'workspace.retrieved', {
      workspaceFingerprint,
      reportCount: payload.reportCount,
      evidenceCount: payload.evidenceCount,
    });

    return res.status(200).json(payload);
  } catch (error) {
    emitAuditEvent(requestContext, 'workspace.failed', { message: cleanString(error.message) });
    console.error('Workspace handler error:', error);
    return res.status(500).json({ error: 'Failed to process workspace request.' });
  }
};
