# Threat model — Magic-link authentication

**Surface:** `/api/auth/request`, `/api/auth/verify`, `/api/auth/me`,
`/api/auth/logout`, session cookie.
**Owner:** Founder.
**Last reviewed:** 2026-06-02.
**Cadence:** quarterly + on any change to the auth flow.

---

## 1. Adversary objectives

1. **Account takeover** — sign in as another user without their
   credentials.
2. **Token reuse** — replay a magic-link token after it was used or
   should have expired.
3. **User enumeration** — determine which email addresses have an
   OrcaTrade account.
4. **Credential stuffing** (post password-auth migration) — try
   leaked password lists at the password endpoint.
5. **Cookie theft** — steal a session cookie via XSS or MITM.

## 2. Attack paths (STRIDE)

### S — Spoofing

| Path | Mitigation in place | Gap |
|---|---|---|
| Replay an old magic-link URL | One-time-use enforced: the verify handler deletes the KV row on success. A second use returns "token used". | None today |
| Forge a magic-link token | Tokens are random 32-hex (crypto.randomBytes); KV-keyed, server-known only | None today |
| Replay an old session cookie | Cookies HMAC-signed with `ORCATRADE_AUTH_SECRET`; revocation list (`/api/auth/revoke-all`, `/api/auth/sessions/<id>/revoke`) invalidates server-side | None today |
| Impersonate the OrcaTrade-from address in the magic-link email | Resend SPF + DKIM configured at the domain level; DMARC policy at `p=quarantine` | DMARC could be `p=reject`. Queued: DNS hardening sprint |

### T — Tampering

| Path | Mitigation in place | Gap |
|---|---|---|
| Modify the email address in the magic-link URL before clicking | The token (not the email) is the lookup key; the token's KV row carries the intended email server-side. Mismatch rejected. | None today |
| Tamper with the session cookie payload | Cookie format includes the HMAC; any modification invalidates the signature | None today |
| Tamper with the session-cookie path / domain to leak to subdomains | Cookies set with `Path=/; SameSite=Lax; Secure; HttpOnly` (`test/security-headers.test.js` pins this) | None today |

### R — Repudiation

| Path | Mitigation in place | Gap |
|---|---|---|
| User claims "I never logged in from there" | `auth_signin` event written with timestamp, IP, user-agent, before success returns | Granular per-session detail (e.g. last-active timestamps) tracked but not exposed in `/account/security/`. Acceptable today. |
| User claims "I never approved that draft" | Approval surface writes `document_approved` event with actor's `email_hash`; tamper-evident chain prevents retro-edit | None today |

### I — Information disclosure

| Path | Mitigation in place | Gap |
|---|---|---|
| **User enumeration** via timing on `/api/auth/request` (existing email vs. new) | The request endpoint returns 200 unconditionally; KV write is the same shape whether the email exists or not. Response time is dominated by the Resend API call. | Response-time difference between "email send succeeded" vs. "email send failed silently" could leak the email's deliverability — but not its existence in OrcaTrade. Acceptable today. |
| Account-existence leak via `/api/auth/signup` (collision returns 409 vs. 200) | Documented behaviour: signup flow needs the collision response so the user can recover. Trade-off accepted. | Acceptable. |
| Session cookie stolen via XSS | CSP blocks inline + external scripts except allowlisted CDNs (vercel.json); HttpOnly cookie cannot be read by JS | XSS via Markdown rendering of user content not yet sandboxed (Markdown is sanitised but a future exploit could surface). Queued: Markdown renderer hardening |
| Session cookie stolen via MITM | HSTS preload (`Strict-Transport-Security: max-age=63072000; preload`); `Secure` flag on cookie | None today (HTTP downgrade impossible after preload propagates) |
| `ai_call` audit row exposes raw email | Audit log redactor turns email → 12-hex hash; PG events store 16-hex `email_hash` | None today |

### D — Denial of service

| Path | Mitigation in place | Gap |
|---|---|---|
| Spam `/api/auth/request` to lock out a user with rate-limit "too many requests" | Per-email and per-IP counters with TTL (PR #67 hygiene gate ensures the TTL) | Granular per-IP throttling could deny a coffeeshop full of users; per-email cap is the safer keying. Acceptable today. |
| Email bombing via `/api/auth/request` | Resend-side rate limit + our own per-email TTL counter | Resend bills per email; an attacker could increase our bill. Spend cap acts as an upper bound. |
| Massive `/api/auth/verify` brute-force on a stolen-token-fragment | Per-token KV row + cooldown; tokens are 32-hex (128-bit entropy) so brute-forcing is impractical | None today |

### E — Elevation of privilege

| Path | Mitigation in place | Gap |
|---|---|---|
| Sign in then access admin endpoints (`/api/audit`, `/api/leads`) without admin token | Admin endpoints token-gated independently of the session cookie; admin token (`ORCATRADE_LEADS_TOKEN`) is server-side only | None today |
| Org-owner privilege escalation by editing KV directly | KV is platform-internal; no API surface to write KV beyond what handlers expose | None today |
| MFA bypass | TOTP MFA enforced when enabled (`lib/handlers/auth.js`); challenge has its own per-email failure counter with TTL | None today |
| Password endpoint accepts an unsalted leaked password | Passwords stored as bcrypt hash with per-user salt; brute-forcing on the client side bounded by per-IP cap | None today |

## 3. Out-of-scope for this model

- **Email-provider compromise** (an attacker compromises Resend or
  the user's email inbox). Mitigated by short magic-link TTL
  (15 minutes); a stale leaked link is unusable.
- **Stolen device** (attacker has the user's logged-in laptop). User
  is expected to revoke from `/account/security/` after a known loss.
- **Social engineering of the founder** to grant admin access. Covered
  in incident-response.md.

## 4. Residual risk + gap log

| Gap | Severity | Closes via |
|---|---|---|
| DMARC at `p=reject` (currently `p=quarantine`) | Low | DNS hardening sprint (queued) |
| Markdown-renderer XSS sandbox | Low | Renderer hardening sprint (queued) |
| Granular per-session detail surfaced in `/account/security/` | Low | Acceptable today |

## 5. Review checklist (run quarterly)

- [ ] Re-walk each STRIDE table; confirm mitigations + their tests
- [ ] Confirm `test/security-headers.test.js` still asserts the
      cookie hardening
- [ ] Confirm `test/auth.test.js` and `test/mfa-totp.test.js` pass
- [ ] Update "Last reviewed" + revision history

## 6. Revision history

| Version | Date | Change |
|---|---|---|
| v1 | 2026-06-02 | Initial threat model (apex P1.E) |
