const crypto = require('node:crypto');

const DEFAULT_REPORT_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const TOKEN_PREFIX = 'otrp1';
const TOKEN_PURPOSE = 'compliance-report';
const ACCOUNT_TOKEN_PURPOSE = 'compliance-account';
const WORKSPACE_TOKEN_PURPOSE = 'workspace';

function cleanString(value) {
  return String(value || '').trim();
}

function getSigningSecret() {
  return (
    cleanString(process.env.ORCATRADE_REPORT_SECRET) ||
    cleanString(process.env.KV_REST_API_TOKEN) ||
    cleanString(process.env.UPSTASH_REDIS_REST_TOKEN) ||
    cleanString(process.env.RESEND_API_KEY) ||
    cleanString(process.env.ORCATRADE_OS_API)
  );
}

function getTokenTtlMs() {
  const configured = Number(process.env.ORCATRADE_REPORT_TOKEN_TTL_MS) || DEFAULT_REPORT_TOKEN_TTL_MS;
  return Math.max(60 * 1000, configured);
}

function signPayload(encodedPayload, secret) {
  return crypto.createHmac('sha256', secret).update(encodedPayload).digest('base64url');
}

function buildTokenPayload(reportId, expiresAtMs, purpose) {
  return {
    v: 1,
    p: purpose,
    r: cleanString(reportId),
    e: expiresAtMs,
  };
}

function createReportAccessToken(reportId, options = {}) {
  const normalizedReportId = cleanString(reportId);
  const secret = getSigningSecret();
  if (!normalizedReportId || !secret) return null;

  const issuedAtMs = Number(options.issuedAtMs) || Date.now();
  const expiresAtMs = Number(options.expiresAtMs) || (issuedAtMs + getTokenTtlMs());
  const payload = buildTokenPayload(normalizedReportId, expiresAtMs, TOKEN_PURPOSE);
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = signPayload(encodedPayload, secret);

  return {
    token: `${TOKEN_PREFIX}.${encodedPayload}.${signature}`,
    expiresAt: new Date(expiresAtMs).toISOString(),
    expiresAtMs,
    mode: 'signed_token',
  };
}

function createAccountAccessToken(ownerFingerprint, options = {}) {
  const normalizedFingerprint = cleanString(ownerFingerprint);
  const secret = getSigningSecret();
  if (!normalizedFingerprint || !secret) return null;

  const issuedAtMs = Number(options.issuedAtMs) || Date.now();
  const expiresAtMs = Number(options.expiresAtMs) || (issuedAtMs + getTokenTtlMs());
  const payload = buildTokenPayload(normalizedFingerprint, expiresAtMs, ACCOUNT_TOKEN_PURPOSE);
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = signPayload(encodedPayload, secret);

  return {
    token: `${TOKEN_PREFIX}.${encodedPayload}.${signature}`,
    expiresAt: new Date(expiresAtMs).toISOString(),
    expiresAtMs,
    mode: 'signed_account_token',
  };
}

function createWorkspaceAccessToken(workspaceFingerprint, options = {}) {
  const normalizedFingerprint = cleanString(workspaceFingerprint);
  const secret = getSigningSecret();
  if (!normalizedFingerprint || !secret) return null;

  const issuedAtMs = Number(options.issuedAtMs) || Date.now();
  const expiresAtMs = Number(options.expiresAtMs) || (issuedAtMs + getTokenTtlMs());
  const payload = buildTokenPayload(normalizedFingerprint, expiresAtMs, WORKSPACE_TOKEN_PURPOSE);
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = signPayload(encodedPayload, secret);

  return {
    token: `${TOKEN_PREFIX}.${encodedPayload}.${signature}`,
    expiresAt: new Date(expiresAtMs).toISOString(),
    expiresAtMs,
    mode: 'signed_workspace_token',
  };
}

function buildRetrievalPath(reportId, accessToken, accountToken) {
  const normalizedReportId = cleanString(reportId);
  const normalizedToken = cleanString(accessToken);
  if (!normalizedReportId || !normalizedToken) return '';

  const base = `/api/report?reportId=${encodeURIComponent(normalizedReportId)}&accessToken=${encodeURIComponent(normalizedToken)}`;
  return cleanString(accountToken)
    ? `${base}&accountToken=${encodeURIComponent(accountToken)}`
    : base;
}

function attachReportAccess(report, options = {}) {
  const baseReport = report && typeof report === 'object' ? report : {};
  const access = createReportAccessToken(baseReport.reportId, options);
  const ownerFingerprint = cleanString(options.ownerFingerprint) || cleanString(baseReport.reportOwnership?.ownerFingerprint);
  const accountAccess = createAccountAccessToken(ownerFingerprint, options);
  const workspaceFingerprint = cleanString(options.workspaceFingerprint) ||
    cleanString(baseReport.reportOwnership?.workspaceFingerprint) ||
    ownerFingerprint;
  const workspaceAccess = createWorkspaceAccessToken(workspaceFingerprint, options);

  if (!access) {
    return {
      ...baseReport,
      reportAccess: {
        enabled: false,
        mode: 'disabled',
        reason: 'Signed report access is unavailable because no signing secret is configured.',
      },
    };
  }

  return {
    ...baseReport,
    reportAccess: {
      enabled: true,
      mode: access.mode,
      token: access.token,
      expiresAt: access.expiresAt,
      retrievalPath: buildRetrievalPath(baseReport.reportId, access.token, accountAccess?.token),
    },
    accountAccess: accountAccess ? {
      enabled: true,
      mode: accountAccess.mode,
      token: accountAccess.token,
      expiresAt: accountAccess.expiresAt,
      retrievalPath: `/api/reports?accountToken=${encodeURIComponent(accountAccess.token)}`,
    } : {
      enabled: false,
      mode: 'disabled',
      reason: ownerFingerprint
        ? 'Account access could not be signed because no signing secret is configured.'
        : 'No account ownership context was provided for this report.',
    },
    workspaceAccess: workspaceAccess ? {
      enabled: true,
      mode: workspaceAccess.mode,
      token: workspaceAccess.token,
      expiresAt: workspaceAccess.expiresAt,
      retrievalPath: `/api/workspace?workspaceToken=${encodeURIComponent(workspaceAccess.token)}`,
    } : {
      enabled: false,
      mode: 'disabled',
      reason: workspaceFingerprint
        ? 'Workspace access could not be signed because no signing secret is configured.'
        : 'No workspace ownership context was provided for this report.',
    },
  };
}

function decodeSignedTokenResource(token, expectedPurpose) {
  const normalizedToken = cleanString(token);
  if (!normalizedToken) return { ok: false, code: 'missing_token', reason: 'A signed token is required.' };

  const parts = normalizedToken.split('.');
  if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX) {
    return { ok: false, code: 'invalid_token', reason: 'The access token format is invalid.' };
  }

  let payload = null;
  try {
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch (error) {
    return { ok: false, code: 'invalid_payload', reason: 'The access token payload could not be read.' };
  }

  if (!payload || (expectedPurpose && payload.p !== expectedPurpose)) {
    return { ok: false, code: 'token_purpose_mismatch', reason: 'The access token purpose is invalid.' };
  }

  return {
    ok: true,
    payload,
  };
}

function verifyReportAccessToken(reportId, token) {
  const normalizedReportId = cleanString(reportId);
  const normalizedToken = cleanString(token);
  const secret = getSigningSecret();

  if (!normalizedToken) {
    return { ok: false, code: 'missing_token', reason: 'A signed access token is required.' };
  }

  if (!secret) {
    return { ok: false, code: 'signing_unavailable', reason: 'Signed report access is unavailable.' };
  }

  const parts = normalizedToken.split('.');
  if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX) {
    return { ok: false, code: 'invalid_token', reason: 'The access token format is invalid.' };
  }

  const expectedSignature = signPayload(parts[1], secret);
  const expectedBuffer = Buffer.from(expectedSignature);
  const actualBuffer = Buffer.from(parts[2]);

  if (expectedBuffer.length !== actualBuffer.length || !crypto.timingSafeEqual(expectedBuffer, actualBuffer)) {
    return { ok: false, code: 'invalid_signature', reason: 'The access token signature is invalid.' };
  }

  let payload = null;
  try {
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch (error) {
    return { ok: false, code: 'invalid_payload', reason: 'The access token payload could not be read.' };
  }

  if (!payload || payload.p !== TOKEN_PURPOSE || payload.r !== normalizedReportId) {
    return { ok: false, code: 'report_mismatch', reason: 'The access token does not match this report.' };
  }

  if (!payload.e || Number(payload.e) <= Date.now()) {
    return { ok: false, code: 'expired_token', reason: 'The access token has expired.' };
  }

  return {
    ok: true,
    payload,
    expiresAt: new Date(Number(payload.e)).toISOString(),
  };
}

function verifyAccountAccessToken(ownerFingerprint, token) {
  const normalizedFingerprint = cleanString(ownerFingerprint);
  const normalizedToken = cleanString(token);
  const secret = getSigningSecret();

  if (!normalizedToken) {
    return { ok: false, code: 'missing_account_token', reason: 'A signed account token is required.' };
  }

  if (!secret) {
    return { ok: false, code: 'signing_unavailable', reason: 'Signed account access is unavailable.' };
  }

  const parts = normalizedToken.split('.');
  if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX) {
    return { ok: false, code: 'invalid_account_token', reason: 'The account token format is invalid.' };
  }

  const expectedSignature = signPayload(parts[1], secret);
  const expectedBuffer = Buffer.from(expectedSignature);
  const actualBuffer = Buffer.from(parts[2]);

  if (expectedBuffer.length !== actualBuffer.length || !crypto.timingSafeEqual(expectedBuffer, actualBuffer)) {
    return { ok: false, code: 'invalid_account_signature', reason: 'The account token signature is invalid.' };
  }

  let payload = null;
  try {
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch (error) {
    return { ok: false, code: 'invalid_account_payload', reason: 'The account token payload could not be read.' };
  }

  if (!payload || payload.p !== ACCOUNT_TOKEN_PURPOSE || payload.r !== normalizedFingerprint) {
    return { ok: false, code: 'account_mismatch', reason: 'The account token does not match this account.' };
  }

  if (!payload.e || Number(payload.e) <= Date.now()) {
    return { ok: false, code: 'expired_account_token', reason: 'The account token has expired.' };
  }

  return {
    ok: true,
    payload,
    expiresAt: new Date(Number(payload.e)).toISOString(),
  };
}

function verifyWorkspaceAccessToken(workspaceFingerprint, token) {
  const normalizedFingerprint = cleanString(workspaceFingerprint);
  const normalizedToken = cleanString(token);
  const secret = getSigningSecret();

  if (!normalizedToken) {
    return { ok: false, code: 'missing_workspace_token', reason: 'A signed workspace token is required.' };
  }

  if (!secret) {
    return { ok: false, code: 'signing_unavailable', reason: 'Signed workspace access is unavailable.' };
  }

  const parts = normalizedToken.split('.');
  if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX) {
    return { ok: false, code: 'invalid_workspace_token', reason: 'The workspace token format is invalid.' };
  }

  const expectedSignature = signPayload(parts[1], secret);
  const expectedBuffer = Buffer.from(expectedSignature);
  const actualBuffer = Buffer.from(parts[2]);

  if (expectedBuffer.length !== actualBuffer.length || !crypto.timingSafeEqual(expectedBuffer, actualBuffer)) {
    return { ok: false, code: 'invalid_workspace_signature', reason: 'The workspace token signature is invalid.' };
  }

  const decoded = decodeSignedTokenResource(normalizedToken, WORKSPACE_TOKEN_PURPOSE);
  if (!decoded.ok) {
    return {
      ok: false,
      code: decoded.code === 'token_purpose_mismatch' ? 'workspace_mismatch' : decoded.code,
      reason: decoded.reason,
    };
  }

  const payload = decoded.payload;
  if (payload.r !== normalizedFingerprint) {
    return { ok: false, code: 'workspace_mismatch', reason: 'The workspace token does not match this workspace.' };
  }

  if (!payload.e || Number(payload.e) <= Date.now()) {
    return { ok: false, code: 'expired_workspace_token', reason: 'The workspace token has expired.' };
  }

  return {
    ok: true,
    payload,
    expiresAt: new Date(Number(payload.e)).toISOString(),
  };
}

module.exports = {
  attachReportAccess,
  buildRetrievalPath,
  createWorkspaceAccessToken,
  createAccountAccessToken,
  createReportAccessToken,
  decodeSignedTokenResource,
  verifyAccountAccessToken,
  verifyReportAccessToken,
  verifyWorkspaceAccessToken,
};
