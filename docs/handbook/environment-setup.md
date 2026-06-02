# Environment setup

From zero to running tests, typecheck, and a Vercel preview deploy. ~10
minutes for someone with the prerequisites; ~30 minutes from a fresh
machine.

## Prerequisites

- **Node.js 20 or 22.** The codebase tests against both in CI
  ([.github/workflows/test.yml](../../.github/workflows/test.yml)). Use
  [nvm](https://github.com/nvm-sh/nvm) or
  [fnm](https://github.com/Schniz/fnm) to manage versions.
- **npm 10+.** Ships with Node 20+.
- **git 2.40+.** Any modern git works.
- **Vercel CLI** (`npm install -g vercel`) for preview deploys + log
  inspection. Optional but useful.
- **GitHub CLI** (`gh`) for PR creation from the command line. Optional.

## Clone + install

```bash
git clone git@github.com:Osk7779/orcatrade.git
cd orcatrade
npm ci                    # exact-version install from package-lock.json
```

`npm ci` is the right command (not `npm install`) — it installs from the
lockfile deterministically without modifying it. Use `npm install` only
when you're deliberately adding or upgrading a dependency.

## Verify the install

```bash
npm test                  # full test suite — should be ~3,100+ pass / 0 fail / 9 skipped
npm run typecheck         # tsc --noEmit — should exit 0
```

If `npm test` fails: pull the latest `main` first (the suite is green on
`main` by convention; standing order #8 in
[docs/execution-plan.md](../execution-plan.md)). If it's still red after
pulling, file a SEV2 issue.

If `npm run typecheck` fails: most likely you've opted a file into
`// @ts-check` without complete JSDoc annotations. See
[coding-standards.md](coding-standards.md) §TypeScript.

## Environment variables

```bash
cp .env.example .env.local
```

`.env.example` is committed and lists every variable with empty values.
Fill in the ones you need — most local development can run without
production credentials. Key variables for local agent work:

| Variable | Required for | Where to get |
|---|---|---|
| `ANTHROPIC_API_KEY` or `ORCATRADE_OS_API` | Any agent / handler that hits Anthropic | [console.anthropic.com](https://console.anthropic.com) |
| `DATABASE_URL` + `DATABASE_URL_UNPOOLED` | PG-backed tests, schema migrations | Neon dashboard for OrcaTrade project |
| `KV_REST_API_URL` + `KV_REST_API_TOKEN` (or `UPSTASH_REDIS_REST_*`) | KV-backed handlers | Upstash dashboard |
| `RESEND_API_KEY` | Any email-sending path | Resend dashboard |
| `ORCATRADE_AUTH_SECRET` | Magic-link auth, session signing | Generate locally: `openssl rand -hex 32` |

**Never commit `.env.local`.** It's in `.gitignore`. If you accidentally
commit a secret: rotate it immediately + force-push to remove it from
history + see [security.md](security.md) for the rotation runbook.

## Run a Vercel preview deploy

```bash
vercel link               # one-off — pick the OrcaTrade project
vercel                    # deploys current branch to a preview URL
```

The preview URL is unique to your branch + commit. Share it for review.
It runs against the **preview** environment in Vercel (separate env vars
from production).

## Run the live agent eval (manual)

```bash
ANTHROPIC_API_KEY=sk-... npm run eval -- --agent compliance
```

Live eval costs real Anthropic tokens. Default is dry-run; the CI
nightly eval ([.github/workflows/evals.yml](../../.github/workflows/evals.yml))
runs against a budget. Don't run live evals casually.

## Run a database migration

```bash
DATABASE_URL=... npm run db:migrate
```

Migrations are forward-only, tracked in `schema_versions` table, content-
hashed (drift detection). See [lib/db/schema.sql](../../lib/db/schema.sql).
Don't edit historical migrations after they've shipped; add a new one.

## Iteration loop

The fast inner loop most engineers will use:

```bash
# in one terminal
npm test                  # run tests on save (use --watch if you prefer)

# in another terminal
npm run typecheck         # before committing

# before opening a PR
git commit -m "feat(scope): summary"     # conventional commit
git push -u origin <branch-name>
gh pr create              # picks up .github/pull_request_template.md
```

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `npm test` hangs | Some tests require KV or PG and connect blindly | Set the env vars OR skip those tests; this is a known gap (Phase 1 P1.D) |
| `npm run typecheck` fails on a file you didn't touch | Someone else added `@ts-check` to that file recently; pull `main` | `git pull origin main` |
| `vercel logs` shows raw secrets | A recent commit logged a `process.env.*` directly | File a SEV1 — rotate the leaked secret immediately |
| Tests fail with `ENOENT: ... index.html` | An old test still references the pre-marketing-shell root | See PR #5's pattern — guard with `fs.existsSync` + a `// @ts-check`-style skip marker |
| Suite passes locally, fails in CI | Often Node version mismatch (CI runs 20 + 22) | Use `nvm use 20` or `22` to reproduce |

## What to do if your local setup is broken

1. `rm -rf node_modules && npm ci` — fixes most install-related issues
2. `git stash && git pull --rebase origin main && git stash pop` —
   resync with main
3. Compare your `.env.local` against `.env.example` — missing variables
   often manifest as obscure failures
4. Ask in the shared dev channel; or for AI-paired work, ask Claude

## What's NOT in this guide yet

Phase 0 Wave 3 task P0.H will ship a fuller [runbooks/](../runbooks/)
directory covering: auth subsystem failures, billing pipeline issues,
AI agent timeouts, KV outage, PG outage. Until then, this file + the
runbook entries written ad-hoc as incidents happen are the corpus.
