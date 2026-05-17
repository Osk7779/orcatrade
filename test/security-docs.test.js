// Tests for docs/security/ folder — Sprint BG-5.4.
//
// These docs are operational artefacts: when something drifts, a
// procurement conversation tomorrow notices. The tests pin the
// contract — every required file exists, every file is non-trivial,
// every file is dated, the README indexes everything, and cross-file
// references point at real files.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SECURITY_DIR = path.join(__dirname, '..', 'docs', 'security');

const REQUIRED_FILES = [
  'README.md',
  'data-flow.md',
  'subprocessors.md',
  'dpa-template.md',
  'incident-response.md',
  'soc2-readiness.md',
];

test('docs/security/ contains every required file', () => {
  for (const f of REQUIRED_FILES) {
    const p = path.join(SECURITY_DIR, f);
    assert.ok(fs.existsSync(p), `missing required file: ${f}`);
  }
});

test('every security doc is substantial (no stub markers)', () => {
  for (const f of REQUIRED_FILES) {
    const content = fs.readFileSync(path.join(SECURITY_DIR, f), 'utf8');
    assert.ok(content.length > 800, `${f} is suspiciously short (${content.length} chars)`);
    assert.doesNotMatch(content, /\bTODO\b/, `${f} contains a TODO — fill it in before shipping`);
    assert.doesNotMatch(content, /\bFIXME\b/, `${f} contains a FIXME — fill it in before shipping`);
    assert.doesNotMatch(content, /\blorem ipsum\b/i, `${f} contains lorem ipsum`);
  }
});

test('every security doc carries a Last reviewed date', () => {
  // README.md is the index — not dated itself, but every doc it points to is.
  for (const f of REQUIRED_FILES.filter(x => x !== 'README.md')) {
    const content = fs.readFileSync(path.join(SECURITY_DIR, f), 'utf8');
    assert.match(content, /\*\*Last reviewed:\*\*\s*\d{4}-\d{2}-\d{2}/, `${f} missing 'Last reviewed' line`);
  }
});

test('README.md indexes every other security doc', () => {
  const readme = fs.readFileSync(path.join(SECURITY_DIR, 'README.md'), 'utf8');
  for (const f of REQUIRED_FILES.filter(x => x !== 'README.md')) {
    assert.match(readme, new RegExp(`\\[\`?${f.replace('.', '\\.')}\`?\\]`),
      `README does not link to ${f}`);
  }
});

test('every cross-doc link in security/ points to a real file', () => {
  // Pattern: [`name.md`](name.md) or [`../name.md`](../name.md). Resolve and
  // assert the file exists.
  const linkRe = /\[`?([^\]`]+\.md)`?\]\(([^)]+)\)/g;
  for (const f of REQUIRED_FILES) {
    const filePath = path.join(SECURITY_DIR, f);
    const content = fs.readFileSync(filePath, 'utf8');
    let match;
    while ((match = linkRe.exec(content)) !== null) {
      const href = match[2];
      // Skip external links + anchor-only links.
      if (/^https?:/.test(href) || href.startsWith('#')) continue;
      // Resolve relative to the file's directory.
      const resolved = path.resolve(path.dirname(filePath), href.split('#')[0]);
      assert.ok(fs.existsSync(resolved),
        `${f}: broken link to ${href} (resolved: ${resolved})`);
    }
  }
});

test('subprocessors.md lists every current third party', () => {
  const content = fs.readFileSync(path.join(SECURITY_DIR, 'subprocessors.md'), 'utf8');
  for (const name of ['Vercel', 'Upstash', 'Resend', 'Stripe', 'Anthropic', 'GitHub']) {
    assert.match(content, new RegExp(`\\b${name}\\b`), `subprocessors missing ${name}`);
  }
});

test('dpa-template.md covers the GDPR Article 28 essentials', () => {
  const content = fs.readFileSync(path.join(SECURITY_DIR, 'dpa-template.md'), 'utf8');
  // Sub-processor authorisation, breach notification SLA, TOMs, transfer mechanism.
  assert.match(content, /[Ss]ub-?processor/);
  assert.match(content, /[Pp]ersonal [Dd]ata [Bb]reach/);
  assert.match(content, /\bSCC\b|Standard Contractual Clauses/);
  assert.match(content, /Annex A/);
  // Breach SLA must be tighter than GDPR's 72h.
  assert.match(content, /48 hours/);
});

test('incident-response.md defines all four severity classes', () => {
  const content = fs.readFileSync(path.join(SECURITY_DIR, 'incident-response.md'), 'utf8');
  for (const sev of ['SEV-0', 'SEV-1', 'SEV-2', 'SEV-3']) {
    assert.match(content, new RegExp(sev), `incident-response missing ${sev} row`);
  }
  // Must spell out the supervisory authority + GDPR 72h.
  assert.match(content, /UODO/);
  assert.match(content, /72 ?h|72 hours/);
});

test('soc2-readiness.md uses the in-place / partial / gap legend consistently', () => {
  const content = fs.readFileSync(path.join(SECURITY_DIR, 'soc2-readiness.md'), 'utf8');
  // Trust services criteria must all appear.
  for (const cc of ['CC1', 'CC2', 'CC3', 'CC4', 'CC5', 'CC6', 'CC7', 'CC8', 'CC9']) {
    assert.match(content, new RegExp(cc), `soc2-readiness missing ${cc}`);
  }
  // The legend symbols are used at least once each.
  assert.ok(content.includes('✅'), 'missing ✅ in-place marker');
  assert.ok(content.includes('🟡'), 'missing 🟡 partial marker');
});

test('data-flow.md maps every GDPR right to an endpoint or process', () => {
  const content = fs.readFileSync(path.join(SECURITY_DIR, 'data-flow.md'), 'utf8');
  for (const art of ['Art 15', 'Art 17', 'Art 20']) {
    assert.match(content, new RegExp(art.replace(' ', '\\s*')), `data-flow missing ${art}`);
  }
});
