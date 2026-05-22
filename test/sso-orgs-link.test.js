// Sprint sso-oidc-v1 phase 3 closeout — the SSO config page is now
// discoverable: owner-only "Configure SSO" link in the org detail view.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'account', 'orgs', 'index.html'), 'utf8');
const APP = fs.readFileSync(path.join(__dirname, '..', 'account', 'orgs', 'app.js'), 'utf8');

test('org detail markup has a hidden-by-default SSO config link slot', () => {
  assert.match(HTML, /id="ssoLinkRow"/);
  assert.match(HTML, /id="ssoLinkRow"[^>]*\shidden/);
  assert.match(HTML, /id="ssoConfigLink"/);
});

test('the SSO link is revealed ONLY for the org owner + points at the config page with ?org=', () => {
  assert.match(APP, /myRoleInCurrentOrg === 'owner'/);
  assert.match(APP, /\/account\/orgs\/sso\/\?org=/);
  // It lives in the owner branch (revealed) and is hidden otherwise.
  assert.match(APP, /ssoRow\.hidden = false/);
  assert.match(APP, /ssoRow\.hidden = true/);
});
