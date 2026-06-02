<!--
Runbook template — Phase 0 task P0.H of docs/execution-plan.md.

Copy this file to docs/runbooks/<slug>.md (lower-kebab-case) and fill
in the sections. Keep it tight — a runbook is read at 3 AM by someone
under pressure; clarity beats completeness. Aim for ~80-150 lines.

Sections marked (REQUIRED) gate review. Optional sections can be "N/A"
with a one-line reason; do not delete the headers.

Add a row to docs/runbooks/README.md's index when you ship.
-->

# {short title: action + subject}

## When to use this runbook (REQUIRED)

<!--
The specific trigger. Be concrete: "When /api/foo returns 5xx for >2 min"
not "When something is wrong." A reader should know within 10 seconds
whether they're in the right runbook.
-->

## Prerequisites (REQUIRED)

<!--
Access, credentials, tools needed. Anyone with the listed prerequisites
should be able to execute. Common: admin access to Vercel, gh CLI
authenticated, specific dashboards open.
-->

## Procedure (REQUIRED)

<!--
Numbered steps. Each step is one action with one observable outcome.
Include exact commands (with placeholders for variable values). Show
expected output where ambiguous.
-->

1. ...
2. ...
3. ...

## Verification (REQUIRED)

<!--
How you know it worked. Concrete: "GET /api/health returns kvProbe.ok: true"
not "things look better."
-->

## Rollback (REQUIRED)

<!--
How to undo if the procedure made things worse. "N/A — procedure is
read-only" is acceptable when honest.
-->

## Related

<!-- ADRs, other runbooks, relevant handbook sections, past post-mortems. -->

- ...

## More information

<!-- Optional: background reading, vendor docs, references. -->
