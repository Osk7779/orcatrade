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
  // Legacy endpoints
  chat: require('../lib/handlers/chat'),
  check: require('../lib/handlers/check'),
  'quick-check': require('../lib/handlers/quick-check'),
  'factory-score': require('../lib/handlers/factory-score'),
  'supply-chain': require('../lib/handlers/supply-chain'),
  news: require('../lib/handlers/news'),
  contact: require('../lib/handlers/contact'),
  evidence: require('../lib/handlers/evidence'),
  report: require('../lib/handlers/report'),
  reports: require('../lib/handlers/reports'),
  workspace: require('../lib/handlers/workspace'),
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

  const handler = handlers[key];
  if (!handler) {
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = 404;
    return res.end(JSON.stringify({
      error: `No API handler for /api/${key}`,
      availableEndpoints: Object.keys(handlers).sort(),
    }));
  }

  try {
    return await handler(req, res);
  } catch (err) {
    console.error(`[/api/${key}] handler threw:`, err);
    if (!res.headersSent) {
      res.setHeader('Content-Type', 'application/json');
      res.statusCode = 500;
      return res.end(JSON.stringify({ error: err.message || 'Internal handler error' }));
    }
    if (!res.writableEnded) res.end();
  }
};

module.exports.handlers = handlers;
