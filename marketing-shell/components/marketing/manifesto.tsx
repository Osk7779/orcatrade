import { FadeUp } from './fade-up';

// Editorial pull-paragraph with a serif drop cap. Static — class beats
// motion here. The reveal cadence of the page is carried by the
// surrounding chapter rules and the FadeUp on the kicker and signature.
const BODY =
  'uropean businesses deserve import operations that are calculated, cited, and explained — not estimated, not assumed, not lost to the next intermediary. OrcaTrade exists to make the next container a known quantity — landed cost, every regime, end to end — before it leaves the factory.';

export function Manifesto() {
  return (
    <section
      id="manifesto"
      className="relative border-b border-[var(--color-navy-line)] bg-[var(--color-ink)] py-32 md:py-44"
    >
      <div className="mx-auto max-w-[1080px] px-6">
        <FadeUp className="flex items-center gap-4">
          <span className="h-px w-10 bg-[var(--color-ivory-dim)]/50" />
          <span className="font-serif text-[13px] italic text-[var(--color-ivory-mute)]">
            On principle
          </span>
        </FadeUp>

        <FadeUp delay={0.1} className="mt-12">
          <p
            className="font-serif text-[clamp(1.5rem,2.8vw+0.4rem,2.5rem)] leading-[1.34] tracking-[-0.014em] text-[var(--color-ivory)]"
            style={{ fontVariationSettings: "'SOFT' 35, 'opsz' 144" }}
          >
            <span
              aria-hidden
              className="float-left mr-3 pt-[0.18em] font-serif text-[clamp(4.6rem,9vw+0.6rem,7.4rem)] leading-[0.78] text-[var(--color-ivory)]"
              style={{ fontVariationSettings: "'SOFT' 30, 'opsz' 144", fontWeight: 600 }}
            >
              E
            </span>
            <span className="italic">{BODY}</span>
          </p>
        </FadeUp>

        <FadeUp delay={0.2} className="mt-16 flex items-center gap-4">
          <span className="h-px flex-1 bg-[var(--color-navy-line)]" />
          <span aria-hidden className="font-serif text-[18px] text-[var(--color-ivory-dim)]/55">
            ❦
          </span>
          <span className="h-px flex-1 bg-[var(--color-navy-line)]" />
        </FadeUp>

        <div className="mt-6 text-center">
          <span className="font-serif text-[12.5px] italic tracking-tight text-[var(--color-ivory-mute)]">
            OrcaTrade Group · MMXXVI
          </span>
        </div>
      </div>
    </section>
  );
}
