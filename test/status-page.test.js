// Tests for the public /status/ page.
//
// The page is a static HTML file that polls /api/health and renders
// subsystem cards. We don't run a browser here — we just assert the
// markup contract so the page can't silently break (missing element id,
// missing fetch target, missing legend, etc.).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const HTML_PATH = path.join(__dirname, '..', 'status', 'index.html');
const html = fs.readFileSync(HTML_PATH, 'utf8');

test('status page exists and is non-empty', () => {
  assert.ok(html.length > 1000, 'status page should be substantial HTML');
});

test('status page is noindex (operational page, not content)', () => {
  assert.match(html, /<meta name="robots" content="noindex"/i);
});

test('status page polls /api/health (not a different endpoint)', () => {
  assert.match(html, /fetch\(['"]\/api\/health['"]/);
});

test('status page declares every required DOM hook', () => {
  for (const id of ['overall', 'overallLabel', 'overallSub', 'subs', 'lastChecked', 'errBanner']) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `id="${id}" present`);
  }
});

test('status page declares ok/degraded/down legend rows', () => {
  assert.match(html, /ok.*fully operational/i);
  assert.match(html, /degraded.*platform still serves/i);
  assert.match(html, /down.*paging condition/i);
});

test('status page labels every subsystem the health endpoint reports', () => {
  for (const key of ['kv', 'taric', 'resend', 'stripe', 'anthropic']) {
    assert.match(html, new RegExp(`${key}:\\s*{\\s*name:`), `${key} entry in SUBSYSTEM_LABELS`);
  }
});

test('status page auto-refreshes (otherwise it is just a snapshot)', () => {
  assert.match(html, /setInterval\(refresh,\s*30[_,]?000\)/);
});

test('status page has a visible contact link for incidents', () => {
  assert.match(html, /orca@orcatrade\.pl/);
});
