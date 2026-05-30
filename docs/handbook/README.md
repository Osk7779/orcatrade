# OrcaTrade Engineering Handbook

The day-1 reference for anyone writing code on OrcaTrade — whether that's
you (the founder), an engineer you've just hired, or an AI pair (Claude
Code). It complements three other documents; read all four together:

| Document | Purpose |
|---|---|
| [CLAUDE.md](../../CLAUDE.md) | Orientation: what the codebase is + current constraints |
| [docs/execution-plan.md](../execution-plan.md) | Canonical 18-month roadmap + 15 standing orders |
| [docs/adr/](../adr/) | Architecture Decision Records — the "why" behind every hard rule |
| **`docs/handbook/`** (this directory) | The "how" — concrete conventions, checklists, runbook entry points |

If those four ever disagree, the **execution plan is canonical**. Open a
PR to reconcile.

## Contents

| File | Topic |
|---|---|
| [coding-standards.md](coding-standards.md) | Naming, error handling, comments, dependency policy, JS/TS conventions |
| [review-checklist.md](review-checklist.md) | What a reviewer looks for on every PR — mapped to the PR template |
| [on-call.md](on-call.md) | What on-call means today, response targets, escalation, what counts as a page |
| [incident-response.md](incident-response.md) | SEV levels, declaration, comms, post-mortem template |
| [security.md](security.md) | Every engineer's security responsibilities + the security-touching PR checklist |
| [environment-setup.md](environment-setup.md) | From zero to running tests + typecheck + preview deploy |
| [onboarding.md](onboarding.md) | Day-1 / week-1 / month-1 checklist for a new engineer |

## How this handbook is maintained

- Open a PR that edits a handbook file like any other change. Use the
  standard PR template + reviewer signoff.
- Significant policy changes (e.g. raising the test coverage bar, adding
  a new SEV level) require an ADR alongside the handbook edit.
- The handbook should reflect **how things work today**, not how they will
  work after some future Phase. If a section describes a future state,
  it must say so explicitly + cite the execution-plan task that ships it.
- Honest > aspirational. A handbook claiming "we have 24x7 on-call" when
  one founder runs the pager fails the corp-grade bar (see standing order
  #4 in the execution plan: promise = enforcement).

## Status

Introduced 2026-05-30 as Phase 0 task **P0.G** of the execution plan.
First-pass content covers the conventions used through Phase 0 Wave 1
and Wave 2. Will evolve as Phase 0 Wave 3 (security tooling, branch
protection, runbooks) and beyond land.
