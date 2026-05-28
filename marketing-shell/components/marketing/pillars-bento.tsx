import { BentoGrid, BentoCard } from './bento-grid';
import { FadeUp } from './fade-up';

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

export function PillarsBento() {
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
            Five stages. One platform.
          </h2>
        </FadeUp>

        <BentoGrid className="border border-[var(--color-navy-line)]">
          <BentoCard
            span={2}
            flagship
            kicker="Stage 03 · Verify it · Flagship"
            status="live"
            title="OrcaTrade Intelligence."
            description="EU/UK customs, CBAM, EUDR, REACH, CE-marking, anti-dumping and countervailing duties — surfaced from one calculator-grounded engine, with citations and confidence tiers on every claim."
            cta={{ label: 'See the guides', href: '/guides/compliance' }}
            visual={<FlagshipVisual />}
          />
          <BentoCard
            kicker="Stage 01 · Find it"
            status="live"
            title="OrcaTrade Search."
            description="Type any HS code, product, supplier or lane. Get every regime that touches it."
            cta={{ label: 'Open Search', href: '/start' }}
            visual={<GridVisual />}
          />
          <BentoCard
            kicker="Stage 02 · Source it"
            status="live"
            title="OrcaTrade Sourcing."
            description="Six Asia origins, supplier screening, factory-risk feeds, sample-quote rebranding."
            cta={{ label: 'Explore sourcing', href: '/guides/sourcing' }}
            visual={<GridVisual />}
          />
          <BentoCard
            kicker="Stage 04 · Ship it"
            status="live"
            title="OrcaTrade Logistics."
            description="Lane routing across DE, NL, PL, ES, IT, FR and beyond. Door-to-door priced end-to-end."
            cta={{ label: 'Routing guides', href: '/guides/routing' }}
            visual={<GridVisual />}
          />
          <BentoCard
            kicker="Stage 05 · Finance it"
            status="beta"
            title="OrcaTrade Finance."
            description="Working capital, FX hedging windows, total cost of ownership — for orders of €50k–€500k."
            cta={{ label: 'Read the brief', href: '/docs/orcatrade-shareholder-brief' }}
            visual={<GridVisual />}
          />
        </BentoGrid>
      </div>
    </section>
  );
}
