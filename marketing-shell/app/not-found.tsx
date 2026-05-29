import Link from 'next/link';
import { Aurora } from '@/components/marketing/aurora';
import { SparklesText } from '@/components/marketing/sparkles';

export default function NotFound() {
  return (
    <section className="relative isolate flex min-h-[78vh] items-center overflow-hidden bg-[var(--color-ink)]">
      <Aurora />
      <div className="relative mx-auto flex max-w-[780px] flex-col items-center gap-10 px-6 py-24 text-center md:py-36">
        <div className="flex items-center gap-4">
          <span className="h-px w-10 bg-[var(--color-ivory-dim)]/50" />
          <span className="font-serif text-[13px] italic text-[var(--color-ivory-mute)]">
            404 · not found
          </span>
        </div>

        <h1
          className="font-serif text-[clamp(3.4rem,7vw+0.4rem,6rem)] leading-[1] tracking-[-0.024em] text-[var(--color-ivory)]"
          style={{ fontVariationSettings: "'SOFT' 35, 'opsz' 144", fontWeight: 550 }}
        >
          <SparklesText count={10}>Mislaid.</SparklesText>
        </h1>

        <p
          className="max-w-[44ch] font-serif text-[clamp(1.1rem,1.4vw+0.4rem,1.4rem)] italic leading-[1.5] text-[var(--color-ivory-dim)]"
          style={{ fontVariationSettings: "'SOFT' 35, 'opsz' 144" }}
        >
          The page you asked for is not at the address you gave us. It may have
          moved, it may have been retired, or we may have simply mis-stamped
          the envelope.
        </p>

        <div className="flex items-center gap-3.5">
          <span className="h-px w-10 bg-[var(--color-ivory-dim)]/40" />
          <span aria-hidden className="font-serif text-[14px] text-[var(--color-ivory-dim)]/60">
            ❦
          </span>
          <span className="h-px w-10 bg-[var(--color-ivory-dim)]/40" />
        </div>

        <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
          <Link
            href="/"
            className="group inline-flex items-center gap-3 bg-[var(--color-ivory)] px-7 py-3.5 text-[12.5px] font-semibold text-[var(--color-ink)] transition-colors duration-500 hover:bg-white"
          >
            Return to the homepage
            <span aria-hidden className="transition-transform duration-500 group-hover:translate-x-0.5">
              →
            </span>
          </Link>
          <Link
            href="/contact"
            className="inline-flex items-center gap-3 border border-[var(--color-navy-line)] px-7 py-3.5 text-[12.5px] font-medium text-[var(--color-ivory)] transition-all duration-500 hover:border-[var(--color-ivory-dim)] hover:bg-[var(--color-navy-soft)]"
          >
            Tell us what you were looking for
          </Link>
        </div>
      </div>
    </section>
  );
}
