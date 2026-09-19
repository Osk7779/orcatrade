import { FadeUp } from './fade-up';
import { EN_COPY, type HomepageCopy } from '@/lib/i18n/homepage-copy';

// One large, centred statement on the alternate surface — the product's
// principle in a single paragraph.
export function Manifesto({ copy = EN_COPY.manifesto }: { copy?: HomepageCopy['manifesto'] }) {
  return (
    <section id="manifesto" className="bg-[var(--color-navy)] py-20 md:py-28">
      <FadeUp className="mx-auto max-w-[900px] px-6 text-center">
        <p className="eyebrow">{copy.eyebrow}</p>
        <p className="mt-6 text-[clamp(1.6rem,3.2vw,2.6rem)] font-semibold leading-[1.2] tracking-[-0.025em] text-[var(--color-ivory)]">
          {copy.dropCap}
          {copy.bodyAfterDropCap}
        </p>
        <p className="mt-8 text-[14px] text-[var(--color-ivory-mute)]">{copy.colophon}</p>
      </FadeUp>
    </section>
  );
}
