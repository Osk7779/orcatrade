// Post-deploy smoke test (apex enterprise-readiness — defence in depth).
//
//   node scripts/smoke.js                           → probes prod (orcatradegroup.com)
//   node scripts/smoke.js --host orcatrade.pl       → probes a different host
//   node scripts/smoke.js --base https://…          → probes any base URL
//
// Hits a handful of *behavioural* probes that catch the most common deploy
// regressions in one HTTP round-trip each:
//   - /api/health           is the platform alive
//   - /api/scim/v2/Users    SCIM handler registered + bearer-auth working
//                           (401 with a real SCIM Error body — proves the new
//                           code is on, not just a generic 404)
//   - /api/audit            admin-gated, expects 401 without token
//   - /trust/, /changelog/  static enterprise-trust surfaces render
//   - /app/operations       the new app-shell dashboard route resolves
//
// Exit code is non-zero on any failure so a CI step can gate promotion.
// No npm deps — uses the Node 18+ global fetch.

'use strict';

const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const base = arg('--base', `https://${arg('--host', 'orcatradegroup.com')}`);
const TIMEOUT_MS = 20_000;

const RESET = '\x1b[0m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const DIM = '\x1b[2m';

// GitHub Actions workflow-command emission for failure annotations.
// `::error file=…,title=…::message` makes a failing probe appear as
// a red annotation in the PR's Checks / Files-changed UI rather
// than only in the action log. ADR 0017's known-gap close-out.
// Only emits when running inside GHA (CI=true && GITHUB_ACTIONS=true);
// otherwise the helper is a no-op so local runs stay readable.
function inGithubActions() {
  return process.env.CI === 'true' && process.env.GITHUB_ACTIONS === 'true';
}
function emitGhaError({ name, url, reason }) {
  if (!inGithubActions()) return;
  const escape = (s) => String(s == null ? '' : s)
    .replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  // file= must be a workspace-relative path. We're a runtime-probe
  // script — there's no source file to blame — so we anchor on the
  // script itself; the PR reviewer follows the annotation back to
  // smoke.js where the probe list lives, sees `name` + `url`, and
  // knows which probe failed without scrolling the action log.
  const title = `smoke probe failed: ${escape(name)}`;
  const msg = `${escape(name)}  ${escape(url)}  ${escape(reason || 'unknown')}`;
  console.log(`::error file=scripts/smoke.js,title=${title}::${msg}`);
}

async function probe(name, path, check) {
  const url = base + path;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'manual' });
    const text = await res.text();
    const verdict = check({ status: res.status, text, headers: res.headers });
    if (verdict.ok) {
      console.log(`${GREEN}✓${RESET} ${name}  ${DIM}${url} → ${res.status}  ${verdict.note || ''}${RESET}`);
      return true;
    }
    const reason = `expected check failed: ${verdict.reason} (got status ${res.status})`;
    console.log(`${RED}✗${RESET} ${name}  ${DIM}${url} → ${res.status}${RESET}  ${verdict.reason}`);
    emitGhaError({ name, url, reason });
    return false;
  } catch (err) {
    console.log(`${RED}✗${RESET} ${name}  ${DIM}${url}${RESET}  ${err.message}`);
    emitGhaError({ name, url, reason: err.message });
    return false;
  } finally {
    clearTimeout(timer);
  }
}

const probes = [
  ['health', '/api/health', ({ status }) => status >= 200 && status < 500
    ? { ok: true, note: 'reachable' }
    : { ok: false, reason: `expected <500, got ${status}` }],

  ['scim handler registered', '/api/scim/v2/Users', ({ status, text }) => {
    if (status !== 401) return { ok: false, reason: `expected 401, got ${status}` };
    try {
      const body = JSON.parse(text);
      const schema = Array.isArray(body.schemas) ? body.schemas[0] : null;
      if (schema !== 'urn:ietf:params:scim:api:messages:2.0:Error') return { ok: false, reason: 'not a SCIM Error body' };
      return { ok: true, note: 'SCIM Error body returned (handler live)' };
    } catch (_) { return { ok: false, reason: 'response is not JSON' }; }
  }],

  ['audit admin-gated', '/api/audit', ({ status }) => status === 401 || status === 403
    ? { ok: true, note: `gated (${status})` }
    : { ok: false, reason: `expected 401/403, got ${status}` }],

  ['trust center', '/trust/', ({ status, text }) => {
    if (status !== 200) return { ok: false, reason: `expected 200, got ${status}` };
    return /Reproducibility|Tamper-evident|Trust/.test(text)
      ? { ok: true, note: 'trust content present' }
      : { ok: false, reason: 'expected trust content not found' };
  }],

  ['changelog', '/changelog/', ({ status, text }) => {
    if (status !== 200) return { ok: false, reason: `expected 200, got ${status}` };
    return /Changelog|OrcaTrade/.test(text)
      ? { ok: true, note: 'page rendered' }
      : { ok: false, reason: 'expected changelog content not found' };
  }],

  ['app-shell operations', '/app/operations', ({ status }) => status === 200
    ? { ok: true, note: 'route resolves' }
    : { ok: false, reason: `expected 200, got ${status}` }],
];

// Only run the probe loop when invoked directly (node scripts/smoke.js).
// When required from a test file, expose the helpers so the
// GHA-annotation logic can be unit-tested without spinning up real
// HTTP probes.
if (require.main === module) {
  (async () => {
    console.log(`${DIM}smoke against ${base}${RESET}`);
    let pass = 0;
    for (const [name, path, check] of probes) {
      if (await probe(name, path, check)) pass++;
    }
    const total = probes.length;
    const colour = pass === total ? GREEN : RED;
    console.log(`${colour}${pass}/${total} probes passed${RESET}`);
    process.exit(pass === total ? 0 : 1);
  })();
}

module.exports = {
  emitGhaError,
  inGithubActions,
  probes,
};
