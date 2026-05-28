// /api/marketplace/* — trade-finance + insurance introducer (apex II7).
//
// We are an introducer, not an adviser, not a broker, not a principal. The
// platform's only role is: (1) surface a curated provider directory,
// (2) record an introduction request when the user clicks (audit-logged with
// expected take-rate), and (3) provide the user with the provider's contact
// path. Everything else happens between the user and the provider.
//
//   GET  /api/marketplace[?product=<p>&region=<r>]
//   POST /api/marketplace/intro  body: { providerId, note? }
//     → records a marketplace_intro_requested event and returns the contact
//       path for the user to follow up directly.

'use strict';

const auth = require('../auth');
const events = require('../events');
const log = require('../log').withContext({ handler: 'marketplace' });
const { listProviders, getProvider } = require('../intelligence/marketplace-providers');

function jsonResponse(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  return res.end(JSON.stringify(body));
}

function segments(req) {
  if (req.query && req.query.path) {
    const parts = Array.isArray(req.query.path) ? req.query.path : String(req.query.path).split('/');
    return parts.slice(1); // drop 'marketplace'
  }
  return (req.url || '').split('?')[0].replace(/^\/api\/marketplace\/?/, '').split('/').filter(Boolean);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }

  const segs = segments(req);

  // GET /api/marketplace — public read-only directory (no auth required).
  if (req.method === 'GET' && !segs.length) {
    const product = req.query && req.query.product ? String(req.query.product) : undefined;
    const region = req.query && req.query.region ? String(req.query.region) : undefined;
    return jsonResponse(res, 200, {
      ok: true,
      disclaimer: 'OrcaTrade is an introducer, not a broker or adviser. Provider listings are illustrative; verify regulatory status and terms directly with the provider before transacting.',
      providers: listProviders({ product, region }),
    });
  }

  // POST /api/marketplace/intro — record an intro request (auth required).
  if (req.method === 'POST' && segs[0] === 'intro') {
    const user = auth.getCurrentUser(req);
    if (!user) return jsonResponse(res, 401, { error: 'Sign in to request an introduction.' });
    const body = req.body || {};
    const providerId = String(body.providerId || '');
    const provider = getProvider(providerId);
    if (!provider) return jsonResponse(res, 404, { error: 'Unknown providerId' });
    const note = typeof body.note === 'string' ? body.note.slice(0, 600) : '';
    try {
      await events.record('marketplace_intro_requested', {
        email: user.email,
        providerId: provider.id,
        providerName: provider.name,
        products: provider.products,
        takeRatePct: provider.takeRatePct,
        note,
      });
    } catch (err) {
      log.warn('intro audit failed', { err: err.message });
    }
    return jsonResponse(res, 200, {
      ok: true,
      provider: {
        id: provider.id, name: provider.name, region: provider.region,
        products: provider.products, introContact: provider.introContact,
        takeRatePct: provider.takeRatePct,
      },
      followUp: 'The provider has been notified-via-record only. To proceed, contact them directly using the introContact above and reference OrcaTrade as the source of the introduction.',
    });
  }

  return jsonResponse(res, 404, { error: 'Unknown marketplace route' });
};
