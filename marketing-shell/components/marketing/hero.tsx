import Link from 'next/link';
import { Aurora } from './aurora';
import { Globe } from './globe';
import { SparklesText } from './sparkles';
import { MotionHeadline } from './motion-headline';
import { AmbientParticles } from './ambient-particles';
import { GlobeStars } from './globe-stars';

// No measured claims. The hero is copy, globe, CTAs, and a single
// confident closing line. Presence through space, not through numbers.
export function Hero() {
  return (
    <section className="relative isolate overflow-hidden">
      <Aurora />
      <AmbientParticles />

      <div className="relative mx-auto grid max-w-[1280px] grid-cols-1 items-center gap-12 px-6 pt-24 pb-28 md:grid-cols-[1.05fr_0.95fr] md:gap-20 md:pt-32 md:pb-36">
        {/* Copy column */}
        <div className="flex flex-col gap-10">
          <div className="flex items-center gap-4">
            <span className="h-px w-10 bg-[var(--color-ivory-dim)]/50" />
            <span className="text-[12px] font-medium tracking-tight text-[var(--color-ivory-dim)]">
              One platform · Asia → Europe
            </span>
          </div>

          <MotionHeadline
            className="font-serif text-[clamp(3rem,6.2vw+0.4rem,5.6rem)] leading-[1.02] tracking-[-0.02em] text-[var(--color-ivory)]"
            lines={[
              'Source it.',
              'Clear it.',
              'Move it.',
              <SparklesText key="finance" count={8}>
                Finance it.
              </SparklesText>,
            ]}
          />

          <p className="max-w-[52ch] text-[15.5px] leading-[1.78] text-[var(--color-ivory-dim)]">
            OrcaTrade is the import operations team available 24/7 for European
            businesses sourcing from Asia. Search, sourcing, compliance,
            logistics and finance — on one calculator-grounded platform, with
            citations on every recommendation.
          </p>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <Link
              href="/start"
              className="group inline-flex items-center gap-3 bg-[var(--color-ivory)] px-7 py-3.5 text-[12.5px] font-semibold text-[var(--color-ink)] transition-all duration-500 hover:bg-white"
            >
              Build my import plan
              <span
                aria-hidden
                className="transition-transform duration-500 group-hover:translate-x-0.5"
              >
                →
              </span>
            </Link>
            <Link
              href="/docs/orcatrade-shareholder-brief"
              className="group inline-flex items-center gap-3 border border-[var(--color-navy-line)] px-7 py-3.5 text-[12.5px] font-medium text-[var(--color-ivory)] transition-all duration-500 hover:border-[var(--color-ivory-dim)] hover:bg-[var(--color-navy-soft)]"
            >
              Read the prospectus
            </Link>
          </div>

          {/* Single closing line — presence, not metric. Fleuron carries
              the same ornament language as the chapter rules below. */}
          <div className="flex items-center gap-3.5 pt-4">
            <span className="h-px w-8 bg-[var(--color-ivory-mute)]/40" />
            <span aria-hidden className="font-serif text-[14px] text-[var(--color-ivory-dim)]/60">
              ❦
            </span>
            <span className="font-serif text-[14px] italic text-[var(--color-ivory-mute)]">
              Operating across the EU, the UK and Asia.
            </span>
          </div>
        </div>

        {/* Globe column — bare sphere in atmosphere, with a barely-visible
            star field flickering at its edges */}
        <div className="relative mx-auto w-full max-w-[640px]">
          <GlobeStars />
          <Globe />
          <div className="mt-8 flex flex-col items-center gap-1.5">
            <span className="font-serif text-[1.05rem] italic leading-tight text-[var(--color-ivory-dim)]">
              Lanes observed between Asia and Europe — live.
            </span>
            <span className="text-[11px] font-medium tracking-tight text-[var(--color-ivory-mute)]">
              From Shanghai and Ho Chi Minh to Warsaw, Berlin and Amsterdam.
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
