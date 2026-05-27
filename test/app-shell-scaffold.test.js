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

test('Portfolios / Alerts / Calendar are ported into the shell and link in-app', () => {
  const routes = {
    'app/(authed)/portfolios/page.tsx': /\/portfolio\/list/,
    'app/(authed)/alerts/page.tsx': /\/account\/alerts/,
    'app/(authed)/calendar/page.tsx': /\/account\/calendar/,
  };
  for (const [file, apiRe] of Object.entries(routes)) {
    assert.ok(exists(file), `missing ${file}`);
    assert.match(read(file), apiRe, `${file} must read its API`);
    assert.match(read(file), /AuthError/, `${file} must be auth-gated`);
  }
  const nav = read('components/Sidebar.tsx');
  for (const href of ['/portfolios', '/alerts', '/calendar']) {
    assert.match(nav, new RegExp(`href:\\s*'${href}',\\s*inApp:\\s*true`), `sidebar must link ${href} in-app`);
  }
});

test('the alerts page can mark-read / dismiss (POSTs back to the inbox)', () => {
  const page = read('app/(authed)/alerts/page.tsx');
  assert.match(page, /apiPost/);
  assert.match(page, /markRead|markAllRead|dismiss/);
});

test('Documents + Screening complete the shell (final two surfaces, in-app)', () => {
  assert.ok(exists('app/(authed)/documents/page.tsx'), 'documents page missing');
  assert.ok(exists('app/(authed)/screening/page.tsx'), 'screening page missing');
  assert.match(read('app/(authed)/documents/page.tsx'), /action:\s*'audit'/);
  assert.match(read('app/(authed)/screening/page.tsx'), /apiPost[^)]*'\/screen'/);
  const nav = read('components/Sidebar.tsx');
  assert.match(nav, /href:\s*'\/documents',\s*inApp:\s*true/);
  assert.match(nav, /href:\s*'\/screening',\s*inApp:\s*true/);
});

test('Preferences is ported + the whole sidebar is now in-app (no /account/* links)', () => {
  assert.ok(exists('app/(authed)/preferences/page.tsx'), 'preferences page missing');
  const page = read('app/(authed)/preferences/page.tsx');
  assert.match(page, /\/account\/preferences/);
  assert.match(page, /apiPost/); // toggles persist
  const nav = read('components/Sidebar.tsx');
  assert.match(nav, /href:\s*'\/preferences',\s*inApp:\s*true/);
  assert.equal((nav.match(/href:\s*'\/account\//g) || []).length, 0, 'every sidebar surface should now be native');
});

test('Plan detail view exists, reads /api/plans/<id>, and the list links to it', () => {
  assert.ok(exists('app/(authed)/plans/[id]/page.tsx'), 'plan detail page missing');
  const detail = read('app/(authed)/plans/[id]/page.tsx');
  assert.match(detail, /\/plans\/\$\{id\}/);
  assert.match(detail, /Cost breakdown/);
  // The list row links to the detail route.
  assert.match(read('app/(authed)/plans/page.tsx'), /href=\{`\/plans\/\$\{p\.id\}`\}/);
});

test('Team page exists, is in the sidebar, and drives the RBAC endpoints', () => {
  assert.ok(exists('app/(authed)/team/page.tsx'), 'team page missing');
  const team = read('app/(authed)/team/page.tsx');
  assert.match(team, /\/orgs\/\$\{org\.id\}\/role/);   // change role
  assert.match(team, /\/orgs\/\$\{org\.id\}\/invite/); // invite
  assert.match(team, /\/orgs\/\$\{org\.id\}\/remove/); // remove
  assert.match(team, /canManageMembers/);               // gates the controls
  assert.match(read('components/Sidebar.tsx'), /href: '\/team'/);
  assert.match(read('lib/api.ts'), /interface OrgDetail/);
  // Owner-only SCIM provisioning panel + the DELETE client it needs.
  assert.match(team, /ScimPanel/);
  assert.match(team, /\/orgs\/\$\{orgId\}\/scim/);
  assert.match(read('lib/api.ts'), /apiDelete/);
});

test('Agent chat page streams the orchestrator (SSE) and is in the sidebar', () => {
  assert.ok(exists('app/(authed)/chat/page.tsx'), 'chat page missing');
  const chat = read('app/(authed)/chat/page.tsx');
  assert.match(chat, /\/api\/orchestrator/);
  assert.match(chat, /text-delta/);        // parses streamed text
  assert.match(chat, /getReader/);          // reads the SSE body
  assert.match(read('components/Sidebar.tsx'), /href: '\/chat'/);
});

test('Plan detail surfaces the reproducibility verdict (III3 made visible)', () => {
  const detail = read('app/(authed)/plans/[id]/page.tsx');
  // Fetches the reproduce endpoint and renders the panel.
  assert.match(detail, /\/plans\/\$\{id\}\/reproduce/);
  assert.match(detail, /ReproPanel/);
  assert.match(detail, /Reproducibility/);
  // The api client exposes the Reproduction type the panel consumes.
  assert.match(read('lib/api.ts'), /interface Reproduction/);
});

test('the accent colour is ivory white, not gold (user preference, locked in)', () => {
  const css = read('app/globals.css');
  assert.match(css, /--color-accent:\s*#fafaf7/i);
  // No component should reference a gold token any more.
  for (const f of [
    'components/Sidebar.tsx',
    'app/(authed)/dashboard/page.tsx',
    'app/(authed)/plans/page.tsx',
    'app/(authed)/portfolios/page.tsx',
    'app/(authed)/alerts/page.tsx',
    'app/(authed)/calendar/page.tsx',
    'app/(authed)/documents/page.tsx',
    'app/(authed)/screening/page.tsx',
    'app/(authed)/preferences/page.tsx',
    'app/(authed)/plans/[id]/page.tsx',
  ]) {
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
