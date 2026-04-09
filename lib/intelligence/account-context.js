const { createCacheKey } = require('./cache-store');

function cleanString(value) {
  return String(value || '').trim();
}

function normalizeEmail(value) {
  return cleanString(value).toLowerCase();
}

function maskEmail(value) {
  const email = normalizeEmail(value);
  const parts = email.split('@');
  if (parts.length !== 2) return '';
  const local = parts[0];
  const domain = parts[1];
  if (!local) return email;
  const maskedLocal = local.length <= 2
    ? `${local.charAt(0)}*`
    : `${local.slice(0, 2)}${'*'.repeat(Math.max(1, local.length - 2))}`;
  return `${maskedLocal}@${domain}`;
}

function normalizeAccountContext(orderData = {}) {
  return {
    accountId: cleanString(orderData.accountId || orderData.workspaceId || orderData.customerId),
    company: cleanString(orderData.company || orderData.companyName || orderData.importerCompany),
    email: normalizeEmail(orderData.email || orderData.workEmail || orderData.contactEmail),
  };
}

function deriveOwnerFingerprint(orderData = {}) {
  const context = normalizeAccountContext(orderData);
  if (!context.accountId && !context.company && !context.email) return '';

  return createCacheKey({
    accountId: context.accountId,
    company: context.company.toLowerCase(),
    email: context.email,
  });
}

function deriveWorkspaceFingerprint(orderData = {}) {
  return deriveOwnerFingerprint(orderData);
}

function buildWorkspaceProfile(orderData = {}) {
  const context = normalizeAccountContext(orderData);
  const workspaceFingerprint = deriveWorkspaceFingerprint(context);
  const workspaceLabel = context.company || maskEmail(context.email) || context.accountId || 'Anonymous workspace';

  return {
    workspaceFingerprint: workspaceFingerprint || null,
    workspaceLabel,
    company: context.company || null,
    emailMasked: context.email ? maskEmail(context.email) : null,
    accountId: context.accountId || null,
    accessRequired: Boolean(workspaceFingerprint),
  };
}

function buildReportOwnership(orderData = {}) {
  const context = normalizeAccountContext(orderData);
  const ownerFingerprint = deriveOwnerFingerprint(context);
  const workspace = buildWorkspaceProfile(context);
  const identityMode = context.accountId
    ? 'account_id'
    : context.email
      ? 'email'
      : context.company
        ? 'company'
        : 'anonymous';
  const accountLabel = context.company || maskEmail(context.email) || context.accountId || 'Anonymous';

  return {
    identityMode,
    accountLabel,
    company: context.company || null,
    emailMasked: context.email ? maskEmail(context.email) : null,
    ownerFingerprint: ownerFingerprint || null,
    accessRequired: Boolean(ownerFingerprint),
    workspaceFingerprint: workspace.workspaceFingerprint,
    workspaceLabel: workspace.workspaceLabel,
  };
}

module.exports = {
  buildReportOwnership,
  buildWorkspaceProfile,
  deriveOwnerFingerprint,
  deriveWorkspaceFingerprint,
  maskEmail,
  normalizeAccountContext,
};
