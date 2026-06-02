// AI prompt content sanitization.
//
// lib/ai/prompts/<agent>/v*.txt files ship VERBATIM to two destinations:
//   1. Anthropic — every agent request sends the system prompt
//   2. Every reader of this public repo
//
// A secret slipped into a prompt leaks in both directions at once. A real
// customer email used as an example burns that user's address into both
// the AI provider's logs and the GitHub mirror.
//
// This test scans every shipped prompt file for sensitive tokens. It is
// pure-pattern matching — false negatives are possible (a novel secret
// format won't match), but the common slip-ups are blocked: provider
// API keys, AWS access keys, JWTs, Stripe keys, private-key PEM
// headers, Slack tokens, postgres URLs with embedded credentials, and
// emails outside the documented allowlist of example domains.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const PROMPTS_DIR = path.join(ROOT, 'lib', 'ai', 'prompts');

function listPromptFiles() {
  const out = [];
  for (const agent of fs.readdirSync(PROMPTS_DIR, { withFileTypes: true })) {
    if (!agent.isDirectory()) continue;
    const agentDir = path.join(PROMPTS_DIR, agent.name);
    for (const f of fs.readdirSync(agentDir)) {
      if (f.endsWith('.txt')) out.push(path.join(agentDir, f));
    }
  }
  return out.sort();
}

// ── Secret-class detectors ───────────────────────────────────
//
// Each name is what shows up in the failure message. Patterns deliberately
// err on the side of false positives — a real secret in a prompt is so
// much worse than a doc rewrite that the asymmetric cost favours noise.

const SECRET_PATTERNS = Object.freeze([
  // Anthropic / OpenAI / Google generative AI keys.
  { name: 'Anthropic API key',  re: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: 'OpenAI API key',     re: /\bsk-(?!ant-)[A-Za-z0-9]{20,}/ },
  { name: 'Google API key',     re: /\bAIza[0-9A-Za-z_-]{35}/ },
  // Cloud provider access keys.
  { name: 'AWS access key',     re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'AWS secret key',     re: /\b(?:aws_secret_access_key|AWS_SECRET)[\s:=]+[A-Za-z0-9/+]{40}/i },
  // Payment provider.
  { name: 'Stripe live key',    re: /\b(?:sk|pk|rk)_live_[A-Za-z0-9]{20,}/ },
  // Auth tokens.
  { name: 'JWT-shaped token',   re: /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/ },
  { name: 'Slack token',        re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/ },
  { name: 'GitHub PAT',         re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}/ },
  // Cryptographic material.
  { name: 'Private key PEM',    re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/ },
  // DB URLs with embedded credentials.
  { name: 'Postgres URL w/ creds',
    re: /\bpostgres(?:ql)?:\/\/[^\s/]+:[^@\s]+@/ },
  { name: 'Mongo URL w/ creds',
    re: /\bmongodb(?:\+srv)?:\/\/[^\s/]+:[^@\s]+@/ },
  { name: 'Generic URL w/ creds',
    re: /\bhttps?:\/\/[^\s/]+:[^@\s/]+@[^\s]+/ },
]);

// Email allowlist — domains conventionally used in docs / examples
// without being real customer addresses. Anything outside this list
// that appears in a prompt is flagged.
const ALLOWED_EMAIL_DOMAINS = Object.freeze([
  'example.com', 'example.org', 'example.net',
  'test.com',
  'orcatrade.pl',           // our own corporate domain (publicly known)
  'orcatradegroup.com',     // ditto
  'anonymised.local',       // GDPR pseudonymisation suffix (per ADR 0008)
  'localhost',
]);

// Simple email matcher — RFC-5322 is overkill, and we want false-
// positive-leaning matches so a typo'd domain still gets caught.
const EMAIL_RE = /\b[a-zA-Z0-9._%+-]+@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/g;

function findEmails(text) {
  const out = [];
  EMAIL_RE.lastIndex = 0;
  let m;
  while ((m = EMAIL_RE.exec(text)) !== null) {
    out.push({ full: m[0], domain: m[1].toLowerCase() });
  }
  return out;
}

test('every shipped prompt file is scanned (discovery sanity)', () => {
  const files = listPromptFiles();
  assert.ok(files.length >= 5,
    `Expected ≥5 prompt files under lib/ai/prompts/, found ${files.length}. ` +
    'If you renamed the layout, update listPromptFiles().');
  // Pin the five known agents — a rename should fail loudly here, not
  // silently scan partial coverage.
  const agents = new Set(files.map(f => path.basename(path.dirname(f))));
  for (const expected of ['compliance', 'finance', 'logistics', 'orchestrator', 'sourcing']) {
    assert.ok(agents.has(expected), `prompts for "${expected}" agent must be discovered`);
  }
});

test('no prompt file contains a secret-class token', () => {
  const offenders = [];
  for (const file of listPromptFiles()) {
    const rel = path.relative(ROOT, file);
    const src = fs.readFileSync(file, 'utf8');
    for (const pat of SECRET_PATTERNS) {
      const m = src.match(pat.re);
      if (m) {
        // Surface the file + pattern name + first 40 chars of the match
        // so the developer can locate it. Truncate so the test output
        // doesn't itself leak the full secret to logs.
        const preview = m[0].slice(0, 40);
        offenders.push(`${rel}: ${pat.name} → ${preview}…`);
      }
    }
  }
  assert.deepEqual(offenders, [],
    `Secret-class tokens found in shipped prompt files:\n  ${offenders.join('\n  ')}\n\n` +
    'These files ship VERBATIM to both Anthropic (every agent request) and every reader of the public repo. ' +
    'A secret here leaks in both directions at once. ROTATE the credential ' +
    '(assume compromised) before removing it from the file.');
});

test('no prompt file contains an email outside the allowed example domains', () => {
  const allowed = new Set(ALLOWED_EMAIL_DOMAINS);
  const offenders = [];
  for (const file of listPromptFiles()) {
    const rel = path.relative(ROOT, file);
    const src = fs.readFileSync(file, 'utf8');
    for (const e of findEmails(src)) {
      if (!allowed.has(e.domain)) {
        offenders.push(`${rel}: ${e.full} (domain "${e.domain}" not in ALLOWED_EMAIL_DOMAINS)`);
      }
    }
  }
  assert.deepEqual(offenders, [],
    `Real-looking emails found in prompt files:\n  ${offenders.join('\n  ')}\n\n` +
    'Use example.com / example.org for illustrative addresses. If a customer/contact email is ' +
    'legitimately needed (rare), add the domain to ALLOWED_EMAIL_DOMAINS in this test with a ' +
    'justification comment, in the same commit.');
});

test('pattern detectors actually work (defensive — no silent stripping)', () => {
  // Synthetic strings the patterns SHOULD catch. Built via string concat
  // + repeat() so GitHub's push-protection scanner doesn't see literal
  // secret-shaped tokens in the source (the irony of being blocked by
  // exactly the kind of scanner this test complements is real — the
  // fakes are constructed, not pasted).
  const A20 = 'a'.repeat(20);
  const A40 = 'a'.repeat(40);
  const A30 = 'a'.repeat(30);
  const fakes = {
    'Anthropic API key':       'sk-' + 'ant-' + 'api03-' + 'A'.repeat(24),
    'AWS access key':          'AKIA' + 'IOSFODNN7EXAMPLE',  // canonical AWS doc example
    'Stripe live key':         'sk_' + 'live_' + A20,
    'JWT-shaped token':        'eyJ' + A20 + '.eyJ' + A20 + '.' + A20,
    'Private key PEM':         '-----' + 'BEGIN RSA PRIVATE KEY-----',
    'Postgres URL w/ creds':   'postgres' + '://user:pw@db.example.com:5432/orca',
    'GitHub PAT':              'ghp_' + A30,
    'Slack token':             'xoxb-' + A20,
    'Google API key':          'AIza' + 'a'.repeat(35),
  };
  void A40;  // reserved if a future pattern needs 40 chars
  for (const [name, fake] of Object.entries(fakes)) {
    const pat = SECRET_PATTERNS.find(p => p.name === name);
    assert.ok(pat, `Pattern "${name}" must exist`);
    assert.match(fake, pat.re, `Pattern "${name}" must match the synthetic fake`);
  }
});

test('allowed example domains do NOT trigger the email check', () => {
  // Defensive: if the allowlist set construction breaks, every example
  // email in our docs would suddenly fail. Pin it.
  const allowed = new Set(ALLOWED_EMAIL_DOMAINS);
  for (const dom of ['example.com', 'orcatrade.pl', 'anonymised.local']) {
    assert.ok(allowed.has(dom), `${dom} must remain in ALLOWED_EMAIL_DOMAINS`);
  }
});
