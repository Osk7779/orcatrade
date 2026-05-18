#!/usr/bin/env node
// Sprint BG-9 — Calculator regression snapshot CLI.
//
// Regenerates frozen snapshot files in lib/intelligence/regression/__snapshots__/
// for each scenario in the corpus. Intended ONLY for intentional updates —
// the test suite (test/calculator-regression.test.js) is the day-to-day
// guard. Run after a calculator change you actually want to ship.
//
// Usage:
//   node scripts/regression-snapshot.js                  # regenerate every scenario
//   node scripts/regression-snapshot.js --scenario <slug>
//   node scripts/regression-snapshot.js --diff           # report drift, do not write
//
// The TARIC live-rate path is force-disabled so snapshots stay
// network-deterministic; the test suite also runs with that flag.

'use strict';

process.env.ORCATRADE_DISABLE_LIVE_TARIC = '1';

const startHandler = require('../lib/handlers/start');
const { CORPUS, findBySlug } = require('../lib/intelligence/regression/corpus');
const snap = require('../lib/intelligence/regression/snapshot');

function parseArgs(argv) {
  const args = { scenario: null, diff: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--scenario' || a === '-s') args.scenario = argv[++i];
    else if (a === '--diff') args.diff = true;
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

function pickScenarios(args) {
  if (!args.scenario) return CORPUS;
  const one = findBySlug(args.scenario);
  if (!one) {
    console.error('Unknown scenario: ' + args.scenario);
    console.error('Available slugs:');
    for (const s of CORPUS) console.error('  - ' + s.slug);
    process.exit(1);
  }
  return [one];
}

function diffSnapshots(prev, next) {
  if (!prev) return [{ path: '(file missing)', prev: null, next: 'NEW' }];
  const prevStr = snap.sortedStringify(prev);
  const nextStr = snap.sortedStringify(next);
  if (prevStr === nextStr) return [];
  return [{ path: '(content)', prev: prevStr.length, next: nextStr.length }];
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node scripts/regression-snapshot.js [--scenario <slug>] [--diff]');
    return 0;
  }

  const scenarios = pickScenarios(args);
  let changed = 0;
  let unchanged = 0;
  let failed = 0;

  for (const scenario of scenarios) {
    process.stdout.write('• ' + scenario.slug + ' … ');
    let next;
    try {
      const plan = await startHandler.composePlan(scenario.inputs);
      next = snap.extractSnapshot(plan);
    } catch (err) {
      console.log('THREW ' + err.message);
      failed++;
      continue;
    }
    if (!next.ok) {
      console.log('not-ok (' + (next.errors || ['?']).join(', ') + ')');
      failed++;
      continue;
    }
    const prev = snap.loadSnapshot(scenario.slug);
    const diffs = diffSnapshots(prev, next);
    if (diffs.length === 0) {
      console.log('unchanged');
      unchanged++;
      continue;
    }
    if (args.diff) {
      console.log('WOULD CHANGE (prev ' + (diffs[0].prev || 'missing') + 'b → next ' + diffs[0].next + 'b)');
    } else {
      snap.writeSnapshot(scenario.slug, next);
      console.log(prev ? 'updated' : 'created');
    }
    changed++;
  }

  console.log('');
  console.log('Summary: ' + unchanged + ' unchanged · ' + changed + (args.diff ? ' would change' : ' rewritten') + ' · ' + failed + ' failed');
  return failed > 0 ? 1 : 0;
}

if (require.main === module) {
  run().then((code) => process.exit(code)).catch((err) => {
    console.error(err && err.stack ? err.stack : err);
    process.exit(1);
  });
}

module.exports = { run, parseArgs };
