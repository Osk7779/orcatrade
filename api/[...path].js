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
  // Multi-SKU portfolio planner (Sprint portfolio-v1). POST /api/portfolio
  // with { lines: [<plan-input>, …] } → per-line plans + a portfolio
  // aggregate (total landed, blended duty, per-lane consolidation savings).
  portfolio: require('../lib/handlers/portfolio'),
  // Goods master CRUD — L1.1 of docs/strategic-plan-2026-2031.md §4.1.2.
  // GET/POST /api/goods + GET/PATCH/DELETE /api/goods/<externalId>.
  // Auth-required + org-scoped + audit-logged on every mutation (ADR 0005).
  goods: require('../lib/handlers/goods'),
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
  // /api/factory-risk is the public marketing-shell tool surface; it
  // wraps the same handler as factory-score (the legacy internal name).
  // Aliasing here keeps one source of truth for the screening logic.
  'factory-risk': require('../lib/handlers/factory-score'),
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
  // Public SLO snapshot (apex P1.A). GET /api/slo returns per-handler
  // p50/p95/p99 latencies + error rate over the last 24h rolling
  // window, populated by the dispatcher's instrumentation in
  // lib/slo.js. Consumed by /status/ for the live SLO display.
  slo: require('../lib/handlers/slo'),
  // GDPR data subject endpoints (Sprint BG-5.1). GET /api/account/export
  // returns a JSON dump of everything we hold for the signed-in user;
  // POST /api/account/delete pseudonymises events + hard-deletes plans
  // + clears the session.
  account: require('../lib/handlers/account'),
  // Admin event-by-event feed (Sprint BG-5.3). GET /api/audit returns
  // recent events with PII redacted (email → emailHash) for the
  // /dashboard/audit/ admin view. Same token-gate as /api/leads.
  audit: require('../lib/handlers/audit'),
  // Public verifiable audit-chain anchor (apex III2). GET
  // /api/audit-anchor returns { chainHead, chainLength, asOf,
  // genesis } — no admin gate, no PII. Lets customers pin the
  // current head so a future chain rewrite is third-party
  // detectable. See docs/security/audit-trail.md.
  'audit-anchor': require('../lib/handlers/audit-anchor'),
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
  // Sprint share-render-v1 — the wizard calls /api/share-check/<code>
  // on every cold load when ?share=<code> is in the URL. Increments
  // view count + audits + returns ok/revoked so a bookmarked /start/
  // URL stops working once the owner hits Revoke.
  'share-check': require('../lib/handlers/share-check'),
  // Sprint wizard-step-funnel-v1 — the wizard fires fire-and-forget
  // POSTs as the user clicks Next/Back/Submit so we can compute the
  // 6-step funnel ("how many users reached step 4?") without external
  // analytics tools. No PII.
  'wizard-event': require('../lib/handlers/wizard-event'),
  // Sprint hs-suggest-v1 — GET /api/hs-suggest?q=<description> returns
  // candidate HS6 commodity codes so a wizard user who doesn't know
  // their code can pick one, which then triggers the live-TARIC-refined
  // duty path. Pure curated lookup, no PII.
  'hs-suggest': require('../lib/handlers/hs-suggest'),
  // One-click unsubscribe (prefs-v1). GET /api/unsubscribe?token=…
  // verifies the HMAC-signed token from a plan-revision email and
  // flips planRevisionEmails:false for the encoded address. Renders
  // a small HTML confirmation page — most users hit this from a
  // mail client. No auth — the signed token IS the auth.
  unsubscribe: require('../lib/handlers/unsubscribe'),
  // Sprint sanctions-ui-v1 — indicative denied-party / sanctions pre-screen.
  // POST /api/screen { name } → potential matches (never an all-clear).
  // Stateless + rate-limited; powers the /account/screen/ tool page.
  screen: require('../lib/handlers/screen'),
  // Quote Studio (Sprint quote-rebrand-v1). Admin-only internal tool.
  // POST /api/quote-rebrand { action:'extract' } reads a supplier PDF via
  // Claude; { action:'generate' } prices it with the fixed-margin calculator
  // and returns a branded OrcaTrade quotation PDF. Powers /tools/quote-rebrand/.
  'quote-rebrand': require('../lib/handlers/quote-rebrand'),
  // SCIM 2.0 user provisioning (apex III1). /api/scim/v2/Users — the
  // customer's IdP provisions/deprovisions org members via a per-org bearer
  // token (lib/scim-store.js). Machine-to-machine; no session cookie.
  scim: require('../lib/handlers/scim'),
  // Human-review queue inspector (Phase 0 P0.10). GET = list queued
  // tickets; POST = claim or resolve. Admin-gated (same pattern as
  // /api/audit). Backs the lib/human-review.js queue that the 5 agents'
  // requestHumanReview tool writes to. See docs/runbooks/human-review-queue.md.
  'human-review': require('../lib/handlers/human-review'),
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

  // Versioned alias (backend-grade-plan #7): /api/v1/<name> is the stable
  // public contract surface. Strip the version segment from BOTH req.query.path
  // and req.url so downstream sub-action handlers (which anchor on the handler
  // name, e.g. /api/plans/<id>) see exactly the same path as the bare alias —
  // the version is transparent to them. Bare /api/<name> is the v1 alias.
  let apiVersion = 'v1';
  if (key === 'v1' || key === 'v2') {
    apiVersion = key;
    if (req.query && req.query.path) {
      req.query.path = Array.isArray(req.query.path)
        ? req.query.path.slice(1)
        : String(req.query.path).split('/').slice(1).join('/');
    }
    if (req.url) req.url = req.url.replace(/^\/api\/v[12]\//, '/api/');
    // Re-resolve the handler key from the now-stripped path.
    if (req.query && req.query.path && (Array.isArray(req.query.path) ? req.query.path.length : req.query.path)) {
      key = Array.isArray(req.query.path) ? (req.query.path[0] || '') : String(req.query.path).split('/')[0];
    } else {
      const pathname = (req.url || '').split('?')[0];
      key = pathname.replace(/^\/api\//, '').split('/').filter(Boolean)[0] || '';
    }
  }

  // Sprint BG-4.1: every request gets a correlation id. Honour a caller-supplied
  // x-request-id if it looks reasonable (so curl scripts can pin one); otherwise
  // mint a fresh 12-hex-char id. The id is attached to req for handlers, echoed
  // back on the response, and stamped on the router-level error log.
  const log = require('../lib/log');
  const incoming = (req.headers && req.headers['x-request-id']) || '';
  const requestId = /^[a-z0-9_-]{6,64}$/i.test(incoming) ? incoming : log.generateRequestId();
  req.requestId = requestId;
  req.apiVersion = apiVersion;
  try {
    res.setHeader('x-request-id', requestId);
    res.setHeader('x-api-version', apiVersion);
  } catch (_) { /* response may already be terminal */ }

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

  // Apex P1.A — per-handler SLO instrumentation. Records latency +
  // status for every dispatched call into a 24h-rolling KV bucket.
  // Fire-and-forget post-response so it never blocks the user. See
  // lib/slo.js + /api/slo for the consumption surface.
  const sloStart = Date.now();
  const slo = require('../lib/slo');
  function recordSlo() {
    const ms = Date.now() - sloStart;
    const status = res.statusCode || 200;
    // Don't await — purely fire-and-forget.
    Promise.resolve()
      .then(() => slo.record(key, ms, status))
      .catch(() => { /* telemetry must never break the request */ });
  }

  try {
    const result = await handler(req, res);
    recordSlo();
    return result;
  } catch (err) {
    // log.error forwards to Sentry as an exception (with stack frames)
    // when the `err` extra is an Error — see lib/log.js forwardToSentry
    // (P0.7). The previous captureMessage path lost the stack.
    log.error('handler threw', { handler: key, requestId, err });
    if (!res.headersSent) {
      res.setHeader('Content-Type', 'application/json');
      res.statusCode = 500;
      const body = JSON.stringify({ error: err.message || 'Internal handler error', requestId });
      res.end(body);
      recordSlo();
      return;
    }
    if (!res.writableEnded) res.end();
    recordSlo();
  }
};

module.exports.handlers = handlers;

// Phase 0 P0.7 — install Sentry process-level handlers at module load.
// Idempotent (no-op on re-load). Captures errors that escape the dispatcher's
// try/catch above: module-load throws, async errors from setTimeout/setInterval
// callbacks, post-response throws. Vercel cold-starts run this once per
// function instance; warm invocations skip via the idempotency guard.
try {
  require('../lib/sentry').installProcessHandlers();
} catch (_) {
  // Telemetry must NEVER break the dispatcher.
}
