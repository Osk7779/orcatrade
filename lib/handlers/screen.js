// Denied-party / sanctions pre-screen endpoint (Sprint sanctions-ui-v1).
// POST { name, threshold? } → indicative screen result. GET → advisory info.
// Stateless (no user data), rate-limited. SAFE-BY-DESIGN: never returns an
// all-clear — see lib/intelligence/sanctions-screening.js.

const { consumeRateLimit } = require('../intelligence/runtime-store');
const sanctions = require('../intelligence/sanctions-screening');

function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch (_) { return {}; }
  }
  return {};
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET → describe the endpoint + the standing advisory (so the UI can render
  // the disclaimer before the user screens anything).
  if (req.method === 'GET') {
    return res.status(200).json({
      ok: true,
      authoritative: false,
      advisory: sanctions.screen({ name: '' }).advisory,
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  const rate = await consumeRateLimit('screen', ip, 60, 60000);
  if (rate.limited) {
    return res.status(429).json({ error: 'Too many screening requests. Please wait a moment.' });
  }

  const body = readBody(req);
  const name = typeof body.name === 'string' ? body.name : '';
  if (!name.trim()) {
    return res.status(400).json({ error: '`name` is required' });
  }
  const threshold = Number.isFinite(Number(body.threshold)) ? Number(body.threshold) : undefined;

  const result = sanctions.screen({ name, threshold });
  return res.status(200).json(result);
};
