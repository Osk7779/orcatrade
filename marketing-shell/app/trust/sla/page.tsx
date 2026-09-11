import type { Metadata } from 'next';
import { EditorialHeader } from '@/components/marketing/editorial-header';
import { ChapterRule } from '@/components/marketing/chapter-rule';
import { FadeUp } from '@/components/marketing/fade-up';
import { SlaAttainmentLive } from '@/components/marketing/sla-attainment-live';

export const metadata: Metadata = {
  title: 'Service commitments, measured — OrcaTrade Group',
  description:
    'OrcaTrade’s two operational commitments — 48-hour quote turnaround and 24-hour first human response — with measured attainment recomputed statelessly from stamped timestamps. Published even when the honest answer is “still accruing”.',
};

// Sprint 85 (Track D) — the public SLA surface. Every number comes
// from lib/intelligence/sla.js over first-write-only timestamps;
// the honesty gates are shared with the accuracy ledger and
// drift-guarded server-side.
export default function TrustSlaPage() {
  return (
    <>
      <EditorialHeader
        kicker="Trust · service commitments"
        title={
          <>
            An SLA you can&rsquo;t verify
            <br className="hidden md:block" /> is a slogan.
          </>
        }
        lead="Two commitments run the OrcaTrade operating floor: a customer-visible quote within 48 hours of submission, and a first human response within 24. This page publishes measured attainment against both — median, p95, and the share landing within target — recomputed statelessly from write-once timestamps on every read. Below ten scoreable rows the figures are withheld and the page says so; an SLA page that flatters itself is worse than none."
        meta="No PII · write-once clock stamps · human-action definition · shared sample gates"
      />

      <ChapterRule numeral="I" label="Measured attainment" />

      <section className="bg-[var(--color-ink)] py-14 md:py-20">
        <div className="mx-auto max-w-[980px] px-6">
          <SlaAttainmentLive />
        </div>
      </section>

      <ChapterRule numeral="II" label="How the clocks work" />

      <section className="bg-[var(--color-ink)] py-14 md:py-20">
        <div className="mx-auto max-w-[860px] px-6">
          <FadeUp>
            <ol className="space-y-6 text-[15px] leading-[1.65] text-[var(--color-ivory-dim)]">
              <li className="flex gap-4">
                <span className="mt-1 inline-block min-w-[2.5rem] font-mono text-[12px] uppercase tracking-[0.14em] text-[var(--color-ivory-mute)]">
                  01
                </span>
                <span>
                  <strong className="text-[var(--color-ivory)]">Write-once stamps.</strong> Each
                  clock stops at the FIRST qualifying moment and never moves again — a request
                  that gets sent back and re-quoted keeps its first quoted time. Reworks cannot
                  launder a slow first answer.
                </span>
              </li>
              <li className="flex gap-4">
                <span className="mt-1 inline-block min-w-[2.5rem] font-mono text-[12px] uppercase tracking-[0.14em] text-[var(--color-ivory-mute)]">
                  02
                </span>
                <span>
                  <strong className="text-[var(--color-ivory)]">Humans only.</strong> The
                  first-response clock stops on a team review decision or an ops message —
                  never on an automated status transition. An instant machine response would make
                  the metric trivially perfect, which is marketing, not measurement.
                </span>
              </li>
              <li className="flex gap-4">
                <span className="mt-1 inline-block min-w-[2.5rem] font-mono text-[12px] uppercase tracking-[0.14em] text-[var(--color-ivory-mute)]">
                  03
                </span>
                <span>
                  <strong className="text-[var(--color-ivory)]">Shared sample gates.</strong> The
                  same thresholds as the{' '}
                  <a href="/trust/accuracy/" className="text-[var(--color-ivory)] underline-offset-2 hover:underline">
                    quote accuracy ledger
                  </a>
                  : withheld below ten, early-sample to forty-nine, measured at fifty. Two trust
                  instruments with two definitions of &ldquo;enough data&rdquo; would be a
                  credibility bug.
                </span>
              </li>
              <li className="flex gap-4">
                <span className="mt-1 inline-block min-w-[2.5rem] font-mono text-[12px] uppercase tracking-[0.14em] text-[var(--color-ivory-mute)]">
                  04
                </span>
                <span>
                  <strong className="text-[var(--color-ivory)]">Stateless recomputation.</strong>{' '}
                  No stored attainment figure exists anywhere in the system. Every read recomputes
                  from the stamped timestamps; the raw endpoint is public:{' '}
                  <code className="font-mono text-[13px] text-[var(--color-ivory)]">
                    GET /api/sla
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
