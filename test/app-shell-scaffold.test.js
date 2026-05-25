// Structural guard for the Next.js app shell (Pillar IV / F5). Runs in the
// normal node --test suite WITHOUT a Next build — it asserts the scaffold is
// present and coherent, and crucially that it stays ISOLATED from the repo-root
// project (so the live static site + API are never put at risk by it).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SHELL = path.join(ROOT, 'app-shell');
const read = (p) => fs.readFileSync(path.join(SHELL, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(SHELL, p));

test('app-shell scaffold files are present', () => {
  for (const f of [
    'package.json', 'next.config.mjs', 'tsconfig.json', 'postcss.config.mjs',
    'app/globals.css', 'app/layout.tsx', 'app/page.tsx',
    'app/(authed)/layout.tsx', 'app/(authed)/dashboard/page.tsx',
    'components/Sidebar.tsx', 'lib/api.ts', 'README.md', '.gitignore',
  ]) {
    assert.ok(exists(f), `missing app-shell/${f}`);
  }
});

test('package.json targets Next 15 + React 19 + Tailwind v4', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.match(pkg.dependencies.next, /\^?15\./);
  assert.match(pkg.dependencies.react, /\^?19\./);
  assert.match(pkg.devDependencies.tailwindcss, /\^?4\./);
  assert.match(pkg.devDependencies.typescript, /\^?5\./);
});

test('tsconfig is strict', () => {
  // tsconfig.json may carry comments in other repos, but ours is plain JSON.
  const ts = JSON.parse(read('tsconfig.json'));
  assert.equal(ts.compilerOptions.strict, true);
});

test('next.config sets basePath /app so it composes behind the proxy', () => {
  assert.match(read('next.config.mjs'), /basePath:\s*'\/app'/);
});

test('the API client forwards the session cookie (same-origin), no second auth', () => {
  const api = read('lib/api.ts');
  assert.match(api, /credentials:\s*'same-origin'/);
  assert.match(api, /\/api/);
});

test('the dashboard is auth-gated and reads the existing overview endpoint', () => {
  const page = read('app/(authed)/dashboard/page.tsx');
  assert.match(page, /\/account\/overview/);
  assert.match(page, /AuthError/);
});

test('the Plans page is ported into the shell and reads /api/plans', () => {
  assert.ok(exists('app/(authed)/plans/page.tsx'), 'plans page missing');
  const page = read('app/(authed)/plans/page.tsx');
  assert.match(page, /apiGet[^)]*'\/plans'/);
  assert.match(page, /AuthError/);
  // The sidebar links Plans in-app (not the old static /account/plans/).
  assert.match(read('components/Sidebar.tsx'), /href:\s*'\/plans',\s*inApp:\s*true/);
});

test('the accent colour is ivory white, not gold (user preference, locked in)', () => {
  const css = read('app/globals.css');
  assert.match(css, /--color-accent:\s*#fafaf7/i);
  // No component should reference a gold token any more.
  for (const f of ['components/Sidebar.tsx', 'app/(authed)/dashboard/page.tsx', 'app/(authed)/plans/page.tsx']) {
    assert.doesNotMatch(read(f), /--color-gold/, `${f} still references a gold token`);
  }
});

// ── Isolation guarantees (the whole point of the subtree) ──

test('the repo-root package.json was NOT polluted with Next/React deps', () => {
  const root = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const deps = { ...(root.dependencies || {}), ...(root.devDependencies || {}) };
  for (const forbidden of ['next', 'react', 'react-dom', 'tailwindcss']) {
    assert.ok(!(forbidden in deps), `root package.json must not depend on ${forbidden} — the app shell is a separate project`);
  }
});

test('app-shell ignores its build output (node_modules/.next not committed)', () => {
  const gi = read('.gitignore');
  assert.match(gi, /node_modules/);
  assert.match(gi, /\.next/);
});
