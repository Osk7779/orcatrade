'use strict';

// Apex A2 step 3 — read-shadow extended to saved-portfolios.
// Mirrors saved-plans shadow tests (#33, #34) so the contract scales.
// Source-pins the wiring + scoping clause + projector shape — the
// same drift modes that would silently break the plans shadow apply
// to portfolios.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

const portfoliosSrc = fs.readFileSync(path.join(ROOT, 'lib/saved-portfolios.js'), 'utf8');

// ── handler-side wiring ────────────────────────────────────────────

test('lib/saved-portfolios.js requires lib/db/read-shadow', () => {
  assert.match(
    portfoliosSrc,
    /require\(['"]\.\/db\/read-shadow['"]\)/,
    'saved-portfolios.js must import the shadow module',
  );
});

test('getPortfolio fires shadowCompare with the right name + projector', () => {
  assert.match(
    portfoliosSrc,
    /name:\s*['"]saved-portfolios\.getPortfolio['"]/,
    'getPortfolio shadow must register as saved-portfolios.getPortfolio',
  );
  assert.match(
    portfoliosSrc,
    /pgFetcher:\s*\(\)\s*=>\s*fetchPortfolioFromPg/,
    'getPortfolio shadow must call fetchPortfolioFromPg',
  );
  assert.match(
    portfoliosSrc,
    /projector:\s*projectPortfolioForShadow/,
    'getPortfolio shadow must use the single-record projector',
  );
});

test('listPortfolios fires shadowCompare with the right name + projector', () => {
  assert.match(
    portfoliosSrc,
    /name:\s*['"]saved-portfolios\.listPortfolios['"]/,
  );
  assert.match(
    portfoliosSrc,
    /pgFetcher:\s*\(\)\s*=>\s*fetchPortfoliosFromPgByEmailHash/,
  );
  assert.match(
    portfoliosSrc,
    /projector:\s*projectPortfolioListForShadow/,
  );
});

// ── scoping clause: this is the load-bearing detail ────────────────
//
// The list shadow has to filter PG to the requesting user's
// email_hash. Without the WHERE clause, the multi-row shadow would
// compare KV's one-user list against PG's all-users table and
// divergence would fire on every read.

test('fetchPortfoliosFromPgByEmailHash scopes to one user via WHERE email_hash = $1', () => {
  assert.match(
    portfoliosSrc,
    /async function fetchPortfoliosFromPgByEmailHash/,
  );
  assert.match(
    portfoliosSrc,
    /WHERE email_hash = \$1[\s\S]{0,200}archived_at IS NULL/,
    'list query must scope to email_hash AND filter archived rows — same posture as listFromPg',
  );
});

test('fetchPortfolioFromPg also scopes to (external_id, email_hash) — defensive double-check', () => {
  assert.match(
    portfoliosSrc,
    /async function fetchPortfolioFromPg/,
  );
  assert.match(
    portfoliosSrc,
    /WHERE external_id = \$1 AND email_hash = \$2[\s\S]{0,200}archived_at IS NULL/,
    'single-record fetch must also enforce email_hash so a stray planId can\'t cross users',
  );
});

// ── projector shape ────────────────────────────────────────────────

test('projectPortfolioForShadow projects { id, label, lines, snapshot } — durable-truth fields only', () => {
  // The projector must strip KV-only fields like raw email + share
  // block so the comparison doesn't fire on shape divergence the
  // dual-write writer doesn't try to mirror.
  assert.match(portfoliosSrc, /function projectPortfolioForShadow/);
  assert.match(portfoliosSrc, /id:\s*record\.id/);
  assert.match(portfoliosSrc, /label:\s*record\.label[^,]*\|\|/);
  assert.match(portfoliosSrc, /lines:\s*record\.lines[^,]*\|\|/);
  assert.match(portfoliosSrc, /snapshot:\s*record\.snapshot[^,]*\|\|/);
  // And it must NOT carry email — pin negatively so a future refactor
  // that accidentally added email to the projection fails CI.
  assert.doesNotMatch(
    portfoliosSrc.match(/function projectPortfolioForShadow[\s\S]{0,500}\}/)[0],
    /email:/,
    'projector must NOT include raw email — that would always fire divergence',
  );
});

test('projectPortfolioListForShadow returns { length, rows } with rows sorted by id', () => {
  assert.match(portfoliosSrc, /function projectPortfolioListForShadow/);
  assert.match(portfoliosSrc, /length:\s*records\.length/);
  assert.match(portfoliosSrc, /localeCompare/);
});

// ── runtime exercise (shadow off by default — pin the no-op contract)

const kv = require('../lib/intelligence/kv-store');
const savedPortfolios = require('../lib/saved-portfolios');

test('getPortfolio + listPortfolios remain functionally unchanged when shadow is OFF', async () => {
  // The shadow seam must never affect the hot-path return value.
  // With ORCATRADE_SHADOW_PG unset (default), KV reads should behave
  // exactly as before this PR.
  const prev = process.env.ORCATRADE_SHADOW_PG;
  delete process.env.ORCATRADE_SHADOW_PG;
  try {
    kv._resetMemoryStore();
    const rec = await savedPortfolios.savePortfolio({
      email: 'shadow-off@example.com',
      lines: [{ productCategory: 'apparel', originCountry: 'CN', destinationCountry: 'PL', customsValueEur: 1000 }],
      label: 'shadow-off-test',
    });
    const got = await savedPortfolios.getPortfolio(rec.id, 'shadow-off@example.com');
    assert.equal(got.id, rec.id);
    const list = await savedPortfolios.listPortfolios('shadow-off@example.com');
    assert.equal(list.length, 1);
    assert.equal(list[0].id, rec.id);
  } finally {
    if (prev === undefined) delete process.env.ORCATRADE_SHADOW_PG;
    else process.env.ORCATRADE_SHADOW_PG = prev;
  }
});
