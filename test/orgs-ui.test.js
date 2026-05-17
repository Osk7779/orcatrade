// Tests for /account/orgs/ UI — Sprint BG-3.1 closeout.
//
// Markup-contract + script-surface assertions. No browser; no live
// network. The same offline pattern as test/privacy-page.test.js +
// test/audit.test.js page-contract assertions.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'account', 'orgs', 'index.html'), 'utf8');
const JS = fs.readFileSync(path.join(__dirname, '..', 'account', 'orgs', 'app.js'), 'utf8');

// ── HTML contract ─────────────────────────────────────────

test('orgs page exists, substantial, noindex', () => {
  assert.ok(HTML.length > 2000, 'page is substantial');
  assert.match(HTML, /<meta name="robots" content="noindex,\s*nofollow"/i);
});

test('orgs page declares every required DOM hook', () => {
  for (const id of [
    'authNeeded', 'content',
    'listView', 'orgsList', 'newOrgName', 'createBtn', 'createMsg', 'listMsg', 'userEmailList',
    'detailView', 'detailName', 'detailMeta', 'membersList', 'membersMsg',
    'inviteCard', 'inviteEmail', 'inviteRole', 'inviteBtn', 'inviteMsg',
    'userEmailDetail',
  ]) {
    assert.match(HTML, new RegExp(`id=["']${id}["']`), `id="${id}" present`);
  }
});

test('orgs page invite role dropdown offers admin + member, but NOT owner', () => {
  // Owners are minted via createOrg or transferOwnership, never via invite.
  // The form must not let an admin invite someone directly as owner.
  assert.match(HTML, /<option value="member">/i);
  assert.match(HTML, /<option value="admin">/i);
  assert.doesNotMatch(HTML, /<option value="owner">/i);
});

test('orgs page explains the three roles in footer note', () => {
  assert.match(HTML, /owner/i);
  assert.match(HTML, /admin/i);
  assert.match(HTML, /member/i);
});

test('orgs page links to security docs for storage context', () => {
  assert.match(HTML, /\/docs\/security\//);
});

test('orgs page breadcrumb links back to /account/', () => {
  assert.match(HTML, /href=["']\/account\/["']/);
});

// ── app.js contract ───────────────────────────────────────

test('app.js bootstraps from /api/auth/me', () => {
  assert.match(JS, /fetch\(['"`]\/api\/auth\/me/);
});

test('app.js fetches list via GET /api/orgs', () => {
  assert.match(JS, /fetch\(['"`]\/api\/orgs['"`]/);
});

test('app.js creates via POST /api/orgs with { name }', () => {
  assert.match(JS, /method:\s*['"]POST['"]/);
  assert.match(JS, /JSON\.stringify\(\{\s*name\s*\}\)/);
});

test('app.js fetches detail via GET /api/orgs/<id>', () => {
  assert.match(JS, /fetch\(\s*['"`]\/api\/orgs\/['"`]\s*\+\s*encodeURIComponent\(orgId\)/);
});

test('app.js invites via POST /api/orgs/<id>/invite with { email, role }', () => {
  assert.match(JS, /\/api\/orgs\/.+invite/);
  assert.match(JS, /JSON\.stringify\(\{\s*email,\s*role\s*\}\)/);
});

test('app.js removes via POST /api/orgs/<id>/remove with { email }', () => {
  assert.match(JS, /\/api\/orgs\/.+remove/);
  // Remove uses confirm() as a safety prompt before firing.
  assert.match(JS, /confirm\(['"`]Remove /);
});

test('app.js gates invite/remove buttons on owner-or-admin role', () => {
  // myRoleInCurrentOrg is computed from the membership lookup and used
  // to gate the invite card + the per-row remove buttons. A regular
  // member must not see destructive UI.
  assert.match(JS, /myRoleInCurrentOrg/);
  assert.match(JS, /myRoleInCurrentOrg === ['"]owner['"]/);
  assert.match(JS, /myRoleInCurrentOrg === ['"]admin['"]/);
});

test('app.js never renders a "Remove" button next to the owner OR the signed-in user', () => {
  // Both guards must be present: don't remove the owner; don't remove yourself.
  assert.match(JS, /m\.role\s*!==\s*['"]owner['"]/);
  assert.match(JS, /m\.email\s*!==\s*me\.toLowerCase\(\)/);
});

test('app.js DOMContentLoaded handler is browser-guarded', () => {
  // Like /dashboard/ai/app.js — must skip DOM wiring when document
  // is undefined so the file can be required in Node tests safely.
  assert.match(JS, /typeof document !== ['"]undefined['"]/);
});

// ── Cross-link from /account/ home ────────────────────────

test('/account/ quick-links includes the orgs page', () => {
  const accountHtml = fs.readFileSync(path.join(__dirname, '..', 'account', 'index.html'), 'utf8');
  assert.match(accountHtml, /href=["']\/account\/orgs\/["']/);
  assert.match(accountHtml, /Organisations.+team/i);
});
