# Incremental TypeScript adoption: opt-in `// @ts-check` per file, new files `.ts`

- **Status:** Accepted
- **Date:** 2026-05-30
- **Decision-makers:** Oskar + Claude
- **Consulted:** N/A
- **Informed:** Every future contributor; future code reviewers

## Context and problem statement

OrcaTrade today is ~161 `.js` files under `lib/`, plus `scripts/`,
`test/`, and `api/`. The 2026-05-30 audit flagged "no type contract" as
the single biggest velocity tax on the next 6 hires: a function signature
change in `lib/intelligence/customs-quote.js` has no compile-time signal
to its 11 consumers; a renamed field on the agent tool-call interface
silently produces `undefined` at runtime; refactoring across the
calculator boundary is a leap-of-faith exercise.

Big-corporation engineering bar (per [docs/execution-plan.md](../execution-plan.md))
includes "Strict TypeScript (all new code)" in the quality bar table.
But the existing 161 files can't credibly be retyped overnight, and
adding `checkJs: true` globally would surface thousands of inferred-`any`
errors at once, defeating the "land green CI" rule and forcing a
trade-off between blocking merge for weeks and disabling the check.

## Decision drivers

- Get compile-time safety on **new** code from this point forward, with no
  excuses
- Make migration of existing files **incremental**, not a flag day
- Preserve the existing zero-build-step runtime (`node --test` works on
  `.js`; `.ts` files don't run via Node directly without a loader)
- Honour standing order 4: enforcement, not aspiration
- Avoid taking on a heavy bundler/transpiler dependency

## Considered options

1. **Incremental: `tsconfig.json` strict, `allowJs: true`, `checkJs: false`;
   each `.js` file opts in via `// @ts-check`; new files land as `.ts`;
   types via JSDoc on `.js` and native syntax on `.ts`** ✓
2. Big-bang: `checkJs: true` globally; fix all errors in one PR
3. JSDoc-only: type via JSDoc with no `tsc` step; rely on editor checking
4. Full TypeScript rewrite: convert every `.js` to `.ts` in one PR
5. Stay pure JS forever; trust code review

## Decision outcome

**Chosen option: incremental. `tsconfig.json` strict, `allowJs: true`,
`checkJs: false`. Per-file opt-in via `// @ts-check`. New code lands as
`.ts`. Types via JSDoc on `.js`, native TS syntax on `.ts`.**

### What ships in PR #13 (this ADR's implementation)

- `tsconfig.json` at the repo root with strict-mode every option enabled
- `typescript` + `@types/node` added to `devDependencies`; `npm run typecheck`
  script
- `.github/workflows/typecheck.yml` runs `tsc --noEmit` on every PR + push
  to main
- `lib/ai/models.js` opted in as the first proof-of-concept file (smallest
  load-bearing module; JSDoc annotations added so it passes strict checks)
- This ADR

### What follow-up PRs will do

- Each follow-up PR adds `// @ts-check` to a small number of files + fixes
  the typecheck errors that surface (typically by adding JSDoc annotations
  on parameters, return types, and module-export shapes)
- New files MUST land as `.ts`. CLAUDE.md is updated in PR #13 to reflect
  this rule. Standing order #4 (promise = enforcement) implies a grep
  test should eventually catch `.js` files created after a cut-off date —
  logged as a Phase 1 follow-up (P1.5 in [docs/execution-plan.md](../execution-plan.md)
  estimates 2 weeks part-time to migrate `lib/intelligence/` + `lib/ai/`
  in full)

### Why JSDoc on `.js` and not just convert everything to `.ts`

Three reasons:

1. **Runtime preserved.** Node's `--test` runner natively executes `.js`.
   `.ts` requires a loader (`tsx`, `ts-node`, etc.) or a build step that
   produces `.js`. Migrating all 161 files to `.ts` at once would force
   adopting a runtime loader for the entire test suite, which is a much
   bigger change than the typecheck harness itself.
2. **JSDoc IS TypeScript** to the compiler. `tsc` reads JSDoc annotations
   as authoritative types when `@ts-check` is present. There's no
   functional difference between "function in `.js` with full JSDoc" and
   "function in `.ts`" for compile-time safety. The visible difference
   is syntax weight.
3. **Smaller diffs per migration PR.** Adding `// @ts-check` + JSDoc to a
   working `.js` file is a 5-10 line diff. Converting the same file to
   `.ts` is a rename + a structural change + tooling adjustments.

### Consequences

- **Good:** type safety from PR #13 onwards for new code (`.ts`) + opted-in
  files (`@ts-check`)
- **Good:** zero runtime change — `node --test` keeps working unmodified
- **Good:** incremental migration aligned with the team's bandwidth
- **Good:** mutation-tested in PR #13 — a planted type violation is caught
  at the exact file/line by `npm run typecheck`
- **Bad:** the codebase will have a mix of typed (`@ts-check`-ed or `.ts`)
  and untyped (pure `.js`) files for some months; a developer reading any
  given file needs to check whether it's typed
- **Bad:** `// @ts-check` is easy to forget at the top of a new `.js` file;
  per the rule "new files MUST be `.ts`", the grep enforcement (planned
  P1.5 follow-up) closes this
- **Neutral:** `marketing-shell/` and `app-shell/` (Next.js sub-projects)
  have their own `tsconfig.json` and are excluded from the root config

### Confirmation

- `npm run typecheck` runs `tsc --noEmit` with strict config; passes today
  (`lib/ai/models.js` is the only `@ts-check`-ed file in this PR and its
  JSDoc annotations pass)
- [.github/workflows/typecheck.yml](../../.github/workflows/typecheck.yml)
  runs on every PR + push; blocks merge on type errors via branch
  protection (Wave 3 P0.C)
- **Mutation test on `lib/ai/models.js`** in PR #13's body: replacing
  `AGENT: 'claude-opus-4-7'` with `AGENT: 12345` causes `tsc --noEmit` to
  fail at line 17, column 7 with TS2322; restoring makes it pass. The
  harness actually enforces.
- **Per-file opt-in discoverability:** `// @ts-check` is the visible
  marker. A reader sees it on line 1 + knows the file is type-checked.

### Open question (deferred): runtime for `.ts` files

When new files start landing as `.ts`, the test runner needs to execute
them. Three options, none chosen yet:

1. `tsx` loader (`node --import tsx --test`) — adds one devDep, works
2. Native Node experimental `--experimental-strip-types` — Node 24+,
   currently we're on Node 22 in CI
3. Build step: `tsc` produces `.js` next to `.ts`; test runner sees `.js`

Will be decided in the first PR that needs to actually run a `.ts` file.
Until then, the harness in this PR typechecks `.ts` files (if any
existed) without executing them.

## Pros and cons of the options

### Incremental opt-in (chosen)

- **Good, because:** ship now, migrate steadily; no blocked-on-everything
- **Good, because:** JSDoc keeps `.js` files runnable without a build
- **Bad, because:** mixed-typed-and-untyped codebase for some months

### Big-bang `checkJs: true`

- **Good, because:** type safety everywhere immediately
- **Bad, because:** thousands of errors land at once, blocking merge for
  days/weeks while every file is annotated
- **Bad, because:** developers under pressure will `@ts-ignore` to ship,
  permanently weakening the typecheck

### JSDoc-only (no `tsc` step)

- **Good, because:** zero CI work
- **Bad, because:** "documented but not enforced" — exact anti-pattern the
  execution plan rejects. Without `tsc`, JSDoc is a comment, not a contract

### Full TypeScript rewrite

- **Good, because:** end state is uniform
- **Bad, because:** forces adopting a runtime loader for `node --test`
  alongside the language conversion — two large changes coupled
- **Bad, because:** 161 files × full conversion = weeks of churn,
  reviewable only by complete rewrite. PR review meaningless at that size.

### Stay pure JS

- **Bad, because:** the audit explicitly flagged this as the biggest
  velocity tax
- **Bad, because:** doesn't meet the corp-grade bar set in the execution
  plan ("Strict TypeScript (all new code)" in §3)

## Related decisions

- [docs/execution-plan.md](../execution-plan.md) §3 — the quality bar table
  that lists "Strict TypeScript (all new code)" as the corp-grade target
- [docs/execution-plan.md](../execution-plan.md) Phase 1 task P1.5 — bulk
  migration of `lib/intelligence/` + `lib/ai/` to fully typed (whether
  `.ts` or annotated `.js`)
- The decision *not* to choose a `.ts` runtime today (deferred until first
  `.ts` file lands) — will be its own ADR when it comes due

## More information

- [JSDoc-based type checking handbook](https://www.typescriptlang.org/docs/handbook/intro-to-js-ts.html) —
  TypeScript's official guide to JSDoc-as-types
- [Type checking JavaScript files](https://www.typescriptlang.org/docs/handbook/type-checking-javascript-files.html) —
  the official `@ts-check` documentation
- [Phase 1 task P1.5 in docs/execution-plan.md](../execution-plan.md) —
  the scheduled bulk migration that this ADR makes possible
