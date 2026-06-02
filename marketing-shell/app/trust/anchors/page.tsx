import type { Metadata } from 'next';
import Link from 'next/link';
import { EditorialHeader } from '@/components/marketing/editorial-header';
import { ChapterRule } from '@/components/marketing/chapter-rule';
import { FadeUp } from '@/components/marketing/fade-up';
import { AnchorTimeline } from '@/components/marketing/anchor-timeline';

export const metadata: Metadata = {
  title: 'Audit-chain anchors — OrcaTrade Group',
  description:
    'Rolling history of OrcaTrade’s public audit-chain anchors. Cross-visitor, third-party-verifiable evidence that the chain has not been rewritten.',
};

export default function TrustAnchorsPage() {
  return (
    <>
      <EditorialHeader
        kicker="Trust · audit-chain anchors"
        title={
          <>
            A rolling receipt that the chain
            <br className="hidden md:block" /> has not been rewritten.
          </>
        }
        lead="The OrcaTrade audit log is hash-chained at write time over a personal-data-free projection. The public anchor — the sha256 head of the chain — is snapshotted nightly by an independent GitHub-hosted cron job, capped at ninety days. A missed day would surface as a visible gap; a silent rewrite would surface as a head-divergence between two consecutive snapshots."
        meta="No PII · no auth · independent cron · 90-day window"
      />

      <ChapterRule numeral="I" label="Anchor history" />

      <section className="bg-[var(--color-ink)] py-14 md:py-20">
        <div className="mx-auto max-w-[900px] px-6">
          <AnchorTimeline />
        </div>
      </section>

      <ChapterRule numeral="II" label="How to verify" />

      <section className="bg-[var(--color-ink)] py-14 md:py-20">
        <div className="mx-auto max-w-[860px] px-6">
          <FadeUp>
            <div className="flex items-center gap-3">
              <span aria-hidden className="font-serif text-[13px] text-[var(--color-ivory-dim)]/55">
                ❦
              </span>
              <span className="font-serif text-[13px] italic text-[var(--color-ivory-mute)]">
                Verification flow
              </span>
            </div>
            <h2
              className="mt-5 font-serif text-[clamp(1.6rem,2.4vw+0.4rem,2.2rem)] leading-[1.15] tracking-[-0.02em] text-[var(--color-ivory)]"
              style={{ fontVariationSettings: "'SOFT' 35, 'opsz' 144", fontWeight: 550 }}
            >
              Three steps. No trust required.
            </h2>
            <ol className="mt-8 space-y-6 text-[15px] leading-[1.65] text-[var(--color-ivory-dim)]">
              <li className="flex gap-4">
                <span className="mt-1 inline-block min-w-[2.5rem] font-mono text-[12px] uppercase tracking-[0.14em] text-[var(--color-ivory-mute)]">
                  01
                </span>
                <span>
                  Fetch <code className="font-mono text-[14px] text-[var(--color-ivory)]">/api/audit-anchor</code> periodically and persist each <code className="font-mono text-[14px] text-[var(--color-ivory)]">{`{ chainHead, chainLength, asOf }`}</code> locally.
                </span>
              </li>
              <li className="flex gap-4">
                <span className="mt-1 inline-block min-w-[2.5rem] font-mono text-[12px] uppercase tracking-[0.14em] text-[var(--color-ivory-mute)]">
                  02
                </span>
                <span>
                  On the next fetch, the new <code className="font-mono text-[14px] text-[var(--color-ivory)]">chainLength</code> must be ≥ the previous, and the previous <code className="font-mono text-[14px] text-[var(--color-ivory)]">chainHead</code> must remain reachable in the chain at the previous <code className="font-mono text-[14px] text-[var(--color-ivory)]">_seq</code>.
                </span>
              </li>
              <li className="flex gap-4">
                <span className="mt-1 inline-block min-w-[2.5rem] font-mono text-[12px] uppercase tracking-[0.14em] text-[var(--color-ivory-mute)]">
                  03
                </span>
                <span>
                  A divergence — an older head no longer in the chain at its <code className="font-mono text-[14px] text-[var(--color-ivory)]">_seq</code> — is third-party-detectable evidence the chain was rewritten. The integrity claim does not require trust in our auth surface, only the cryptographic property of sha256.
                </span>
              </li>
            </ol>
            <div className="mt-10 flex flex-wrap gap-4">
              <Link
                href="/api/audit-anchor"
                target="_blank"
                rel="noopener noreferrer"
                className="border border-[var(--color-ivory)]/40 px-5 py-2.5 font-mono text-[12px] uppercase tracking-[0.12em] text-[var(--color-ivory)] transition-colors hover:border-[var(--color-ivory)] hover:bg-[var(--color-ivory)]/5"
              >
                GET /api/audit-anchor
              </Link>
              <Link
                href="https://github.com/Osk7779/orcatrade/blob/main/docs/security/audit-trail.md"
                target="_blank"
                rel="noopener noreferrer"
                className="border border-[var(--color-ivory)]/40 px-5 py-2.5 font-mono text-[12px] uppercase tracking-[0.12em] text-[var(--color-ivory)] transition-colors hover:border-[var(--color-ivory)] hover:bg-[var(--color-ivory)]/5"
              >
                audit-trail.md ↗
              </Link>
              <Link
                href="/trust"
                className="border border-[var(--color-ivory-mute)]/40 px-5 py-2.5 font-mono text-[12px] uppercase tracking-[0.12em] text-[var(--color-ivory-dim)] transition-colors hover:border-[var(--color-ivory)] hover:text-[var(--color-ivory)]"
              >
                Back to /trust
              </Link>
            </div>
          </FadeUp>
        </div>
      </section>
    </>
  );
}
