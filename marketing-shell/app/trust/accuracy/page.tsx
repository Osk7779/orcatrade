import type { Metadata } from 'next';
import { EditorialHeader } from '@/components/marketing/editorial-header';
import { ChapterRule } from '@/components/marketing/chapter-rule';
import { FadeUp } from '@/components/marketing/fade-up';
import { AccuracyLedgerLive } from '@/components/marketing/accuracy-ledger-live';

export const metadata: Metadata = {
  title: 'Quote Accuracy Ledger — OrcaTrade Group',
  description:
    'The measured version of our accuracy guarantee: how OrcaTrade landed-cost quotes compare against customer-reported actual outcomes — recomputed statelessly, with sample-size gates that withhold headline figures until the data earns them.',
};

// Sprint 80 (Track B) — the commercial instrument. Every number on
// this page is computed by lib/intelligence/accuracy-ledger.js from
// the actuals corpus; nothing is stored or hand-adjustable. The
// honest-tier behaviour (withholding figures below 10 scoreable
// actuals) is drift-guarded server-side.
export default function TrustAccuracyPage() {
  return (
    <>
      <EditorialHeader
        kicker="Trust · quote accuracy"
        title={
          <>
            A quote is a promise.
            <br className="hidden md:block" /> Here is how ours land.
          </>
        }
        lead="Every OrcaTrade landed-cost quote is deterministic — calculator output, never a language model's guess. This ledger closes the loop: customers report what they actually paid, and we publish how close the quote came. Median absolute error, the share landing within ±5, ±10 and ±20 percent, and the value-weighted bias — recomputed statelessly from the full corpus on every read. Below ten scoreable outcomes the headline figures are withheld: a median over three rows is marketing, not measurement."
        meta="No PII · deterministic recomputation · sample-size gates · integer-cents arithmetic"
      />

      <ChapterRule numeral="I" label="The ledger" />

      <section className="bg-[var(--color-ink)] py-14 md:py-20">
        <div className="mx-auto max-w-[900px] px-6">
          <AccuracyLedgerLive />
        </div>
      </section>

      <ChapterRule numeral="II" label="Methodology" />

      <section className="bg-[var(--color-ink)] py-14 md:py-20">
        <div className="mx-auto max-w-[860px] px-6">
          <FadeUp>
            <ol className="space-y-6 text-[15px] leading-[1.65] text-[var(--color-ivory-dim)]">
              <li className="flex gap-4">
                <span className="mt-1 inline-block min-w-[2.5rem] font-mono text-[12px] uppercase tracking-[0.14em] text-[var(--color-ivory-mute)]">
                  01
                </span>
                <span>
                  <strong className="text-[var(--color-ivory)]">Frozen comparison.</strong> Each
                  actual is compared against the estimate snapshotted at the moment the plan was
                  saved — never against a re-priced version. The question the ledger answers is
                  &ldquo;did the promise hold?&rdquo;, not &ldquo;would today&rsquo;s pricing have
                  matched?&rdquo;
                </span>
              </li>
              <li className="flex gap-4">
                <span className="mt-1 inline-block min-w-[2.5rem] font-mono text-[12px] uppercase tracking-[0.14em] text-[var(--color-ivory-mute)]">
                  02
                </span>
                <span>
                  <strong className="text-[var(--color-ivory)]">Integer-cents arithmetic.</strong>{' '}
                  Every sum runs in whole euro-cents; percentages derive from cent totals. No
                  floating-point money, no rounding drift between what we compute and what we
                  publish.
                </span>
              </li>
              <li className="flex gap-4">
                <span className="mt-1 inline-block min-w-[2.5rem] font-mono text-[12px] uppercase tracking-[0.14em] text-[var(--color-ivory-mute)]">
                  03
                </span>
                <span>
                  <strong className="text-[var(--color-ivory)]">Sample-size gates.</strong> Below
                  ten scoreable actuals the ledger reports only the count. From ten it publishes
                  with an explicit early-sample label; from fifty it reads as measured. The gates
                  are enforced in code and covered by tests — the surface cannot be talked into
                  flattering itself.
                </span>
              </li>
              <li className="flex gap-4">
                <span className="mt-1 inline-block min-w-[2.5rem] font-mono text-[12px] uppercase tracking-[0.14em] text-[var(--color-ivory-mute)]">
                  04
                </span>
                <span>
                  <strong className="text-[var(--color-ivory)]">Stateless recomputation.</strong>{' '}
                  There is no stored accuracy figure anywhere in the system. Every read recomputes
                  the ledger from the corpus, so an auditor with the same rows reaches the same
                  numbers. The raw endpoint is public:{' '}
                  <code className="font-mono text-[13px] text-[var(--color-ivory)]">
                    GET /api/accuracy
                  </code>
                  .
                </span>
              </li>
            </ol>
          </FadeUp>
        </div>
      </section>
    </>
  );
}
