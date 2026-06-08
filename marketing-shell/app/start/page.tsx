import type { Metadata } from 'next';
import { Aurora } from '@/components/marketing/aurora';
import { AmbientParticles } from '@/components/marketing/ambient-particles';
import { Marquee } from '@/components/marketing/marquee';
import { NumberTicker } from '@/components/marketing/number-ticker';
import { SparklesText } from '@/components/marketing/sparkles';
import { Wizard } from '@/components/marketing/wizard';

export const metadata: Metadata = {
  title: 'Build your import plan — OrcaTrade Group',
  description:
    "Tell us what you're importing. We'll compose a calculator-grounded plan across sourcing, routing, customs, and warehousing — in about sixty seconds.",
};

const LANE_TICKER = [
  { lane: 'cotton t-shirts', route: 'CN → DE', tag: 'Apparel · chapter 62' },
  { lane: 'e-bikes', route: 'CN → PL', tag: 'AD 70.1% + CVD 17.2%' },
  { lane: 'aluminium extrusions', route: 'CN → DE', tag: 'CBAM declarant' },
  { lane: 'PCBA modules', route: 'VN → DE', tag: 'EVFTA · 0% duty' },
  { lane: 'oak dining tables', route: 'VN → FR', tag: 'Chapter 94 · EUDR' },
  { lane: 'bluetooth speakers', route: 'CN → IT', tag: 'CE LVD/EMC/RED' },
  { lane: 'jeans', route: 'BD → ES', tag: 'EBA · 0% duty' },
  { lane: 'cosmetics', route: 'IN → NL', tag: 'EU CPNP · 1223/2009' },
];

const STATS = [
  { value: 60, label: 'Seconds to a plan', suffix: 's' },
  { value: 14, label: 'Regimes covered' },
  { value: 6, label: 'Sourcing markets' },
  { value: 0, label: 'Payment up front', prefix: '€' },
];

export default function StartPage() {
  return (
    <>
      {/* ── HERO: Aurora wash + ambient particles + sparkles title ── */}
      <section className="relative isolate overflow-hidden bg-[var(--color-ink)] pt-20 pb-12 md:pt-28 md:pb-14">
        <Aurora />
        <AmbientParticles />
        <div className="relative mx-auto max-w-[1100px] px-6 text-center md:text-left">
          <div className="flex flex-wrap items-center gap-3 font-mono text-[11px] tracking-[0.18em] uppercase text-[var(--color-ivory-mute)]">
            <span className="relative flex h-2 w-2 items-center justify-center">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--color-positive)] opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--color-positive)]" />
            </span>
            Import Plan Builder · about sixty seconds · free
          </div>
          <h1
            className="mt-7 max-w-[24ch] font-serif text-[clamp(2.6rem,4.4vw+0.4rem,4.4rem)] leading-[1.04] tracking-[-0.024em] text-[var(--color-ivory)]"
            style={{ fontVariationSettings: "'SOFT' 35, 'opsz' 144", fontWeight: 550 }}
          >
            Tell us what you&rsquo;re importing.{' '}
            <SparklesText count={6}>We&rsquo;ll compose the plan.</SparklesText>
          </h1>
          <p className="mt-7 max-w-[60ch] text-[15.5px] leading-[1.78] text-[var(--color-ivory-dim)]">
            A six-step brief — what, from where, to where, the numbers. We come
            back with the calculator-grounded plan: duty, every regime, freight,
            working capital, end to end.
          </p>
          <div className="mt-8 flex items-center gap-3.5">
            <span className="h-px w-8 bg-[var(--color-ivory-mute)]/40" />
            <span aria-hidden className="font-serif text-[14px] text-[var(--color-ivory-dim)]/60">
              ❦
            </span>
            <span className="font-serif text-[14px] italic text-[var(--color-ivory-mute)]">
              No payment to apply · calculator-grounded, with citations
            </span>
          </div>
        </div>
      </section>

      {/* ── LIVE STATS STRIP ─────────────────────────────── */}
      <section className="border-y border-[var(--color-navy-line)] bg-[var(--color-ink)] py-10">
        <div className="mx-auto max-w-[1100px] grid grid-cols-2 md:grid-cols-4 gap-px bg-[var(--color-navy-line)] border-x border-[var(--color-navy-line)]">
          {STATS.map((s) => (
            <div key={s.label} className="bg-[var(--color-ink)] px-6 py-7 text-center">
              <div
                className="font-serif text-[clamp(2rem,3vw+0.4rem,2.6rem)] leading-none tracking-[-0.022em] text-[var(--color-ivory)]"
                style={{ fontVariationSettings: "'SOFT' 30, 'opsz' 144", fontWeight: 600 }}
              >
                <NumberTicker value={s.value} prefix={s.prefix || ''} suffix={s.suffix || ''} />
              </div>
              <div className="mt-2 font-mono text-[10.5px] tracking-[0.16em] uppercase text-[var(--color-ivory-mute)]">
                {s.label}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── LANE TICKER MARQUEE ──────────────────────────── */}
      <section className="border-b border-[var(--color-navy-line)] bg-[var(--color-ink)] py-5">
        <div className="mb-3 text-center">
          <span className="font-mono text-[10px] tracking-[0.18em] uppercase text-[var(--color-ivory-mute)]">
            Recently priced
          </span>
        </div>
        <Marquee durationMs={50_000} pauseOnHover>
          {LANE_TICKER.map((l) => (
            <span key={l.lane + l.route} className="flex shrink-0 items-center gap-3 text-[12.5px]">
              <span className="font-serif italic text-[var(--color-ivory)]">{l.lane}</span>
              <span aria-hidden className="text-[var(--color-navy-line)]">·</span>
              <span className="font-mono text-[var(--color-ivory-dim)]">{l.route}</span>
              <span aria-hidden className="text-[var(--color-navy-line)]">·</span>
              <span className="font-serif italic text-[var(--color-ivory-mute)]">{l.tag}</span>
            </span>
          ))}
        </Marquee>
      </section>

      {/* ── WIZARD ───────────────────────────────────────── */}
      <Wizard />
    </>
  );
}
