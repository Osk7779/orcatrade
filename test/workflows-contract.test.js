// .github/workflows/ contract — pin the load-bearing shape of each
// workflow that nothing else covers.
//
// Existing coverage (do NOT duplicate):
//   test/automation.test.js          → cron.yml (schedules + dispatch)
//   test/automation-extended.test.js → rotate-dates.yml + cron.yml extras
//   test/ai-evals.test.js            → evals.yml structure
//
// What this file pins:
//   test.yml   — runs `npm test` on push:main + pull_request:main,
//                matrix-tests against Node 20 + 22, pins ORCATRADE_AUTH_SECRET
//                in env so tests don't depend on CI's actual secret state.
//   smoke.yml  — post-deploy probe via scripts/smoke.js, fires on push:main
//                + workflow_dispatch, waits for Vercel to settle before probing.
//   uptime.yml — every-5-minutes external probe of /api/health, requires
//                SITE_ORIGIN secret.
//
// If a workflow legitimately needs a different shape, update the assertion
// in the same commit — the gate is intentional.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const WF_DIR = path.join(ROOT, '.github', 'workflows');

function readWf(name) {
  return fs.readFileSync(path.join(WF_DIR, name), 'utf8');
}

// ── test.yml ─────────────────────────────────────────────────

test('workflows: test.yml exists and runs on push:main + PR:main', () => {
  assert.ok(fs.existsSync(path.join(WF_DIR, 'test.yml')), 'test.yml must exist');
  const yml = readWf('test.yml');
  assert.match(yml, /^name:\s*tests/m, 'workflow name is "tests"');
  assert.match(yml, /push:\s*\n\s*branches:\s*\[\s*main\s*\]/, 'fires on push to main');
  assert.match(yml, /pull_request:\s*\n\s*branches:\s*\[\s*main\s*\]/, 'fires on PR to main');
});

test('workflows: test.yml runs the actual test command (npm test)', () => {
  const yml = readWf('test.yml');
  // npm test is the entry point; if this changes to a script that does
  // less than the full suite, CI silently weakens.
  assert.match(yml, /run:\s*npm test/, 'must run `npm test` (not a narrower subset)');
});

test('workflows: test.yml matrix covers Node 20 + Node 22 (LTS coverage)', () => {
  const yml = readWf('test.yml');
  // Node 20 was first LTS shipping a stable test runner; Node 22 is
  // current LTS. Dropping either loses coverage of a Vercel-deployable
  // runtime.
  assert.match(yml, /node:\s*\[\s*['"]20['"]/, 'Node 20 in matrix');
  assert.match(yml, /['"]22['"]/, 'Node 22 in matrix');
});

test('workflows: test.yml pins ORCATRADE_AUTH_SECRET so tests are deterministic', () => {
  const yml = readWf('test.yml');
  // Without this env pin, test/auth.test.js would depend on whatever
  // secret CI happens to inject — flaky if the secret rotates, or
  // worse, signs cookies against the real prod secret in a CI run.
  assert.match(yml, /ORCATRADE_AUTH_SECRET:/, 'auth secret pinned in env');
  assert.doesNotMatch(yml, /ORCATRADE_AUTH_SECRET:\s*\$\{\{\s*secrets/,
    'auth secret must NOT pull from CI secrets — pin a literal test value');
});

// ── smoke.yml ────────────────────────────────────────────────

test('workflows: smoke.yml exists and post-deploys via scripts/smoke.js', () => {
  assert.ok(fs.existsSync(path.join(WF_DIR, 'smoke.yml')), 'smoke.yml must exist');
  const yml = readWf('smoke.yml');
  assert.match(yml, /^name:\s*smoke/m, 'workflow name is "smoke"');
  assert.match(yml, /push:\s*\n\s*branches:\s*\[\s*main\s*\]/, 'fires on push to main');
  assert.match(yml, /workflow_dispatch:/, 'manual dispatch path exists');
  assert.match(yml, /scripts\/smoke\.js/, 'invokes the smoke script');
});

test('workflows: smoke.yml waits for Vercel to settle before probing', () => {
  const yml = readWf('smoke.yml');
  // Without a settle delay, the probe races the deploy and fails
  // intermittently — the existing 90s sleep is load-bearing.
  assert.match(yml, /sleep\s+\d{2,}/,
    'must wait ≥10s before probing (Vercel auto-deploy settle window)');
});

// ── uptime.yml ───────────────────────────────────────────────

test('workflows: uptime.yml probes /api/health every 5 minutes', () => {
  assert.ok(fs.existsSync(path.join(WF_DIR, 'uptime.yml')), 'uptime.yml must exist');
  const yml = readWf('uptime.yml');
  assert.match(yml, /^name:\s*uptime/m, 'workflow name is "uptime"');
  assert.match(yml, /cron:\s*['"]?\*\/5/, 'schedule is every 5 minutes');
  assert.match(yml, /\/api\/health/, 'probes the /api/health endpoint specifically');
  assert.match(yml, /SITE_ORIGIN/, 'reads SITE_ORIGIN secret for the target host');
});

// ── Cross-cutting: no workflow uses an unpinned third-party action ──

test('workflows: all actions/* uses are pinned to a major version (v4, v5, …)', () => {
  // Pinning to a major version is the minimum bar — pinning to a SHA
  // is better (supply-chain attack defense) but our threat model and
  // operational tempo make the cost-benefit favour major-version pinning.
  // What we forbid here: `uses: actions/checkout@main` (rolling, can break
  // overnight) and `uses: actions/checkout` (no version at all).
  const files = fs.readdirSync(WF_DIR).filter(f => f.endsWith('.yml'));
  const offenders = [];
  for (const f of files) {
    const yml = readWf(f);
    // Find every `uses: <something>` line.
    const usesRe = /uses:\s*([^\s#]+)/g;
    let m;
    while ((m = usesRe.exec(yml)) !== null) {
      const ref = m[1];
      // Local actions (./.github/actions/...) don't need a version pin.
      if (ref.startsWith('./')) continue;
      if (!ref.includes('@')) {
        offenders.push(`${f}: "${ref}" has no version pin`);
      } else if (/@(main|master|latest|HEAD)$/.test(ref)) {
        offenders.push(`${f}: "${ref}" pins to a rolling ref (use a major version)`);
      }
    }
  }
  assert.deepEqual(offenders, [],
    `Unpinned workflow actions found:\n  ${offenders.join('\n  ')}\n` +
    'Pin to a major version (e.g. actions/checkout@v4). A rolling ref can break overnight ' +
    'and a missing ref is implicitly @latest.');
});

test('workflows: discovery finds the expected set (rename detection)', () => {
  const found = new Set(fs.readdirSync(WF_DIR).filter(f => f.endsWith('.yml')));
  for (const expected of ['test.yml', 'smoke.yml', 'uptime.yml', 'cron.yml']) {
    assert.ok(found.has(expected),
      `Expected workflow ${expected} — if renamed, update the contract pins in this file`);
  }
});
