# Set up the team mailbox and restore email delivery

## When to use this runbook (REQUIRED)

- Inquiries, founding applications, weekly digests or drift alerts are not
  arriving in the team inbox.
- Resend's Emails log shows `bounced` or `suppressed` for internal recipients.
- First-time setup of `orcatrade@orcatradegroup.com`, the single team
  mailbox every internal notification is sent to (`lib/email.js` →
  `teamInbox()`, overridable with `ORCATRADE_TEAM_INBOX`).

Background (2026-09-18): the per-person Google Workspace mailboxes on
`orcatrade.pl` (`orca@`, `oskar@`, `arman@`, `nigel@`, `leads@`,
`intelligence@`) stopped existing. Google hard-bounced with `550 5.1.1`,
Resend then suppressed every one of them, and all internal mail since was
silently dropped. Sending itself (Resend, domain `orcatrade.pl`) was fine.

## Prerequisites (REQUIRED)

- Login for the DNS host of `orcatradegroup.com` (today: home.pl —
  nameservers `dns.home.pl`, `dns2.home.pl`, `dns3.home.pl`).
- Resend dashboard access (account that owns domain `orcatrade.pl`).
- Vercel access to project `orcatrade` (env vars).

## Procedure (REQUIRED)

1. **Create the receiving mailbox** for `orcatrade@orcatradegroup.com`.
   Pick one:
   - *Cloudflare Email Routing (free, forwards to any inbox)*: add
     `orcatradegroup.com` to Cloudflare, switch the nameservers at home.pl
     to the two Cloudflare gives you, copy over the existing records
     (apex `A 216.198.79.1`, `www CNAME cname.vercel-dns.com`), enable
     Email Routing and create `orcatrade@` → your personal inbox. Add a
     catch-all → same inbox so old aliases (`privacy@`, `press@`, …) land too.
   - *Google Workspace / Zoho Mail (a real mailbox)*: add the domain and
     create the user; publish the MX records they give you.
2. **Verify the domain for sending in Resend** (domain already created,
   id `6fbba680-5f54-4a64-9f8e-3a9cdde15fce`, region eu-west-1). Publish:

   | Type | Name | Value | Priority |
   |---|---|---|---|
   | TXT | `resend._domainkey` | `p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDK5phEYRrhqgxrmCdCNdxtV1jE+3oPrnOwsSIHnTxMjbc6Vae1IPRAd4+pnGx4JIH4u5m4sFKOTxNnfuV1iHmdPgb3iHzMwr29e6XU6E0rXYKh70hlzXgsCDEwl+9FpqJtFAeGR2xm7zvD9gVMh5LAiRkUZOQoVJ6ys8ODScahKwIDAQAB` | |
   | MX | `send` | `feedback-smtp.eu-west-1.amazonses.com` | 10 |
   | TXT | `send` | `v=spf1 include:amazonses.com ~all` | |
   | CNAME | `rsend` | `send.forge.rmta.net` | |
   | TXT | `_dmarc` | `v=DMARC1; p=none;` | |

   These live on the `send`/`resend` subdomains, so they never conflict
   with the mailbox MX records from step 1. Click **Verify** in Resend.
3. **Point the app at the mailbox** (Vercel → orcatrade → Settings →
   Environment Variables, Production + Preview):
   - `ORCATRADE_TEAM_INBOX=orcatrade@orcatradegroup.com`
   - `ORCATRADE_LEADS_INBOX` and `ORCATRADE_FOUNDER_INBOXES`: set to the
     same address, or delete them (both fall back to the team inbox).
   - After step 2 verifies: `RESEND_FROM=OrcaTrade <noreply@orcatradegroup.com>`
     (until then keep the working `…@orcatrade.pl` sender).
   Redeploy production for env changes to apply.
4. **Clear suppressions**: Resend → Suppressions → remove any entry for the
   team address (it may have been suppressed if mail was sent before step 1).

## Verification (REQUIRED)

- `dig +short MX orcatradegroup.com` returns the mailbox provider's MX.
- Resend → Domains shows `orcatradegroup.com` as **verified**.
- Submit the contact form on `/contact/`; Resend → Emails shows the send
  as `delivered` (not `bounced`/`suppressed`) and it arrives in the inbox.
- `/api/health` → `subsystems.resend.status` is `ok`.

## Rollback (REQUIRED)

Set `ORCATRADE_TEAM_INBOX` back to any address that is known to receive
mail and redeploy. `RESEND_FROM` can revert to the `orcatrade.pl` sender at
any time — that domain stays verified.

## Related

- `lib/email.js` (`teamInbox`, `resolveFrom`), `test/email-team-inbox.test.js`
- [auth-subsystem-failure.md](auth-subsystem-failure.md) — magic-link emails
- ADR 0006 (circuit breaker on external calls), ADR 0008 (email pseudonymisation)

## More information

Resend only delivers `onboarding@resend.dev` sandbox sends to the account
owner, so `DEFAULT_FROM` in `lib/email.js` is a verified-domain address.
