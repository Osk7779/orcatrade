# OrcaTrade Intelligence — Codex Task Spec

This file defines backend tasks for Codex to work on in parallel with frontend work.
All serverless functions are CommonJS (`module.exports`). No npm dependencies may be added to API routes.
Deploy target: Vercel. Environment variable: `ORCATRADE_OS_API` (Anthropic key).

---

## Task 1 — Smarter chat triage in `api/chat.js`

**Problem:** When a user message scores 0 on all pillar keywords, the bot returns a generic triage
reply. This is jarring — users asking general CBAM questions get routed away.

**Goal:** Before sending a static triage reply, check if the message contains compliance-adjacent
language (cbam, eudr, import, regulation, penalty, fine, certificate, declarant, supplier, goods,
customs) and if so, treat it as `compliance` intent and answer with AI instead of routing.

**File:** `api/chat.js`
**Change:** In the `intent === 'triage'` branch, run a secondary check for compliance keywords before
falling back to `streamStaticReply(res, buildTriageReply())`. If the message matches, set intent to
`'compliance'` and proceed to the AI call.

---

## Task 2 — Inline quick-check endpoint `api/quick-check.js`

**Goal:** Create a new endpoint that accepts `{ productCategory, origin, importValue }` and returns a
short (3-sentence) compliance verdict as plain text — not the full JSON report.

This powers a "Try it now" widget on `intelligence.html` (form already wired to `/api/quick-check`).

**Response format:**
```json
{ "verdict": "string", "status": "at_risk | compliant | non_compliant | not_applicable", "cta": "string" }
```

**Rules:**
- Use `determineRegulationApplicability` from `lib/intelligence/compliance.js` for the pre-check
- Call Claude with max_tokens 160 for a terse verdict
- If no API key, return a sensible static fallback based on category/origin
- No streaming — plain JSON response

---

## Task 3 — Rate limiting in `api/check.js` and `api/chat.js`

**Problem:** Both endpoints hit Anthropic with no rate limiting. Vercel functions can be called
in rapid succession, burning API tokens.

**Goal:** Add a simple in-memory request counter per IP (use `req.headers['x-forwarded-for']`).
Allow max 5 calls per IP per 60 seconds for `/api/check`, max 20 for `/api/chat`.
Return `429` with `{ error: 'Too many requests. Please wait a moment.' }` if exceeded.

Use a module-level `Map` keyed by IP → `{ count, windowStart }`. This resets per cold start
which is fine for our traffic level.

---

## Task 4 — Email notification after compliance report `api/check.js`

**Goal:** After a successful report is generated, fire-and-forget an email to
`intelligence@orcatrade.pl` with a summary: reportId, productCategory, origin, overallStatus,
overallScore, and the user's company (if provided in the request body).

Use the existing Resend API pattern from `api/contact.js` if one exists, or use a raw `fetch`
to `https://api.resend.com/emails`. Add `RESEND_API_KEY` to environment variables.
Wrap in try/catch so email failure never breaks the report response.

---

## Task 5 — `lib/intelligence/live-pillars.js` — expand general company keywords

**File:** `lib/intelligence/live-pillars.js`
**Function:** `isGeneralCompanyQuestion(text)`

Add these missing keywords to the regex so the chatbot doesn't reject them as out-of-scope:
`certificate`, `declarant`, `declaration`, `threshold`, `penalty`, `penalties`, `fine`, `fines`,
`import`, `imports`, `importer`, `goods`, `cbam`, `eudr`, `regulation`, `compliance`, `compliant`

These are general questions users ask before they know which pillar they need.

---

## Constraints

- Do NOT change `compliance/`, `factory-risk/`, or `supply-chain/` sub-pages
- Do NOT add new npm dependencies — use Node.js built-ins and existing packages only
- Do NOT modify `lib/intelligence/compliance.js` score/status logic
- Run `node --test` after any change to `lib/` files to ensure tests pass
- Commit each task separately with a clear message