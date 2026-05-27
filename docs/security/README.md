# Security & compliance

**Index for the OrcaTrade security documentation set.** Read this first if you're new to the folder.

The audience is split:
- **Customers + prospects** evaluating OrcaTrade for procurement — start with [`dpa-template.md`](dpa-template.md) and [`soc2-readiness.md`](soc2-readiness.md).
- **Engineers** working on the platform — start with [`data-flow.md`](data-flow.md) and [`incident-response.md`](incident-response.md).
- **The DPO / founder** during a regulator interaction — every file in this folder is the answer set, version-controlled, dated.

For the broader engineering plan that ties into compliance, see [`../backend-grade-plan.md`](../backend-grade-plan.md) Track 5.

---

## Documents

| File | Audience | Purpose |
|---|---|---|
| [`data-flow.md`](data-flow.md) | Engineers, DPO | What personal data we hold, where it lives, how long, how each GDPR right maps to an endpoint |
| [`subprocessors.md`](subprocessors.md) | DPA signatories | Full list of third parties processing customer data, with DPA links + transfer mechanisms |
| [`dpa-template.md`](dpa-template.md) | Customers signing a DPA | Article 28 DPA template + Annex A technical/organisational measures |
| [`incident-response.md`](incident-response.md) | Engineers, DPO | Severity classes, runbooks, post-mortem cadence, breach-notification SLAs |
| [`soc2-readiness.md`](soc2-readiness.md) | Procurement, auditors, sales engineers | Honest gap analysis against AICPA TSC; what's in place, what's queued, what we're upfront about not having yet |
| [`audit-trail.md`](audit-trail.md) | Auditors, procurement, DPO | Tamper-evident hash-chained audit log + how to independently verify an export |

---

## Honesty discipline

Every file in this folder is dated + signed by the owner. When something changes, we update the date and the file content — not by adding marketing-shine, but by removing claims that are no longer accurate or adding gaps we've discovered. The point of this folder is to be useful in a real procurement conversation. That requires being honest about what's not done yet.

If you spot a claim in here that doesn't match how the platform actually behaves, that's a bug — email `orca@orcatrade.pl` with subject "security docs drift" and we'll fix it within 5 business days.

---

## Cadence

- **Per file**: dated `Last reviewed` at the top. Owner reviews + updates on any material change.
- **Quarterly**: full folder re-review by the founder + (when hired) head of platform. Outdated rows in `soc2-readiness.md` get updated; closed gaps move from 🟡 / ❌ to ✅; new tracks added.
- **Annually**: formal review + external pen test (planned 2026-Q4) + audit-readiness sweep ahead of SOC 2 Type I.

---

## Quick links

- Live operational status: [`/status/`](https://orcatrade.pl/status/)
- Privacy & data UI for customers: [`/account/privacy/`](https://orcatrade.pl/account/privacy/)
- GDPR endpoints: `GET /api/account/export` (Art 20), `POST /api/account/delete` (Art 17)
- Health probe: `GET /api/health`
- Public privacy policy: [`/regulations/privacy.html`](https://orcatrade.pl/regulations/privacy.html)
- Contact for security issues: [`orca@orcatrade.pl`](mailto:orca@orcatrade.pl) (subject prefix: "security:")
