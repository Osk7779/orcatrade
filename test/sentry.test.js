// Tests for lib/sentry.js — Sprint BG-4.2.
//
// Three layers under test:
//   1. parseDsn() — must accept every Sentry DSN shape and reject garbage
//   2. buildEvent() + buildEnvelopeBody() — the wire-format contract
//      (a future Sentry API change would surface here, not in production)
//   3. log forwarding — log.warn / log.error must call captureMessage
//      when SENTRY_DSN is set, NOT when it isn't (no spam, no surprises)

const test = require('node:test');
const assert = require('node:assert/strict');

const sentry = require('../lib/sentry');

function withEnv(overrides, fn) {
  const prev = {};
  for (const k of Object.keys(overrides)) prev[k] = process.env[k];
  for (const k of Object.keys(overrides)) {
    if (overrides[k] == null) delete process.env[k];
    else process.env[k] = overrides[k];
  }
  try { return fn(); }
  finally {
    for (const k of Object.keys(prev)) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
}

async function withEnvAsync(overrides, fn) {
  const prev = {};
  for (const k of Object.keys(overrides)) prev[k] = process.env[k];
  for (const k of Object.keys(overrides)) {
    if (overrides[k] == null) delete process.env[k];
    else process.env[k] = overrides[k];
  }
  try { return await fn(); }
  finally {
    for (const k of Object.keys(prev)) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
}

// ── parseDsn ────────────────────────────────────────────────

test('parseDsn: standard EU-region DSN', () => {
  const dsn = 'https://b5ffc4cc851368e91a700e4166eb0bbd@o4511406249934848.ingest.de.sentry.io/4511406281064528';
  const p = sentry.parseDsn(dsn);
  assert.ok(p);
  assert.equal(p.protocol, 'https');
  assert.equal(p.host, 'o4511406249934848.ingest.de.sentry.io');
  assert.equal(p.projectId, '4511406281064528');
  assert.equal(p.publicKey, 'b5ffc4cc851368e91a700e4166eb0bbd');
});

test('parseDsn: US-region DSN', () => {
  const p = sentry.parseDsn('https://abc123@o456.ingest.us.sentry.io/7890');
  assert.ok(p);
  assert.equal(p.host, 'o456.ingest.us.sentry.io');
  assert.equal(p.projectId, '7890');
});

test('parseDsn: legacy (no region) DSN', () => {
  const p = sentry.parseDsn('https://key@o123.ingest.sentry.io/4567');
  assert.ok(p);
  assert.equal(p.projectId, '4567');
});

test('parseDsn: self-hosted http:// DSN', () => {
  const p = sentry.parseDsn('http://key@sentry.internal.example.com/8901');
  assert.ok(p);
  assert.equal(p.protocol, 'http');
  assert.equal(p.host, 'sentry.internal.example.com');
});

test('parseDsn: rejects empty + null + non-string', () => {
  assert.equal(sentry.parseDsn(''), null);
  assert.equal(sentry.parseDsn(null), null);
  assert.equal(sentry.parseDsn(undefined), null);
  assert.equal(sentry.parseDsn(42), null);
});

test('parseDsn: rejects DSN with non-numeric projectId', () => {
  assert.equal(sentry.parseDsn('https://key@host/not-a-number'), null);
});

test('parseDsn: rejects DSN missing publicKey', () => {
  assert.equal(sentry.parseDsn('https://o456.ingest.sentry.io/789'), null);
});

test('parseDsn: rejects garbage', () => {
  assert.equal(sentry.parseDsn('not-a-url'), null);
  assert.equal(sentry.parseDsn('ftp://key@host/123'), null);
});

// ── isConfigured ──────────────────────────────────────────

test('isConfigured: false when SENTRY_DSN unset', () => {
  withEnv({ SENTRY_DSN: null }, () => {
    assert.equal(sentry.isConfigured(), false);
  });
});

test('isConfigured: false when SENTRY_DSN malformed', () => {
  withEnv({ SENTRY_DSN: 'garbage' }, () => {
    assert.equal(sentry.isConfigured(), false);
  });
});

test('isConfigured: true with valid DSN', () => {
  withEnv({ SENTRY_DSN: 'https://k@o1.ingest.de.sentry.io/123' }, () => {
    assert.equal(sentry.isConfigured(), true);
  });
});

// ── envelopeUrl + authHeader ─────────────────────────────

test('envelopeUrl: builds the right endpoint from parsed DSN', () => {
  const parsed = sentry.parseDsn('https://key@o456.ingest.de.sentry.io/789');
  assert.equal(sentry.envelopeUrl(parsed), 'https://o456.ingest.de.sentry.io/api/789/envelope/');
});

test('authHeader: includes sentry_key + sentry_client tag', () => {
  const parsed = sentry.parseDsn('https://my-key@host/1');
  const h = sentry.authHeader(parsed);
  assert.match(h, /sentry_version=7/);
  assert.match(h, /sentry_key=my-key/);
  assert.match(h, /sentry_client=orcatrade-zero-dep/);
});

// ── splitTagsAndExtra ─────────────────────────────────────

test('splitTagsAndExtra: whitelisted fields go to tags, rest to extra', () => {
  const r = sentry.splitTagsAndExtra({
    handler: 'orchestrator',
    requestId: 'req-123',
    customField: 'something',
    nested: { x: 1 },
  });
  assert.equal(r.tags.handler, 'orchestrator');
  assert.equal(r.tags.requestId, 'req-123');
  assert.equal(r.extra.customField, 'something');
  assert.deepEqual(r.extra.nested, { x: 1 });
});

test('splitTagsAndExtra: nested object NEVER promoted to a tag (Sentry rejects)', () => {
  const r = sentry.splitTagsAndExtra({ handler: { weird: 'shape' } });
  assert.equal(r.tags.handler, undefined);
  assert.deepEqual(r.extra.handler, { weird: 'shape' });
});

test('splitTagsAndExtra: null/undefined values dropped', () => {
  const r = sentry.splitTagsAndExtra({ handler: null, foo: undefined });
  assert.equal(r.tags.handler, undefined);
  assert.equal(r.extra.foo, undefined);
});

test('splitTagsAndExtra: long tag values truncated to 200 chars (Sentry limit)', () => {
  const longStr = 'x'.repeat(500);
  const r = sentry.splitTagsAndExtra({ handler: longStr });
  assert.equal(r.tags.handler.length, 200);
});

test('splitTagsAndExtra: numeric + boolean tags coerced to string', () => {
  const r = sentry.splitTagsAndExtra({ requestId: 42, agent: true });
  assert.equal(r.tags.requestId, '42');
  assert.equal(r.tags.agent, 'true');
});

// ── buildEvent ───────────────────────────────────────────

test('buildEvent: warn level becomes Sentry "warning"', () => {
  const e = sentry.buildEvent({ level: 'warn', message: 'hi', extras: {} });
  assert.equal(e.payload.level, 'warning');
});

test('buildEvent: error level stays "error"', () => {
  const e = sentry.buildEvent({ level: 'error', message: 'boom', extras: {} });
  assert.equal(e.payload.level, 'error');
});

test('buildEvent: payload carries message, platform:node, logger:orcatrade', () => {
  const e = sentry.buildEvent({ level: 'error', message: 'fail', extras: {} });
  assert.equal(e.payload.message.formatted, 'fail');
  assert.equal(e.payload.platform, 'node');
  assert.equal(e.payload.logger, 'orcatrade');
});

test('buildEvent: event_id is 32-hex per Sentry spec', () => {
  const e = sentry.buildEvent({ level: 'error', message: 'fail', extras: {} });
  assert.match(e.eventId, /^[a-f0-9]{32}$/);
  assert.equal(e.eventId, e.payload.event_id);
});

test('buildEvent: extras split correctly into tags + extra', () => {
  const e = sentry.buildEvent({
    level: 'error',
    message: 'fail',
    extras: { handler: 'auth', custom: 'value' },
  });
  assert.equal(e.payload.tags.handler, 'auth');
  assert.equal(e.payload.extra.custom, 'value');
});

// ── buildEnvelopeBody ─────────────────────────────────────

test('buildEnvelopeBody: three newline-separated JSON lines per Sentry spec', () => {
  const e = sentry.buildEvent({ level: 'error', message: 'boom', extras: {} });
  const body = sentry.buildEnvelopeBody(e);
  const lines = body.split('\n').filter(l => l.length > 0);
  assert.equal(lines.length, 3);
  const envelopeHeader = JSON.parse(lines[0]);
  const itemHeader = JSON.parse(lines[1]);
  const itemBody = JSON.parse(lines[2]);
  assert.equal(envelopeHeader.event_id, e.eventId);
  assert.match(envelopeHeader.sent_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(itemHeader.type, 'event');
  assert.equal(itemHeader.content_type, 'application/json');
  assert.equal(itemBody.event_id, e.eventId);
  assert.equal(itemBody.message.formatted, 'boom');
});

// ── captureMessage (no DSN path) ─────────────────────────

test('captureMessage: no DSN → returns { sent: false, reason: "no-dsn" }', async () => {
  await withEnvAsync({ SENTRY_DSN: null }, async () => {
    const r = await sentry.captureMessage({ level: 'error', message: 'test' });
    assert.equal(r.sent, false);
    assert.equal(r.reason, 'no-dsn');
  });
});

// ── log → Sentry forwarding ──────────────────────────────

test('log.error forwards to Sentry when SENTRY_DSN set', async () => {
  // Capture network attempts by replacing global.fetch.
  const origFetch = global.fetch;
  const captured = [];
  global.fetch = async (url, init) => {
    captured.push({ url, init });
    return { ok: true, status: 200, text: async () => '' };
  };
  try {
    await withEnvAsync({ SENTRY_DSN: 'https://k@o1.ingest.de.sentry.io/123' }, async () => {
      const log = require('../lib/log');
      log.error('synthetic error for testing', { handler: 'test' });
      // Forwarding is fire-and-forget — wait for microtasks to drain.
      await new Promise(r => setImmediate(r));
      await new Promise(r => setImmediate(r));
    });
    assert.equal(captured.length, 1, 'one Sentry envelope POSTed');
    assert.match(captured[0].url, /sentry\.io\/api\/123\/envelope/);
    assert.equal(captured[0].init.method, 'POST');
    assert.match(captured[0].init.headers['X-Sentry-Auth'], /sentry_key=k/);
    // Envelope body must contain the message.
    assert.match(captured[0].init.body, /synthetic error for testing/);
  } finally {
    global.fetch = origFetch;
  }
});

test('log.warn forwards to Sentry too (warn = sentry "warning")', async () => {
  const origFetch = global.fetch;
  const captured = [];
  global.fetch = async (url, init) => {
    captured.push({ url, init });
    return { ok: true, status: 200, text: async () => '' };
  };
  try {
    await withEnvAsync({ SENTRY_DSN: 'https://k@o1.ingest.de.sentry.io/123' }, async () => {
      const log = require('../lib/log');
      log.warn('synthetic warn');
      await new Promise(r => setImmediate(r));
      await new Promise(r => setImmediate(r));
    });
    assert.equal(captured.length, 1);
    const body = JSON.parse(captured[0].init.body.split('\n')[2]);
    assert.equal(body.level, 'warning');
  } finally {
    global.fetch = origFetch;
  }
});

test('log.info does NOT forward (would blow Sentry quota)', async () => {
  const origFetch = global.fetch;
  const captured = [];
  global.fetch = async (url, init) => { captured.push({ url, init }); return { ok: true, status: 200 }; };
  try {
    await withEnvAsync({ SENTRY_DSN: 'https://k@o1.ingest.de.sentry.io/123' }, async () => {
      const log = require('../lib/log');
      log.info('routine event');
      log.debug('verbose noise');
      await new Promise(r => setImmediate(r));
      await new Promise(r => setImmediate(r));
    });
    assert.equal(captured.length, 0, 'info + debug must not reach Sentry');
  } finally {
    global.fetch = origFetch;
  }
});

test('log.error does NOT forward when SENTRY_DSN unset', async () => {
  const origFetch = global.fetch;
  const captured = [];
  global.fetch = async (url, init) => { captured.push({ url, init }); return { ok: true, status: 200 }; };
  try {
    await withEnvAsync({ SENTRY_DSN: null }, async () => {
      const log = require('../lib/log');
      log.error('should stay local');
      await new Promise(r => setImmediate(r));
      await new Promise(r => setImmediate(r));
    });
    assert.equal(captured.length, 0, 'unset DSN must not attempt network');
  } finally {
    global.fetch = origFetch;
  }
});

test('log.error: PII redaction applies BEFORE Sentry forward', async () => {
  // The redact() pass in log.emit() runs before the Sentry forward, so a
  // raw email in extras must be masked in the envelope payload too.
  const origFetch = global.fetch;
  const captured = [];
  global.fetch = async (url, init) => { captured.push({ url, init }); return { ok: true, status: 200 }; };
  try {
    await withEnvAsync({ SENTRY_DSN: 'https://k@o1.ingest.de.sentry.io/123' }, async () => {
      const log = require('../lib/log');
      log.error('user op failed', { email: 'oskar@orcatrade.pl', handler: 'auth' });
      await new Promise(r => setImmediate(r));
      await new Promise(r => setImmediate(r));
    });
    assert.equal(captured.length, 1);
    const body = JSON.parse(captured[0].init.body.split('\n')[2]);
    // The email field lives in `extra` (not whitelisted as tag). Must be redacted.
    assert.notEqual(body.extra.email, 'oskar@orcatrade.pl');
    assert.match(body.extra.email, /^os\*\*\*$/);
  } finally {
    global.fetch = origFetch;
  }
});

// ── Health probe ─────────────────────────────────────────

test('health.probeSentry: ok when valid SENTRY_DSN set', () => {
  withEnv({ SENTRY_DSN: 'https://k@o1.ingest.de.sentry.io/123' }, () => {
    const health = require('../lib/handlers/health');
    const r = health.probeSentry();
    assert.equal(r.status, 'ok');
    assert.equal(r.configured, true);
    assert.equal(r.host, 'o1.ingest.de.sentry.io');
    assert.equal(r.projectId, '123');
  });
});

test('health.probeSentry: degraded when SENTRY_DSN unset', () => {
  withEnv({ SENTRY_DSN: null }, () => {
    const health = require('../lib/handlers/health');
    const r = health.probeSentry();
    assert.equal(r.status, 'degraded');
    assert.equal(r.configured, false);
  });
});

test('health.probeSentry: degraded when SENTRY_DSN malformed', () => {
  withEnv({ SENTRY_DSN: 'not-a-dsn' }, () => {
    const health = require('../lib/handlers/health');
    const r = health.probeSentry();
    assert.equal(r.status, 'degraded');
    assert.equal(r.configured, true);
    assert.match(r.reason, /malformed/);
  });
});

test('status page knows about the sentry subsystem', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const html = fs.readFileSync(path.join(__dirname, '..', 'status', 'legacy', 'index.html'), 'utf8');
  assert.match(html, /sentry:\s*\{\s*name:/);
});

// ── release tagging ────────────────────────────────────

test('buildEvent stamps the release from VERCEL_GIT_COMMIT_SHA (truncated 8)', () => {
  const prior = process.env.VERCEL_GIT_COMMIT_SHA;
  try {
    process.env.VERCEL_GIT_COMMIT_SHA = 'deadbeefcafebabe1234';
    const env = sentry.buildEvent({ level: 'info', message: 'release smoke' });
    assert.equal(env.payload.release, 'deadbeef');
  } finally {
    if (prior === undefined) delete process.env.VERCEL_GIT_COMMIT_SHA;
    else process.env.VERCEL_GIT_COMMIT_SHA = prior;
  }
});

test('buildEvent falls back to release="dev" when no commit SHA is present', () => {
  const prior = process.env.VERCEL_GIT_COMMIT_SHA;
  delete process.env.VERCEL_GIT_COMMIT_SHA;
  try {
    const env = sentry.buildEvent({ level: 'info', message: 'release smoke' });
    assert.equal(env.payload.release, 'dev');
  } finally {
    if (prior !== undefined) process.env.VERCEL_GIT_COMMIT_SHA = prior;
  }
});
