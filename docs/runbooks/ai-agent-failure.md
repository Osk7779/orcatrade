# AI agent failure (Anthropic / agent loop / cost spike)

## When to use this runbook

- One or more agent endpoints (`/api/agent`, `/api/orchestrator`,
  `/api/finance-agent`, `/api/logistics-agent`, `/api/sourcing-agent`,
  `/api/chat`, `/api/quick-check`, `/api/check`, `/api/analysis`,
  `/api/factory-score`) returning 5xx or hanging
- Agent responses returning empty `content`
- Cost telemetry (`lib/ai/cost-telemetry.js` logs) shows a spike >2×
  baseline over a 1-hour window
- Eval CI gate ([.github/workflows/evals.yml](../../.github/workflows/evals.yml))
  regressing on the offline scorer
- A customer reports the agent "doesn't know things it used to know"

## Prerequisites

- Admin access to: Vercel logs, Anthropic console (billing + status), Sentry
- Knowledge of: [lib/handlers/agent.js](../../lib/handlers/agent.js) +
  [lib/ai/](../../lib/ai/) registry + prompt files

## Procedure

1. **Check Anthropic status first.**
   [https://status.anthropic.com/](https://status.anthropic.com/).
   If degraded → post to `/status/`, monitor, no code fix needed. Our
   handlers should be degrading gracefully via timeout + (post-P0.3)
   circuit-breaker fallback. If they're not, that's a separate runbook
   gap to file.

2. **Check `/api/health`** for the AI subsystem section:

   ```bash
   curl -s https://orcatrade.pl/api/health | jq .aiSubsystem
   ```

   Looks at: model registry shape (per [ADR 0010](../adr/0010-typescript-incremental-adoption.md)),
   prompt registry load status, last successful Anthropic call timestamp.

3. **Categorise:**

   | Symptom | Likely cause | Next step |
   |---|---|---|
   | All agents 5xx | Anthropic outage or API key revoked | step 4 |
   | One agent 5xx | That agent's prompt / tool wiring | step 5 |
   | Agents return but with empty content | Model deprecated, output token cap hit, or tool-loop infinite | step 6 |
   | Cost spike | Runaway loop or per-tenant cap missing | step 7 |
   | Eval regression | Prompt or tool change made it through CI | step 8 |

4. **API key revoked.** Check `ANTHROPIC_API_KEY` in Vercel env vars
   matches the value in Anthropic console → API Keys. If the console
   shows revoked → rotate per
   [docs/handbook/security.md](../handbook/security.md) §Secrets management:

   ```bash
   vercel env rm ANTHROPIC_API_KEY production
   vercel env add ANTHROPIC_API_KEY production   # paste new key
   vercel deploy --prod
   ```

5. **Single-agent failure.** Check Vercel logs for that handler:

   ```bash
   vercel logs --since 30m | grep -i 'agent\|orchestrator\|finance-agent'
   ```

   Common causes:
   - Recent prompt change broke tool schema validation
   - Tool definition mismatch with what the agent expects (e.g. renamed
     calculator function)
   - Model ID change in `MODELS.*` (registry — see [ADR 0010](../adr/0010-typescript-incremental-adoption.md)+ [ADR 0003](../adr/0003-anthropic-sdk-boundary.md))
     that doesn't exist on Anthropic's side anymore

   Rollback the latest PR touching that agent's files; the standard
   PR + revert + preview + review flow applies even under pressure.

6. **Empty content / output cap / tool-loop infinite:**

   - **Output cap:** look for `stop_reason: 'max_tokens'` in logs. Bump
     `max_tokens` for the affected handler. Cheap fix.
   - **Tool-loop infinite:** look for repeated tool calls in a row.
     The agent's iteration cap in `lib/handlers/agent.js` should
     prevent unbounded loops, but a buggy tool that always asks for
     "more info" can spin near the cap. Mitigation: ship a tighter
     cap as a quick fix; investigate the tool separately.
   - **Model deprecated:** Anthropic occasionally deprecates older
     snapshots. Update `MODELS.*` in [lib/ai/models.js](../../lib/ai/models.js)
     to the current alias; commit via PR per
     [test/model-registry-enforcement.test.js](../../test/model-registry-enforcement.test.js).

7. **Cost spike.** Check `lib/ai/cost-telemetry.js` log entries for the
   spike window:

   ```bash
   vercel logs --since 1h | grep '"agent-cost":' | jq -s 'group_by(.userTier) | map({tier: .[0].userTier, costCents: map(.costCents) | add})'
   ```

   Common culprits: a single user looping the chat agent; a misbehaving
   integration making the same eval-style query repeatedly. Mitigation:
   per-tenant cost cap is **Phase 1 task P1.7** — not yet shipped.
   Until then, manually IP-block / user-block via the rate-limiter in
   `lib/intelligence/runtime-store.js` while you investigate.

8. **Eval regression.** Check the offline eval logs
   ([.github/workflows/evals.yml](../../.github/workflows/evals.yml)).
   If a recent PR regressed the scorer, revert that PR. If the regression
   is in the live eval (nightly), check Anthropic's release notes —
   sometimes a model update changes output style enough to trip our
   regexes. Update the eval cases under
   [lib/ai/evals/](../../lib/ai/evals/) as needed.

9. **Eval-gate red on a recent merge.** The post-merge gate
   ([.github/workflows/eval-gate.yml](../../.github/workflows/eval-gate.yml),
   per [ADR 0018](../adr/0018-eval-gate-post-merge-95pct.md))
   fires on `push: main` when AI-relevant files change and fails
   the workflow when any agent's pass-rate drops below **95%**.
   When it fires:

   ```bash
   # 1. Identify the offending merge:
   gh run list --workflow=eval-gate.yml --limit 5
   gh run view <run-id> --log-failed   # see which agent + which case

   # 2. Decide: revert vs. case-rewrite.
   #    - If the failing case is testing real behaviour that
   #      regressed → revert the merge:
   gh pr list --search "merged:>$(date -u -d '24 hours ago' +%Y-%m-%d)" --base main
   gh pr revert <pr-number>   # opens a revert PR; merge it

   #    - If the failing case is testing the wrong thing
   #      (e.g. an outdated regex, an Anthropic style change) →
   #      update lib/ai/evals/<agent>/cases.v1.json in a follow-up PR,
   #      cite the upstream change in the PR description

   # 3. Re-run the gate against the revert / fix commit:
   gh workflow run eval-gate.yml \
     --ref main \
     -f agent=<agent>   # leave blank to re-run all
   ```

   **Note on missing key:** if `ANTHROPIC_API_KEY` was unset on
   the run, the gate emits a `::warning::` and exits 0 (advisory
   pass per ADR 0018). Treat that as a real-failure signal and
   re-run after restoring the secret.

## Verification

After mitigation:

1. `/api/health` shows `aiSubsystem.ok: true`
2. Hand-fire a test query against the affected agent via curl
3. Cost telemetry returns to baseline within 15 min
4. Eval CI green on the next push

## Rollback

- Env-var rotation: see step 4's reverse procedure
- Code change: standard PR revert + redeploy
- Prompt change: bump the prompt to a previous version per
  [ADR 0009](../adr/0009-conventional-commits-release-please.md) —
  prompts are version-pinned files in `lib/ai/prompts/`

## Related

- [ADR 0002 — LLM never produces decision-driving numbers](../adr/0002-llm-never-produces-decision-numbers.md) —
  the LLM is *allowed* to fail because the underlying calculators
  remain authoritative; a hallucinated number is the worst-case
  failure mode this ADR guards against
- [ADR 0003 — Anthropic SDK boundary](../adr/0003-anthropic-sdk-boundary.md)
- [ADR 0006 — Circuit breaker on external calls](../adr/0006-circuit-breaker-on-external-calls.md) —
  Phase 0 P0.3 migrates Anthropic calls onto the circuit; until then,
  raw-fetch timeouts are the only protection
- [Phase 1 P1.7 — per-tenant Anthropic spend cap](../execution-plan.md) —
  the structural fix for the cost-spike scenario above
- [docs/handbook/security.md](../handbook/security.md) §Secrets management

## More information

- [Anthropic status page](https://status.anthropic.com/)
- [Anthropic API documentation](https://docs.anthropic.com/)
- [lib/ai/models.js](../../lib/ai/models.js) — the model registry that
  [test/model-registry-enforcement.test.js](../../test/model-registry-enforcement.test.js)
  enforces
