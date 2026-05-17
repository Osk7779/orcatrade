// Tests for the /account/privacy/ UI page — Sprint BG-5.1 closeout.
//
// Pins the markup contract so the page can't silently break (missing
// endpoint reference, missing confirm gate, missing auth redirect).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const HTML_PATH = path.join(__dirname, '..', 'account', 'privacy', 'index.html');
const html = fs.readFileSync(HTML_PATH, 'utf8');

test('privacy page exists and is non-empty', () => {
  assert.ok(html.length > 1500, 'privacy page should be substantial');
});

test('privacy page is noindex,nofollow (account-only)', () => {
  assert.match(html, /<meta name="robots" content="noindex,\s*nofollow"/i);
});

test('privacy page references both endpoints exactly', () => {
  // Note: must NOT request /api/account/export with a body, must NOT POST
  // /api/account/delete without { confirm: true }. Pinning the right shape.
  assert.match(html, /fetch\(['"]\/api\/account\/export['"]/);
  assert.match(html, /fetch\(['"]\/api\/account\/delete['"]/);
});

test('privacy page POSTs delete with confirm:true (matches the handler guard)', () => {
  // Both the JSON body and the human confirm gate are required.
  assert.match(html, /JSON\.stringify\(\{\s*confirm:\s*true\s*\}\)/);
  // confirm() is the in-browser additional safety net.
  assert.match(html, /confirm\(['"]Permanently delete/);
});

test('privacy page calls /api/auth/me to gate UI behind a session', () => {
  // Without a session, the page must show the auth-needed banner.
  assert.match(html, /\/api\/auth\/me/);
  assert.match(html, /id=["']authNeeded["']/);
});

test('privacy page requires typed-email confirmation before enabling delete', () => {
  // The delete button is disabled by default and only enabled when the
  // typed email matches.
  assert.match(html, /id=["']confirmInput["']/);
  assert.match(html, /id=["']deleteBtn["'].*disabled/);
});

test('privacy page cites Articles 17 and 20', () => {
  assert.match(html, /Article 17/);
  assert.match(html, /Article 20/);
});

test('privacy page has an incident contact link', () => {
  assert.match(html, /orca@orcatrade\.pl/);
});

test('/account/ links to /account/privacy/ in the signed-in quick links', () => {
  const accountHtml = fs.readFileSync(path.join(__dirname, '..', 'account', 'index.html'), 'utf8');
  assert.match(accountHtml, /href=["']\/account\/privacy\/["']/);
  assert.match(accountHtml, /Privacy.+data/);
});
