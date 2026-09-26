'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const email = require('../lib/email');

test('teamInbox defaults to the single OrcaTrade team mailbox', () => {
  const prev = process.env.ORCATRADE_TEAM_INBOX;
  delete process.env.ORCATRADE_TEAM_INBOX;
  try {
    assert.equal(email.teamInbox(), 'orcatrade@orcatradegroup.com');
  } finally {
    if (prev !== undefined) process.env.ORCATRADE_TEAM_INBOX = prev;
  }
});

test('teamInbox honours ORCATRADE_TEAM_INBOX (trimmed)', () => {
  const prev = process.env.ORCATRADE_TEAM_INBOX;
  process.env.ORCATRADE_TEAM_INBOX = '  ops@example.com ';
  try {
    assert.equal(email.teamInbox(), 'ops@example.com');
  } finally {
    if (prev === undefined) delete process.env.ORCATRADE_TEAM_INBOX;
    else process.env.ORCATRADE_TEAM_INBOX = prev;
  }
});

test('DEFAULT_FROM is not a resend.dev sandbox sender', () => {
  assert.doesNotMatch(email.DEFAULT_FROM, /resend\.dev/);
});

// The retired @orcatrade.pl Workspace mailboxes hard-bounce and sit on the
// Resend suppression list. No handler may hard-code them as a recipient.
test('no handler hard-codes a retired @orcatrade.pl recipient', () => {
  const dir = path.join(__dirname, '..', 'lib', 'handlers');
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.doesNotMatch(src, /['"`][a-z.-]+@orcatrade\.pl['"`]/, f);
    assert.doesNotMatch(src, /onboarding@resend\.dev/, f);
  }
});
