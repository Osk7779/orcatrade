# Incident response v1

The minimal-credible process for handling a production incident. Phase 3
task P3.4 in [docs/execution-plan.md](../execution-plan.md) will mature
this into the full PagerDuty + incident-commander + game-day programme;
this file is what we hold ourselves to today.

## Severity levels

| Level | Definition | Examples |
|---|---|---|
| **SEV1** | Customer-facing outage, data loss, security breach, regulatory exposure | `/api/*` returning 5xx; corrupted plan data; auth bypass; raw PII leak; sustained Anthropic timeout breaking every agent flow |
| **SEV2** | Degradation, partial outage, single-feature broken | One handler 5xx-ing; CHANGELOG/release-please pipeline broken; eval CI regression; uptime probe flapping |
| **SEV3** | Single-customer issue, non-critical regression, observable-only | Specific customer's saved plan won't load; doc page 404; minor UI regression |

When in doubt, **assume the higher severity** and downgrade if
investigation rules it out.

## The first 10 minutes (SEV1)

1. **Acknowledge.** Slack / GitHub comment "investigating <hypothesis>".
2. **Stop the bleed.** If recent deploy correlates, promote previous
   deployment via Vercel dashboard. Roll-forward is also acceptable if
   the fix is faster than the rollback.
3. **Open the SEV1 issue.** Title format: `SEV1 — <one-line symptom>`.
   Label `sev1` + the affected component. Body includes:
   - Symptom (with screenshots / logs)
   - Suspected scope (which customers / endpoints / regions)
   - Current hypothesis
   - Timeline started at (UTC)
4. **Communicate** when mitigation is underway. `/status/` page update;
   trust centre when it lands (Phase 2 P2.12).

## The next hour (SEV1)

5. **Mitigate.** Ship a fix via the normal PR + preview + review flow.
   For SEV1 the reviewer can be expedited to "post-merge review" — but
   the PR + CI run still happen, and the audit trail is preserved.
6. **Verify mitigation.** `/api/health` returns green; the symptom is
   gone from logs; a customer-impacting flow works end-to-end. Don't
   close the incident on "the alert stopped firing."
7. **Update the SEV1 issue** every 30 minutes until resolved.

## After resolution (any severity, within 7 business days)

8. **Write the post-mortem.** Template below. Public by default — this
   is a deliberate corp-grade choice ([standing order #4](../execution-plan.md)
   plus Phase 3 P3.4). Customers reading our post-mortems learn that
   we're honest about failures, which is more trust-building than
   pretending nothing went wrong.

## Post-mortem template

Copy this to a new file under `docs/post-mortems/YYYY-MM-DD-slug.md` (the
directory will be created on first use):

```markdown
# Post-mortem: <one-line incident title>

- **Date:** YYYY-MM-DD
- **Severity:** SEV1 / SEV2
- **Duration:** HH:MM (acknowledge → resolved)
- **Customers impacted:** all / specific cohort / N customers
- **Incident commander:** Oskar
- **Author:** Oskar (+ Claude where relevant)

## Summary

(2-3 sentences. What broke, who noticed, how long, how bad.)

## Timeline (UTC)

- HH:MM — first symptom appeared
- HH:MM — first detection (uptime probe / Sentry / customer email)
- HH:MM — acknowledged
- HH:MM — root cause hypothesised
- HH:MM — mitigation deployed
- HH:MM — verified resolved

## Root cause

(The technical reason. Don't blame people; blame systems.)

## Contributing factors

- (e.g. recent dependency bump; missing test coverage; ambiguous runbook)

## What went well

- (Specific things — fast detection, clean rollback, good comms)

## What went badly

- (Specific things — no graceful degradation, missing alert, runbook
  gap, communication delay)

## Action items

Each one is a GitHub issue with an owner + a date. No vague items.

- [ ] OWNER — Specific fix — by YYYY-MM-DD — `#issue`
- [ ] OWNER — Specific runbook update — by YYYY-MM-DD — `#issue`
- [ ] OWNER — Specific test to prevent recurrence — by YYYY-MM-DD — `#issue`

## Lessons

(1-3 sentences of "what this teaches us about the platform / process".)
```

## What NOT to do during an incident

- **Don't lie** about scope or duration on the `/status/` page. Customers
  notice and remember.
- **Don't bypass CI** even under pressure. The fix that bypasses the
  test is the fix that breaks the next thing.
- **Don't skip the post-mortem** because the fix was small. Small fixes
  with no post-mortem accumulate into folklore-based engineering.
- **Don't blame** in the post-mortem. The point is the system, not the
  person. If you can write a sentence that names a person as the cause,
  rewrite it to name a system that allowed the human action.
- **Don't close action items as "won't do"** without a written
  justification + reviewer signoff. That's how lessons get unlearned.

## Communication templates

### `/status/` page entry (SEV1, investigating)

> **Investigating** — We're investigating reports of <symptom> affecting
> <scope>. We will post an update within 30 minutes. (HH:MM UTC)

### `/status/` page entry (SEV1, mitigated)

> **Mitigated** — A fix has been deployed and the issue is no longer
> observable. We are monitoring. A full post-mortem will be published
> within 7 business days. (HH:MM UTC)

### Customer email (single-customer SEV3, resolved)

> Hi <name> — the issue you reported with <feature> is fixed. The root
> cause was <one sentence>. Apologies for the inconvenience. If you see
> it recur, reply to this email and we'll investigate immediately.
