#!/usr/bin/env node
// Compliance Agent eval harness.
// Runs the cases in test/agent-eval-cases.json against api/agent.js, captures the SSE event stream,
// asserts tools called, citations present, expected keywords in final text, and stop reason.
//
// Usage:
//   ORCATRADE_OS_API=sk-ant-... node scripts/agent-eval.js
//   ORCATRADE_OS_API=sk-ant-... node scripts/agent-eval.js cbam-steel-china       # single case
//   ORCATRADE_OS_API=sk-ant-... node scripts/agent-eval.js --bail                  # stop on first failure
//
// Exit code: 0 if all pass, 1 if any fail. Suitable for CI.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CASES_PATH = path.join(ROOT, 'test', 'agent-eval-cases.json');
const HANDLER_PATH = path.join(ROOT, 'api', 'agent.js');

const COLOR = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
};

function color(text, c) {
  if (!process.stdout.isTTY) return text;
  return `${COLOR[c] || ''}${text}${COLOR.reset}`;
}

if (!process.env.ORCATRADE_OS_API) {
  console.error(color('ORCATRADE_OS_API is required for the agent eval. Aborting.', 'red'));
  process.exit(2);
}

const args = process.argv.slice(2);
const bail = args.includes('--bail');
const onlyId = args.find(a => !a.startsWith('--'));

const fixtures = JSON.parse(fs.readFileSync(CASES_PATH, 'utf8'));
const allCases = fixtures.cases;
const cases = onlyId ? allCases.filter(c => c.id === onlyId) : allCases;

if (!cases.length) {
  console.error(color(`No cases matched "${onlyId || '<all>'}". Available: ${allCases.map(c => c.id).join(', ')}`, 'red'));
  process.exit(2);
}

const handler = require(HANDLER_PATH);

function makeMockReqRes(body) {
  const events = [];
  let statusCode = 200;
  let ended = false;

  const req = {
    method: 'POST',
    headers: { 'x-forwarded-for': '127.0.0.1' },
    body,
  };

  const res = {
    statusCode,
    setHeader() {},
    flushHeaders() {},
    status(code) { statusCode = code; this.statusCode = code; return this; },
    json(payload) { events.push({ type: '__http_json', payload }); ended = true; return this; },
    write(chunk) {
      const text = String(chunk);
      const lines = text.split('\n').filter(l => l.startsWith('data:'));
      for (const line of lines) {
        const data = line.slice(5).trim();
        if (!data) continue;
        try { events.push(JSON.parse(data)); } catch {}
      }
    },
    end() { ended = true; },
  };

  return { req, res, events, get statusCode() { return statusCode; }, get ended() { return ended; } };
}

function summariseEvents(events) {
  const toolsCalled = events
    .filter(e => e.type === 'tool-call')
    .map(e => e.name);
  const toolsSucceeded = events
    .filter(e => e.type === 'tool-result' && e.ok)
    .length;
  const toolsFailed = events
    .filter(e => e.type === 'tool-result' && !e.ok)
    .length;
  const finalEvent = events.find(e => e.type === 'final') || {};
  const finalText = finalEvent.text || '';
  const stopReason = finalEvent.stopReason || 'unknown';
  const errors = events.filter(e => e.type === 'error');
  return { toolsCalled, toolsSucceeded, toolsFailed, finalText, stopReason, errors };
}

function assertExpectations(summary, expectations) {
  const failures = [];

  for (const expected of expectations.mustCallTools || []) {
    if (!summary.toolsCalled.includes(expected)) {
      failures.push(`expected tool "${expected}" was never called (called: ${summary.toolsCalled.join(', ') || 'none'})`);
    }
  }
  for (const forbidden of expectations.mustNotCallTools || []) {
    if (summary.toolsCalled.includes(forbidden)) {
      failures.push(`forbidden tool "${forbidden}" was called`);
    }
  }
  if (expectations.mustCite) {
    const hasCitation = /\[[a-z0-9][a-z0-9_\-]+\]/i.test(summary.finalText);
    if (!hasCitation) failures.push('expected at least one [chunk-id] citation; none found');
  }
  if (expectations.shouldEscalate === true && !summary.toolsCalled.includes('requestHumanReview')) {
    failures.push('expected escalation (requestHumanReview) but agent did not escalate');
  }
  if (expectations.shouldEscalate === false && summary.toolsCalled.includes('requestHumanReview')) {
    failures.push('expected no escalation but agent invoked requestHumanReview');
  }
  for (const keyword of expectations.mustIncludeKeywords || []) {
    if (!summary.finalText.toLowerCase().includes(String(keyword).toLowerCase())) {
      failures.push(`expected keyword "${keyword}" in final text; not found`);
    }
  }
  if (expectations.stopReason && summary.stopReason !== expectations.stopReason) {
    failures.push(`expected stop reason "${expectations.stopReason}" but got "${summary.stopReason}"`);
  }
  if (summary.errors.length) {
    failures.push(`agent emitted ${summary.errors.length} error events: ${summary.errors.map(e => e.message).join('; ')}`);
  }
  return failures;
}

async function runCase(testCase) {
  const startedAt = Date.now();
  const { req, res, events } = makeMockReqRes({ messages: testCase.messages });
  await handler(req, res);
  const elapsedMs = Date.now() - startedAt;
  const summary = summariseEvents(events);
  const failures = assertExpectations(summary, testCase.expectations || {});
  return { testCase, summary, failures, elapsedMs };
}

(async () => {
  console.log(color(`\n  Compliance Agent eval — ${cases.length} case${cases.length === 1 ? '' : 's'}`, 'cyan'));
  console.log(color(`  Model: claude-sonnet-4-6 · Cases file: ${path.relative(ROOT, CASES_PATH)}\n`, 'dim'));

  const results = [];
  for (const testCase of cases) {
    process.stdout.write(`  ${color('▸', 'cyan')} ${color(testCase.id, 'cyan')} — ${testCase.name} `);
    try {
      const result = await runCase(testCase);
      results.push(result);
      const ms = result.elapsedMs;
      if (result.failures.length === 0) {
        process.stdout.write(`${color('✓', 'green')} ${color(`${ms}ms`, 'dim')}\n`);
        process.stdout.write(color(`      tools: ${result.summary.toolsCalled.join(' → ') || 'none'}\n`, 'dim'));
      } else {
        process.stdout.write(`${color('✗', 'red')} ${color(`${ms}ms`, 'dim')}\n`);
        for (const failure of result.failures) {
          process.stdout.write(color(`      ✗ ${failure}\n`, 'red'));
        }
        process.stdout.write(color(`      tools called: ${result.summary.toolsCalled.join(' → ') || 'none'}\n`, 'dim'));
        process.stdout.write(color(`      stop reason: ${result.summary.stopReason}\n`, 'dim'));
        process.stdout.write(color(`      final text (first 240 chars): ${(result.summary.finalText || '<empty>').slice(0, 240)}\n`, 'dim'));
        if (bail) break;
      }
    } catch (error) {
      results.push({ testCase, error: error.message, failures: [error.message] });
      process.stdout.write(`${color('✗', 'red')} ${color('error', 'red')}\n`);
      process.stdout.write(color(`      ${error.message}\n`, 'red'));
      if (bail) break;
    }
  }

  const passed = results.filter(r => !r.failures || r.failures.length === 0).length;
  const failed = results.length - passed;

  console.log('');
  if (failed === 0) {
    console.log(color(`  ✓ ${passed}/${results.length} cases passed.`, 'green'));
    process.exit(0);
  } else {
    console.log(color(`  ✗ ${failed}/${results.length} cases failed.`, 'red'));
    console.log(color(`  ✓ ${passed} passed.`, 'dim'));
    process.exit(1);
  }
})();
