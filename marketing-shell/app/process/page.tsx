import type { Metadata } from 'next';
import { EditorialHeader } from '@/components/marketing/editorial-header';
import { ChapterRule } from '@/components/marketing/chapter-rule';
import { FadeUp } from '@/components/marketing/fade-up';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'The process — Five stages, one platform — OrcaTrade Group',
  description:
    'Find it → Source it → Verify it → Ship it → Finance it. How a brief becomes a calculator-grounded plan, then a shipped container, then a credit decision.',
};

const STAGES = [
  {
    numeral: 'I',
    kicker: 'Stage 01',
    verb: 'Find it',
    title: 'Search the catalogue of European trade.',
    body: 'Type an HS code, a product, a supplier, or an origin–destination lane. The platform surfaces every duty, every preferential framework, every compliance regime that touches it — with chunk-level citations and confidence tiers on every claim.',
    href: '/search',
  },
  {
    numeral: 'II',
    kicker: 'Stage 02',
    verb: 'Source it',
    title: 'Brief the supplier against the lane.',
    body: 'Six Asia origins, eight commodity categories. The brief carries the regulatory overlay so the supplier sees the compliance constraints from day one. Sanctions screening on every candidate against four authoritative lists.',
    href: '/sourcing',
  },
  {
    numeral: 'III',
    kicker: 'Stage 03 · Flagship',
    verb: 'Verify it',
    title: 'Compose the calculator-grounded plan.',
    body: 'Fourteen regulatory regimes, live customs integration, audit-chained mutations. Every number in the plan comes from a versioned, deterministic function — never an LLM. Reproducible on any past date, citation-checked on every line.',
    href: '/intelligence',
  },
  {
    numeral: 'IV',
    kicker: 'Stage 04',
    verb: 'Ship it',
    title: 'Route the lane, book the freight, clear the window.',
    body: 'Sea and air across thirty origin × destination combinations. Bonded options at six EU hubs, sorted by what each does best. Freight, brokerage, warehousing and last-mile composed into one end-to-end landed cost.',
    href: '/logistics',
  },
  {
    numeral: 'V',
    kicker: 'Stage 05',
    verb: 'Finance it',
    title: 'Make the cycle bankable.',
    body: 'Working capital cycle, FX hedging windows, total cost of ownership. Investor-grade actuals on every shipment — quoted landed cost vs receipt at port, drift surfaced quarterly.',
    href: '/finance',
  },
];

export default function ProcessPage() {
  return (
    <>
      <EditorialHeader
        kicker="How the platform composes"
        title={
          <>
            Five stages.
            <br className="hidden md:block" /> One platform.
          </>
        }
        lead="From the moment you type an HS code to the moment the container clears the port. Five stages, each one calculator-grounded, each one citation-checked, each one routed back into the next."
        meta="Find it → Source it → Verify it → Ship it → Finance it"
      />

      {STAGES.map((s, i) => (
        <div key={s.numeral}>
          <ChapterRule numeral={s.numeral} label={s.verb} />
          <section
            id={s.verb.toLowerCase().replace(/\s+/g, '-')}
            data-chapter={s.verb}
            data-chapter-numeral={s.numeral}
            className={`scroll-mt-28 bg-[var(--color-ink)] py-20 md:py-28 ${
              i < STAGES.length - 1 ? 'border-b border-[var(--color-navy-line)]' : ''
            }`}
          >
            <div className="mx-auto max-w-[1100px] px-6">
              <FadeUp>
                <div className="grid grid-cols-1 gap-10 md:grid-cols-[260px_1fr] md:gap-16">
                  <div>
                    <div className="font-serif text-[12.5px] italic text-[var(--color-ivory-mute)]">
                      {s.kicker}
                    </div>
                    <div
                      className="mt-3 font-serif text-[clamp(3rem,5vw,4.4rem)] leading-none tracking-[-0.022em] text-[var(--color-ivory)]"
                      style={{
                        fontVariationSettings: "'SOFT' 35, 'opsz' 144",
                        fontWeight: 550,
                      }}
                    >
                      {s.verb}.
                    </div>
                  </div>
                  <div>
                    <h2
                      className="font-serif text-[clamp(1.8rem,2.6vw+0.4rem,2.4rem)] leading-[1.1] tracking-[-0.018em] text-[var(--color-ivory)]"
                      style={{
                        fontVariationSettings: "'SOFT' 35, 'opsz' 144",
                        fontWeight: 550,
                      }}
                    >
                      {s.title}
                    </h2>
                    <p className="mt-5 max-w-[62ch] text-[15px] leading-[1.75] text-[var(--color-ivory-dim)]">
                      {s.body}
                    </p>
                    <Link
                      href={s.href}
                      className="group mt-7 inline-flex items-center gap-2 text-[13px] font-medium text-[var(--color-ivory)] transition-all duration-500"
                    >
                      <span className="relative">
                        Open the stage
                        <span className="absolute -bottom-0.5 left-0 h-px w-0 bg-[var(--color-ivory)]/70 transition-[width] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:w-full" />
                      </span>
                      <span
                        aria-hidden
                        className="transition-transform duration-500 group-hover:translate-x-0.5"
                      >
                        →
                      </span>
                    </Link>
                  </div>
                </div>
              </FadeUp>
            </div>
          </section>
        </div>
      ))}
    </>
  );
}
