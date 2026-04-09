const { cleanString } = require('../lib/intelligence/catalog');
const {
  consumeRateLimit,
  getStoredEvidenceBundleById,
  listStoredEvidenceBundlesByOwner,
  persistEvidenceBundle,
} = require('../lib/intelligence/runtime-store');
const { extractEvidenceBundle, mergeComplianceInputWithEvidence, validateEvidenceDocuments } = require('../lib/intelligence/evidence-ingestion');
const { normaliseComplianceInput } = require('../lib/intelligence/compliance');
const { createAccountAccessToken, verifyAccountAccessToken } = require('../lib/intelligence/report-access');
const { applyRequestHeaders, buildRequestContext, buildRequestMeta, emitAuditEvent } = require('../lib/intelligence/request-runtime');

const EVIDENCE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-OrcaTrade-Account-Token, X-Request-Id');
  res.setHeader('Cache-Control', 'no-store');
}

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

function buildBundleResponse(record, requestContext, accountAccess) {
  const bundle = record && record.bundle ? record.bundle : {};
  const ownership = record && record.ownership ? record.ownership : {};

  return {
    bundleId: cleanString(bundle.bundleId),
    bundleVersion: cleanString(bundle.bundleVersion),
    generationMode: 'deterministic_extraction',
    storageMode: cleanString(record?.storageMode) || 'memory',
    storedAt: cleanString(record?.storedAt),
    documentCount: Math.max(0, Number(bundle.documentCount) || 0),
    documents: Array.isArray(bundle.documents) ? bundle.documents : [],
    extractedFacts: bundle.extractedFacts || {},
    factSources: bundle.factSources || {},
    evidenceSummary: cleanString(bundle.evidenceSummary),
    extractedFieldCount: Math.max(0, Number(bundle.extractedFieldCount) || 0),
    ownership: {
      accountLabel: cleanString(ownership.accountLabel),
      company: cleanString(ownership.company),
      accessRequired: Boolean(ownership.accessRequired),
    },
    accountAccess: accountAccess || {
      enabled: false,
      mode: 'disabled',
      reason: ownership.ownerFingerprint
        ? 'A signed account token is required to retrieve this evidence bundle.'
        : 'No account ownership context was provided for this evidence bundle.',
    },
    requestMeta: buildRequestMeta(requestContext, {
      storageMode: cleanString(record?.storageMode) || 'memory',
    }),
  };
}

async function handlePost(req, res, requestContext, rate) {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    emitAuditEvent(requestContext, 'evidence.validation_failed', { reason: 'body_not_object' });
    return res.status(422).json({ error: 'Request body must be a JSON object.' });
  }

  const evidenceValidation = validateEvidenceDocuments(req.body.evidenceDocuments);
  if (!evidenceValidation.ok) {
    emitAuditEvent(requestContext, 'evidence.validation_failed', {
      reason: 'invalid_documents',
      errorCount: evidenceValidation.errors.length,
    });
    return res.status(422).json({
      error: 'Evidence documents could not be processed.',
      details: evidenceValidation.errors,
    });
  }

  const evidenceBundle = extractEvidenceBundle(evidenceValidation.documents, req.body);
  const derivedInputs = normaliseComplianceInput(
    mergeComplianceInputWithEvidence(req.body, evidenceBundle)
  );
  const persisted = await persistEvidenceBundle(evidenceBundle, derivedInputs, EVIDENCE_TTL_MS);
  const ownerFingerprint = cleanString(persisted.ownership?.ownerFingerprint);
  const accountAccess = ownerFingerprint
    ? createAccountAccessToken(ownerFingerprint)
    : null;

  res.setHeader('X-OrcaTrade-Storage-Mode', persisted.storageMode || rate.storageMode || 'memory');
  res.setHeader('X-OrcaTrade-Evidence-Bundle', evidenceBundle.bundleId);
  if (accountAccess?.mode) {
    res.setHeader('X-OrcaTrade-Account-Access-Mode', accountAccess.mode);
  }
  if (accountAccess?.expiresAt) {
    res.setHeader('X-OrcaTrade-Account-Access-Expires-At', accountAccess.expiresAt);
  }

  emitAuditEvent(requestContext, 'evidence.persisted', {
    bundleId: evidenceBundle.bundleId,
    storageMode: persisted.storageMode,
    documentCount: evidenceBundle.documentCount,
    extractedFieldCount: evidenceBundle.extractedFieldCount,
  });

  const payload = buildBundleResponse({
    ...persisted,
    bundle: evidenceBundle,
    derivedInputs: {
      company: cleanString(derivedInputs.company),
      supplierName: cleanString(derivedInputs.supplierName),
      origin: cleanString(derivedInputs.origin),
      cnCode: cleanString(derivedInputs.cnCode || derivedInputs.hsCode),
      employeeCount: cleanString(derivedInputs.employeeCount),
      globalTurnover: cleanString(derivedInputs.globalTurnover),
      geolocationAvailable: derivedInputs.geolocationAvailable,
      dueDiligenceStatement: derivedInputs.dueDiligenceStatement,
      supplierEmissionsData: derivedInputs.supplierEmissionsData,
      authorisedDeclarant: derivedInputs.authorisedDeclarant,
    },
  }, requestContext, accountAccess ? {
    enabled: true,
    mode: accountAccess.mode,
    token: accountAccess.token,
    expiresAt: accountAccess.expiresAt,
    retrievalPath: `/api/evidence?bundleId=${encodeURIComponent(evidenceBundle.bundleId)}&accountToken=${encodeURIComponent(accountAccess.token)}`,
    listPath: `/api/evidence?accountToken=${encodeURIComponent(accountAccess.token)}`,
  } : null);
  payload.derivedInputs = {
    company: cleanString(derivedInputs.company),
    supplierName: cleanString(derivedInputs.supplierName),
    origin: cleanString(derivedInputs.origin),
    cnCode: cleanString(derivedInputs.cnCode || derivedInputs.hsCode),
    employeeCount: cleanString(derivedInputs.employeeCount),
    globalTurnover: cleanString(derivedInputs.globalTurnover),
    geolocationAvailable: derivedInputs.geolocationAvailable,
    dueDiligenceStatement: derivedInputs.dueDiligenceStatement,
    supplierEmissionsData: derivedInputs.supplierEmissionsData,
    authorisedDeclarant: derivedInputs.authorisedDeclarant,
  };

  return res.status(200).json(payload);
}

async function handleGet(req, res, requestContext, rate) {
  const bundleId = cleanString(req.query?.bundleId);
  const accountToken = cleanString(
    req.query?.accountToken ||
    req.headers['x-orcatrade-account-token']
  );

  if (bundleId) {
    const record = await getStoredEvidenceBundleById(bundleId);
    if (!record || !record.bundle) {
      emitAuditEvent(requestContext, 'evidence.not_found', { bundleId });
      return res.status(404).json({ error: 'Evidence bundle not found.' });
    }

    const ownerFingerprint = cleanString(record.ownership?.ownerFingerprint);
    if (ownerFingerprint) {
      const accountCheck = verifyAccountAccessToken(ownerFingerprint, accountToken);
      if (!accountCheck.ok) {
        emitAuditEvent(requestContext, 'evidence.access_denied', {
          bundleId,
          reason: accountCheck.code,
        });
        return res.status(accountCheck.code === 'missing_account_token' ? 401 : 403).json({
          error: accountCheck.reason || 'A signed account token is required for this evidence bundle.',
        });
      }
      if (accountCheck.expiresAt) {
        res.setHeader('X-OrcaTrade-Account-Access-Expires-At', accountCheck.expiresAt);
      }
    }

    res.setHeader('X-OrcaTrade-Storage-Mode', record.storageMode || rate.storageMode || 'memory');
    res.setHeader('X-OrcaTrade-Evidence-Bundle', bundleId);
    emitAuditEvent(requestContext, 'evidence.retrieved', {
      bundleId,
      storageMode: record.storageMode,
    });
    return res.status(200).json(buildBundleResponse(record, requestContext));
  }

  const decodedFingerprint = decodeOwnerFingerprint(accountToken);
  const accountCheck = verifyAccountAccessToken(decodedFingerprint, accountToken);
  if (!accountCheck.ok) {
    emitAuditEvent(requestContext, 'evidence.list_denied', { reason: accountCheck.code });
    return res.status(accountCheck.code === 'missing_account_token' ? 401 : 403).json({
      error: accountCheck.reason || 'A signed account token is required.',
    });
  }

  const limit = Math.min(25, Math.max(1, Number(req.query?.limit) || 10));
  const result = await listStoredEvidenceBundlesByOwner(decodedFingerprint, { limit });
  res.setHeader('X-OrcaTrade-Storage-Mode', result.storageMode || rate.storageMode || 'memory');
  if (accountCheck.expiresAt) {
    res.setHeader('X-OrcaTrade-Account-Access-Expires-At', accountCheck.expiresAt);
  }

  emitAuditEvent(requestContext, 'evidence.listed', {
    ownerFingerprint: decodedFingerprint,
    count: Array.isArray(result.bundles) ? result.bundles.length : 0,
  });

  return res.status(200).json({
    bundles: Array.isArray(result.bundles) ? result.bundles : [],
    count: Array.isArray(result.bundles) ? result.bundles.length : 0,
    requestMeta: buildRequestMeta(requestContext, {
      storageMode: result.storageMode || rate.storageMode || 'memory',
    }),
  });
}

module.exports = async function handler(req, res) {
  setCors(res);
  const requestContext = buildRequestContext(req, 'evidence');
  applyRequestHeaders(res, requestContext);

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET' && req.method !== 'POST') {
    emitAuditEvent(requestContext, 'evidence.method_not_allowed', { method: req.method });
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const rate = await consumeRateLimit('evidence-ingestion', requestContext.ip, 10, 60000);
  res.setHeader('X-OrcaTrade-Storage-Mode', rate.storageMode);
  if (rate.limited) {
    emitAuditEvent(requestContext, 'evidence.rate_limited', { storageMode: rate.storageMode });
    return res.status(429).json({ error: 'Too many requests. Please wait a moment.' });
  }

  try {
    return req.method === 'POST'
      ? await handlePost(req, res, requestContext, rate)
      : await handleGet(req, res, requestContext, rate);
  } catch (error) {
    emitAuditEvent(requestContext, 'evidence.failed', {
      message: cleanString(error.message),
    });
    console.error('Evidence handler error:', error);
    return res.status(500).json({
      error: 'Failed to process evidence bundle.',
      requestMeta: buildRequestMeta(requestContext, {
        storageMode: rate.storageMode || 'memory',
      }),
    });
  }
};
