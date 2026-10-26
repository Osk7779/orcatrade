'use client';

import Link from '@/components/marketing/smart-link';
import { usePathname } from 'next/navigation';
import { Globe } from './globe';
import { EN_COPY, type HomepageCopy } from '@/lib/i18n/homepage-copy';

// Apple-style hero: centred statement, one sentence of support, one
// primary action and one quiet link — then the product shot (the globe).
// Content renders immediately; no intro gate, no staged reveal.
export function Hero({ copy = EN_COPY.hero }: { copy?: HomepageCopy['hero'] }) {
  const pathname = usePathname() || '/';
  const prefix = pathname.startsWith('/pl') ? '/pl' : pathname.startsWith('/de') ? '/de' : '';
  const [a, b, c, d] = copy.headline;

  return (
    <section className="overflow-hidden bg-[var(--color-ink)] pt-16 text-center md:pt-24">
      <div className="mx-auto max-w-[980px] px-6">
        <p className="eyebrow">{copy.kicker}</p>

        <h1 className="mt-4 text-[clamp(2.6rem,6.4vw,5rem)] font-semibold leading-[1.05] tracking-[-0.035em] text-[var(--color-ivory)]">
          {a} {b}
          <br className="hidden sm:block" /> {c}{' '}
          <span className="text-[var(--color-accent)]">{d}</span>
        </h1>

        <p className="mx-auto mt-6 max-w-[640px] text-[clamp(1.05rem,1.4vw,1.3rem)] leading-[1.5] text-[var(--color-ivory-mute)]">
          {copy.body}
        </p>

        <div className="mt-9 flex flex-col items-center justify-center gap-4 sm:flex-row sm:gap-7">
          {/* /pl/start/ and /de/start/ are static pages on the root project,
              so this is a plain anchor, not a client-side route. */}
          <a href={`${prefix}/start/`} className="btn-primary">
            {copy.ctaPrimary}
          </a>
          <Link href="/platform/" className="link-arrow">
            {copy.ctaSecondary} <span aria-hidden>›</span>
          </Link>
        </div>
      </div>

      <div className="relative mx-auto mt-10 max-w-[620px] px-6 md:mt-14">
        <Globe />
      </div>
      <p className="mx-auto -mt-6 max-w-[520px] px-6 pb-20 text-[14px] text-[var(--color-ivory-mute)] md:pb-28">
        {copy.globeCaption} {copy.globeSubCaption}
      </p>
    </section>
  );
}
