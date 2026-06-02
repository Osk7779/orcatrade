# Security

Every engineer's security responsibilities on OrcaTrade. This file is the
day-1 reference; the full security programme (SOC 2 Type II + ISO 27001
+ ISO 27701) is built out across Phases 3-5 of
[docs/execution-plan.md](../execution-plan.md).

## The five rules nobody breaks

1. **No secrets in logs, errors, or AI prompts.** `lib/log.js` has
   redaction middleware — use it. Phase 0 Wave 3 task P0.D adds gitleaks
   as a CI gate to enforce this against the source tree too.
2. **No raw PII in Postgres or events.** Email goes through the
   pseudonym helper in `lib/hash.js`. See [ADR 0008](../adr/0008-email-pseudonymisation.md).
   Phase 1 P1.3 makes the pseudonym privacy-preserving (salted HMAC);
   until then, don't claim it is in customer-facing copy.
3. **Audit-log writes precede success on every mutation.** See
   [ADR 0005](../adr/0005-audit-log-before-success.md). Failure of the
   audit subsystem becomes a 5xx, not a silent gap.
4. **External calls are circuit-broken.** See
   [ADR 0006](../adr/0006-circuit-breaker-on-external-calls.md). Limits
   blast radius when an upstream is down or being attacked.
5. **API contracts are versioned.** Breaking changes go to a new
   `/api/vN/` path. See [ADR 0007](../adr/0007-api-v1-stable-contracts.md).

## Threat model on every security-relevant PR

If your PR touches **auth, authz, money, PII, AI tool surface, public
API contract, data layer, security boundary, secrets, or third-party
calls**, the PR template's STRIDE table must be substantive.

STRIDE rows:

- **Spoofing** — can someone pretend to be someone they aren't?
- **Tampering** — can someone change data they shouldn't?
- **Repudiation** — can someone do something + deny they did it?
- **Information disclosure** — does any data leak to a party who
  shouldn't see it?
- **Denial of service** — can someone exhaust resources / take the
  service down?
- **Elevation of privilege** — can someone get permissions they
  shouldn't have?

"N/A — <one-line reason>" is acceptable per row. Empty cells are not.

## Secrets management

- **`.env.local`** is gitignored. Holds local-dev secrets only.
- **`.env.example`** is committed. Lists every required variable with
  empty values + a one-line description.
- **Production secrets** live in the Vercel project's environment
  variables UI, scoped per environment (Dev / Preview / Production).
- **Never log a secret.** Use `lib/log.js`'s redact helpers. Common
  fields to never log: `*.password`, `*.token`, `*.api_key`, `*.secret`,
  `Authorization` header, `x-api-key` header, `STRIPE_*`,
  `RESEND_API_KEY`, etc.
- **Rotation** is documented (Phase 3 P3.1+). Anthropic, Resend, Stripe,
  Neon, Upstash, `ORCATRADE_AUTH_SECRET`, `ORCATRADE_CRON_TOKEN` —
  each has a rotation procedure that becomes a runbook in P0.H.

## Sub-processors

A **sub-processor** is any third party that processes our customer data.
Current list (also published on the trust centre when Phase 2 P2.12
lands):

| Vendor | Purpose | Data processed |
|---|---|---|
| Vercel | Hosting, function execution, edge cache | Request metadata, function logs |
| Neon | Postgres (durable corpus, dual-write) | Pseudonymised user data, audit log, events |
| Upstash | Redis KV (primary user-facing store) | Sessions, magic tokens, rate-limit counters, cache |
| Anthropic | LLM inference | Prompts (system + user) submitted by handlers + tool-call results. No PII per rule #1. |
| Resend | Transactional email | Recipient email (raw — needed to deliver), email body |
| Voyage AI | Embeddings (optional, when configured) | Corpus text only, no PII |
| Sentry | Error capture | Stack traces, redacted request metadata, breadcrumbs |
| Stripe | Billing (Phase 2 P2.1) | Email, billing address, payment method, invoice data |

Adding a new sub-processor needs:
1. Security questionnaire response on file from the vendor
2. DPA signed (Phase 2 P2.G makes this customer-visible)
3. Sub-processor list updated (this file + the trust centre)
4. 30-day customer notification (per the DPA template, Phase 2 P2.13)

## Vulnerability disclosure

- **security@orcatrade.…** is the public contact (Phase 2 P2.J formalises
  the VDP with a PGP key + safe-harbour language).
- **Bug bounty:** private launch on Intigriti in Phase 3 P3.6.
- **CVE response:** target 7-day patch for critical CVEs in dependencies.
  Dependabot (Phase 0 P0.D) auto-opens PRs; reviewer prioritises sec
  PRs.

## Things that surface a security review

Anything in this list requires an explicit security pass during PR
review (the reviewer notes it in the AC):

- New auth path (login, session creation, token issuance, SSO)
- New permission check or RBAC role
- New endpoint accepting customer input
- New webhook receiver
- New secret added to env vars
- New sub-processor
- New regex on untrusted input (ReDoS surface)
- Anything that runs arbitrary user-provided content through `eval`,
  `Function()`, template-string interpolation against a string from a
  user, etc. — these should be reviewed twice + ideally avoided

## CI security gates (current + planned)

| Gate | Status |
|---|---|
| `test/import-boundary.test.js` (no Anthropic outside handlers/ai) | ✓ live (PR #8) |
| `test/model-registry-enforcement.test.js` (no hardcoded model IDs) | ✓ live (PR #7) |
| Conventional commits + commitlint | ✓ live (PR #11) |
| TypeScript strict typecheck | ✓ live (PR #13) |
| CodeQL static analysis | ✓ live (PR #15) |
| gitleaks secrets scan | ✓ live (PR #15) |
| Dependabot dependency updates | ✓ live (PR #15) |
| Snyk vulnerability scan | ✓ live, opt-in via `SNYK_TOKEN` repo secret (PR #15) |
| SBOM (CycloneDX) per release | ✓ live, fires on `release-please` release event (PR #15) |
| Branch protection (required checks, Code Owners, linear history) | ✓ live, applied via [runbook](../runbooks/repo-settings-branch-protection.md) (PR #16) |
| Annual external pen test | Phase 3 P3.5 |
| Private bug bounty | Phase 3 P3.6 |
| SOC 2 Type II / ISO 27001 / ISO 27701 | Phase 3-5 |

**One-off setup needed after PR #15 merges** (per the workflow files'
documentation):
- Add `SNYK_TOKEN` to repo secrets (from your Snyk account → API Token)
  for the Snyk scan to actually run. Until then it skips gracefully.
- Verify "Settings → Code security → Dependabot security updates" is
  on (typically on by default for repos with `dependabot.yml`).
