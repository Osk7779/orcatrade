// vercel.json contract pins — the load-bearing routing fields that
// existing test files don't cover yet.
//
// Existing coverage (do NOT duplicate):
//   test/security-headers.test.js   → CSP + HSTS + X-Content-Type-Options
//   test/feed.test.js               → /feed.xml + /atom.xml rewrites
//   test/shares.test.js             → /share/:code rewrite
//
// What this file pins:
//   1. cleanUrls: true               (commit 709134a5 — without this, /intelligence,
//                                     /sourcing, /finance, /process, /contact, /search
//                                     all 404. Regression class: silent drop.)
//   2. api/[...path].js maxDuration  (Vercel Hobby caps at 60s — we depend on it for
//                                     the streaming agent endpoints; raising it
//                                     without a plan move is a billing surprise.)
//   3. /_next/:path* + / → marketing-shell rewrites (marketing-shell sits on a
//                                     separate Vercel project; if these rewrites
//                                     vanish, the homepage 500s.)
//   4. /app/:path* → app-shell rewrite (same pattern, separate Vercel project.)
//   5. The catch-all api rewrite (/api/:path+ → /api/[...path]) — without it
//      the single-function dispatcher pattern breaks.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));

function findRewrite(source) {
  return (cfg.rewrites || []).find(r => r.source === source);
}

test('vercel.json: cleanUrls is enabled (else /intelligence /sourcing etc. 404)', () => {
  assert.equal(cfg.cleanUrls, true,
    'cleanUrls=true is load-bearing — without it the static .html pages can only be reached at their full /thing.html URL. ' +
    'Commit 709134a5 introduced this fix; if you must remove it, also add a redirect for every cleanUrl-served route.');
});

test('vercel.json: api/[...path].js maxDuration stays within Hobby budget', () => {
  const fn = cfg.functions && cfg.functions['api/[...path].js'];
  assert.ok(fn, 'api/[...path].js function config must be present');
  assert.equal(typeof fn.maxDuration, 'number', 'maxDuration must be a number');
  assert.ok(fn.maxDuration >= 30 && fn.maxDuration <= 60,
    `maxDuration ${fn.maxDuration}s outside the 30-60s safe band. ` +
    'Streaming agent endpoints need ≥30s; Hobby plan caps at 60s. ' +
    'Raising to 300s is supported only on Pro+ and would be a billing change.');
});

test('vercel.json: marketing-shell rewrites are in place (/ + /_next/:path*)', () => {
  const home = findRewrite('/');
  const nextAssets = findRewrite('/_next/:path*');
  assert.ok(home, 'root / rewrite to marketing-shell must be present (else homepage 500s)');
  assert.match(home.destination, /orcatrade-marketing\.vercel\.app/,
    '/ must rewrite to the orcatrade-marketing.vercel.app project');
  assert.ok(nextAssets, '/_next/:path* rewrite must be present (Next.js asset routing)');
  assert.match(nextAssets.destination, /orcatrade-marketing\.vercel\.app\/_next\/:path\*/,
    '/_next/:path* must rewrite to marketing-shell with the path preserved');
});

test('vercel.json: app-shell rewrite is in place (/app/:path*)', () => {
  const app = findRewrite('/app/:path*');
  assert.ok(app, '/app/:path* rewrite must be present (else /app/dashboard 404s)');
  // The app shell sits on a separate Vercel project (orcatrade-c2i5).
  // If the project handle changes, update this assertion in the same
  // commit as the vercel.json edit — drift is the failure mode.
  assert.match(app.destination, /vercel\.app\/app\/:path\*/,
    '/app/:path* must rewrite to a vercel.app project with the path preserved');
});

test('vercel.json: /app and /app/ redirect to /app/dashboard', () => {
  // Without these, hitting orcatrade.pl/app shows whatever the catch-all
  // serves at /app/index.html — usually a 404. The redirect is what makes
  // the bare URL useful in marketing materials.
  const redirects = cfg.redirects || [];
  const slashed = redirects.find(r => r.source === '/app/');
  const bare = redirects.find(r => r.source === '/app');
  assert.ok(bare, '/app redirect must be present');
  assert.ok(slashed, '/app/ redirect must be present');
  assert.equal(bare.destination, '/app/dashboard', '/app must redirect to /app/dashboard');
  assert.equal(slashed.destination, '/app/dashboard', '/app/ must redirect to /app/dashboard');
});

test('vercel.json: catch-all /api/:path+ → /api/[...path] dispatcher is wired', () => {
  // The single-function dispatcher pattern (CLAUDE.md constraint: Hobby
  // 12-function cap) needs this rewrite to route every /api/* to the
  // one api/[...path].js file. Without it, /api/customs etc. would only
  // resolve if there was a literal api/customs.js — there isn't.
  const dispatcher = findRewrite('/api/:path+');
  assert.ok(dispatcher, '/api/:path+ catch-all rewrite must be present (single-function dispatcher)');
  assert.equal(dispatcher.destination, '/api/[...path]',
    '/api/:path+ must point at /api/[...path] — the only API entry file');
});

test('vercel.json: no unexpected top-level keys (config drift tripwire)', () => {
  // Whitelist top-level keys so a misspelled key (e.g. "rewrite" instead
  // of "rewrites") gets caught instead of silently no-op'd by Vercel.
  const allowed = new Set([
    'cleanUrls', 'functions', 'redirects', 'rewrites', 'headers',
    'crons', 'images', 'trailingSlash', 'regions',
  ]);
  const unexpected = Object.keys(cfg).filter(k => !allowed.has(k));
  assert.deepEqual(unexpected, [],
    `Unexpected top-level keys in vercel.json: ${unexpected.join(', ')}. ` +
    'If intentional, add to the allowlist in this test in the same commit.');
});
