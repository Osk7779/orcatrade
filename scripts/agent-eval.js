#!/usr/bin/env node
// AI agent eval harness (Sprint BG-6.2 phase 2).
//
// Runs cases against the live agent handlers and asserts:
//   1. Legacy expectations: tool calls, citations, escalation, stop reason
//   2. New-shape patterns:  mustContain / mustNotContain regex or substring
//   3. Optional calc-grounding: every monetary/percent/weight number in the
//      final response must trace to a calculator output (Sprint BG-6.3).
//
// Two case-file sources are supported (auto-detected):
//   - lib/ai/evals/<agent>/cases.v1.json  (new tree, all 5 agents)
//   - test/agent-eval-cases.json          (legacy, compliance only)
//
// Usage:
//   ANTHROPIC_API_KEY=sk-ant-… node scripts/agent-eval.js                # compliance, all cases
//   ANTHROPIC_API_KEY=sk-ant-… node scripts/agent-eval.js --agent orchestrator
//   ANTHROPIC_API_KEY=sk-ant-… node scripts/agent-eval.js --agent sourcing --bail
//   ANTHROPIC_API_KEY=sk-ant-… node scripts/agent-eval.js cbam-steel-china   # single case (any agent)
//   node scripts/agent-eval.js --list-cases --agent orchestrator         # NO API key required
//
// Exit code: 0 if every case passes, 1 if any fail.

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LEGACY_CASES_PATH = path.join(ROOT, 'test', 'agent-eval-cases.json');

// Agent → handler path. Compliance is api/agent.js (Sprint-12-vintage location).
// Everything else lives under lib/handlers/.
const AGENT_HANDLERS = {
  compliance:   path.join(ROOT, 'api', 'agent.js'),
  orchestrator: path.join(ROOT, 'lib', 'handlers', 'orchestrator.js'),
  sourcing:     path.join(ROOT, 'lib', 'handlers', 'sourcing-agent.js'),
  logistics:    path.join(ROOT, 'lib', 'handlers', 'logistics-agent.js'),
  finance:      path.join(ROOT, 'lib', 'handlers', 'finance-agent.js'),
};

const COLOR = {
  reset: '\x1b[0m', red: '\x1b[31m', green: '\x1b[32m',
  yellow: '\x1b[33m', cyan: '\x1b[36m', dim: '\x1b[2m',
};

function color(text, c) {
  if (!process.stdout.isTTY) return String(text);
  return `${COLOR[c] || ''}${text}${COLOR.reset}`;
}

// ── CLI parsing ───────────────────────────────────────────────

function parseArgs(argv) {
  const opts = {
    agent: 'compliance',
    bail: false,
    listCases: false,
    requireGrounding: false,
    onlyId: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--bail') opts.bail = true;
    else if (a === '--list-cases') opts.listCases = true;
    else if (a === '--require-grounding') opts.requireGrounding = true;
    else if (a === '--agent') { opts.agent = String(argv[++i] || ''); }
    else if (a.startsWith('--agent=')) opts.agent = a.slice('--agent='.length);
    else if (a.startsWith('--')) {
      console.error(color(`Unknown flag: ${a}`, 'red'));
      process.exit(2);
    } else if (!opts.onlyId) opts.onlyId = a;
  }
  if (!AGENT_HANDLERS[opts.agent]) {
    console.error(color(`Unknown agent "${opts.agent}". Available: ${Object.keys(AGENT_HANDLERS).join(', ')}`, 'red'));
    process.exit(2);
  }
  return opts;
}

// ── Case loading + normalisation ──────────────────────────────

// Cases come from two shapes. Normalise to:
//   { id, name, messages, promptVersion, expectations, mustContain, mustNotContain }
function normaliseLegacyCase(c) {
  return {
    id: c.id,
    name: c.name || c.id,
    messages: c.messages || [],
    promptVersion: c.promptVersion || null,
    expectations: c.expectations || {},
    mustContain: [],
    mustNotContain: [],
    expectedTools: (c.expectations && c.expectations.mustCallTools) || [],
  };
}

function normaliseNewShapeCase(c) {
  // New tree uses { input: '<single user message>' }
  const messages = Array.isArray(c.messages)
    ? c.messages
    : (c.input ? [{ role: 'user', content: String(c.input) }] : []);
  return {
    id: c.id,
    name: c.name || c.id,
    messages,
    promptVersion: c.promptVersion || null,
    expectations: c.expectations || {},
    mustContain: c.mustContain || [],
    mustNotContain: c.mustNotContain || [],
    expectedTools: c.expectedTools || [],
  };
}

function loadCases(agent) {
  // Prefer the new tree; fall back to the legacy file for compliance.
  const newTreePath = path.join(ROOT, 'lib', 'ai', 'evals', agent, 'cases.v1.json');
  if (fs.existsSync(newTreePath)) {
    const fixtures = JSON.parse(fs.readFileSync(newTreePath, 'utf8'));
    return {
      source: path.relative(ROOT, newTreePath),
      cases: (fixtures.cases || []).map(normaliseNewShapeCase),
    };
  }
  if (agent === 'compliance' && fs.existsSync(LEGACY_CASES_PATH)) {
    const fixtures = JSON.parse(fs.readFileSync(LEGACY_CASES_PATH, 'utf8'));
    return {
      source: path.relative(ROOT, LEGACY_CASES_PATH),
      cases: (fixtures.cases || []).map(normaliseLegacyCase),
    };
  }
  return { source: null, cases: [] };
}

// ── Mock req/res for SSE capture ──────────────────────────────

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
  const toolsCalled = events.filter(e => e.type === 'tool-call').map(e => e.name);
  const toolsSucceeded = events.filter(e => e.type === 'tool-result' && e.ok).length;
  const toolsFailed = events.filter(e => e.type === 'tool-result' && !e.ok).length;
  const finalEvent = events.find(e => e.type === 'final') || {};
  const finalText = finalEvent.text || '';
  const stopReason = finalEvent.stopReason || 'unknown';
  const errors = events.filter(e => e.type === 'error');
  return { toolsCalled, toolsSucceeded, toolsFailed, finalText, stopReason, errors };
}

// ── Assertions ────────────────────────────────────────────────

// Legacy assertions on the rich expectations shape (compliance).
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

// New-shape assertions via the scorer (mustContain / mustNotContain).
// Optional calc-grounding when --require-grounding is set.
function applyScorer(testCase, summary, opts) {
  if ((testCase.mustContain || []).length === 0 && (testCase.mustNotContain || []).length === 0) {
    return [];
  }
  const scorer = require(path.join(ROOT, 'lib', 'ai', 'evals', 'scorer'));
  const result = scorer.score(testCase, summary.finalText, opts);
  return result.failures.map(f => {
    if (f.kind === 'missing') return `mustContain "${f.pattern}" not found in final text`;
    if (f.kind === 'forbidden') return `mustNotContain "${f.pattern}" appeared in final text`;
    if (f.kind === 'ungrounded') return `ungrounded ${f.numKind} "${f.token}" — value ${f.value} doesn't trace to a calculator output`;
    return JSON.stringify(f);
  });
}

// ── Case runner ───────────────────────────────────────────────

async function runCase(testCase, handler, opts = {}) {
  const startedAt = Date.now();
  const { req, res, events } = makeMockReqRes({ messages: testCase.messages });
  await handler(req, res);
  const elapsedMs = Date.now() - startedAt;
  const summary = summariseEvents(events);

  // Combine legacy + new-shape failures so the user sees ALL of them.
  // Don't bail between the two — they're complementary signals.
  const legacyFailures = assertExpectations(summary, testCase.expectations || {});
  const scorerFailures = applyScorer(testCase, summary, opts);
  const failures = [...legacyFailures, ...scorerFailures];

  return { testCase, summary, failures, elapsedMs };
}

// ── Entry point ───────────────────────────────────────────────

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const { source, cases: allCases } = loadCases(opts.agent);
  const cases = opts.onlyId ? allCases.filter(c => c.id === opts.onlyId) : allCases;

  if (opts.listCases) {
    console.log(color(`\n  Cases for ${opts.agent} (${source || '(none found)'})`, 'cyan'));
    if (!cases.length) {
      console.log(color('  No cases.', 'dim'));
      process.exit(2);
    }
    for (const c of cases) {
      console.log(`  ${c.id.padEnd(36)} ${color(c.name || '', 'dim')}`);
    }
    process.exit(0);
  }

  if (!(process.env.ANTHROPIC_API_KEY || process.env.ORCATRADE_OS_API)) {
    console.error(color('ANTHROPIC_API_KEY (or ORCATRADE_OS_API) required for the agent eval. Aborting.', 'red'));
    console.error(color('(For an offline view of which cases would run, pass --list-cases.)', 'dim'));
    process.exit(2);
  }

  if (!cases.length) {
    console.error(color(`No cases for agent "${opts.agent}"${opts.onlyId ? ` matching "${opts.onlyId}"` : ''}. Available: ${allCases.map(c => c.id).join(', ') || 'none'}`, 'red'));
    process.exit(2);
  }

  const handler = require(AGENT_HANDLERS[opts.agent]);
  console.log(color(`\n  ${opts.agent} agent eval — ${cases.length} case${cases.length === 1 ? '' : 's'}`, 'cyan'));
  console.log(color(`  Source: ${source}${opts.requireGrounding ? ' · calc-grounding ENFORCED' : ''}\n`, 'dim'));

  const results = [];
  for (const testCase of cases) {
    process.stdout.write(`  ${color('▸', 'cyan')} ${color(testCase.id, 'cyan')} — ${testCase.name} `);
    try {
      // Calc-grounding: pass a dummy empty allow-list for now. Phase 3 of this
      // sprint will collect tool outputs from the SSE stream and pass them
      // here, so the scorer can verify the LLM didn't hallucinate numbers.
      const scoreOpts = opts.requireGrounding ? { groundedNumbers: [] } : {};
      const result = await runCase(testCase, handler, scoreOpts);
      results.push(result);
      if (result.failures.length === 0) {
        process.stdout.write(`${color('✓', 'green')} ${color(`${result.elapsedMs}ms`, 'dim')}\n`);
        if (result.summary.toolsCalled.length) {
          process.stdout.write(color(`      tools: ${result.summary.toolsCalled.join(' → ')}\n`, 'dim'));
        }
      } else {
        process.stdout.write(`${color('✗', 'red')} ${color(`${result.elapsedMs}ms`, 'dim')}\n`);
        for (const f of result.failures) process.stdout.write(color(`      ✗ ${f}\n`, 'red'));
        process.stdout.write(color(`      tools: ${result.summary.toolsCalled.join(' → ') || 'none'}\n`, 'dim'));
        process.stdout.write(color(`      stop: ${result.summary.stopReason}\n`, 'dim'));
        process.stdout.write(color(`      text: ${(result.summary.finalText || '<empty>').slice(0, 240)}\n`, 'dim'));
        if (opts.bail) break;
      }
    } catch (error) {
      results.push({ testCase, error: error.message, failures: [error.message] });
      process.stdout.write(`${color('✗', 'red')} ${color('error', 'red')}\n`);
      process.stdout.write(color(`      ${error.message}\n`, 'red'));
      if (opts.bail) break;
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
}

// Expose internals for the test harness. main() only runs when this file
// is invoked directly (node scripts/agent-eval.js …).
module.exports = {
  AGENT_HANDLERS,
  parseArgs,
  loadCases,
  normaliseLegacyCase,
  normaliseNewShapeCase,
  makeMockReqRes,
  summariseEvents,
  assertExpectations,
  applyScorer,
  runCase,
};

if (require.main === module) {
  main().catch((err) => {
    console.error(color(`Fatal: ${err && err.stack ? err.stack : err}`, 'red'));
    process.exit(2);
  });
}
