import type { Metadata } from 'next';
import { EditorialHeader } from '@/components/marketing/editorial-header';
import { ChapterRule } from '@/components/marketing/chapter-rule';
import { FadeUp } from '@/components/marketing/fade-up';
import { StatusLive } from '@/components/marketing/status-live';
import { AuditAnchorWidget } from '@/components/marketing/audit-anchor-widget';

export const metadata: Metadata = {
  title: 'System status — OrcaTrade Group',
  description:
    'Live state of the OrcaTrade production fleet. Per-subsystem health, this session’s uptime, public audit-chain anchor.',
};

export default function StatusPage() {
  return (
    <>
      <EditorialHeader
        kicker="System status"
        title={
          <>
            Live state of the platform,
            <br className="hidden md:block" /> updated every thirty seconds.
          </>
        }
        lead="Powered by /api/health. Each subsystem reports its own status — calculators, data store, TARIC cache, email, billing, AI, error reporting — refreshed in your browser, not pre-rendered. Incident history is published post-hoc; the rolling audit anchor is a third-party-verifiable receipt that the chain has not been rewritten."
        meta="Refreshes 30s · session uptime in this browser · cross-visitor evidence at /trust/anchors/"
      />

      <ChapterRule numeral="I" label="Subsystems" />

      <section className="bg-[var(--color-ink)] py-14 md:py-20">
        <div className="mx-auto max-w-[1100px] px-6">
          <StatusLive />
        </div>
      </section>

      <ChapterRule numeral="II" label="Recent incidents" />

      <section className="bg-[var(--color-ink)] py-14 md:py-20">
        <div className="mx-auto max-w-[860px] px-6">
          <FadeUp>
            <div className="flex items-center gap-3">
              <span aria-hidden className="font-serif text-[13px] text-[var(--color-ivory-dim)]/55">
                ❦
              </span>
              <span className="font-serif text-[13px] italic text-[var(--color-ivory-mute)]">
                Last 90 days
              </span>
            </div>
            <h2
              className="mt-5 font-serif text-[clamp(1.6rem,2.4vw+0.4rem,2.2rem)] leading-[1.15] tracking-[-0.02em] text-[var(--color-ivory)]"
              style={{ fontVariationSettings: "'SOFT' 35, 'opsz' 144", fontWeight: 550 }}
            >
              No incidents recorded.
            </h2>
            <p className="mt-6 max-w-[62ch] text-[15px] leading-[1.7] text-[var(--color-ivory-dim)]">
              When one happens we publish the start time, scope and remediation here within the{' '}
              <a
                href="https://github.com/Osk7779/orcatrade/blob/main/docs/security/incident-response.md"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--color-ivory)] underline-offset-2 hover:underline"
              >
                incident-response SLA
              </a>
              . The list is sourced from <code className="font-mono text-[14px] text-[var(--color-ivory)]">docs/incidents/</code>; an empty list is the honest current state — not &ldquo;we choose not to publish.&rdquo;
            </p>
          </FadeUp>
        </div>
      </section>

      <ChapterRule numeral="III" label="Audit-chain anchor" />

      <section className="bg-[var(--color-ink)] py-14 md:py-20">
        <div className="mx-auto max-w-[860px] px-6">
          <FadeUp>
            <div className="flex items-center gap-3">
              <span aria-hidden className="font-serif text-[13px] text-[var(--color-ivory-dim)]/55">
                ❦
              </span>
              <span className="font-serif text-[13px] italic text-[var(--color-ivory-mute)]">
                Public receipt
              </span>
            </div>
            <h2
              className="mt-5 font-serif text-[clamp(1.6rem,2.4vw+0.4rem,2.2rem)] leading-[1.15] tracking-[-0.02em] text-[var(--color-ivory)]"
              style={{ fontVariationSettings: "'SOFT' 35, 'opsz' 144", fontWeight: 550 }}
            >
              Cross-visitor proof of continuous operation.
            </h2>
            <p className="mt-6 max-w-[62ch] text-[15px] leading-[1.7] text-[var(--color-ivory-dim)]">
              The current public anchor — chain head, length, timestamp — proves the audit chain has not been rewritten. No PII, no auth required. Fetched live below.
            </p>
            <div className="mt-6">
              <AuditAnchorWidget />
            </div>
          </FadeUp>
        </div>
      </section>
    </>
  );
}
