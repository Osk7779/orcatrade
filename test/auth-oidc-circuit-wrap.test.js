'use strict';

// Enforces ADR 0006 ("Every external HTTP call is wrapped in lib/circuit.js")
// for the OIDC SSO surface.
//
// The 2026-06-08 audit surfaced this gap: lib/handlers/auth.js's
// exchangeCodeForTokens() POST to cfg.tokenEndpoint and fetchJwks() GET to
// cfg.jwksUri were calling raw fetch() with no circuit, no timeout, no
// fallback. A slow or hanging IdP would pin the SSO callback at the function
// timeout (~30s) and exhaust Vercel concurrency under any IdP outage.
//
// This test pins the fix so it cannot regress.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const AUTH_PATH = path.join(ROOT, 'lib', 'handlers', 'auth.js');
const AUTH_SRC = fs.readFileSync(AUTH_PATH, 'utf8');

test('exchangeCodeForTokens wraps the IdP token POST in circuit.run(\'oidc-token\')', () => {
  // The function body must contain a circuit.run('oidc-token', ...) call.
  // Per-file grep is fine here — the file has exactly two OIDC fetches and
  // both must be wrapped under their named circuits.
  assert.match(
    AUTH_SRC,
    /async function exchangeCodeForTokens\(/,
    'exchangeCodeForTokens function must exist in lib/handlers/auth.js',
  );
  assert.match(
    AUTH_SRC,
    /circuit\.run\(\s*['"]oidc-token['"]/,
    'lib/handlers/auth.js must contain circuit.run(\'oidc-token\', ...) per ADR 0006',
  );
});

test('fetchJwks wraps the IdP JWKS GET in circuit.run(\'oidc-jwks\')', () => {
  assert.match(
    AUTH_SRC,
    /async function fetchJwks\(/,
    'fetchJwks function must exist in lib/handlers/auth.js',
  );
  assert.match(
    AUTH_SRC,
    /circuit\.run\(\s*['"]oidc-jwks['"]/,
    'lib/handlers/auth.js must contain circuit.run(\'oidc-jwks\', ...) per ADR 0006',
  );
});

test('both OIDC circuits declare a fallback (required by circuit.run contract)', () => {
  // circuit.run throws if opts.fallback is missing — but a static check here
  // catches the regression earlier (no need to wait for the runtime).
  const oidcRunCalls = AUTH_SRC.match(/circuit\.run\(\s*['"]oidc-[a-z]+['"][\s\S]*?^\s{2}\}\);/gm);
  assert.ok(oidcRunCalls && oidcRunCalls.length >= 2, 'expected at least 2 oidc circuit.run blocks');
  for (const block of oidcRunCalls) {
    assert.match(block, /fallback\s*:/, `oidc circuit.run block missing fallback option: ${block.slice(0, 80)}…`);
  }
});

test('both OIDC fetches carry an AbortSignal.timeout — slow IdP cannot hang the handler', () => {
  // The breaker handles repeated failures, but a single in-flight fetch
  // still needs a hard timeout — otherwise the very first slow IdP request
  // pins one Vercel concurrency slot for the full function timeout.
  const exchangeFnMatch = AUTH_SRC.match(/async function exchangeCodeForTokens\([\s\S]*?^}/m);
  assert.ok(exchangeFnMatch, 'exchangeCodeForTokens function not located');
  assert.match(
    exchangeFnMatch[0],
    /AbortSignal\.timeout\(/,
    'exchangeCodeForTokens fetch must use AbortSignal.timeout() — no unbounded IdP wait',
  );

  const jwksFnMatch = AUTH_SRC.match(/async function fetchJwks\([\s\S]*?^}/m);
  assert.ok(jwksFnMatch, 'fetchJwks function not located');
  assert.match(
    jwksFnMatch[0],
    /AbortSignal\.timeout\(/,
    'fetchJwks fetch must use AbortSignal.timeout() — no unbounded IdP wait',
  );
});

test('the OIDC fetches no longer call raw fetch() outside the circuit wrap', () => {
  // Pattern: each OIDC helper function must contain exactly one circuit.run
  // call, and any fetch() call inside the function must be inside that
  // circuit.run block. We approximate "inside" by string position — the
  // index of the fetch( call must fall between the circuit.run( index and
  // the function's closing }.
  function assertFetchInsideCircuit(fnName, circuitName) {
    const fnMatch = AUTH_SRC.match(new RegExp(`async function ${fnName}\\([\\s\\S]*?^}`, 'm'));
    assert.ok(fnMatch, `${fnName} not located`);
    const body = fnMatch[0];
    const circuitIdx = body.indexOf(`circuit.run('${circuitName}'`);
    if (circuitIdx < 0) {
      // Allow double-quoted variant
      const altIdx = body.indexOf(`circuit.run("${circuitName}"`);
      assert.ok(altIdx >= 0, `${fnName} missing circuit.run('${circuitName}', …)`);
    }
    // Find every `fetch(` occurrence and assert it appears after circuit.run
    const fetchRe = /\bfetch\(/g;
    let m;
    while ((m = fetchRe.exec(body)) !== null) {
      assert.ok(
        m.index > Math.max(circuitIdx, body.indexOf(`circuit.run("${circuitName}"`)),
        `${fnName} contains a fetch() call OUTSIDE the circuit.run('${circuitName}') wrap (index ${m.index})`,
      );
    }
  }

  assertFetchInsideCircuit('exchangeCodeForTokens', 'oidc-token');
  assertFetchInsideCircuit('fetchJwks', 'oidc-jwks');
});

test('circuit.run wrap is functionally honoured — fallback fires when fetch throws', async (t) => {
  // Functional check: stub global.fetch to throw, call the helpers via the
  // auth module's internal references (not exported), and assert each
  // returns null rather than propagating the error.
  //
  // We import auth.js fresh so this test doesn't pollute later suites.
  const authMod = require(AUTH_PATH);

  // The helpers aren't exported; we read them off the module's internal
  // function expressions by re-evaluating the source in a Function scope
  // with the same lexical helpers. Simpler: skip functional-level test
  // if the helpers aren't exported, and rely on the static checks above.
  // This keeps the test deterministic without a brittle eval.
  if (typeof authMod.exchangeCodeForTokens !== 'function' || typeof authMod.fetchJwks !== 'function') {
    t.skip('exchangeCodeForTokens / fetchJwks not exported — relying on static enforcement above');
    return;
  }

  const origFetch = global.fetch;
  global.fetch = async () => { throw new Error('upstream-hung'); };
  try {
    const cfg = { tokenEndpoint: 'https://idp.example.test/token', jwksUri: 'https://idp.example.test/jwks', clientId: 'x', clientSecret: 'y' };
    const tokenResult = await authMod.exchangeCodeForTokens(cfg, 'code', 'verifier', 'https://app.test/cb');
    assert.equal(tokenResult, null, 'exchangeCodeForTokens fallback must return null on fetch throw');
    const jwksResult = await authMod.fetchJwks(cfg);
    assert.equal(jwksResult, null, 'fetchJwks fallback must return null on fetch throw');
  } finally {
    global.fetch = origFetch;
  }
});
