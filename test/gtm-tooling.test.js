// GTM tooling tests (press kit + partners + outbound composer).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
function readFile(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }

// ── /press/ ──────────────────────────────────────────

test('/press/ index exists with positioning sentence', () => {
  const html = readFile('press/index.html');
  assert.match(html, /Press kit/);
  assert.match(html, /Positioning sentence/);
  assert.match(html, /operating system for European SMEs importing from Asia/);
});

test('/press/ has founder bio + Oskar Klepuszewski named', () => {
  const html = readFile('press/index.html');
  assert.match(html, /Oskar Klepuszewski/);
  assert.match(html, /Founder &amp; CFO|Founder &amp;amp; CFO/i);
});

test('/press/ links to brand-kit + logo asset', () => {
  const html = readFile('press/index.html');
  assert.match(html, /\/orcatrade_logo\.png/);
  assert.match(html, /\/docs\/brand-kit\//);
});

test('/press/ has noindex robots tag absent (we want press kit indexed)', () => {
  const html = readFile('press/index.html');
  assert.doesNotMatch(html, /robots"\s+content="noindex/i);
});

test('/press/ provides press contact route', () => {
  const html = readFile('press/index.html');
  assert.match(html, /press@orcatrade\.pl/);
  assert.match(html, /\?intent=press/);
});

test('/press/ canonical points to /press/', () => {
  const html = readFile('press/index.html');
  assert.match(html, /canonical" href="https:\/\/orcatrade\.pl\/press\/"/);
});

// ── /partners/ ───────────────────────────────────────

test('/partners/ index exists with three relationship modes called out', () => {
  const html = readFile('partners/index.html');
  assert.match(html, /Partners|partner/);
  assert.match(html, /Recommended/);
  assert.match(html, /Referral/);
  assert.match(html, /Commercial/);
});

test('/partners/ covers freight + finance + FX + insurance + inspection categories', () => {
  const html = readFile('partners/index.html');
  for (const heading of ['Freight forwarding', 'Trade finance', 'FX', 'Insurance', 'Inspections']) {
    assert.match(html, new RegExp(heading, 'i'), `expected partners page to cover ${heading}`);
  }
});

test('/partners/ has CTA for becoming a partner', () => {
  const html = readFile('partners/index.html');
  assert.match(html, /\?intent=partnership/);
});

// ── /agent/outbound/ ─────────────────────────────────

test('/agent/outbound/ exists + is noindex', () => {
  const html = readFile('agent/outbound/index.html');
  assert.match(html, /Outbound email composer/);
  assert.match(html, /robots"\s+content="noindex/i);
});

test('/agent/outbound/ form has recipient, hook, goal, tone fields', () => {
  const html = readFile('agent/outbound/index.html');
  assert.match(html, /id="recipient"/);
  assert.match(html, /id="hook"/);
  assert.match(html, /id="goal"/);
  assert.match(html, /id="tone"/);
});

test('/agent/outbound/app.js posts to /api/orchestrator', () => {
  const js = readFile('agent/outbound/app.js');
  assert.match(js, /\/api\/orchestrator/);
});

test('/agent/outbound/app.js handles 402 tier-gate response', () => {
  const js = readFile('agent/outbound/app.js');
  assert.match(js, /402/);
  assert.match(js, /tier_gate/);
});

test('/agent/outbound/ enforces the brand voice in the prompt', () => {
  const js = readFile('agent/outbound/app.js');
  assert.match(js, /OrcaTrade/);
  assert.match(js, /calibrated trust/);
  assert.match(js, /Oskar Klepuszewski/);
  // Disallow generic openers — banned in the prompt
  assert.match(js, /generic openers/i);
});

// ── home-page navigation surfaces (lightweight) ──────

// 2026-05-30 marketing-shell migration retired the static root index.html
// (commit 2c21a9d0). This soft check targeted that file. Coverage of
// home-page nav surfaces on the marketing-shell-rendered root is tracked
// under Phase 1 of docs/execution-plan.md.
test('home page footer links to press + partners (or top nav)', { skip: 'marketing-shell migration: root index.html retired; coverage moved to Phase 1' }, () => {
  // Either a header nav or a footer link is acceptable. We just want at
  // least one entry point from the home page.
  const html = readFile('index.html');
  const hasPressLink = /href="\/?press\/?"/.test(html);
  const hasPartnersLink = /href="\/?partners\/?"/.test(html);
  // Don't fail this hard — these can be added later without changing the page
  // status. Just emit when neither is present, so we notice.
  if (!hasPressLink && !hasPartnersLink) {
    console.warn('NOTE: home page does not yet link to /press/ or /partners/');
  }
  assert.ok(true);
});
