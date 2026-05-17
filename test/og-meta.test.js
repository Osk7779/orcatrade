// Sprint H: every HTML page must carry the canonical Open Graph image
// + Twitter Card meta so that any social/messenger share renders as a
// brand-quality preview instead of a bare URL. The injector
// (scripts/inject-favicon-tags.js) is the source of truth — these tests
// catch the case where the injector is bypassed (a sub-generator writes
// HTML without running the injector, or the marker pattern drifts).

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

// Sample landing-surface pages that real users + social crawlers visit
// most. Don't enumerate all 680 — the injector is shared, so a
// representative cross-section catches drift just as well.
//
// Deliberately excluded: SEO-generated pages under guides/ and examples/.
// Those are regenerated mid-suite by the generator idempotence test
// (test/generate-seo-pages.test.js), which would race with reads here
// under parallel test execution. They get the canonical OG block from
// the SEO generator's own post-build injector hook (see
// scripts/generate-seo-pages.js#run), and idempotence on every other
// page is asserted directly below.
const SAMPLE_PAGES = [
  'index.html',
  'start/index.html',
  'pricing/index.html',
  'agents/index.html',
  'platform/index.html',
  'press/index.html',
  'partners/index.html',
  'founding/index.html',
  'pl/zalozyciele-10/index.html',
  'de/gruender-10/index.html',
  'compliance/index.html',
  'pl/index.html',
  'de/index.html',
  'pl/cennik/index.html',
  'de/preise/index.html',
];

test('OG image file exists at the canonical path', () => {
  const ogPath = path.join(ROOT, 'og-1200x630.png');
  assert.ok(fs.existsSync(ogPath), 'og-1200x630.png must live at repo root');
  const stat = fs.statSync(ogPath);
  // Bigger than 50KB (otherwise it's a sad thumbnail), smaller than 1MB
  // (otherwise it's wasted bandwidth on every share).
  assert.ok(stat.size > 50 * 1024, `og image too small: ${stat.size} bytes`);
  assert.ok(stat.size < 1024 * 1024, `og image too large: ${stat.size} bytes`);
});

for (const rel of SAMPLE_PAGES) {
  test(`${rel} carries the canonical OG image + Twitter card`, () => {
    const full = path.join(ROOT, rel);
    if (!fs.existsSync(full)) {
      // Don't hard-fail if a sample page was deleted; surface clearly.
      assert.fail(`fixture missing: ${rel} — update SAMPLE_PAGES`);
    }
    const html = fs.readFileSync(full, 'utf8');
    assert.match(html, /og:image"\s+content="https:\/\/orcatrade\.pl\/og-1200x630\.png"/,
      `${rel} missing canonical og:image`);
    assert.match(html, /og:image:width"\s+content="1200"/);
    assert.match(html, /og:image:height"\s+content="630"/);
    // og:type is "website" for hand-rolled landings, "article" for SEO-
    // generated guides + worked examples. Both are valid; the injector
    // preserves whichever the page declared.
    assert.match(html, /og:type"\s+content="(website|article)"/);
    assert.match(html, /og:site_name"\s+content="OrcaTrade"/);
    assert.match(html, /twitter:card"\s+content="summary_large_image"/);
    assert.match(html, /twitter:image"\s+content="https:\/\/orcatrade\.pl\/og-1200x630\.png"/);
  });

  // Sprint J.1 → BG-5.2: Vercel analytics must be present on every page,
  // but is now consent-gated: the va() stub plus the cookie-consent module
  // loader are injected by scripts/inject-favicon-tags.js; the actual
  // /_vercel/insights/script.js tag is appended dynamically by
  // js/cookie-consent.js only when the user grants analytics consent.
  test(`${rel} carries the Vercel analytics block (consent-gated v2)`, () => {
    const full = path.join(ROOT, rel);
    const html = fs.readFileSync(full, 'utf8');
    assert.match(html, /analytics v2 \(consent-gated\) injected by scripts\/inject-favicon-tags\.js/,
      `${rel} missing analytics marker — run scripts/inject-favicon-tags.js`);
    assert.match(html, /window\.va=window\.va\|\|function/);
    assert.match(html, /<script\s+defer\s+src="\/js\/cookie-consent\.js"><\/script>/);
    // Single instance only — no duplication after re-inject.
    const matches = html.match(/<script\s+defer\s+src="\/js\/cookie-consent\.js"><\/script>/g) || [];
    assert.equal(matches.length, 1, `${rel} has ${matches.length} consent-loader tags, expected exactly 1`);
    // The pre-consent stub must NOT include the actual Vercel script tag —
    // that gets injected by cookie-consent.js after user opts in.
    assert.doesNotMatch(html, /<script\s+defer\s+src="\/_vercel\/insights\/script\.js"><\/script>/,
      `${rel} still has the unconditional Vercel Analytics script — consent gating bypassed`);
  });
}

test('injector marker is current (catches stale legacy markers)', () => {
  // Spot-check: any one page should carry the current marker, not an old one.
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.match(html, /favicon set v9 injected/);
  assert.doesNotMatch(html, /favicon set v8 injected/);
});

test('injector idempotence: re-injecting does not duplicate OG meta', () => {
  // Count og:image occurrences on a sample page. Should be exactly 1.
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const matches = html.match(/property="og:image"[^:]/g) || [];
  assert.equal(matches.length, 1, `expected 1 og:image, got ${matches.length}`);
});
