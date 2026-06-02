# PR review checklist

The reviewer's job is to ensure **promise = enforcement** (standing order
#4 of [docs/execution-plan.md](../execution-plan.md)). This checklist is
the discipline that makes that promise real.

Today the reviewer is Oskar; tomorrow it's whoever Oskar hires. Either
way, the checklist is the contract.

## Before reviewing

- **CI green?** Suite + typecheck + commitlint + (Wave 3) CodeQL +
  gitleaks. If red, the author fixes before review begins.
- **PR template fully filled?** The (REQUIRED) sections (Summary, AC,
  Test plan, Rollback, Threat model) must be present + substantive.
  "N/A" is allowed only with a one-line reason — never empty.
- **Conventional commit?** Title + commits parse as conventional.
  Commitlint catches this but eyeball it.

If any of those fails: request changes with a short note, don't dive in.

## What to look for in the diff

### Hard rules ([ADRs 0002-0008](../adr/))

Walk the diff and confirm none of these is violated:

- [ ] **No LLM call from a calculator.** If `lib/intelligence/*.js` got
      touched, grep the diff for `claude-` or `anthropic` — should be
      zero hits. [test/import-boundary.test.js](../../test/import-boundary.test.js)
      enforces, but check anyway: a clever indirection could slip.
- [ ] **Money is integer cents.** Any new arithmetic on money fields uses
      `lib/intelligence/money.js`. No raw `*`, `/`, `+`, `-` on a value
      named in money (`cents`, `eur`, `price`, `cost`, `total`, etc.)
      outside the helper.
- [ ] **Audit log writes precede success.** Any new mutation handler
      (`POST` / `PUT` / `DELETE`) writes an audit event + propagates
      failure (returns 5xx) rather than swallowing.
- [ ] **External calls use `lib/circuit.js`.** Any new `fetch(...)` to a
      non-localhost URL is wrapped.
- [ ] **No raw PII.** Any new event payload or PG insert uses the
      `email_hash` (`lib/hash.js`), never the raw email.
- [ ] **No hardcoded model string.** Any new `model:` field uses
      `MODELS.AGENT | TRIAGE | BULK`, not a literal.
- [ ] **Stable contracts.** If `lib/contracts/v1/*` changed in a way that
      could break a v1 consumer, the change goes to a new `v2` instead.

### Tests

- [ ] **New behaviour has a new test** (standing order #3).
- [ ] **New enforcement rule has a mutation test** (planted regression
      fails at exact line). Documented in the PR body.
- [ ] **Test names describe the behaviour**, not the implementation.
      "GET /api/foo returns 404 on unknown id" ✓
      "test for foo handler" ✗
- [ ] **No `.skip()` / `.only()`** without a clear marker pointing at the
      follow-up task. See PR #5's `marketing-shell migration: ...` markers
      for the pattern.

### TypeScript

- [ ] **New `.js` file?** Should it have been `.ts`? Default is `.ts`
      for new code ([ADR 0010](../adr/0010-typescript-incremental-adoption.md)).
- [ ] **Opted-in `.js` file (`// @ts-check`)?** Check that JSDoc covers
      function params + return types. Strict mode is on; missing
      annotations show up as inferred `any`.
- [ ] **`@ts-ignore` / `@ts-expect-error`?** Must have an inline comment
      explaining why and a TODO + issue reference.

### Documentation

- [ ] **Hard-rule change?** New ADR alongside the code change. Existing
      ADR superseded if behaviour changed.
- [ ] **User-visible behaviour change?** `CHANGELOG.md` is auto-generated
      from the conventional commit; just verify the commit type produces
      the right section (`feat:` → Features, `sec:` → Security, etc.).
- [ ] **CLAUDE.md still accurate** after this change? If not, update it
      in the same PR.
- [ ] **Marketing / `/changelog/` / public copy** still accurate? Same
      rule: update in the same PR.

### Threat model

- [ ] **STRIDE table substantive** for any auth / authz / money / PII /
      AI / API / data / security change. "N/A — pure docs" is fine for
      docs PRs; for code that touches a boundary, every row must be
      addressed.
- [ ] **No new attack surface** without explicit acknowledgement: new
      endpoint? new secret? new third-party? new public field?

## When to block vs comment

| Severity | Action |
|---|---|
| Hard-rule violation; CI red; missing AC/test/rollback section | **Request changes** — block merge |
| Type holes; minor convention drift; clearer naming possible | **Comment** — author addresses, no re-review needed |
| Style nit; alternative implementation preference | **Comment, prefix "nit:"** — author decides |

## The reviewer's signoff

The "Reviewed by Oskar" checkbox in the PR template's Acceptance Criteria
is the merge gate. Don't tick it until:

1. Every (REQUIRED) section is substantive
2. CI is green
3. The diff has no hard-rule violation
4. The author has resolved every "Request changes" comment
5. You'd be comfortable defending this PR in front of a procurement
   reviewer 6 months from now

If you can't tick it: write a short summary of what's still needed, post
it as a "Request changes" review, and tag the author.

## Two-eyes review without a second engineer

Until OrcaTrade hires engineer #2, the reviewer is Oskar (who is also
typically the author when Claude pairs with him). The "two-eyes" discipline
([standing order #11](../execution-plan.md)) is preserved by:

1. Claude prepares the PR + ticks all author-side AC checkboxes
2. Claude posts the PR for review without self-merge
3. **Oskar reads + ticks the "Reviewed by Oskar" checkbox** + merges

That checkbox is the gate. Self-merging is never acceptable, even for
docs-only changes.
