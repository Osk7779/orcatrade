# Onboarding

Day-1, week-1, month-1 checklist for a new engineer at OrcaTrade. Written
*before* the first engineer joins, so the platform is ready when hiring
starts (target: end of Phase 1 per
[docs/execution-plan.md](../execution-plan.md) §10).

If you're an AI agent reading this for context: most items below assume
a human is in the loop. The "Read" + "Understand" tasks apply to AI
pairs too; the "Meet" + "Pair with Oskar" items don't.

## Before day 1

(Done by Oskar before the new hire arrives.)

- [ ] GitHub repo access (`Osk7779/orcatrade`) at appropriate role
- [ ] Vercel project access (Preview + Production)
- [ ] Neon project access (read for everyone, write gated)
- [ ] Upstash KV project access
- [ ] Anthropic console access (org member, billing scoped)
- [ ] Sentry project access
- [ ] Slack workspace + relevant channels
- [ ] 1Password / shared secret store access
- [ ] Calendar invites for: weekly Oskar 1:1, sprint review (if applicable)
- [ ] Email forwarding for `oncall@orcatrade.…` (when there's a rota)
- [ ] DPA + security questionnaire — sub-processor list reviewed if the
      new engineer is a contractor

## Day 1 (the new hire)

- [ ] Clone the repo, follow [environment-setup.md](environment-setup.md)
- [ ] Run `npm test` + `npm run typecheck` locally — both green
- [ ] Open a `vercel` preview deploy from `main` — confirm working
- [ ] **Read** [CLAUDE.md](../../CLAUDE.md) — orientation
- [ ] **Read** [docs/handbook/README.md](README.md) — this handbook's
      contents page
- [ ] **Read** [docs/execution-plan.md](../execution-plan.md) — top-level
      sections + standing orders (skim the phase tables, don't memorise)
- [ ] 1:1 with Oskar — calibrate on current Phase + Wave focus
- [ ] **Tiny first PR** — fix a typo, update a comment, anything to
      exercise the full PR + CI + review + merge loop. Wave 2 PR #6
      (delete `_legacy/index.html`) is a good shape to imitate.

## Week 1

- [ ] **Read** the 11 ADRs in [docs/adr/](../adr/) — these are the "why"
      behind everything
- [ ] **Read** [docs/billion-dollar-plan.md](../billion-dollar-plan.md) —
      apex strategy
- [ ] **Read** [docs/handbook/coding-standards.md](coding-standards.md)
      + [review-checklist.md](review-checklist.md) — the conventions
- [ ] **Understand** the calculator → agent → handler → API flow.
      Recommended walk-through:
  - Open `lib/intelligence/customs-quote.js` — see the deterministic
    math
  - Open `lib/handlers/agent.js` — see the tool-use loop that wraps it
  - Open `api/[...path].js` line 61 + 197 — see how the dispatcher
    routes it
- [ ] **Understand** the test discipline. Run a mutation test on one of
      the enforcement tests (e.g.
      `test/import-boundary.test.js`) — plant a violation, see it fail,
      restore. Recreates the pattern from PRs #7 and #8.
- [ ] **First substantive PR** — pick something from the current Wave
      of the execution plan, pair with Oskar on the design, write the
      PR. The corp-grade bar: AC + Test plan + Rollback + Threat model
      all substantive.
- [ ] Shadow Oskar on any incident response that happens this week
      (or roleplay one from a past post-mortem if none real)

## Month 1

- [ ] **Migrate one `.js` file to `// @ts-check`** per
      [ADR 0010](../adr/0010-typescript-incremental-adoption.md). Pick
      something you've already touched. Add JSDoc, fix the surfaced type
      issues, ship the PR. Follow the pattern in PR #13.
- [ ] **Write or update one runbook entry** in `docs/runbooks/` (created
      in Phase 0 Wave 3 P0.H). Pick a subsystem you now understand.
- [ ] **Take primary on-call for one week** alongside Oskar. Even if
      nothing pages, you're learning the response flow.
- [ ] **Author or co-author one ADR** for an architectural decision the
      team takes this month. Doesn't matter how small.
- [ ] **30-day retro with Oskar** — what surprised you about the
      codebase, what's missing from this handbook, what should change

## Three-month checkpoint

- [ ] You can defend any of the 11 ADRs without reading them
- [ ] You can fix a SEV2 alone with the runbook
- [ ] You can review a PR + tick the (REQUIRED) checkboxes
- [ ] You've opened or co-authored an ADR
- [ ] You've migrated 3+ files to TypeScript
- [ ] You have an opinion on the next Wave's priorities

## Things this handbook deliberately does not include

- **Specific tasks for your first sprint.** Those come from the
  execution plan + Oskar's prioritisation.
- **Salary / benefits / HR.** Out of scope for this engineering
  handbook.
- **Domain education** — what CBAM means, what TARIC is, how customs
  duty works. The marketing site + `docs/billion-dollar-plan.md` cover
  the domain; pair with Oskar for product depth.

## For an AI pair (Claude Code)

If you're Claude Code reading this in a new session:

- The conversation handoff is `MEMORY.md` + this handbook + CLAUDE.md
- The user's working preferences are in the `.claude/projects/.../memory/`
  directory (per the auto-memory system)
- "Resume" / "continue" = pick the next unmerged PR in the current
  Phase + Wave of the execution plan; confirm choice in 1-2 sentences
  before executing
- Standing order #11 (two-eyes review) applies — you prepare, Oskar
  approves, you never self-merge
- Standing order #4 (promise = enforcement) is the single most-cited
  rule across this entire project
