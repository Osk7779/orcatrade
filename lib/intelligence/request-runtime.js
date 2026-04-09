const crypto = require('node:crypto');

function cleanString(value) {
  return String(value || '').trim();
}

function buildRequestContext(req, route) {
  const ip = cleanString(req?.headers?.['x-forwarded-for']?.split(',')[0]) || 'unknown';
  const requestId = cleanString(req?.headers?.['x-request-id']) || crypto.randomUUID();

  return {
    requestId,
    route: cleanString(route) || 'unknown',
    ip,
    userAgent: cleanString(req?.headers?.['user-agent']),
    receivedAt: new Date().toISOString(),
  };
}

function applyRequestHeaders(res, requestContext) {
  if (!res || typeof res.setHeader !== 'function' || !requestContext) return;
  res.setHeader('X-OrcaTrade-Request-Id', requestContext.requestId);
  res.setHeader('X-OrcaTrade-Route', requestContext.route);
}

function buildRequestMeta(requestContext, extras = {}) {
  return {
    requestId: cleanString(requestContext?.requestId),
    route: cleanString(requestContext?.route),
    receivedAt: cleanString(requestContext?.receivedAt),
    ...extras,
  };
}

function emitAuditEvent(requestContext, event, details = {}) {
  try {
    console.info(JSON.stringify({
      scope: 'orcatrade-intelligence',
      event: cleanString(event) || 'unknown',
      requestId: cleanString(requestContext?.requestId),
      route: cleanString(requestContext?.route),
      ip: cleanString(requestContext?.ip),
      receivedAt: cleanString(requestContext?.receivedAt),
      ...details,
    }));
  } catch (error) {
    console.info('orcatrade-intelligence', cleanString(event) || 'unknown');
  }
}

module.exports = {
  applyRequestHeaders,
  buildRequestContext,
  buildRequestMeta,
  emitAuditEvent,
};
