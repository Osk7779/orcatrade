// Single Vercel serverless function that routes /api/<name> requests to the
// matching handler in lib/handlers/. Consolidates 27 endpoints into 1 function
// to stay under the Hobby plan's 12-function limit.
//
// URL semantics are preserved: /api/customs still resolves to customs handler,
// /api/agent still resolves to compliance agent, etc. — only the underlying
// implementation moved from api/<name>.js to lib/handlers/<name>.js.

const handlers = {
  // Recent sprint endpoints (Sprints 12–26)
  agent: require('../lib/handlers/agent'),
  orchestrator: require('../lib/handlers/orchestrator'),
  'sourcing-agent': require('../lib/handlers/sourcing-agent'),
  'logistics-agent': require('../lib/handlers/logistics-agent'),
  'finance-agent': require('../lib/handlers/finance-agent'),
  analysis: require('../lib/handlers/analysis'),
  documents: require('../lib/handlers/documents'),
  insurance: require('../lib/handlers/insurance'),
  'buyer-verification': require('../lib/handlers/buyer-verification'),
  samples: require('../lib/handlers/samples'),
  returns: require('../lib/handlers/returns'),
  routing: require('../lib/handlers/routing'),
  customs: require('../lib/handlers/customs'),
  warehouse: require('../lib/handlers/warehouse'),
  'sourcing-quote': require('../lib/handlers/sourcing-quote'),
  'finance-quote': require('../lib/handlers/finance-quote'),
  // Import Plan Builder
  start: require('../lib/handlers/start'),
  // Auth (magic-link). Sub-actions resolved inside the handler from the
  // second URL segment: request / verify / me / logout.
  auth: require('../lib/handlers/auth'),
  // Saved plans. POST/GET /api/plans, GET/DELETE /api/plans/<id>.
  plans: require('../lib/handlers/plans'),
  // Conversion analytics summary (Sprint 36). Token-gated via the
  // ORCATRADE_LEADS_TOKEN env var; consumed by /dashboard/leads/.
  leads: require('../lib/handlers/leads'),
  // Subscription tier catalogue + per-user resolution (Sprint 40).
  // GET /api/tiers (public) | GET /api/tiers/me (auth).
  tiers: require('../lib/handlers/tiers'),
  // Stripe billing (Sprint 41). POST /api/billing/{checkout,portal,webhook}
  // and GET /api/billing/me. Webhook needs raw-body access for signature
  // verification — see getRawBody() in the handler.
  billing: require('../lib/handlers/billing'),
  // RSS / Atom feed (Sprint AE). /feed.xml + /atom.xml rewrite to here.
  feed: require('../lib/handlers/feed'),
  // Token-gated cron dispatcher. Scheduled jobs (founder digest,
  // plan-revision emails) fire from GitHub Actions → POST here.
  cron: require('../lib/handlers/cron'),
  // Sprint cron-observability-v1 — admin-only status reader. Sibling
  // route to /api/cron so a GET to /api/cron-status returns the last-run
  // map without colliding with the POST dispatcher's token gate.
  'cron-status': require('../lib/handlers/cron').handleStatus,
  // Legacy endpoints
  chat: require('../lib/handlers/chat'),
  check: require('../lib/handlers/check'),
  'quick-check': require('../lib/handlers/quick-check'),
  'factory-score': require('../lib/handlers/factory-score'),
  'supply-chain': require('../lib/handlers/supply-chain'),
  news: require('../lib/handlers/news'),
  contact: require('../lib/handlers/contact'),
  // Founding 10 pilot application capture (Sprint J).
  // GET → counter payload, POST → application + email + event.
  founding: require('../lib/handlers/founding'),
  evidence: require('../lib/handlers/evidence'),
  report: require('../lib/handlers/report'),
  reports: require('../lib/handlers/reports'),
  workspace: require('../lib/handlers/workspace'),
  // Operational health probe (Sprint BG-4.3). GET /api/health returns
  // structured status for KV, TARIC warm cache, Resend/Stripe/Anthropic
  // env vars. 200 = ok | degraded; 503 = KV down (paging condition).
  health: require('../lib/handlers/health'),
  // GDPR data subject endpoints (Sprint BG-5.1). GET /api/account/export
  // returns a JSON dump of everything we hold for the signed-in user;
  // POST /api/account/delete pseudonymises events + hard-deletes plans
  // + clears the session.
  account: require('../lib/handlers/account'),
  // Admin event-by-event feed (Sprint BG-5.3). GET /api/audit returns
  // recent events with PII redacted (email → emailHash) for the
  // /dashboard/audit/ admin view. Same token-gate as /api/leads.
  audit: require('../lib/handlers/audit'),
  // Cross-user calibration analytics (Sprint BG-1.6). GET /api/calibration
  // returns aggregate variance stats grouped by category / origin /
  // destination / route — reads via actuals.listFromPg() which JOINs
  // saved_plans + actuals in Postgres. Same token-gate as /api/audit.
  calibration: require('../lib/handlers/calibration'),
  // Organisation + seat management (Sprint BG-3.1 foundation).
  // GET /api/orgs lists mine; POST creates; /<id>/{invite,remove,transfer}
  // for membership ops. Tier-by-org migration is a follow-up sprint.
  orgs: require('../lib/handlers/orgs'),
  // Public read-only share resolver (shares-v1). GET /api/share/<code>
  // (also reachable as /share/<code> via the vercel.json rewrite)
  // looks up a saved plan by its share code, increments the view
  // count, audits the open, and 302-redirects to /start/?p=<base64>.
  share: require('../lib/handlers/share'),
  // One-click unsubscribe (prefs-v1). GET /api/unsubscribe?token=…
  // verifies the HMAC-signed token from a plan-revision email and
  // flips planRevisionEmails:false for the encoded address. Renders
  // a small HTML confirmation page — most users hit this from a
  // mail client. No auth — the signed token IS the auth.
  unsubscribe: require('../lib/handlers/unsubscribe'),
};

module.exports = async (req, res) => {
  // Vercel exposes the dynamic segment(s) on req.query.path. For a single-segment
  // catch-all like /api/customs, this is ['customs']. Fall back to URL parsing
  // for environments where req.query may not be populated.
  let key;
  if (req.query && req.query.path) {
    key = Array.isArray(req.query.path) ? req.query.path[0] : String(req.query.path).split('/')[0];
  } else {
    const pathname = (req.url || '').split('?')[0];
    const segments = pathname.replace(/^\/api\//, '').split('/').filter(Boolean);
    key = segments[0] || '';
  }

  // Sprint BG-4.1: every request gets a correlation id. Honour a caller-supplied
  // x-request-id if it looks reasonable (so curl scripts can pin one); otherwise
  // mint a fresh 12-hex-char id. The id is attached to req for handlers, echoed
  // back on the response, and stamped on the router-level error log.
  const log = require('../lib/log');
  const incoming = (req.headers && req.headers['x-request-id']) || '';
  const requestId = /^[a-z0-9_-]{6,64}$/i.test(incoming) ? incoming : log.generateRequestId();
  req.requestId = requestId;
  try { res.setHeader('x-request-id', requestId); } catch (_) { /* response may already be terminal */ }

  const handler = handlers[key];
  if (!handler) {
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = 404;
    return res.end(JSON.stringify({
      error: `No API handler for /api/${key}`,
      availableEndpoints: Object.keys(handlers).sort(),
      requestId,
    }));
  }

  try {
    return await handler(req, res);
  } catch (err) {
    log.error('handler threw', { handler: key, requestId, err });
    if (!res.headersSent) {
      res.setHeader('Content-Type', 'application/json');
      res.statusCode = 500;
      return res.end(JSON.stringify({ error: err.message || 'Internal handler error', requestId }));
    }
    if (!res.writableEnded) res.end();
  }
};

module.exports.handlers = handlers;
