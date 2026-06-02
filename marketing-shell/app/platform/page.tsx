import type { Metadata } from 'next';
import Link from 'next/link';
import { EditorialHeader } from '@/components/marketing/editorial-header';
import { ChapterRule } from '@/components/marketing/chapter-rule';
import { FadeUp } from '@/components/marketing/fade-up';

export const metadata: Metadata = {
  title: 'OrcaTrade Platform — Asia → Europe import operating system',
  description:
    'Five stages, one journey. Find it, prove it, move it, pay for it, run it. Calculator-grounded across the whole import lifecycle.',
};

const STAGES = [
  {
    numeral: '01',
    kicker: 'Find it',
    title: 'Sourcing.',
    question: 'Which supplier should I order from?',
    answer: 'Country comparisons grounded in landed-cost math + factory-score signals. Supplier vetting checklists for first-order risk. Concentration-risk diagnostics on existing supplier mix.',
  },
  {
    numeral: '02',
    kicker: 'Prove it',
    title: 'Compliance.',
    question: 'What regulations apply, and what evidence must I collect?',
    answer: 'CBAM, EUDR, REACH, CE marking, anti-dumping & countervailing duties. Per-shipment applicability, exposure math, ranked actions, every claim cited to verbatim regulation chunks.',
  },
  {
    numeral: '03',
    kicker: 'Move it',
    title: 'Logistics.',
    question: 'Cheapest reliable route within my window?',
    answer: 'Mode + lane + warehouse + insurance recommendation with a deterministic landed-cost quote. Bonded warehouse cash-flow trade-offs surfaced explicitly. Buffer-stock math against transit slip.',
  },
  {
    numeral: '04',
    kicker: 'Pay for it',
    title: 'Finance.',
    question: 'What does this cost end-to-end?',
    answer: 'FX exposure, hedging recommendation, working-capital cycle, total cost of ownership. Per-payment-instrument selection (TT / LC) with the supplier-risk framing baked in.',
  },
  {
    numeral: '05',
    kicker: 'Run it',
    title: 'Orchestrator.',
    question: 'How do these answers compose for my actual operation?',
    answer: "A meta-agent that merges the four specialists' tool surfaces — cross-domain plans that cite their producing tool for every number. Personal context (your saved plans, your actuals, your portfolios) optional, with consent.",
  },
];

const MOAT = [
  { title: 'Hong Kong export desk.', body: 'Our HK team leads logistics on the export side. Pure-digital forwarders cannot match in-person supplier verification, sample consolidation, or dispute resolution at the SME price point. We can.' },
  { title: 'EU compliance is the front door, not a sidebar.', body: 'CBAM, EUDR, REACH, CE, RoHS, EU AI Act. Most platforms are American-centric and treat EU regs as bolt-ons. Our compliance engine is foundational.' },
  { title: 'Five agents + an orchestrator.', body: 'Sourcing, Compliance, Logistics, Finance, plus the Operations orchestrator. Agents route, execute, and escalate to humans when it matters. Every irreversible action stays human-approved.' },
  { title: 'Asset-light by design.', body: 'No directly operated ships, planes, trucks, or warehouses. We coordinate the partners who already own that capacity. Margins stay healthy and capital requirements bounded.' },
  { title: 'SME-sized, by choice.', body: '€50k–€2M annual import volume, 2–50 shipments per year. Big enough to need help, small enough that DSV and K+N will not return your call. We sit in that gap.' },
  { title: 'EN / PL / DE.', body: 'Every meaningful page lives in EN, PL, and DE. Polish e-commerce founders, German Mittelstand, broader CEE — we speak the languages and the customs systems.' },
];

export default function PlatformPage() {
  return (
    <>
      <EditorialHeader
        kicker="Platform"
        title={
          <>
            Five stages, one journey.
            <br className="hidden md:block" /> Find it, prove it, move it, pay for it, run it.
          </>
        }
        lead="OrcaTrade is the import operating system for European SMEs sourcing from Asia. Calculator-grounded across sourcing, compliance, logistics, finance, and orchestration — five products the customer experiences as one workflow."
        meta="Asia ↔ Europe · €50k–€2M annual volume · 2–50 shipments / year"
      />

      <ChapterRule numeral="I" label="The five stages" />
      <section className="bg-[var(--color-ink)] py-14 md:py-20">
        <div className="mx-auto max-w-[1100px] px-6">
          <FadeUp>
            <h2
              className="font-serif text-[clamp(1.8rem,2.6vw+0.4rem,2.4rem)] leading-[1.15] tracking-[-0.02em] text-[var(--color-ivory)]"
              style={{ fontVariationSettings: "'SOFT' 35, 'opsz' 144", fontWeight: 550 }}
            >
              Each stage answers one question.
            </h2>
            <p className="mt-4 max-w-[62ch] text-[15px] leading-[1.7] text-[var(--color-ivory-dim)]">
              Five products, one journey from &ldquo;where do I find it?&rdquo; to &ldquo;how do I pay for it?&rdquo;
            </p>
          </FadeUp>
          <div className="mt-12 space-y-4">
            {STAGES.map((s, i) => (
              <FadeUp key={s.numeral} delay={i * 0.05}>
                <div className="grid gap-6 border border-[var(--color-navy-line)] bg-[var(--color-navy-soft)]/25 p-6 md:grid-cols-[100px_1fr] md:p-8">
                  <div className="font-mono text-[44px] leading-none text-[var(--color-ivory)]/85 md:text-[64px]">
                    {s.numeral}
                  </div>
                  <div>
                    <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--color-ivory-mute)]">
                      {s.kicker}
                    </div>
                    <h3
                      className="mt-2 font-serif text-[clamp(1.4rem,1.8vw+0.5rem,1.9rem)] leading-[1.2] text-[var(--color-ivory)]"
                      style={{ fontVariationSettings: "'SOFT' 35, 'opsz' 144", fontWeight: 550 }}
                    >
                      {s.title}
                    </h3>
                    <p className="mt-3 italic text-[14px] leading-[1.55] text-[var(--color-ivory-mute)]">
                      &ldquo;{s.question}&rdquo;
                    </p>
                    <p className="mt-4 text-[15px] leading-[1.7] text-[var(--color-ivory-dim)]">
                      {s.answer}
                    </p>
                  </div>
                </div>
              </FadeUp>
            ))}
          </div>
        </div>
      </section>

      <ChapterRule numeral="II" label="The moat is operational, not technical" />
      <section className="bg-[var(--color-ink)] py-14 md:py-20">
        <div className="mx-auto max-w-[1100px] px-6">
          <FadeUp>
            <p className="max-w-[62ch] text-[15px] leading-[1.7] text-[var(--color-ivory-dim)]">
              A horizontal AI platform is easy to build and easy to copy. What you can&rsquo;t copy: years of supplier data, an HK office, and an EU-compliance posture built in from day one.
            </p>
          </FadeUp>
          <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {MOAT.map((m, i) => (
              <FadeUp key={m.title} delay={i * 0.04}>
                <div className="h-full border border-[var(--color-navy-line)] bg-[var(--color-navy-soft)]/30 p-5 transition-colors hover:border-[var(--color-ivory)]/30">
                  <div className="font-serif text-[16px] leading-[1.3] text-[var(--color-ivory)]">{m.title}</div>
                  <p className="mt-3 text-[14px] leading-[1.6] text-[var(--color-ivory-dim)]">{m.body}</p>
                </div>
              </FadeUp>
            ))}
          </div>
        </div>
      </section>

      <ChapterRule numeral="III" label="Two ways to start" />
      <section className="bg-[var(--color-ink)] py-14 md:py-20">
        <div className="mx-auto max-w-[1000px] px-6">
          <div className="grid gap-4 md:grid-cols-2">
            {[
              { title: 'Run a free CBAM + EUDR analysis.', body: 'Tell us what you import. We check CBAM and EUDR — applicability, exposure math, evidence gaps, ranked actions, every claim cited.', cta: 'Start analysis', href: '/analysis' },
              { title: 'Build your import plan.', body: 'A six-step brief — what, from where, to where, the numbers. We compose the plan: duty, every regime, freight, working capital, end to end.', cta: 'Start the wizard', href: '/start' },
            ].map((c, i) => (
              <FadeUp key={c.title} delay={i * 0.05}>
                <div className="flex h-full flex-col border border-[var(--color-navy-line)] bg-[var(--color-navy-soft)]/30 p-6">
                  <h3 className="font-serif text-[20px] leading-[1.2] text-[var(--color-ivory)]">{c.title}</h3>
                  <p className="mt-3 flex-1 text-[14px] leading-[1.6] text-[var(--color-ivory-dim)]">{c.body}</p>
                  <Link href={c.href} className="mt-6 inline-block w-fit border border-[var(--color-ivory)] bg-[var(--color-ivory)] px-5 py-2.5 font-mono text-[12px] uppercase tracking-[0.14em] text-[var(--color-ink)] transition-colors hover:bg-[var(--color-ivory-dim)]">
                    {c.cta}
                  </Link>
                </div>
              </FadeUp>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
