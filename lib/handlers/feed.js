// /api/feed — RSS / Atom feed of guides + worked examples (Sprint AE).
//
// Format selection:
//   ?format=rss   (default)
//   ?format=atom
// Vercel rewrites /feed.xml → ?format=rss and /atom.xml → ?format=atom.
//
// Cache-Control: 1 hour, stale-while-revalidate 6 hours. Feed readers
// poll often; cheaper to serve from edge cache than to walk the
// filesystem on every poll.

'use strict';

const path = require('node:path');
const feedBuilder = require('../feed-builder');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

function readFormat(req) {
  if (req.query && req.query.format) return String(req.query.format).toLowerCase();
  const url = req.url || '';
  const qs = url.split('?')[1] || '';
  return (new URLSearchParams(qs).get('format') || 'rss').toLowerCase();
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') { res.statusCode = 200; return res.end(); }
  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ error: 'Method not allowed' }));
  }

  const format = readFormat(req);
  if (!['rss', 'atom'].includes(format)) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ error: 'format must be rss or atom' }));
  }

  let items;
  try {
    items = feedBuilder.listFeedItems({ rootDir: PROJECT_ROOT });
  } catch (err) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ error: err.message || 'Feed scan failed' }));
  }

  const xml = format === 'atom'
    ? feedBuilder.buildAtom({ items })
    : feedBuilder.buildRss({ items });

  res.statusCode = 200;
  res.setHeader('Content-Type', format === 'atom' ? 'application/atom+xml; charset=utf-8' : 'application/rss+xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=21600');
  return res.end(xml);
};
