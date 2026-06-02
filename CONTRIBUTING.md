# Contributing to OrcaTrade

OrcaTrade is a closed-source commercial product. External contributions
are not currently accepted — this file documents the **internal**
engineering norms so a new hire (or the founder six months from now)
can get oriented in one read.

Last updated: 2026-06-02.

---

## Before you change anything

1. **Read [`CLAUDE.md`](CLAUDE.md).** It is the source of truth for what
   this codebase is, what's in scope, what isn't, and the hard rules
   that don't bend (calculator-grounded, integer-cents money, no raw
   PII in events/Postgres, audit-log-before-success, etc.).
2. **Skim [`docs/`](docs/).** The planning docs in priority order:
   `dev-plan.md` (week-to-week), `backend-grade-plan.md` (infra/scale),
   `billion-dollar-plan.md` (apex strategy). If the canonical execution
   plan has changed, those changes land here too.
3. **Security-sensitive work — read [`docs/security/`](docs/security/) first.**
   Especially `data-flow.md` (what personal data we hold, where it
   lives, how GDPR rights map to endpoints) and `audit-trail.md`
   (tamper-evident chain + verification flow).

## The non-negotiables

Hard rules from `CLAUDE.md`, repeated here because they are the most
common drift surface:

1. **Calculator-grounded, always.** The LLM never produces a number
   that drives a decision. All money / quote math lives in
   `lib/intelligence/*-quote.js`. The AI layer writes prose on top of
   deterministic results, with `[chunk-id]` citations and confidence
   tiers.
2. **Anthropic SDK imports only in `lib/handlers/` or `lib/ai/`.**
   Calculators stay LLM-free. CI enforces.
3. **Integer-cents money.** No JS-float arithmetic on money in
   calculators. Use [`lib/intelligence/money.js`](lib/intelligence/money.js)
   (banker's rounding).
4. **No raw PII in Postgres or events.** Email is stored only as
   `email_hash` (SHA-256 first-16-hex via [`lib/hash.js`](lib/hash.js)).
5. **Every mutation writes the audit log before returning success.**
6. **Every external HTTP call has timeout + fallback + retries.** Wrap
   upstreams in [`lib/circuit.js`](lib/circuit.js); log via
   [`lib/log.js`](lib/log.js).
7. **Stable `/api/v1/` contracts.** Breaking changes go to a new
   version.
8. **No secrets in logs, errors, or AI prompts.**

If your change touches any of these, expect to update the matching CI
gate test in the same commit.

## Conventions

- **Naming:** files `kebab-case`, functions/vars `camelCase`, DB
  columns `snake_case`.
- **Strict TypeScript** where TS is used. No `any` without a comment.
  Pure JS modules under `lib/` and `dashboard/` are CommonJS (`require`
  / `module.exports`).
- **User-facing copy is UK English.** EUR figures `€179,100`. ISO-2
  country codes (CN, VN, DE, PL).
- **Comments explain why, not what.** The code says what; comments are
  for non-obvious context, business rules, or links to specs.
- **No dead code.** If a function isn't used, delete it. If a feature
  is half-built, finish it or remove it.

## Working with the codebase

- **Tests are the contract.** Run `npm test` (`ORCATRADE_DISABLE_LIVE_TARIC=1 node --test`).
  New deterministic logic ships with unit tests; LLM-touching code gets
  eval cases via [`scripts/agent-eval.js`](scripts/agent-eval.js).
- **Commit per coherent change** with a clear, present-tense message.
  Conventional Commits prefixes are encouraged (`feat`, `fix`, `test`,
  `docs`, `chore`, `ci`).
- **Push to `main` deploys** via Vercel auto-deploy. Open a PR for
  preview-deploy review; commit/push to `main` directly only with
  explicit owner sign-off.
- **Branches:** feature branches under `feat/<topic>`, fixes under
  `fix/<topic>`, docs under `docs/<topic>`. Keep them short-lived —
  rebase or close stale branches.
- **Surface architectural decisions** rather than guessing — especially
  anything touching the non-negotiables above, the Hobby
  function-count budget, or the apex-plan phasing.

## What requires a PR review (not a direct push)

- Anything that changes a hard rule, a CI gate, or a calculator's
  arithmetic.
- Anything that touches `lib/handlers/`, `lib/ai/`, `lib/db/`,
  `vercel.json`, `.github/workflows/`, or `package.json`.
- Anything that adds a runtime dependency (and that dep must also be
  added to the allowlist in `test/dependency-allowlist.test.js`).
- Documentation that changes a commitment we make publicly
  (`docs/security/`, `SECURITY.md`).

Static-content updates (SEO guides, the daily date rotation, docs
typos) can land via direct push if you're confident.

## Reporting a security issue

**Do not open a public GitHub issue.** See
[`SECURITY.md`](SECURITY.md) for the responsible-disclosure flow.

## Questions

Ask in the team channel, or open a draft PR with a question in the
description — drafts are cheap, alignment is expensive.
