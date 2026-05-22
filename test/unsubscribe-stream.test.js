const test = require('node:test');
const assert = require('node:assert/strict');

const kv = require('../lib/intelligence/kv-store');
const notificationPrefs = require('../lib/notification-prefs');
const unsubscribe = require('../lib/handlers/unsubscribe');

function mockRes() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(k, v) { this.headers[k] = v; },
    end(b) { this.body = b || ''; return this; },
  };
}

function call(query) {
  const res = mockRes();
  return unsubscribe({ method: 'GET', url: '/api/unsubscribe', query }, res).then(() => res);
}

test('stream=complianceDeadlineEmails flips only that pref', async () => {
  kv._resetMemoryStore();
  const email = 'user@example.com';
  const token = notificationPrefs.generateUnsubscribeToken(email);
  const res = await call({ token, stream: 'complianceDeadlineEmails' });
  assert.equal(res.statusCode, 200);
  const prefs = await notificationPrefs.getPrefs(email);
  assert.equal(prefs.complianceDeadlineEmails, false);
  assert.equal(prefs.planRevisionEmails, true); // untouched
});

test('no stream param defaults to planRevisionEmails (backwards compatible)', async () => {
  kv._resetMemoryStore();
  const email = 'user2@example.com';
  const token = notificationPrefs.generateUnsubscribeToken(email);
  const res = await call({ token });
  assert.equal(res.statusCode, 200);
  const prefs = await notificationPrefs.getPrefs(email);
  assert.equal(prefs.planRevisionEmails, false);
  assert.equal(prefs.complianceDeadlineEmails, true); // untouched
});

test('unknown stream falls back to planRevisionEmails (never a silent no-op)', async () => {
  kv._resetMemoryStore();
  const email = 'user3@example.com';
  const token = notificationPrefs.generateUnsubscribeToken(email);
  const res = await call({ token, stream: 'bogusStream' });
  assert.equal(res.statusCode, 200);
  const prefs = await notificationPrefs.getPrefs(email);
  assert.equal(prefs.planRevisionEmails, false);
});

test('invalid token → 400 and no preference change', async () => {
  kv._resetMemoryStore();
  const res = await call({ token: 'garbage.deadbeef' });
  assert.equal(res.statusCode, 400);
});
