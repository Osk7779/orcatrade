import Link from 'next/link';
import { Aurora } from './aurora';
import { Lamp } from './lamp';
import { FadeUp } from './fade-up';

export function FinalCta() {
  return (
    <section className="relative isolate overflow-hidden bg-[var(--color-ink)] py-24 md:py-44">
      <Aurora />
      <Lamp />

      {/* Hairline rule above the closing — implies "end of the publication" */}
      <div className="relative mx-auto max-w-[1280px] px-6">
        <span aria-hidden className="mx-auto block h-px w-32 bg-[var(--color-ivory-dim)]/40" />
      </div>

      <FadeUp className="relative mx-auto mt-14 max-w-[900px] px-6 text-center">
        <span className="font-serif text-[14px] italic text-[var(--color-ivory-dim)]">
          One last thing
        </span>
        <h2
          className="mx-auto mt-6 max-w-[22ch] font-serif text-[clamp(2.8rem,5.6vw+0.4rem,4.6rem)] leading-[1.02] tracking-[-0.024em] text-[var(--color-ivory)]"
          style={{ fontVariationSettings: "'SOFT' 35, 'opsz' 144", fontWeight: 550 }}
        >
          Your next import, priced to the cent.
        </h2>
        <p className="mx-auto mt-7 max-w-[58ch] text-[15.5px] leading-[1.78] text-[var(--color-ivory-dim)]">
          Tell us what you&rsquo;re sourcing, where it&rsquo;s coming from, and
          where it&rsquo;s going. We&rsquo;ll cost the lane end-to-end, surface
          every regime that touches it, and hand you a plan you can ship from.
        </p>

        <div className="mt-12 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/start"
            className="group inline-flex items-center gap-3 bg-[var(--color-ivory)] px-8 py-4 text-[12.5px] font-semibold text-[var(--color-ink)] transition-all duration-500 hover:bg-white"
          >
            Build my import plan
            <span aria-hidden className="transition-transform duration-500 group-hover:translate-x-0.5">
              →
            </span>
          </Link>
          <Link
            href="/contact.html"
            className="inline-flex items-center gap-3 border border-[var(--color-navy-line)] px-8 py-4 text-[12.5px] font-medium text-[var(--color-ivory)] transition-all duration-500 hover:border-[var(--color-ivory-dim)] hover:bg-[var(--color-navy-soft)]"
          >
            Talk to a person
          </Link>
        </div>

        <div className="mt-12 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 font-serif text-[13px] italic text-[var(--color-ivory-mute)]">
          <span>No payment to apply</span>
          <span aria-hidden className="hidden md:inline">·</span>
          <span>Calculator-grounded, with citations</span>
          <span aria-hidden className="hidden md:inline">·</span>
          <span>UK English · EUR · ISO-2</span>
        </div>
      </FadeUp>
    </section>
  );
}
