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
    console.log(`${RED}✗${RESET} ${name}  ${DIM}${url} → ${res.status}${RESET}  ${verdict.reason}`);
    return false;
  } catch (err) {
    console.log(`${RED}✗${RESET} ${name}  ${DIM}${url}${RESET}  ${err.message}`);
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
