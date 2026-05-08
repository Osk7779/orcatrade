// Agent locale-directive injection tests.

const test = require('node:test');
const assert = require('node:assert/strict');

const { applyLocaleDirective, pickLocale, DIRECTIVES } = require('../lib/agent-i18n');

const orchestrator = require('../lib/handlers/orchestrator');
const compliance = require('../lib/handlers/agent');
const sourcing = require('../lib/handlers/sourcing-agent');
const logistics = require('../lib/handlers/logistics-agent');
const finance = require('../lib/handlers/finance-agent');

// ── Locale picking ─────────────────────────────────────

test('pickLocale defaults to en for unknown / undefined / null', () => {
  assert.equal(pickLocale(undefined), 'en');
  assert.equal(pickLocale(null), 'en');
  assert.equal(pickLocale(''), 'en');
  assert.equal(pickLocale('fr'), 'en');
  assert.equal(pickLocale('xx'), 'en');
});

test('pickLocale passes through valid locales', () => {
  for (const lang of ['en', 'pl', 'de']) {
    assert.equal(pickLocale(lang), lang);
  }
});

// ── Directive shape ────────────────────────────────────

test('en directive is empty (no-op)', () => {
  assert.equal(DIRECTIVES.en, '');
});

test('pl directive instructs reply in Polish + Polish currency formatting', () => {
  assert.match(DIRECTIVES.pl, /Reply in Polish/i);
  assert.match(DIRECTIVES.pl, /€179 100/);
});

test('de directive instructs reply in German Sie-form + German currency formatting', () => {
  assert.match(DIRECTIVES.de, /Reply in German/i);
  assert.match(DIRECTIVES.de, /Sie-form/i);
  assert.match(DIRECTIVES.de, /€179\.100/);
});

// ── applyLocaleDirective ───────────────────────────────

test('applyLocaleDirective is a no-op for en', () => {
  const result = applyLocaleDirective('SYSTEM', 'en');
  assert.equal(result, 'SYSTEM');
});

test('applyLocaleDirective appends pl directive for pl', () => {
  const result = applyLocaleDirective('SYSTEM', 'pl');
  assert.ok(result.startsWith('SYSTEM'));
  assert.match(result, /Reply in Polish/);
});

test('applyLocaleDirective appends de directive for de', () => {
  const result = applyLocaleDirective('SYSTEM', 'de');
  assert.ok(result.startsWith('SYSTEM'));
  assert.match(result, /Reply in German/);
});

test('applyLocaleDirective falls back to en for unknown locale', () => {
  const result = applyLocaleDirective('SYSTEM', 'unknown');
  assert.equal(result, 'SYSTEM');
});

// ── Each agent exports a SYSTEM_PROMPT ────────────────

test('each agent handler exports SYSTEM_PROMPT (non-empty string)', () => {
  for (const [name, mod] of [
    ['orchestrator', orchestrator],
    ['compliance', compliance],
    ['sourcing', sourcing],
    ['logistics', logistics],
    ['finance', finance],
  ]) {
    assert.ok(mod.SYSTEM_PROMPT, `${name} exports SYSTEM_PROMPT`);
    assert.equal(typeof mod.SYSTEM_PROMPT, 'string');
    assert.ok(mod.SYSTEM_PROMPT.length > 100, `${name} system prompt non-trivial`);
  }
});

test('applyLocaleDirective prepends original system prompt then directive', () => {
  const longPrompt = compliance.SYSTEM_PROMPT;
  const withPl = applyLocaleDirective(longPrompt, 'pl');
  // Directive comes AFTER the original prompt
  assert.ok(withPl.startsWith(longPrompt));
  assert.ok(withPl.endsWith(DIRECTIVES.pl));
});

// ── Localised page generation ─────────────────────────

test('localised agent pages exist on disk', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const root = path.join(__dirname, '..');
  for (const locale of ['pl', 'de']) {
    for (const agentDir of ['orchestrator', 'sourcing', 'logistics', 'finance']) {
      const file = path.join(root, locale, 'agent', agentDir, 'index.html');
      assert.ok(fs.existsSync(file), `${file} exists`);
    }
    // compliance lives at /<locale>/agent/index.html
    const complianceFile = path.join(root, locale, 'agent', 'index.html');
    assert.ok(fs.existsSync(complianceFile), `${complianceFile} exists`);
  }
});

test('PL orchestrator page contains Polish chrome and window.LOCALE=pl', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const html = fs.readFileSync(path.join(__dirname, '..', 'pl/agent/orchestrator/index.html'), 'utf8');
  assert.match(html, /<html lang="pl">/);
  assert.match(html, /window\.LOCALE='pl'/);
  assert.match(html, /Jeden agent, <em>każda specjalność<\/em>/);
  assert.match(html, /src="\/agent\/orchestrator\/app\.js"/);
});

test('DE compliance page contains German chrome and window.LOCALE=de', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const html = fs.readFileSync(path.join(__dirname, '..', 'de/agent/index.html'), 'utf8');
  assert.match(html, /<html lang="de">/);
  assert.match(html, /window\.LOCALE='de'/);
  assert.match(html, /Compliance-Spezialisten/);
});
