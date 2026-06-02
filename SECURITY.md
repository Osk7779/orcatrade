# Security policy

OrcaTrade is a trade-compliance and import-operations platform for European
SMEs. The platform holds plan/portfolio data and per-user audit history;
GDPR + UK ICO discipline is built into the schema (raw email is hashed to
an [`emailHash`](docs/security/data-flow.md) pseudonym before durable
storage on most surfaces). We take security reports seriously and treat
them as a first-class engineering input.

Last updated: 2026-06-01.

---

## Reporting a vulnerability

**Preferred:** send a report to `security@orcatrade.pl`. Use the subject
line `SECURITY:` followed by a one-line summary. PGP key is published at
[https://orcatrade.pl/.well-known/security/pgp-key.txt](https://orcatrade.pl/.well-known/security/pgp-key.txt)
(coming in a follow-up — until then, plain email is fine; we will not
treat the contents as public).

Please include:

1. A description of the issue and the impact.
2. Steps to reproduce — minimal proof-of-concept is ideal.
3. Any logs, request IDs, or timestamps you can share.
4. Whether you want to be credited in the post-fix disclosure.

If you cannot reach us by email, open a private security advisory via
GitHub: <https://github.com/Osk7779/orcatrade/security/advisories/new>.
Do **not** open a public issue for a security report — that exposes the
vulnerability before a fix can ship.

### What to expect

| Stage | Target |
|---|---|
| Acknowledge receipt | 2 business days |
| Initial triage + severity assignment | 5 business days |
| Fix shipped (SEV-0 / SEV-1) | per [`docs/security/incident-response.md`](docs/security/incident-response.md) |
| Public disclosure | coordinated; default 90 days after the fix ships |

These targets assume a single security contact (the founder) on a small
team — we will be honest if a particular issue needs longer triage rather
than miss the SLA quietly.

## Scope

**In scope** for this policy:

- The production site at `https://orcatrade.pl` and any
  `*.vercel.app` preview deployment of the
  [`Osk7779/orcatrade`](https://github.com/Osk7779/orcatrade) repository.
- The API surface under `https://orcatrade.pl/api/`.
- Source code in this repository (`api/`, `lib/`, `dashboard/`, `js/`,
  `scripts/`).

**Out of scope:**

- Third-party services we use as subprocessors — see
  [`docs/security/subprocessors.md`](docs/security/subprocessors.md). Report
  vulnerabilities in those services directly to the relevant vendor.
- Social engineering of OrcaTrade staff.
- Physical attacks against our offices or hardware.
- Findings already documented as known limitations in
  [`docs/security/soc2-readiness.md`](docs/security/soc2-readiness.md)
  (e.g. "no 24/7 on-call rotation yet" is acknowledged, not a finding).
- Automated scanner output without a reproduction (we still appreciate it,
  but the SLA above does not apply).

## What we will not do

- Pursue legal action against good-faith researchers who follow this
  policy.
- Require an NDA before triage.
- Withhold credit on disclosure if you want it (or publish your name if
  you ask us not to).

## Hall of fame

Researchers who have reported valid issues and want credit are listed
here after the fix has shipped. (Empty until our first valid report —
honesty discipline, per [`docs/security/README.md`](docs/security/README.md).)

## See also

- [`docs/security/`](docs/security/) — full security & compliance
  documentation set.
- [`docs/security/incident-response.md`](docs/security/incident-response.md)
  — severity classes, runbooks, breach-notification SLAs.
- [`docs/security/data-flow.md`](docs/security/data-flow.md) — what
  personal data we hold, where it lives, how each GDPR right maps to an
  endpoint.
- [`docs/security/audit-trail.md`](docs/security/audit-trail.md) —
  tamper-evident hash-chained audit log + independent verification.
