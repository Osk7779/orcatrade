# Threat model — Customer API surface

**Surface:** `/api/v1/*` — the stable customer-facing API surface
served by the single Vercel function (`api/[...path].js`).
**Owner:** Founder.
**Last reviewed:** 2026-06-02.
**Cadence:** quarterly + on any change to the `/api/v1/` contract,
authn/authz path, or rate-limit configuration.

---

## 1. Adversary objectives

1. **Authz bypass** — access another tenant's data via the public API.
2. **Rate-limit bypass** — exceed the per-tenant cap (request rate,
   AI spend, storage) without paying for a higher tier.
3. **Data scraping** — pull bulk corpus, supplier data, or aggregate
   analytics that aren't intended for export.
4. **Contract abuse** — depend on undocumented API behaviour, then
   sue when we change it.
5. **Denial of service** — exhaust the single function's capacity for
   other tenants.

## 2. Attack paths (STRIDE)

### S — Spoofing

| Path | Mitigation in place | Gap |
|---|---|---|
| Unauthenticated call to a tenant-scoped endpoint | Session cookie or bearer token required; `lib/auth.js` rejects on absence | None today |
| Stolen / replayed bearer token | Bearer tokens are per-org, revocable via `/api/orgs/<id>/sso` — revocation invalidates immediately | Token rotation cadence not documented per customer. Queued: customer onboarding runbook |
| Spoofed `X-Forwarded-For` to evade per-IP rate limits | Per-tenant rate limit is keyed by `emailHash` or org id, not IP | None today |
| SCIM admin token replayed | Per-org SCIM token verified against KV (`lib/scim-store.js`); revocation invalidates | None today |

### T — Tampering

| Path | Mitigation in place | Gap |
|---|---|---|
| Modified JSON body smuggling extra fields | Handlers validate shape per endpoint; unknown fields ignored, never persisted as-is | Per-endpoint validation discipline — no central schema gate yet. Queued: P0.J OpenAPI scaffold + per-endpoint zod-style validators |
| Plan / portfolio mutation under another tenant's id | Every read + mutation joins on the signed-in user's `email_hash`; `lib/handlers/plans.js` rejects mismatched ownership | Cross-org access not yet implemented. When it lands (Phase 2 multi-seat) must add ACL test |
| Stored row alteration to corrupt future calc | Tamper-evident chain on `events`; `verifyStoredChain` from audit handler | Plans/portfolios not yet chained. Queued: P1.2 extension |

### R — Repudiation

| Path | Mitigation in place | Gap |
|---|---|---|
| Customer claims they never saved a plan / never approved a draft | Audit log writes mutation row before returning success (rule 5); `account_exported`, `document_approved`, `plan_saved` events ship with the actor's `email_hash` | None today |
| Customer claims the agent recommended X | See ai-agent.md threat model | n/a |

### I — Information disclosure

| Path | Mitigation in place | Gap |
|---|---|---|
| Cross-tenant read via crafted query param | Handlers always JOIN on `email_hash` of the signed-in user; tested per-handler | Need a central "ownership filter" test across all read endpoints. Queued: P1.9 RBAC audit |
| Bulk export of corpus / SEO content via `/api/*` | Corpus is public regulation text; SEO pages are public-by-design. Exfiltration value is low. | Acceptable. |
| Audit log read by non-admin | `/api/audit` requires `ORCATRADE_LEADS_TOKEN`; redacted (email → emailHash) before serving | None today (admin-only) |
| Error messages leak internals (stack traces, file paths) | Dispatcher catches handler throws; logs full error server-side, returns generic JSON to client (`{ error, requestId }`) | None today |
| Verbose 500 includes a request-id the user can quote, but no internals | `x-request-id` header echoed on every response; internals stay in logs | None today |

### D — Denial of service

| Path | Mitigation in place | Gap |
|---|---|---|
| Burst traffic from a single tenant | Per-tenant rate limit on the dispatcher (counters with TTL — PR #67 hygiene gate) | Burst threshold tuning per endpoint not yet calibrated. Acceptable today (low traffic) |
| Long-running request blocks the function | `vercel.json` `maxDuration: 60s` cap; agent loops have their own depth cap | None today |
| Slow-loris-style hanging connections | Vercel terminates idle connections; no per-handler timeout beyond the function cap | Acceptable today |
| Anthropic spend exhaustion (cost-DoS via /api/agent) | Per-tenant spend cap (P1.7) | None today |

### E — Elevation of privilege

| Path | Mitigation in place | Gap |
|---|---|---|
| Regular user calls admin endpoint (`/api/audit`, `/api/leads`, `/api/calibration`) | Token-gated via `ORCATRADE_LEADS_TOKEN`; no role escalation path | None today |
| Org member accesses another org's data | Per-mutation ownership check; org membership read from KV/PG | Need ACL test coverage across every org-scoped endpoint. Queued: P1.9 RBAC audit |
| SCIM token expanded to non-SCIM endpoints | SCIM token validated by `lib/handlers/scim.js` only; other handlers reject it | None today |

## 3. Out-of-scope for this model

- **Browser-side attacks against the static SEO site** (XSS in the
  marketing tree). Covered by CSP (vercel.json) + `test/security-headers.test.js`.
- **Domain takeover.** Out of scope here; DNS hardening is documented
  in incident-response.md.
- **Supply-chain compromise of dependencies.** Covered by
  PR #52 (runtime-dep allowlist) + CodeQL / Dependabot (P0.D).

## 4. Residual risk + gap log

| Gap | Severity | Closes via |
|---|---|---|
| Central schema gate for request bodies (zod or similar) | Medium | Apex P0.J + Phase 1 follow-up |
| Plan / portfolio chain extension | Medium | Apex P1.2 follow-up |
| Cross-org ACL test coverage | Medium | Apex P1.9 (RBAC audit across all mutation endpoints) |
| Per-customer token-rotation cadence documentation | Low | Customer onboarding runbook (Phase 2) |
| Per-endpoint burst-threshold calibration | Low | When traffic warrants |

## 5. Review checklist (run quarterly)

- [ ] Re-walk each STRIDE table; confirm cited mitigations still exist
- [ ] Run `gh pr list --search "RBAC OR ACL OR ownership"` to see if
      the queued gaps moved
- [ ] If a new `/api/v1/<name>` endpoint shipped, add a row covering it
- [ ] Update "Last reviewed" + revision history

## 6. Revision history

| Version | Date | Change |
|---|---|---|
| v1 | 2026-06-02 | Initial threat model (apex P1.E) |
