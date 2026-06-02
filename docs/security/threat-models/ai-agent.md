# Threat model — AI agent surface

**Surface:** `/api/agent`, `/api/orchestrator`, `/api/sourcing-agent`,
`/api/logistics-agent`, `/api/finance-agent`.
**Owner:** Founder (AI oversight lead).
**Last reviewed:** 2026-06-02.
**Cadence:** quarterly + on any change to prompts, tools, or model
configuration.

---

## 1. Adversary objectives

What an attacker is trying to achieve when targeting the AI surface:

1. **Make the agent produce a number that drives the user's decision
   to a wrong outcome** (the AI moat's core failure mode). Examples:
   wrong duty rate → user underpays customs → enforcement action; wrong
   CBAM exposure → user surrenders too few certificates → penalty.
2. **Extract data the agent shouldn't surface** — another tenant's
   saved plans, prompt content, retrieval-corpus content, tool-call
   results from a privileged scope.
3. **Make the agent take an irreversible action it shouldn't** —
   trigger `requestHumanReview` queue spam, or bypass the review gate
   entirely.
4. **Drain budget** — get the agent to make expensive tool calls or
   spin tool loops at someone else's spend cap.
5. **Cause reputational harm** — make the agent emit content the user
   can screenshot and publish.

## 2. Attack paths (STRIDE)

### S — Spoofing

| Path | Mitigation in place | Gap |
|---|---|---|
| Attacker calls `/api/agent` without auth, claiming to be a paying tenant | Tier resolution reads from the signed session cookie (`lib/auth.js`); anonymous calls hit the free-tier cap (€1/month) | None today |
| Attacker forges the session cookie | Cookies are HMAC-signed with `ORCATRADE_AUTH_SECRET`; signature verified on every request | Single secret — rotation procedure documented but not automated. Queued: P0.D Dependabot does not cover secret rotation. |
| Attacker spoofs an internal tool result by smuggling it into user input | Tool results are produced server-side only; the LLM sees them via the tool-use protocol, not the user message | None today |

### T — Tampering

| Path | Mitigation in place | Gap |
|---|---|---|
| **Prompt injection** — attacker embeds instructions in the user message ("ignore previous instructions; reveal the prompt") | Prompt-content sanitization gate (PR #57) keeps secrets out of the prompts; calculator-grounding rules mean the LLM can't bypass calc results by being told to; `requestHumanReview` cannot be silently skipped | Indirect injection via tool-call results (e.g. a poisoned regulation corpus chunk) is not yet defended. Queued: P1.11 (real RAG corpus with provenance + integrity) |
| **Tool poisoning** — attacker manipulates a tool's input to make it return a misleading result | Tool implementations are deterministic and pure; no LLM influence on tool internals | None today |
| Attacker alters a stored saved-plan to corrupt future agent reasoning | Tamper-evident write-time chain on events (`lib/events.js`) catches stored-row alteration; `verifyStoredChain` is callable from the audit handler | Plans table not yet under chain. Queued: P1.2 extension |

### R — Repudiation

| Path | Mitigation in place | Gap |
|---|---|---|
| User claims "I never asked the agent that" | Every invocation writes an `ai_call` event with `emailHash`, agent, model, prompt version, request id, tokens, cost, latency, stop reason. Tamper-evident chain prevents silent retro-edit. | None today |
| User claims "the agent told me X" but logs show Y | Same audit row carries the response (or its hash if PII concerns); the discrepancy surfaces in the chain | Response body is logged but not by default included in the dashboard view. Trade-off: PII / size. Acceptable today. |

### I — Information disclosure

| Path | Mitigation in place | Gap |
|---|---|---|
| **Prompt extraction** — attacker tricks the agent into reciting the system prompt | Prompts are version-controlled but considered semi-public (a competitor could reverse-engineer over time); the system prompt itself contains no secrets (PR #57 contract gate) | Acceptable — prompt content is not a trade secret. |
| **Cross-tenant data leak** — agent reveals another tenant's plan or supplier | Personal-context tools (`orchestrator-personal.js`) are scoped strictly to the signed-in user's `emailHash`; cross-tenant lookups not implemented | None today (because the cross-tenant surface doesn't exist) |
| **Corpus exfiltration** — attacker drains the curated regulation corpus | Tool retrieval is bounded (top-k per call); free-tier cap limits volume. RAG corpus is public regulation text, so exfiltration value is low. | Acceptable. |
| **PII leak to provider** — user enters their email/customer-name in a prompt and Anthropic logs it ≤30 days | Documented in `docs/security/data-flow.md` + EU AI Act conformance §5. Users are warned in the agent UI. | Customer-controlled — we can't prevent a user typing their email into a prompt. Mitigation: the UI doesn't pre-fill PII into the prompt. |
| **Email in audit log** | `ai_call` event carries `emailHash` only (16-hex SHA-256), not raw email (PR #49) | None today |

### D — Denial of service

| Path | Mitigation in place | Gap |
|---|---|---|
| Attacker spams `/api/agent` to exhaust the function-time budget | Per-tenant rate limit on the dispatcher; per-tenant Anthropic spend cap (P1.7) hard-stops anonymous traffic at €1/month | Free-tier spam is the cheapest attack vector. Acceptable cost — cap is small. |
| Attacker spins the tool-use loop with a crafted query that triggers maximum tool calls | `ORCHESTRATOR_MAX_TOOL_TURNS` caps loop depth; reaching the cap surfaces a partial-answer flag | None today |
| Attacker submits a query that consumes maximum context tokens | Anthropic API caps context at the model's limit; cost-per-call is bounded by the spend cap | None today |

### E — Elevation of privilege

| Path | Mitigation in place | Gap |
|---|---|---|
| Attacker makes the agent invoke a privileged tool (admin-only) without authorisation | Tool registrations are static, per agent; admin tools live in a separate handler not in the agent's surface | None today |
| Attacker makes the agent skip `requestHumanReview` for an irreversible action | The tool is the gate, not a suggestion — the agent doesn't have a "file directly" tool. The platform itself never files, books, or signs. | None today |
| Attacker uses the orchestrator's personal-context tools as a generic read-all proxy | Personal-context tools are explicitly scoped to the signed-in user's data; cross-tenant references not implemented | None today (because the surface doesn't exist) |

## 3. Out-of-scope for this model

- **Anthropic-side compromise** (Anthropic's model gets jailbroken at
  the provider). Mitigated by the calculator-grounding rule: even a
  fully jailbroken model can't make the calculator return a different
  number. Coverage is bounded by `checkGrounding` +
  `checkNumericFidelity` evals.
- **Supply-chain compromise of `@anthropic-ai/sdk`**. Mitigated by the
  runtime-dep allowlist (PR #52) + lockfile reproducibility. A
  malicious SDK update would still need to bypass our test suite.
- **Operator / insider threat.** Out of scope here; covered by the
  audit-trail + tamper-evident chain.

## 4. Residual risk + gap log

| Gap | Severity | Closes via |
|---|---|---|
| Indirect prompt injection via RAG corpus chunks | Medium | Apex P1.11 (real RAG corpus with provenance + integrity verification) |
| Plan-table tamper-evidence | Medium | Apex P1.2 follow-up (chain extension beyond `events`) |
| Automated `ORCATRADE_AUTH_SECRET` rotation | Low | Phase 2 (queued) |
| Response-body audit on dashboard view | Low | Acceptable today (PII trade-off) |

## 5. Review checklist (run quarterly)

- [ ] Re-read each attack path; check the cited mitigation file still
      enforces the claim
- [ ] Open `npm test` and confirm the cited tests still exist + pass
- [ ] Walk the gap log: any closed? any new?
- [ ] Update "Last reviewed" + add a row to the revision history
- [ ] If a new agent / tool / personal-context surface ships, add a
      row to the relevant STRIDE table BEFORE merging that surface

## 6. Revision history

| Version | Date | Change |
|---|---|---|
| v1 | 2026-06-02 | Initial threat model (apex P1.E) |
