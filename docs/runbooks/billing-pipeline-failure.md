# Billing pipeline failure (Stripe checkout / portal / metering)

## When to use this runbook

- Customer reports checkout failing or hanging
- Customer reports cannot access Stripe customer portal
- Stripe webhook receiver (`/api/billing/webhook`) returning 5xx
- (Phase 2+) Metering events not landing in Stripe
- Subscription state in our DB disagrees with Stripe's view

> **Honesty note:** the full Phase 2 metering pipeline (P2.1, P2.B) is
> not yet shipped. This runbook covers today's checkout + portal flow
> + webhook receiver, and forward-leans on the metering side. Sections
> marked **(Phase 2)** apply only after that work lands.

## Prerequisites

- Admin access to: Stripe Dashboard, Vercel project, Sentry
- `stripe` CLI authenticated to the right account
- Knowledge of `lib/handlers/billing.js` + `lib/stripe.js`

## Procedure

1. **First decision: is this Stripe-side or our-side?** Check
   [Stripe status](https://status.stripe.com/). If Stripe shows
   degraded → post to `/status/`, monitor, no code fix from our side.
   Otherwise continue.

2. **Check the webhook receiver health.** In Stripe Dashboard →
   Developers → Webhooks → click the endpoint pointing at
   `https://orcatrade.pl/api/billing/webhook`. The "Recent events"
   list shows the last ~50 webhook deliveries + their HTTP status.

   | Symptom | Cause | Next step |
   |---|---|---|
   | All events 200 | Webhook healthy; the issue is downstream | step 4 |
   | Many events 4xx | Webhook signature verification failing | step 3 |
   | Many events 5xx | Handler crashing | step 5 |
   | No recent events at all | Stripe not sending; check the endpoint URL + event subscription | re-add endpoint |

3. **Webhook signature failures** — usually means `STRIPE_WEBHOOK_SECRET`
   in the Vercel project env vars doesn't match the one in Stripe
   Dashboard → Webhook → Signing secret. To recover:

   ```bash
   # Pull the current secret from Stripe
   stripe webhook_endpoints retrieve <endpoint-id> --format json | jq .secret

   # Update the Vercel env var (production)
   vercel env rm STRIPE_WEBHOOK_SECRET production
   vercel env add STRIPE_WEBHOOK_SECRET production   # paste the value when prompted
   vercel deploy --prod
   ```

   Then in Stripe Dashboard → Webhooks → endpoint → "Resend events"
   for any events that 4xx'd while the secret was wrong.

4. **Downstream issue (events delivered + 200 but subscription state
   wrong).** Check [lib/handlers/billing.js](../../lib/handlers/billing.js)
   logs in Vercel for the timeframe of the failing event. Common:

   - Race condition between `customer.subscription.updated` + our DB
     write — the second event wins; idempotency-key check in
     [lib/stripe.js](../../lib/stripe.js) should prevent it but worth
     verifying
   - Customer record not found locally — Stripe sent an event for a
     customer we don't have; usually a test-mode/live-mode mix-up

5. **Handler crashing (5xx).** Check Sentry for the
   `billing.webhook.handler` errors. Common:

   - Schema change in a Stripe object we depend on (Stripe occasionally
     adds non-nullable fields to existing objects in API version bumps)
   - `STRIPE_API_VERSION` in [lib/stripe.js](../../lib/stripe.js) is
     pinned but stale — see ADR 0007 (stable contracts) for the
     versioning posture

   Mitigation: pin to the previous deployment via Vercel dashboard
   while you investigate; the webhook receiver returning 200-with-error
   is preferable to a crash loop (Stripe will retry 5xxs with exponential
   backoff, which can saturate the function pool).

## Verification

After mitigation:

1. Stripe Dashboard → Webhooks → recent events showing 200s
2. A test webhook event (use `stripe trigger checkout.session.completed`
   from the CLI) lands + persists to our DB
3. Open the customer portal as a test user → can see subscription +
   update payment method

## Rollback

- Config change (env var): see step 3's reverse procedure
- Code change: standard PR revert + redeploy

For a fully-broken deploy, use Vercel's "Promote previous deployment"
in the deployments dashboard. This is faster than waiting for a PR
to merge.

## Related

- [ADR 0006 — Circuit breaker on external calls](../adr/0006-circuit-breaker-on-external-calls.md) —
  Stripe calls should wrap the circuit (Phase 0 P0.3 migration covers
  Anthropic; Stripe is next)
- [ADR 0007 — API v1 stable contracts](../adr/0007-api-v1-stable-contracts.md) —
  our outbound contract to Stripe + our inbound contract from Stripe
  are both pinned via `STRIPE_API_VERSION`
- [docs/handbook/security.md](../handbook/security.md) — `STRIPE_*`
  secrets rotation procedure
- [Phase 2 task P2.1 + P2.B](../execution-plan.md) — the metering
  pipeline this runbook will need to expand for

## More information

- [Stripe status page](https://status.stripe.com/)
- [Stripe webhook documentation](https://stripe.com/docs/webhooks)
- [Stripe CLI](https://stripe.com/docs/stripe-cli)
