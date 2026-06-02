# Coding standards

The conventions that apply to every file in the OrcaTrade tree. Where a
convention is enforced by a test or workflow, the enforcement is named.
Where it isn't, it's a review-time check the reviewer must apply
(see [review-checklist.md](review-checklist.md)).

## Naming

| Surface | Convention | Example |
|---|---|---|
| Files | kebab-case | `customs-quote.js`, `import-boundary.test.js` |
| Functions / variables | camelCase | `calculateLandedCost`, `userTier` |
| Constants | SCREAMING_SNAKE | `MAX_RETRIES`, `RULE_VERSION` |
| Classes / typedefs | PascalCase | `SystemBlock`, `MoneyAmount` |
| DB tables / columns | snake_case | `saved_plans`, `email_hash` |
| Branch names | kebab + type prefix | `fix/test-suite-green-after-marketing-shell`, `docs/adr-repository-p0a` |
| Commit messages | Conventional Commits | `feat(types): ...`, `sec(auth): ...` ([ADR 0009](../adr/0009-conventional-commits-release-please.md), enforced via commitlint) |

## Language

- **TypeScript for new code.** `.ts` files only from this point forward
  (post-PR #13). Existing `.js` files migrate incrementally via
  `// @ts-check` + JSDoc. See [ADR 0010](../adr/0010-typescript-incremental-adoption.md).
- **CommonJS for `.js` files** (`require` / `module.exports`). This matches
  the consolidated `api/[...path].js` dispatcher's runtime. Mixing ESM
  syntax into a `.js` handler breaks the dispatcher silently —
  [PR #10](https://github.com/Osk7779/orcatrade/pull/10) documents the
  exact bug. New `.ts` files compile to CJS per `tsconfig.json`.
- **UK English** in user-facing copy + comments. EUR figures: `€179,100`.
  ISO-2 country codes (`CN`, `VN`, `DE`, `PL`).

## Comments

- Write *why*, not *what*. The code says what.
- Non-obvious context, business rules, links to specs, or workarounds for
  specific bugs are the reasons to add a comment.
- Don't reference the current task / fix / callers in comments — those
  belong in the PR description and rot as the codebase evolves.
- A long preamble at the top of a file explaining its role is welcome.

## Error handling

- **Validate at the system boundary** (API input, env vars, third-party
  responses). Use `lib/intelligence/compliance-validator.js`-style
  validation patterns or Zod-equivalents in TS.
- **Trust internal code** — don't re-validate values you already validated
  one frame up the stack.
- **Never swallow errors silently.** `try { ... } catch (_) {}` is banned
  on any code path that mutates state. The audit-log-before-success rule
  ([ADR 0005](../adr/0005-audit-log-before-success.md)) is the load-bearing
  example. A swallowed error on a non-mutation path needs an explicit
  comment justifying the swallow.
- **Throw on impossible states.** A function should crash loudly if its
  invariants are violated, not return a `null` / default that hides the
  bug downstream.
- **Catch `unknown`, not `any`.** `useUnknownInCatchVariables` is on in
  `tsconfig.json`.

## External calls

- **Every external HTTP call** wraps in `lib/circuit.js` for timeout +
  retries + fallback. See [ADR 0006](../adr/0006-circuit-breaker-on-external-calls.md).
  Currently partially enforced (Anthropic calls migration is Phase 0
  P0.3; the rule applies from day one for new code).
- **Anthropic SDK + raw `api.anthropic.com` fetches** are only allowed in
  `lib/handlers/` and `lib/ai/`. Enforced by
  [test/import-boundary.test.js](../../test/import-boundary.test.js) —
  the test fails CI if a calculator imports the SDK or fetches the API.
  See [ADR 0003](../adr/0003-anthropic-sdk-boundary.md).
- **Model selection** comes from `MODELS.AGENT | TRIAGE | BULK` in
  `lib/ai/models.js`. Hardcoding `'claude-…'` strings outside the
  registry is enforced against by
  [test/model-registry-enforcement.test.js](../../test/model-registry-enforcement.test.js).

## Money + numbers

- **Integer cents.** Use `lib/intelligence/money.js` (`fromEuro`,
  `toEuro`, `mulRate`, `divInt`). No raw JS float arithmetic on money in
  calculators. Banker's rounding. See [ADR 0004](../adr/0004-integer-cents-money.md).
- **The LLM never produces a number that drives a decision.** All
  customer-visible numerics come from `lib/intelligence/*-quote.js`. See
  [ADR 0002](../adr/0002-llm-never-produces-decision-numbers.md).
- **`toFixed()` for percentage display** is allowed because it's
  rendering, not arithmetic.

## PII

- **No raw email in Postgres or events.** Use the deterministic pseudonym
  via `lib/hash.js`. See [ADR 0008](../adr/0008-email-pseudonymisation.md).
  The current pseudonym is unsalted SHA-256 (operational only — NOT
  privacy-preserving); the salted-HMAC migration is Phase 1 P1.3. Until
  then, don't claim "privacy-preserving SHA-256" in customer-facing copy.
- **No secrets in logs, errors, or AI prompts.** Use `lib/log.js`'s
  redaction middleware. CI-enforced gitleaks scan lands in Wave 3
  ([P0.D](../execution-plan.md)).

## Dependencies

- **Tiny runtime surface.** Three runtime deps total today
  (`@anthropic-ai/sdk`, `@neondatabase/serverless`, `pdf-lib`). Adding a
  fourth needs a reason that maps to the apex plan and a comment in the
  PR explaining the trade-off.
- **DevDeps are cheaper but not free.** TypeScript was added (PR #13)
  because the corp-grade bar requires compile-time safety. Justify
  before adding new tooling.
- **Pin via `^x.y.z`** in `package.json`. The lockfile (`package-lock.json`)
  is committed and CI uses `npm ci` for deterministic installs.

## Tests

- **Five layers per the corp-grade bar** ([docs/execution-plan.md](../execution-plan.md) §3):
  unit · integration · contract · e2e · load. Today: unit + contract
  exist; integration is partial (KV/PG-dependent tests hang silently
  when those services are absent); e2e + load are Phase 1.
- **Mutation-test critical guards.** Adding a test for an enforcement
  rule? Plant a regression, prove the test fails at the exact line +
  column, then revert. Document the mutation result in the PR body.
  Wave 1 PRs #7 and #8 establish the pattern.
- **`npm test` must exit 0 before merge.** Pre-existing failure on `main`
  is not a license to ship more red — see PR #5's "test suite green"
  recovery.

## Workflow

- **PR per coherent change.** Never push directly to `main`. Branch
  protection (Phase 0 Wave 3 P0.C) will enforce this.
- **Conventional Commits** ([ADR 0009](../adr/0009-conventional-commits-release-please.md))
  — `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `perf`, `sec`,
  `build`, `ci`, `style`, `revert`. Enforced by commitlint on every PR.
- **Surface architectural decisions** before guessing. If your change
  touches money / audit / PII / AI / public-API / data-layer / security,
  open an ADR alongside or before the code change.
- **One thing at a time per PR.** Bundling unrelated changes makes review
  harder and rollback messier. "Discovered while doing X" → log it in
  the PR body + a separate follow-up issue.
