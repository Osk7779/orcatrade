// Hero globe wiring tests.
//
// The globe is a vanilla-JS port of a popular React-component pattern
// (rotating dotted Earth). It runs entirely in the browser; these tests
// exercise the static contract — asset shape, JS hooks, HTML wiring.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
function readFile(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }

// ── /assets/ne_110m_land.json ────────────────────────

test('assets: ne_110m_land.json is present + valid GeoJSON', () => {
  const raw = readFile('assets/ne_110m_land.json');
  assert.ok(raw.length > 100_000, 'expected the full Natural Earth 1:110m land file (~230KB)');
  const data = JSON.parse(raw);
  assert.equal(data.type, 'FeatureCollection');
  assert.ok(Array.isArray(data.features));
  assert.ok(data.features.length > 100, `expected >100 land features, got ${data.features.length}`);
  // Every feature has Polygon or MultiPolygon geometry
  for (const f of data.features) {
    assert.equal(f.type, 'Feature');
    assert.ok(['Polygon', 'MultiPolygon'].includes(f.geometry.type), `unexpected geometry: ${f.geometry.type}`);
  }
});

// ── js/globe.js contract ─────────────────────────────

test('js/globe.js: targets [data-globe] selector + uses window.d3', () => {
  const js = readFile('js/globe.js');
  assert.match(js, /\[data-globe\]/);
  assert.match(js, /window\.d3/);
});

test('js/globe.js: orthographic projection with 90deg clip angle', () => {
  const js = readFile('js/globe.js');
  assert.match(js, /geoOrthographic/);
  assert.match(js, /clipAngle\(90\)/);
});

test('js/globe.js: tries local asset first, then falls back to GitHub raw', () => {
  const js = readFile('js/globe.js');
  assert.match(js, /\/assets\/ne_110m_land\.json/);
  assert.match(js, /raw\.githubusercontent\.com.*natural-earth-geojson/);
});

test('js/globe.js: drag-to-rotate via PointerEvents (mouse + pen + touch)', () => {
  const js = readFile('js/globe.js');
  assert.match(js, /pointerdown/);
  assert.match(js, /pointermove/);
  assert.match(js, /pointerup/);
  assert.match(js, /pointercancel/);
  // Latitude clamped to ±90 so the user can't flip the globe upside-down
  assert.match(js, /Math\.max\(-90, Math\.min\(90/);
});

test('js/globe.js: auto-rotation resumes after AUTO_RESUME_DELAY_MS idle', () => {
  const js = readFile('js/globe.js');
  assert.match(js, /AUTO_RESUME_DELAY_MS\s*=\s*\d+/);
  assert.match(js, /setTimeout\(\(\)\s*=>\s*\{\s*autoRotate\s*=\s*true/);
});

test('js/globe.js: respects prefers-reduced-motion', () => {
  const js = readFile('js/globe.js');
  assert.match(js, /prefers-reduced-motion/);
});

test('js/globe.js: pauses the rAF loop when document is hidden', () => {
  const js = readFile('js/globe.js');
  assert.match(js, /visibilitychange/);
  assert.match(js, /document\.hidden/);
});

// ── index.html wiring ────────────────────────────────

test('index.html: hero canvas has [data-globe] + cursor: grab', () => {
  const html = readFile('index.html');
  assert.match(html, /<canvas[^>]*data-globe[^>]*>/);
  assert.match(html, /\.hero-globe-bg\s*\{[^}]*cursor:\s*grab/);
});

test('index.html: drag is disabled on touch + small viewports', () => {
  const html = readFile('index.html');
  // Mobile + coarse-pointer disable — drag on a bg canvas fights vertical scroll
  assert.match(html, /@media\s*\(hover:\s*none\)/);
  assert.match(html, /pointer-events:\s*none/);
});

test('index.html: loads d3 + js/globe.js (defer)', () => {
  const html = readFile('index.html');
  assert.match(html, /cdn\.jsdelivr\.net\/npm\/d3@7/);
  assert.match(html, /<script[^>]*defer[^>]*src="js\/globe\.js"/);
});

test('index.html: globe is decorative (aria-hidden) so screen readers skip it', () => {
  const html = readFile('index.html');
  // Attribute order on the canvas is not load-bearing — match either order.
  const canvasTag = (html.match(/<canvas[^>]*data-globe[^>]*>/) || [''])[0];
  assert.match(canvasTag, /aria-hidden="true"/);
});
