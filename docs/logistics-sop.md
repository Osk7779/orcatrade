# OrcaTrade · Logistics SOP — Full Import Management Playbook

> Single codified flow that every Tier 2 (Full Import Management) shipment runs through, plus the lighter version for Tier 1 (Forwarding Lite). Codifying this before scale is **non-negotiable** per the Strategic Platform Plan.
>
> **Version:** 1.0 · 2026-05-07
> **Owner:** Yiu Cheung (HK-side execution) + Oskar (commercial / EU-side oversight)
> **Audience:** OrcaTrade ops team + partner forwarders + customs broker partner. Read-only reference for clients.

---

## Roles

| Role | Owner | Scope |
|------|-------|-------|
| **Account Lead (AL)** | Arman or assigned ops | Single point of contact for the client. Owns customer communication, escalations, status updates. |
| **Origin Coordinator (OC)** | Yiu (HK) or local Asia coordinator | Supplier side — confirmations, inspection booking, export docs. |
| **Forwarder Operations (FO)** | Partner forwarder + OrcaTrade liaison | Capacity booking, BL/AWB, in-transit visibility. |
| **Customs Coordinator (CC)** | Polish customs agency partner + OrcaTrade liaison | Declaration, duty/VAT, AEO compliance. |
| **Compliance Reviewer (CR)** | Operations Agent + human escalation | CBAM, EUDR, REACH, CE applicability checks. |
| **Finance Lead (FL)** | Oskar (initially) | Invoicing, supplier payment milestones, FX, reconciliation. |

> One named human per role per shipment. Multiple shipments can share a role-holder. The Operations Agent (AI) supports every role but does not own irreversible actions.

---

## Tier 1 · Forwarding Lite — abbreviated flow

For transactional clients who already have suppliers and just need a reliable forwarder + documentation hand-off.

| # | Step | Owner | Trigger |
|--:|------|-------|--------|
| 1 | Capacity request | AL | Client form submission |
| 2 | Forwarder booking | FO | Confirmed quote |
| 3 | BL / AWB issuance | FO | Cargo loaded |
| 4 | In-transit tracking | FO + AL | Continuous |
| 5 | Document hand-off to client's broker | AL | ETA -7 days |
| 6 | Final invoice | FL | POD received |

**Pricing reminder:** 8–15% margin on freight + €150–€500 service fee. No customs, inspection, or supplier interaction in scope.

---

## Tier 2 · Full Import Management — the master playbook

15-step canonical flow. Every shipment runs through these steps in order. Steps are skippable only with documented client agreement.

### Phase A — Pre-shipment (steps 1–6)

#### Step 1 · Client intake & order brief

- **Owner:** AL
- **Inputs:** Client quote form OR sales-call notes
- **Outputs:** Order brief in shared workspace with: cargo type, supplier candidate(s), origin port, destination, target Incoterm, target ship date, CBAM/EUDR scope flags, special handling notes
- **Checks:** Cargo value > €20k → flag for human price-quote approval (per AI agent risk policy)
- **Tooling:** Operations Agent populates first draft from the form; AL reviews & enriches

#### Step 2 · Supplier vetting & price negotiation

- **Owner:** OC (with Sourcing Agent assist)
- **Inputs:** Supplier name, factory location, product spec
- **Outputs:** Verified supplier record (ownership, certifications, capacity, export history) + final commercial terms (price, payment terms, lead time)
- **Checks:** Factory Risk Score ≥ amber threshold → CR review before contract
- **Tooling:** Factory Search lookup; Sourcing Agent drafts negotiation talking points
- **Escalation triggers:** Supplier requires LC, supplier asks for >50% deposit, supplier refuses inspection clauses

#### Step 3 · Compliance applicability check

- **Owner:** CR
- **Inputs:** Cargo description, HS code candidate, origin country, destination country, importer entity, importer turnover
- **Outputs:** Compliance brief covering CBAM, EUDR, REACH, CE/RoHS, food contact, toy safety, textile labelling — applicable yes/no, evidence required, deadline
- **Checks:** Confidence per regulation must be green or amber-with-explanation; never silent green
- **Tooling:** `/api/analysis` (CBAM today, full multi-regulation Compliance Agent next sprint)
- **Escalation triggers:** EUDR applies + geolocation data missing; CBAM applies + supplier won't share emissions data; CE marking missing for product class that requires it

#### Step 4 · Supplier confirmation & contract

- **Owner:** OC + AL
- **Inputs:** Approved commercial terms, compliance requirements
- **Outputs:** Signed PO or sales contract (bilingual EN/CN where applicable) with: Incoterm, payment milestones, inspection clause, compliance evidence requirements, force-majeure
- **Checks:** Contract reviewed by AL before signing; for cargo > €100k, Oskar countersigns

#### Step 5 · Pre-shipment booking

- **Owner:** FO
- **Inputs:** Confirmed cargo dimensions and weight, pickup readiness date, destination port
- **Outputs:** Booking confirmation from partner forwarder; cut-off dates; rolling ETA estimate
- **Checks:** Capacity confirmed; mode (FCL / LCL / air / rail) matches Incoterm and timeline
- **Tooling:** Forwarder API or email; logged to shared workspace

#### Step 6 · Pre-shipment inspection (if scoped)

- **Owner:** OC (coordinates with QIMA / AsiaInspection / partner)
- **Inputs:** Inspection scope (AQL level, photo coverage, packaging check, label check)
- **Outputs:** Inspection report uploaded to client portal; pass / conditional pass / fail
- **Checks:** Conditional pass → AL communicates to client + supplier within 24h; fail → block shipment until remediated
- **Escalation triggers:** Failure rate > 2% on AQL → escalate to inspection partner relationship review

### Phase B — Export (steps 7–10)

#### Step 7 · Export documentation

- **Owner:** OC
- **Inputs:** Final invoice, packing list, certificate of origin, fumigation certificate (if applicable), EUDR diligence statement (if applicable), CBAM emissions data (if applicable)
- **Outputs:** Document pack uploaded to client portal; copy sent to FO + CC
- **Checks:** Commercial invoice value matches PO; HS code consistent across all documents; Incoterm matches contract; quantities match packing list to within rounding tolerance
- **Common failure mode:** HS code on commercial invoice differs from CN code on packing list → block until corrected

#### Step 8 · Cargo loaded & BL/AWB issued

- **Owner:** FO
- **Inputs:** Cargo physically loaded; gate-in/onboard confirmed by carrier
- **Outputs:** Bill of Lading (sea/rail) or Airway Bill (air) issued; document copies to client portal
- **Checks:** "Shipped on board" date matches expected; consignee field correct; notify party correct (typically OrcaTrade Polish broker partner)

#### Step 9 · Supplier balance payment trigger

- **Owner:** FL
- **Inputs:** BL/AWB issued = trigger condition typically
- **Outputs:** Supplier balance payment initiated per contract milestone; supplier notified
- **Checks:** Payment matches contract; FX rate captured for reconciliation
- **Tooling:** Bank rails (initially); Multi-currency Wallet add-on later

#### Step 10 · In-transit monitoring

- **Owner:** FO + AL
- **Inputs:** Carrier tracking, port congestion data, route disruption signals (from OrcaTrade Intelligence supply-chain pillar)
- **Outputs:** ETA refreshed weekly; client notified of any delay > 3 days
- **Escalation triggers:** Vessel diversion; port closure on origin or destination; transit insurance event (cargo damage / theft / loss)
- **Tooling:** Logistics Agent (AI) auto-monitors and drafts client updates; AL reviews before sending

### Phase C — Arrival & clearance (steps 11–13)

#### Step 11 · Arrival notice & pre-clearance prep

- **Owner:** CC
- **Inputs:** ETA confirmed within 5 days of arrival
- **Outputs:** Pre-clearance package assembled (commercial invoice, packing list, BL, certificates, declaration draft); AEO benefits applied where eligible
- **Checks:** All required documents present; HS code locked; duty + VAT estimate generated and shared with FL

#### Step 12 · EU customs clearance

- **Owner:** CC
- **Inputs:** Cargo arrival; pre-clearance package
- **Outputs:** Declaration filed; customs release; clearance reference logged
- **Escalation triggers:** Customs hold (random or risk-based); query letter from customs authority; valuation challenge
- **Common failure mode:** Discrepancy between BL consignee and declaration importer → resolve same-day

#### Step 13 · Duty & VAT payment

- **Owner:** FL (with CC)
- **Inputs:** Final duty + VAT calculation post-clearance
- **Outputs:** Payment to customs authority via CC's deferred-payment account; receipt attached to shipment record
- **Checks:** Amount matches pre-clearance estimate (within 5% tolerance); CBAM certificate surrender if applicable for the period

### Phase D — Last-mile & close (steps 14–15)

#### Step 14 · Last-mile delivery

- **Owner:** FO (delivery partner) + AL
- **Inputs:** Cleared cargo; agreed delivery address(es)
- **Outputs:** Cargo delivered; Proof of Delivery (POD) signed and uploaded
- **Escalation triggers:** Damage on receipt → claim opened against carrier insurance same-day; quantity short → reconcile with packing list and BL within 48h

#### Step 15 · Final invoice & reconciliation

- **Owner:** FL
- **Inputs:** All cost lines (freight, customs, duty/VAT, inspection, service fees, FX)
- **Outputs:** Final invoice to client; reconciliation report (forecast vs actual cost lines); margin captured per cost line
- **Checks:** Final cost ≤ quoted cost +5% OR client notified before submission of any overrun
- **Cadence:** Sent within 5 business days of POD

---

## Standard timing expectations

| Mode | Origin to EU port | EU port to delivery | Total typical | Total worst-case |
|------|------------------:|--------------------:|--------------:|------------------:|
| Sea FCL (CN → Gdańsk) | 30–35 days | 5–10 days | 35–45 days | 60+ |
| Sea LCL (CN → Gdańsk) | 35–45 days | 7–14 days | 42–59 days | 75+ |
| Air freight (CN → WAW) | 3–7 days | 2–4 days | 5–11 days | 15+ |
| Rail (CN → Małaszewicze) | 18–24 days | 3–6 days | 21–30 days | 40+ |

> Buffer the worst-case figure into the client commitment. We promise the typical, plan for the worst-case.

---

## Documents produced per shipment (master checklist)

- [ ] Order brief (internal)
- [ ] Supplier verification record
- [ ] Compliance brief (CBAM / EUDR / REACH / CE / etc.)
- [ ] Signed PO or sales contract
- [ ] Booking confirmation
- [ ] Pre-shipment inspection report (if scoped)
- [ ] Commercial invoice
- [ ] Packing list
- [ ] Certificate of origin
- [ ] Fumigation / phyto / health certificates (if applicable)
- [ ] CBAM emissions data + verifier statement (Q4 2026 onward, if applicable)
- [ ] EUDR due diligence statement (when EUDR phase-in date triggers, if applicable)
- [ ] BL / AWB
- [ ] Customs declaration (SAD / electronic equivalent)
- [ ] Duty + VAT receipt
- [ ] Proof of Delivery
- [ ] Final invoice + reconciliation report

---

## Escalation framework

| Severity | Definition | Owner action | Client comms |
|---------:|-----------|-------------|-------------|
| **L0 — Info** | Status update, no impact | Logged in workspace | Async email weekly |
| **L1 — Minor** | Delay ≤ 3 days, no cost impact | AL informs client within 24h | Same-day email |
| **L2 — Moderate** | Delay 3–14 days, minor cost impact, customs query | AL + role-owner respond same-day; escalate to Oskar by EOD | Same-day call attempt + email |
| **L3 — Major** | Delay > 14 days, cargo damage, declaration rejection, supplier dispute | AL + Oskar + role-owner; written client comms within 4h | Phone call + written |
| **L4 — Critical** | Total cargo loss, fraud, regulatory enforcement action | All hands; legal counsel engaged | Continuous; written record kept |

---

## Risk catalogue (top 12)

These are the most common failure modes we should be ready for from day one.

1. **HS code dispute at customs** — pre-clearance HS verification reduces incidence; have alternative codes documented before clearance.
2. **CBAM emissions data refused by supplier** — fall back to default values + supplier-side mark-up; transparent to client.
3. **EUDR geolocation gap** — applies to specific commodities; if scope is hit and data missing, shipment cannot legally be placed on EU market.
4. **Pre-shipment inspection failure** — conditional pass triggers re-inspection; full fail blocks shipment.
5. **Vessel rolling / blank sailing** — partner forwarder's responsibility to rebook; AL communicates ETA shift.
6. **Currency volatility on supplier balance payment** — capture FX rate at contract; flag exposure ≥ 3% to FL.
7. **Customs random hold** — adds 1–10 days; AEO partner reduces frequency.
8. **Declaration rejection** — usually documentation mismatch; CC has 5 business days to respond before automatic re-filing fee.
9. **Damage on arrival** — open claim within 24h of POD; transit insurance covers most cases.
10. **Supplier delay vs PO date** — built-in buffer of 7 days; beyond that, AL escalates and triggers L2.
11. **Duty calculation overrun** — happens when valuation method changes mid-clearance; FL alerts client before confirming overrun.
12. **Force majeure event on route** — typhoons, strikes, sanctions changes; Logistics Agent monitors signals; AL reviews risk weekly.

---

## Service-level commitments to clients (Tier 2)

Stated on the public Logistics page and in the Letter of Engagement.

- **Response time:** within one business day on all client communications.
- **Status update cadence:** weekly during transit, daily during clearance, real-time on exceptions.
- **Document delivery to client portal:** within 24h of receiving the source document.
- **Final invoice:** within 5 business days of POD.
- **Refund / re-do policy:** structural error on our side (mis-classification, mis-routing) → service-fee credit; cargo damage → handled by transit insurance.

---

## Continuous improvement

- **Weekly ops review:** every Friday 09:00 CET. Review every active shipment, every blocker, every escalation. 30 minutes max.
- **Monthly retro:** first working day of the month. Review last month's KPIs (on-time rate, exception rate, margin per shipment, NPS), identify one process improvement to implement, version-bump this SOP if changed.
- **Partner reviews:** quarterly with each forwarder, customs agency, and inspection partner. Volume forecast, performance metrics, pricing tiers, contract renewal.

---

## KPIs to track from day one

| KPI | Target | Owner |
|-----|--------|-------|
| On-time delivery rate (within typical-case window) | ≥ 85% by month 6 | Yiu + Oskar |
| Exception rate (L2+ events per shipment) | ≤ 12% | AL |
| Document-completeness rate (full pack at clearance) | ≥ 95% | OC + CC |
| Margin per shipment (Tier 2) | ≥ 20% gross | FL |
| Client NPS | ≥ 40 in year 1 | AL |
| Average response time to client message | ≤ 4 working hours | AL |

---

## Tooling stack

- **Shared workspace:** Notion or Linear (decide before first paid Tier 2 shipment).
- **Document portal:** Supabase storage with signed URLs (Phase 2 build).
- **Communication:** Slack channel per shipment for ops; email for client-facing.
- **Tracking:** Logistics Agent + partner forwarder API or web tracking.
- **AI agents:** Operations Agent (orchestrator), Sourcing Agent, Compliance Agent, Logistics Agent, Finance Agent — all on Anthropic API + Vercel serverless.
- **Insurance:** Cargo policy via partner broker; professional liability via FIATA-affiliated insurer.

---

## Versioning

- **v1.0 — 2026-05-07** — initial codified playbook. Approved by Oskar.
- Future revisions versioned at the top; changes recorded in a CHANGELOG section once in active use.
