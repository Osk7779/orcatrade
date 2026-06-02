'use strict';

// ADR 0017 follow-up — inline GHA annotations from scripts/smoke.js.
//
// When the pr-smoke workflow fails, the GHA-formatted `::error
// file=…,title=…::message` output makes the failing probe appear
// as a red annotation in the PR's Files-changed / Checks UI rather
// than buried in the action log. ADR 0017's "Known gaps" section
// promised this — this PR closes it.
//
// Coverage:
//   * inGithubActions reads env flags (CI=true && GITHUB_ACTIONS=true);
//     either missing → false
//   * emitGhaError is a no-op when NOT in GHA
//   * emitGhaError emits a properly-escaped workflow command when
//     in GHA, with file= anchor + title= + message containing the
//     probe name + url + reason
//   * Newlines + carriage returns + percent signs in reason are
//     escape-encoded (GHA's required encoding for workflow commands)

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const smoke = require(path.join(ROOT, 'scripts/smoke.js'));

// In-process stdout capture — emitGhaError writes via console.log.
function captureStdout(fn) {
  const lines = [];
  const orig = console.log;
  console.log = (...args) => {
    lines.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
  };
  try { fn(); }
  finally { console.log = orig; }
  return lines;
}

function withEnv(overrides, fn) {
  const prev = {};
  for (const k of Object.keys(overrides)) {
    prev[k] = process.env[k];
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

// ── inGithubActions ────────────────────────────────────────────────

test('inGithubActions is false when CI flag is missing', () => {
  withEnv({ CI: null, GITHUB_ACTIONS: 'true' }, () => {
    assert.equal(smoke.inGithubActions(), false);
  });
});

test('inGithubActions is false when GITHUB_ACTIONS flag is missing', () => {
  withEnv({ CI: 'true', GITHUB_ACTIONS: null }, () => {
    assert.equal(smoke.inGithubActions(), false);
  });
});

test('inGithubActions is true only when BOTH CI=true AND GITHUB_ACTIONS=true', () => {
  withEnv({ CI: 'true', GITHUB_ACTIONS: 'true' }, () => {
    assert.equal(smoke.inGithubActions(), true);
  });
});

// ── emitGhaError gating ────────────────────────────────────────────

test('emitGhaError is a no-op when NOT in GHA (local runs stay readable)', () => {
  const lines = withEnv({ CI: null, GITHUB_ACTIONS: null }, () =>
    captureStdout(() => smoke.emitGhaError({ name: 'health', url: 'https://x/api/health', reason: 'boom' })),
  );
  assert.equal(lines.length, 0, 'no output should be emitted outside GHA');
});

test('emitGhaError writes a ::error workflow command when in GHA', () => {
  const lines = withEnv({ CI: 'true', GITHUB_ACTIONS: 'true' }, () =>
    captureStdout(() => smoke.emitGhaError({
      name: 'health', url: 'https://x/api/health', reason: 'connection refused',
    })),
  );
  assert.equal(lines.length, 1);
  const line = lines[0];
  // The annotation must (a) be a `::error` workflow command, (b) anchor
  // on scripts/smoke.js so the PR Files-changed UI has a target, (c)
  // include the probe name in title= for at-a-glance scannability,
  // (d) carry name + url + reason in the message body.
  assert.match(line, /^::error /);
  assert.match(line, /file=scripts\/smoke\.js/);
  assert.match(line, /title=smoke probe failed: health/);
  assert.match(line, /health/);
  assert.match(line, /api\/health/);
  assert.match(line, /connection refused/);
});

// ── escape encoding ───────────────────────────────────────────────
//
// GitHub Actions workflow commands need %25 / %0D / %0A for
// percent / CR / LF in the message body — otherwise GHA mis-parses
// the command + drops the annotation. Pin the escapes.

test('emitGhaError escapes newlines (LF → %0A) in the reason', () => {
  const lines = withEnv({ CI: 'true', GITHUB_ACTIONS: 'true' }, () =>
    captureStdout(() => smoke.emitGhaError({
      name: 'health', url: 'https://x/api/health',
      reason: 'line one\nline two',
    })),
  );
  assert.equal(lines.length, 1);
  assert.match(lines[0], /line one%0Aline two/, 'LF must be encoded as %0A');
  assert.doesNotMatch(lines[0], /line one\nline two/, 'raw newline must not appear');
});

test('emitGhaError escapes carriage returns (CR → %0D)', () => {
  const lines = withEnv({ CI: 'true', GITHUB_ACTIONS: 'true' }, () =>
    captureStdout(() => smoke.emitGhaError({
      name: 'health', url: 'https://x/api/health',
      reason: 'with\rCR',
    })),
  );
  assert.match(lines[0], /with%0DCR/);
});

test('emitGhaError escapes percent signs (% → %25) so the encoding is reversible', () => {
  const lines = withEnv({ CI: 'true', GITHUB_ACTIONS: 'true' }, () =>
    captureStdout(() => smoke.emitGhaError({
      name: 'health', url: 'https://x/api/health',
      reason: '50% packet loss',
    })),
  );
  // Without escaping the `%`, GHA could mis-parse `%0A` etc. that
  // happens to follow it. The escape must run BEFORE the
  // newline/CR escapes (otherwise %0A inside a message body
  // becomes %2525A — wrong direction). The current implementation
  // runs % first, then CR/LF — pin that ordering.
  assert.match(lines[0], /50%25 packet loss/);
});

// ── defensive ────────────────────────────────────────────────────

test('emitGhaError handles undefined / null reason gracefully', () => {
  const lines = withEnv({ CI: 'true', GITHUB_ACTIONS: 'true' }, () =>
    captureStdout(() => {
      smoke.emitGhaError({ name: 'health', url: 'https://x', reason: null });
      smoke.emitGhaError({ name: 'health', url: 'https://x' });
    }),
  );
  assert.equal(lines.length, 2, 'both calls produce an annotation; neither throws');
  // The message body falls back to 'unknown' so the annotation isn't
  // a blank message that's useless to a reviewer.
  for (const l of lines) assert.match(l, /unknown/);
});
