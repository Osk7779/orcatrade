#!/usr/bin/env node
'use strict';

// Tier-A green-state stamp writer.
//
// Called from CI (`.github/workflows/tier-a-stamp.yml`) after the test
// suite passes on `main`. For each calculator that participates in
// Tier-A (see CALCULATORS below), writes the current UTC time to KV
// at `tier-a:green-state:<name>` with a 7-day TTL.
//
// This stamp satisfies TA-3 (the calculator passed its full regression
// test suite within the last 24 hours) — without it, every Tier-A
// evaluation in production returns `eligible: false, failedReason:
// 'calculator-not-green-TA3'`. Failure-mode is therefore safe: a
// stamp-job outage degrades AWAY from Tier-A rather than into it,
// matching ADR 0020 §Consequences.
//
// Manual invocation: `node scripts/tier-a-stamp.js`
//   (requires KV_REST_API_URL + KV_REST_API_TOKEN env, otherwise no-op).
//
// Exit codes:
//   0 — every calculator stamped (or KV not configured — explicit no-op)
//   1 — at least one stamp failed

const path = require('path');
const greenState = require(path.join(__dirname, '..', 'lib', 'intelligence', 'tier-a', 'green-state'));
const kv = require(path.join(__dirname, '..', 'lib', 'intelligence', 'kv-store'));

// Add a calculator name here when it adopts a COVERAGE manifest +
// emits Tier-A determinations. Keep the list short — adoption is
// per-PR per ADR 0020.
const CALCULATORS = [
  'customs-quote',
  'finance-quote',
];

async function main() {
  if (!kv.isConfigured()) {
    process.stdout.write('tier-a-stamp: KV not configured — no-op (set KV_REST_API_URL + KV_REST_API_TOKEN to enable)\n');
    return 0;
  }

  let failures = 0;
  for (const name of CALCULATORS) {
    try {
      const result = await greenState.stampLastGreenAt(name);
      if (result.ok) {
        process.stdout.write(`tier-a-stamp: ${name} → ${result.iso}\n`);
      } else {
        process.stderr.write(`tier-a-stamp: ${name} FAILED — ${result.err}\n`);
        failures += 1;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`tier-a-stamp: ${name} THREW — ${message}\n`);
      failures += 1;
    }
  }

  if (failures > 0) {
    process.stderr.write(`tier-a-stamp: ${failures} calculator(s) failed to stamp\n`);
    return 1;
  }
  process.stdout.write(`tier-a-stamp: all ${CALCULATORS.length} calculators stamped\n`);
  return 0;
}

if (require.main === module) {
  main().then((code) => process.exit(code)).catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`tier-a-stamp: fatal — ${message}\n`);
    process.exit(2);
  });
}

module.exports = { main, CALCULATORS };
