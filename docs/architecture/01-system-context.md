# L1 — System Context

OrcaTrade as one system in its environment. **Customers + 8 external
systems.**

```mermaid
C4Context
    title System Context — OrcaTrade

    Person(importer, "Importer", "European SME sourcing from Asia.<br/>Uses the platform for compliance, customs, finance, sourcing.")
    Person(broker, "Customs broker / freight forwarder", "Partner channel; integration target (Phase 4)")
    Person(internal, "Oskar / on-call", "Operates the platform.<br/>Today: the entire ops team.")

    System(orcatrade, "OrcaTrade", "Trade-compliance & import-operations platform for European SMEs sourcing from Asia.<br/>Five domains: search · sourcing · intelligence · logistics · finance.")

    System_Ext(anthropic, "Anthropic API", "Claude LLM (Opus 4.7 for agents, Sonnet 4.6 / Haiku 4.5 for cheaper tiers)")
    System_Ext(neon, "Neon Postgres", "Dual-write durable corpus.<br/>Today: mirror of KV. Phase 1 P1.4: cutover to primary.")
    System_Ext(upstash, "Upstash Redis (KV)", "Primary user-facing store: sessions, magic tokens, rate-limits, TARIC cache, audit log.")
    System_Ext(resend, "Resend", "Transactional email (magic links, digests, alerts)")
    System_Ext(stripe, "Stripe", "Billing (Phase 2). Customer portal + webhooks + (Phase 2) metering.")
    System_Ext(voyage, "Voyage AI", "Embeddings for RAG retrieval (optional; current corpus is BM25 + future pgvector)")
    System_Ext(sentry, "Sentry", "Error capture + traces (Phase 1 OTEL expansion)")
    System_Ext(taric, "UK Trade Tariff API", "Live TARIC duty rates. Cached in KV (7-day TTL, stale-while-revalidate).")

    Rel(importer, orcatrade, "Uses for compliance + sourcing + logistics", "HTTPS")
    Rel(broker, orcatrade, "(Phase 4) Integrates via public API", "HTTPS/REST")
    Rel(internal, orcatrade, "Operates + on-calls", "HTTPS · gh CLI · Vercel CLI")

    Rel(orcatrade, anthropic, "Calls", "HTTPS/REST")
    Rel(orcatrade, neon, "Dual-writes events, audit, plans, portfolios", "Postgres wire / Neon serverless driver")
    Rel(orcatrade, upstash, "Reads + writes primary state", "HTTPS REST")
    Rel(orcatrade, resend, "Sends magic links + alerts", "HTTPS/REST (wrapped in circuit-breaker)")
    Rel(orcatrade, stripe, "(Phase 2) Manages billing", "HTTPS/REST")
    Rel(orcatrade, voyage, "Generates embeddings (optional)", "HTTPS/REST")
    Rel(orcatrade, sentry, "Reports errors", "HTTPS/REST")
    Rel(orcatrade, taric, "Fetches duty rates (with circuit-breaker + cache)", "HTTPS/REST")

    UpdateLayoutConfig($c4ShapeInRow="3", $c4BoundaryInRow="2")
```

## What this diagram is the answer to

> "What does OrcaTrade actually depend on at runtime?"

Eight external systems. Each is a sub-processor recorded in
[docs/handbook/security.md](../handbook/security.md). Each is a single
point of failure for the surface it serves; see the corresponding
runbook under [docs/runbooks/](../runbooks/) for the operational
response.

## Caveats not visible in the diagram

- **Vercel itself** is not shown — it's the substrate that runs
  OrcaTrade, not a system OrcaTrade integrates with. It would appear in
  a deployment diagram (out of scope per [README.md](README.md) §Out of
  scope).
- **The marketing-shell + app-shell Next.js applications** are part of
  OrcaTrade at this zoom level — they appear as separate boxes at L2.
- **GitHub (CI, CodeQL, gitleaks, dependabot, release-please)** is also
  not shown — it's the engineering substrate, not a runtime
  dependency.
- **Sub-processors marked (Phase X)** in
  [security.md](../handbook/security.md) (Stripe, Voyage) are shown
  here because the integration intent + the env-var slots already exist
  even if the production traffic doesn't yet.

## What's next (L2)

[02-container.md](02-container.md) opens the OrcaTrade box and shows
the major technical building blocks inside.
