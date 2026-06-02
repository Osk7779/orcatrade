import { BentoGrid, BentoCard } from './bento-grid';
import { FadeUp } from './fade-up';
import { EN_COPY, type HomepageCopy } from '@/lib/i18n/homepage-copy';

// Five stages of an import — matches the live OrcaTrade.pl framing
// (Find it · Source it · Verify it · Ship it · Finance it). Verify it
// (Intelligence) is the flagship; it spans 2 cells and carries the
// border beam. Bento layout below — flagship sits top-left.

const FlagshipVisual = () => (
  <div className="absolute inset-0">
    <div className="absolute right-[-10%] top-[-20%] size-[60%] rounded-full bg-[radial-gradient(circle,rgba(22,44,90,0.55),transparent_70%)] blur-2xl" />
    <div className="absolute bottom-[10%] left-[-10%] size-[50%] rounded-full bg-[radial-gradient(circle,rgba(34,60,108,0.4),transparent_70%)] blur-3xl" />
  </div>
);

const GridVisual = () => (
  <div
    className="absolute inset-0 opacity-60"
    style={{
      backgroundImage:
        'linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)',
      backgroundSize: '24px 24px',
      maskImage: 'radial-gradient(ellipse at center, black 30%, transparent 75%)',
    }}
  />
);

export function PillarsBento({
  copy = EN_COPY.pillarsSection,
}: {
  copy?: HomepageCopy['pillarsSection'];
}) {
  return (
    <section
      id="pillars"
      className="border-b border-[var(--color-navy-line)] bg-[var(--color-ink)] py-20 md:py-32"
    >
      <div className="mx-auto max-w-[1280px] px-6">
        <FadeUp className="mx-auto mb-16 max-w-[760px] text-center">
          <h2
            className="font-serif text-[clamp(2.2rem,3.8vw+0.4rem,3.4rem)] leading-[1.08] tracking-[-0.022em] text-[var(--color-ivory)]"
            style={{ fontVariationSettings: "'SOFT' 35, 'opsz' 144" }}
          >
            {copy.title}
          </h2>
        </FadeUp>

        <BentoGrid className="border border-[var(--color-navy-line)]">
          <BentoCard
            span={2}
            flagship
            kicker={copy.intelligence.kicker}
            status="live"
            title={copy.intelligence.title}
            description={copy.intelligence.description}
            cta={{ label: copy.intelligence.cta, href: '/intelligence' }}
            visual={<FlagshipVisual />}
          />
          <BentoCard
            kicker={copy.search.kicker}
            status="live"
            title={copy.search.title}
            description={copy.search.description}
            cta={{ label: copy.search.cta, href: '/search' }}
            visual={<GridVisual />}
          />
          <BentoCard
            kicker={copy.sourcing.kicker}
            status="live"
            title={copy.sourcing.title}
            description={copy.sourcing.description}
            cta={{ label: copy.sourcing.cta, href: '/sourcing' }}
            visual={<GridVisual />}
          />
          <BentoCard
            kicker={copy.logistics.kicker}
            status="live"
            title={copy.logistics.title}
            description={copy.logistics.description}
            cta={{ label: copy.logistics.cta, href: '/logistics' }}
            visual={<GridVisual />}
          />
          <BentoCard
            kicker={copy.finance.kicker}
            status="beta"
            title={copy.finance.title}
            description={copy.finance.description}
            cta={{ label: copy.finance.cta, href: '/finance' }}
            visual={<GridVisual />}
          />
        </BentoGrid>
      </div>
    </section>
  );
}
