# Data flow & retention

**Last reviewed:** 2026-05-17
**Owner:** Oskar Klepuszewski

Source of truth for what personal data OrcaTrade collects, where it lives, how long it's kept, and which subprocessor handles each leg.

For the legal posture see [`/regulations/privacy.html`](../../regulations/privacy.html) and [`dpa-template.md`](dpa-template.md). For who sees the data see [`subprocessors.md`](subprocessors.md).

---

## What counts as personal data here

Three categories of personal data flow through the platform:

| Category | Examples | Why we collect |
|---|---|---|
| **Identity** | Email, optional name + company | Sign-in (magic link), Founding 10 application, plan-summary email |
| **Behavioural** | Wizard inputs (HS code, origin, destination, customs value), plan permalinks, page views (via Vercel Analytics) | Drive the calculator output; conversion analytics |
| **Operational** | Session cookies (HMAC-signed), IP at request time (rate-limit only), request-id (correlation) | Auth, abuse prevention, debugging |

We do **not** collect: payment-card data (Stripe handles that — we never see PAN or CVV), real customs declarations (the calculator returns estimates only), shipping-document scans, or any biometric / special-category data.

---

## Data flow per surface

### Wizard submission · `POST /api/start`

```
Browser → Vercel Edge → api/[...path].js → lib/handlers/start.js
                                            ↓
                                            calls 4–6 calculators in lib/intelligence/
                                            ↓
                                            optionally writes Resend email
                                            ↓
                                            writes `import_plan_generated` event to KV
                                            ↓
                                            returns JSON plan
```

What's stored: an `import_plan_generated` event with the **wizard inputs** (productCategory, origin, destination, customsValueEur, hsCode, etc.), `emailProvided:boolean` (not the address itself), and the `landedTotal`. **The user's email is intentionally NOT stored in the event log.**

Retention: 365 days, capped at 5,000 most-recent events (KV-backed circular buffer).

### Sign-in · `POST /api/auth/request` + `GET /api/auth/verify`

```
Browser → /api/auth/request (email + magic-link token written to KV, 15-min TTL)
                                            ↓
                                            Resend sends magic link
                                            ↓
Browser → /api/auth/verify (token consumed, KV row deleted, HMAC session cookie set)
```

What's stored: the magic token under key `auth:magic:<token> → email` with a 15-minute TTL (deleted on consumption). The session cookie itself is **HMAC-signed**, not stored server-side — it carries the email + iat + exp and is verified per request. 30-day lifetime.

Retention: magic token max 15 min; session cookie up to 30 days from issuance.

### Founding 10 application · `POST /api/founding`

What's stored: a `founding_applied` event with name, company, role, email, locale, optional message, optional monthlyValueEur. Sent to `orca@orcatrade.pl` via Resend, plus an applicant-confirmation email.

Retention: 365 days (events:log retention, then aged out by the 5,000-event cap).

### Saved plans · `POST /api/plans`

What's stored: per-user keyed records (`user:<email>:plans` → list of plan IDs; each plan body in `plan:<id>`) with the wizard inputs and snapshot.

Retention: 1 year TTL on each plan, max 50 plans per user (oldest IDs roll off the list).

### Stripe billing · `POST /api/billing/*`

What's stored: `stripe:customer:<email>` mapping the user to a Stripe customer ID, plus `tier:<email>` for the active tier and `subscription:<email>` for sub status. Payment data lives entirely inside Stripe — we never see card numbers, CVVs, or bank details.

Retention: kept while the subscription is active. On account deletion (Article 17) we drop the mapping but Stripe retains its own customer record under its own retention policy (typically 7 years for tax compliance) — the user has to contact Stripe directly to delete that.

### Logging · `lib/log.js`

What's stored: JSON-per-line structured logs in Vercel's log stream. **Every log line passes through PII redaction** before being written: any field whose key matches `email`, `token`, `secret`, `apiKey`, `cookie`, `authorization`, `sessionId` is masked to first-2-characters + `***`. Recursive walk into nested objects + arrays.

Retention: Vercel's log retention policy applies — typically 30 days on the free tier. We do **not** forward logs to a long-term store yet; that's queued as Track 4.2 (Sentry / Axiom drain).

### Health probe · `GET /api/health`

What's stored: nothing per request. The probe writes a transient `health:probe` key with 60-second TTL to verify KV round-trip, then immediately overwrites it on the next probe. The `taric:warm:lastRun` timestamp written by the nightly cron is the only persistent state read.

---

## Storage backends

| Backend | What lives there | Provider | Region |
|---|---|---|---|
| **KV (Redis-protocol)** | Magic tokens, session-revocation list (future), events log, saved plans, user tiers, Stripe customer mapping, circuit-breaker state, TARIC rate cache, health probe | Upstash Redis (via Vercel Marketplace) | Frankfurt (eu-central-1) |
| **Postgres** | *Planned in Phase α* — orgs, audit log, events (replacing KV log) | Neon (planned) | Frankfurt |
| **Object storage** | None (no file uploads in v1) | — | — |
| **Stripe** | Customer records, subscriptions, payment methods | Stripe | Ireland (EU) |

All EU-region storage. No data leaves the EU under normal operation. The two exceptions: Anthropic AI inference (US-region — see Anthropic DPA), and outbound emails via Resend (US-region — see Resend DPA).

---

## Retention summary

| Data | Default TTL | Cap | How it's deleted |
|---|---|---|---|
| Magic-link token | 15 minutes | — | Auto-expire / consume |
| Session cookie | 30 days | — | Auto-expire / sign out |
| Saved plan | 1 year | 50 per user | User delete via UI / Article 17 |
| Event log entry | 1 year | 5,000 entries | Aged out by cap, or pseudonymised via Article 17 |
| TARIC rate cache | 7 days fresh + 30 days stale | — | Auto-expire |
| Circuit-breaker state | 24 hours | — | Auto-heal via half-open probe |
| Vercel logs | ~30 days (provider-controlled) | — | Provider-managed |
| Stripe customer | Per Stripe's retention policy | — | Contact Stripe directly |

---

## How a GDPR request maps to the data flow

| Right | Endpoint / process |
|---|---|
| **Art 15 — Access** | `GET /api/account/export` |
| **Art 16 — Rectification** | Self-service via the wizard (re-submit) + future profile-edit UI |
| **Art 17 — Erasure** | `POST /api/account/delete` (pseudonymises events, hard-deletes plans, clears session) |
| **Art 18 — Restriction** | Manual hold via `orca@orcatrade.pl` — flag the email, we won't include in any cron job or aggregation |
| **Art 20 — Portability** | `GET /api/account/export` — JSON file with `format:"orcatrade-gdpr-export-v1"` |
| **Art 21 — Objection** | Cookie banner v2 (Track 5.2, planned) for analytics consent; opt-out of marketing via reply to any email |
| **Art 22 — Automated decisions** | The wizard produces non-binding cost estimates; no automated profiling that produces legal or significant effects |

---

## Open items (tracked in [`backend-grade-plan.md`](../backend-grade-plan.md))

- **Track 4.2** — Sentry / Axiom drain. Once log retention extends past Vercel's 30 days, this doc gets a row in the storage backends table.
- **Track 5.2** — Cookie banner v2 with granular consent. Updates the Art 21 row above.
- **Track 5.3** — Audit log surfacing at `/dashboard/audit/`. Updates the Art 15 row.
- **Track 2.1** — Neon Postgres provisioning. Updates the storage backends table.
