import Link from '@/components/marketing/smart-link';
import { FadeUp } from './fade-up';
import { EN_COPY, type HomepageCopy } from '@/lib/i18n/homepage-copy';

export function FinalCta({ copy = EN_COPY.finalCta }: { copy?: HomepageCopy['finalCta'] }) {
  return (
    <section className="bg-[var(--color-navy)] py-20 md:py-28">
      <FadeUp className="mx-auto max-w-[820px] px-6 text-center">
        <p className="eyebrow">{copy.eyebrow}</p>
        <h2 className="mx-auto mt-4 max-w-[20ch] text-[clamp(2.2rem,5vw,3.8rem)] leading-[1.06] tracking-[-0.035em]">
          {copy.title}
        </h2>
        <p className="mx-auto mt-6 max-w-[56ch] text-[clamp(1rem,1.3vw,1.2rem)] leading-[1.55] text-[var(--color-ivory-mute)]">
          {copy.body}
        </p>
        <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row sm:gap-7">
          <a href="/start/" className="btn-primary">
            {copy.ctaPrimary}
          </a>
          <Link href="/contact/" className="link-arrow">
            {copy.ctaSecondary} <span aria-hidden>›</span>
          </Link>
        </div>
        <p className="mt-10 text-[13px] text-[var(--color-ivory-mute)]">
          {copy.footer.join(' · ')}
        </p>
      </FadeUp>
    </section>
  );
}
