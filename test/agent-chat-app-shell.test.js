'use strict';

// Apex Stage 3 — agent chat in-app surface.
//
// The new /account/agent/ page is the enterprise demo: streams the
// orchestrator's SSE response and shows every tool call inline so
// a customer reviewing the conversation can see exactly which
// calculator the orchestrator invoked for every number it quoted
// — the calculator-grounded discipline made visible.
//
// This is a markup-contract test only: there's no server-side
// runtime to exercise (the page consumes the existing
// /api/orchestrator SSE endpoint). The test pins the load-bearing
// surface so a future stylesheet refactor or rename can't silently
// break the demo flow.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

const HTML = read('account/agent/index.html');
const JS = read('account/agent/app.js');
const ACCOUNT_INDEX = read('account/index.html');

// ── page exists + auth-gated entry point ───────────────────────────

test('account/agent/index.html exists with the documented title', () => {
  assert.match(HTML, /<title>Operations Orchestrator \| OrcaTrade<\/title>/);
});

test('the page is noindex,nofollow (an authenticated surface)', () => {
  assert.match(HTML, /<meta name="robots" content="noindex, nofollow"/);
});

test('the page renders an auth-needed panel that links to /account/?next=/account/agent/', () => {
  // If /api/auth/me returns 401, the page must surface a sign-in
  // CTA that round-trips back to the agent surface. The `next`
  // query param is the existing /account/ behaviour — pin it.
  assert.match(HTML, /id="agent-auth-needed"/);
  assert.match(HTML, /href="\/account\/\?next=\/account\/agent\/"/);
});

test('the page loads the client app.js + has the composer form', () => {
  assert.match(HTML, /<script src="\/account\/agent\/app\.js">/);
  assert.match(HTML, /id="agent-form"/);
  assert.match(HTML, /id="agent-input"/);
  assert.match(HTML, /id="agent-submit"/);
});

test('the empty state offers at least 3 starter examples (cross-domain to showcase orchestrator routing)', () => {
  const examples = HTML.match(/data-example="[^"]+"/g) || [];
  assert.ok(examples.length >= 3, `expected ≥3 example prompts; got ${examples.length}`);
  // Each example should touch a different domain pair so the
  // orchestrator's routing surface is obvious to a first-time user.
  const exampleText = examples.join(' ');
  assert.match(exampleText, /CBAM|anti-dumping/i);
  assert.match(exampleText, /preferential|EVFTA|EUKFTA/i);
  assert.match(exampleText, /working capital|payment terms|CCC/i);
});

// ── app.js: SSE event handling ─────────────────────────────────────

test('app.js POSTs to /api/orchestrator with credentials + JSON body', () => {
  assert.match(JS, /fetch\(['"]\/api\/orchestrator['"][\s\S]{0,400}method:\s*['"]POST['"][\s\S]{0,400}credentials:\s*['"]same-origin['"]/);
  assert.match(JS, /Content-Type[\s\S]{0,40}application\/json/);
});

test('app.js handles every SSE event type the orchestrator emits', () => {
  // Pin the contract: thinking, text-delta, tool-call, tool-result,
  // final, error, done. Drift on either side surfaces here, not in
  // a half-rendered conversation.
  for (const evt of ['thinking', 'text-delta', 'tool-call', 'tool-result', 'final', 'error', 'done']) {
    assert.ok(
      JS.includes("'" + evt + "'"),
      `app.js must handle SSE event type '${evt}'`,
    );
  }
});

test('app.js handles the documented HTTP error codes from /api/orchestrator', () => {
  // 401 → sign-in CTA; 402/403 → tier-gate copy; 429 → rate-limit
  // message. Generic non-2xx → "Request failed". Pin the gates so
  // a future rename in the orchestrator handler surfaces here.
  for (const code of ['401', '402', '403', '429']) {
    assert.ok(JS.includes(code), `app.js must handle HTTP ${code}`);
  }
  assert.match(JS, /tier|upgrade/i);
  assert.match(JS, /Rate limit|rate-limit/i);
});

test('app.js renders [chunk-id] citations as pill spans', () => {
  // The calculator-grounded discipline depends on visible
  // citations in the transcript. Drop the regex → drop the
  // visible trust artefact.
  assert.match(JS, /renderTextWithCitations/);
  assert.match(JS, /class="citation"/);
  // The regex anchor for the citation pattern.
  assert.match(JS, /\\\[\(\[a-z0-9\]\[a-z0-9-\]\{1,80\}\)\\\]/);
});

test('app.js renders the live tool-call trace per turn', () => {
  // The single load-bearing enterprise-trust surface — without
  // this the page is just any chat UI. JS sets className via
  // `tc.className = 'tool-call'`; HTML/CSS declares the matching
  // selector. Pin both sides.
  assert.match(JS, /renderToolCall/);
  assert.match(JS, /className\s*=\s*['"]tool-call['"]/);
  assert.match(JS, /tc-name/);
  assert.match(JS, /Tool calls \(live\)/);
});

test('app.js trims the message history to the last 12 turns (matches server)', () => {
  // The orchestrator handler trims to .slice(-12) server-side.
  // Sending more would be silently truncated; we trim client-side
  // too so the request payload doesn't grow unbounded across a
  // long conversation.
  assert.match(JS, /messages\.slice\(-12\)/);
});

test('app.js bootstraps off /api/auth/me to decide auth-needed vs loaded', () => {
  assert.match(JS, /fetch\(['"]\/api\/auth\/me['"]/);
  assert.match(JS, /401[\s\S]{0,200}showAuthNeeded/);
});

// ── account/ index promotes the new surface ─────────────────────

test('account/ home page links to /account/agent/ in Quick links', () => {
  // The demo lives or dies by being discoverable. Pin the entry
  // point so a future quick-links refactor that drops it fails
  // CI.
  assert.match(ACCOUNT_INDEX, /href="\/account\/agent\/"[\s\S]{0,400}Operations Orchestrator/);
});

test('the account home links calls out the Growth-tier requirement', () => {
  // The orchestrator endpoint is feature-gated (Growth+ per
  // gating.checkFeature). The link should set the expectation
  // before a free-tier user clicks through and hits a 403.
  assert.match(
    ACCOUNT_INDEX,
    /href="\/account\/agent\/"[\s\S]{0,400}Growth/,
    'the link to /account/agent/ must call out the Growth tier',
  );
});

// ── CSS hook coverage ──────────────────────────────────────────────
//
// app.js depends on these class names; pinning them prevents a
// stylesheet refactor from rendering the page styleless.

const REQUIRED_CSS_CLASSES = [
  '.agent-shell',
  '.transcript',
  '.turn',
  '.turn .role',
  '.turn .body',
  '.citation',
  '.trace',
  '.tool-call',
  '.tc-name',
  '.tc-args',
  '.status-pill',
  '.composer',
  '.auth-needed',
  '.empty',
];

for (const cls of REQUIRED_CSS_CLASSES) {
  test(`account/agent/index.html declares ${cls} styles`, () => {
    assert.ok(
      HTML.includes(cls),
      `account/agent/index.html must declare ${cls} — app.js uses it`,
    );
  });
}
