# Threat models

Three documented threat models for the load-bearing OrcaTrade surfaces.
Each follows the STRIDE structure (Spoofing, Tampering, Repudiation,
Information disclosure, Denial of service, Elevation of privilege) with
adversary objectives, attack paths, current mitigations, and gaps
queued for follow-up.

Last updated: 2026-06-02.

| File | Surface | Adversary types |
|---|---|---|
| [`ai-agent.md`](ai-agent.md) | The five LLM agents (`/api/agent`, `/api/orchestrator`, three specialists) | Prompt-injection attacker; tool-result poisoning attacker; data-exfiltration attacker; abusive end-user |
| [`customer-api.md`](customer-api.md) | The `/api/v1/*` surface customers will hit programmatically | Authz-bypass attacker; rate-limit-bypass attacker; data-scraping attacker |
| [`magic-link-auth.md`](magic-link-auth.md) | Magic-link login flow + session cookie | Token-reuse attacker; enumeration attacker; credential-stuffing attacker (post password-auth) |

## How to read a threat model

1. **Adversary objective** — what the attacker is trying to achieve.
2. **Attack paths** — concrete sequences from "outside the system" to
   "objective achieved", structured as STRIDE categories.
3. **Mitigations in place** — what currently blocks the path. Each
   references a file, test, or runbook.
4. **Residual risk + gaps** — what doesn't fully block today. Each
   gap names the apex-plan PR or sprint that closes it.
5. **Review cadence** — when this model is re-walked.

If a section says *"queued"*, that gap is acknowledged + tracked.
Honesty discipline: we don't pretend an unimplemented mitigation is
already shipped.

## See also

- [`docs/security/incident-response.md`](../incident-response.md) — what
  happens when an attack succeeds.
- [`docs/security/audit-trail.md`](../audit-trail.md) — the tamper-
  evident chain that supports forensic investigation.
- [`docs/ai/eu-ai-act-conformance.md`](../../ai/eu-ai-act-conformance.md)
  §6 — risk-management table that references this folder.
- [`SECURITY.md`](../../../SECURITY.md) — disclosure policy if someone
  finds a path we missed.
