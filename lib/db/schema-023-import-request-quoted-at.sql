-- quoted_at stamp — sprint 83 (Track C phase 1: the SLA engine).
--
-- The operator promise enterprise buyers actually ask about is
-- quote turnaround: "you submit, we quote — how fast, provably?"
-- Measuring it needs the CUSTOMER-VISIBLE moment the request
-- entered 'quoted'. quote_generated_at (schema-012) marks when the
-- AI produced the draft at awaiting_review — an internal moment;
-- quoted_at marks when the team's approval made it real to the
-- customer.
--
-- First-write-only (COALESCE at the writers): a request that gets
-- sent back and re-quoted keeps its FIRST quoted moment — the SLA
-- measures time-to-first-quote, and reworks must not launder a
-- slow first answer.
--
-- Historical rows stay NULL — attainment accrues from deploy, and
-- the surface says "measured since", never back-fills a guess
-- (the same accrual honesty as the Quote Accuracy Ledger).

ALTER TABLE import_requests
  ADD COLUMN IF NOT EXISTS quoted_at timestamptz;

-- Partial index for the SLA cut (org + window over quoted rows).
CREATE INDEX IF NOT EXISTS import_requests_quoted_at_idx
  ON import_requests (org_id, quoted_at)
  WHERE quoted_at IS NOT NULL;
