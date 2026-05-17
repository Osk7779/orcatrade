// Tests for lib/ai/cost-telemetry.js — Sprint BG-6.4.
//
// Cost math has to be deterministic + reproducible offline so that:
//   1. CI catches a price-table drift the moment it ships
//   2. The eval harness can include cost-per-case as a regression metric
//   3. Margin calculations downstream don't depend on hitting the live API
//
// The withCostTelemetry wrapper is exercised against a fake Anthropic
// response to prove the log shape end-to-end.

const test = require('node:test');
const assert = require('node:assert/strict');

const telemetry = require('../lib/ai/cost-telemetry');

// ── priceFor + MODEL_PRICING_CENTS_PER_MILLION_TOKENS ────────

test('priceFor returns Sonnet 4.6/4.7 rates for known models', () => {
  const p = telemetry.priceFor('claude-sonnet-4-6');
  assert.equal(p.input, 278);
  assert.equal(p.output, 1389);
  assert.equal(p.cacheRead, 28);
  // Identical pricing for 4.7
  assert.deepEqual(telemetry.priceFor('claude-sonnet-4-7'), p);
});

test('priceFor falls back to Sonnet rates for unknown model', () => {
  const p = telemetry.priceFor('claude-totally-new');
  assert.equal(p.input, telemetry.FALLBACK_PRICING.input);
});

test('Opus 4.x pricing is roughly 5× Sonnet for input/output', () => {
  const sonnet = telemetry.priceFor('claude-sonnet-4-7');
  const opus = telemetry.priceFor('claude-opus-4-7');
  assert.ok(Math.abs(opus.input / sonnet.input - 5) < 0.05, `opus/sonnet input ratio: ${opus.input / sonnet.input}`);
  assert.ok(Math.abs(opus.output / sonnet.output - 5) < 0.05, `opus/sonnet output ratio: ${opus.output / sonnet.output}`);
});

test('Haiku 4.5 pricing is about 1/4 of Sonnet', () => {
  const sonnet = telemetry.priceFor('claude-sonnet-4-7');
  const haiku = telemetry.priceFor('claude-haiku-4-5');
  assert.ok(haiku.input < sonnet.input);
  assert.ok(haiku.output < sonnet.output);
  // Roughly 1/4 — give it a 10% tolerance for any rounding.
  assert.ok(Math.abs(haiku.input / sonnet.input - 0.25) < 0.05);
});

// ── computeCost (pure function) ─────────────────────────────

test('computeCost: empty usage → 0', () => {
  assert.equal(telemetry.computeCost('claude-sonnet-4-7', null), 0);
  assert.equal(telemetry.computeCost('claude-sonnet-4-7', {}), 0);
});

test('computeCost: Sonnet 4.7 1M input + 0 output = exactly 278 cents', () => {
  const cost = telemetry.computeCost('claude-sonnet-4-7', {
    input_tokens: 1_000_000, output_tokens: 0,
  });
  assert.equal(cost, 278);
});

test('computeCost: Sonnet 4.7 1M output + 0 input = exactly 1389 cents', () => {
  const cost = telemetry.computeCost('claude-sonnet-4-7', {
    input_tokens: 0, output_tokens: 1_000_000,
  });
  assert.equal(cost, 1389);
});

test('computeCost: typical agent call (5000 in + 2000 out + 500 cached) = small cents', () => {
  const cost = telemetry.computeCost('claude-sonnet-4-7', {
    input_tokens: 5000, output_tokens: 2000, cache_read_input_tokens: 500,
  });
  // billableInput = 5000 - 500 = 4500
  // 4500 × 278/1e6 = 1.251 cents
  // 2000 × 1389/1e6 = 2.778 cents
  // 500 × 28/1e6   = 0.014 cents
  // Total = 4.043 → halfEven round to 4 cents
  assert.equal(cost, 4);
});

test('computeCost: cache reads are billed at the cheaper cacheRead rate, not input', () => {
  // Same total token count, one with cache hits, one without.
  const withoutCache = telemetry.computeCost('claude-sonnet-4-7', {
    input_tokens: 100_000, output_tokens: 0,
  });
  const withCache = telemetry.computeCost('claude-sonnet-4-7', {
    input_tokens: 100_000, output_tokens: 0, cache_read_input_tokens: 100_000,
  });
  assert.ok(withCache < withoutCache, 'cache reads must be cheaper than uncached input');
  // 100k input × 278/1e6 = 27.8 cents (no cache)
  // 100k cacheRead × 28/1e6 = 2.8 cents (full cache hit)
  assert.equal(withoutCache, 28);
  assert.equal(withCache, 3);
});

test('computeCost: large-shipment scenario (100k in, 30k out, no cache) = roughly 70 cents', () => {
  const cost = telemetry.computeCost('claude-sonnet-4-7', {
    input_tokens: 100_000, output_tokens: 30_000,
  });
  // 100000 × 278/1e6 = 27.8
  // 30000  × 1389/1e6 = 41.67
  // Total ≈ 69.47 → 69 cents
  assert.equal(cost, 69);
});

test('computeCost: Opus is materially more expensive than Sonnet for the same usage', () => {
  const usage = { input_tokens: 10_000, output_tokens: 5_000 };
  const sonnet = telemetry.computeCost('claude-sonnet-4-7', usage);
  const opus = telemetry.computeCost('claude-opus-4-7', usage);
  assert.ok(opus > sonnet * 4, `expected Opus ≥4× Sonnet; got Opus=${opus} vs Sonnet=${sonnet}`);
});

test('computeCost: never negative when cache reads > input (defensive)', () => {
  const cost = telemetry.computeCost('claude-sonnet-4-7', {
    input_tokens: 100, output_tokens: 0, cache_read_input_tokens: 99999,
  });
  // billableInput = max(0, 100 - 99999) = 0
  // cache 99999 × 28/1e6 = ~2.8 → 3 cents
  assert.ok(cost >= 0, 'cost cannot be negative');
});

// ── summariseTokens ─────────────────────────────────────────

test('summariseTokens extracts the three fields from response.usage', () => {
  const t = telemetry.summariseTokens({
    input_tokens: 1234, output_tokens: 567, cache_read_input_tokens: 89,
  });
  assert.deepEqual(t, { inputTokens: 1234, outputTokens: 567, cacheReadTokens: 89 });
});

test('summariseTokens handles missing usage gracefully', () => {
  assert.deepEqual(telemetry.summariseTokens(null), { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 });
  assert.deepEqual(telemetry.summariseTokens({}), { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 });
});

// ── withCostTelemetry (end-to-end with capture) ─────────────

function captureConsole(fn) {
  const out = [];
  const origLog = console.log;
  console.log = (line) => out.push(line);
  return Promise.resolve(fn()).finally(() => { console.log = origLog; }).then(v => ({ v, out }));
}

test('withCostTelemetry wraps a successful call and logs the structured row', async () => {
  // Force log level to info so the call line emits.
  const prev = process.env.ORCATRADE_LOG_LEVEL;
  process.env.ORCATRADE_LOG_LEVEL = 'info';
  try {
    const { v, out } = await captureConsole(() => telemetry.withCostTelemetry(
      { agent: 'orchestrator', promptVersion: 'v1', promptHash: 'abc123def456', model: 'claude-sonnet-4-7', requestId: 'rid' },
      async () => ({ usage: { input_tokens: 5000, output_tokens: 2000 }, stop_reason: 'end_turn' })
    ));
    assert.ok(v && v.usage, 'response passed through');
    // The structured log line carries the expected fields.
    const logLine = out.find(l => l.includes('"event":"ai_call"'));
    assert.ok(logLine, `expected ai_call log line; got: ${out.join('\n')}`);
    const parsed = JSON.parse(logLine);
    assert.equal(parsed.agent, 'orchestrator');
    assert.equal(parsed.promptVersion, 'v1');
    assert.equal(parsed.model, 'claude-sonnet-4-7');
    assert.equal(parsed.inputTokens, 5000);
    assert.equal(parsed.outputTokens, 2000);
    assert.equal(parsed.stopReason, 'end_turn');
    assert.ok(Number.isFinite(parsed.costCents) && parsed.costCents > 0);
    assert.ok(Number.isFinite(parsed.latencyMs) && parsed.latencyMs >= 0);
  } finally {
    process.env.ORCATRADE_LOG_LEVEL = prev;
  }
});

test('withCostTelemetry: an error in the wrapped call is re-thrown but still logged at warn', async () => {
  const prev = process.env.ORCATRADE_LOG_LEVEL;
  process.env.ORCATRADE_LOG_LEVEL = 'info';
  const warnOut = [];
  const origWarn = console.warn;
  console.warn = (line) => warnOut.push(line);
  try {
    await assert.rejects(
      telemetry.withCostTelemetry(
        { agent: 'orchestrator', model: 'claude-sonnet-4-7' },
        async () => { throw new Error('Anthropic 503'); }
      ),
      /Anthropic 503/
    );
    const failLine = warnOut.find(l => l.includes('anthropic call failed'));
    assert.ok(failLine, 'failure was logged');
    const parsed = JSON.parse(failLine);
    assert.equal(parsed.agent, 'orchestrator');
    assert.equal(parsed.model, 'claude-sonnet-4-7');
    assert.match(parsed.err, /Anthropic 503/);
  } finally {
    console.warn = origWarn;
    process.env.ORCATRADE_LOG_LEVEL = prev;
  }
});

// ── recordAnthropicCall handles malformed response gracefully ─

test('recordAnthropicCall never throws on a malformed response', () => {
  // No usage object at all → 0 cost, still logs.
  assert.doesNotThrow(() => telemetry.recordAnthropicCall({
    agent: 'orchestrator', model: 'claude-sonnet-4-7',
    response: null, latencyMs: 100,
  }));
  assert.doesNotThrow(() => telemetry.recordAnthropicCall({
    agent: 'orchestrator', model: 'claude-sonnet-4-7',
    response: {}, latencyMs: 100,
  }));
});
