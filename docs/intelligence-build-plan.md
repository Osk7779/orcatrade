# OrcaTrade Intelligence Build Plan

## Goal

Turn OrcaTrade Intelligence into a product that feels like a real operating system for EU importers, not a generic AI page.

The commercial wedge is:

- Win accounts with `CBAM readiness`
- Convert them into `managed import ops`
- Expand into `factory intelligence` and `shipment intelligence`
- Add `EUDR readiness` as the next major module

## Product North Star

OrcaTrade Intelligence should answer five questions better than anything else in the stack:

1. What is in scope right now?
2. What evidence is missing?
3. Which supplier or shipment is creating risk?
4. What is the next action, owner, and deadline?
5. What is the financial exposure if we do nothing?

## What "Brilliant" Looks Like

- Account-aware: remembers importer, suppliers, goods, routes, and prior issues
- Evidence-first: every decision has a source, timestamp, and confidence
- Fail-closed: never claims certainty when evidence is missing
- Operational: shows exceptions and next steps, not only scores
- Commercial: clearly sellable as a paid product and managed service

## Phase 1

Build a `CBAM Control Room` with the following modules:

### 1. Account Overview

- importer profile
- entity / operating unit
- annual CBAM goods value
- active suppliers
- active shipments
- current status

### 2. Supplier Evidence Queue

- supplier name
- country
- goods category
- missing document list
- last request date
- owner
- status
- confidence / readiness score

### 3. Exception Queue

- shipment or order id
- type: compliance / supplier / logistics / factory
- severity
- blocker
- next action
- owner
- due date

### 4. Cost Planning

- annual goods value
- planning exposure
- certificate planning estimate
- high-risk suppliers
- flows that need escalation

## Shared Data Contract

These are the core entities we should build around:

### account

- id
- companyName
- euEntity
- annualCbamGoodsValueEur
- activeSuppliers
- monthlyShipments
- status

### supplier

- id
- name
- country
- category
- cbamStatus
- eudrStatus
- factoryRiskScore
- evidenceCompleteness
- lastUpdated

### evidence_item

- id
- supplierId
- type
- status
- requestedAt
- receivedAt
- owner
- notes

### exception

- id
- entityType
- entityId
- severity
- title
- blocker
- nextAction
- owner
- dueDate

## Recommended File Ownership For Parallel Work

To keep Codex and Claude from clashing, use this split.

### Codex ownership

- `api/`
- `lib/intelligence/`
- `test/`
- any data model / validation / mock storage files

### Claude ownership

- `intelligence.html`
- any new visual sections or dedicated landing pages
- presentation-only JS and CSS
- conversion UI, product storytelling, polished dashboard presentation

### Shared caution

- avoid editing the same file at the same time
- if Claude edits `intelligence.html`, Codex should stay out of that file until Claude is done
- if Codex edits `api/*` or `lib/intelligence/*`, Claude should avoid those

## Next Concrete Build Steps

1. Add a local mock `account memory` layer for importers, suppliers, evidence items, and exceptions.
2. Add API routes that return the command-center payload from that memory layer.
3. Build a proper command-center UI page that reads those routes.
4. Add confidence and source badges to compliance, supplier, and shipment outputs.
5. Add tests that prove the new workflow never marks missing evidence as fully ready.

## Definition Of Done For The Next Milestone

- There is a real command-center page, not only a marketing page.
- It shows account overview, supplier evidence queue, and exceptions.
- The backend returns structured data for those views.
- The page is visually strong on desktop and mobile.
- `npm test` still passes.
