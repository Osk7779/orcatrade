import Link from '@/components/marketing/smart-link';
import { FadeUp } from './fade-up';
import { EN_COPY, type HomepageCopy } from '@/lib/i18n/homepage-copy';

// The five domains as Apple-style tiles. Intelligence (compliance) is the
// flagship and spans the full width on top; the other four sit beneath.
type Pillar = { kicker: string; title: string; description: string; cta: string };

function Tile({
  pillar,
  href,
  status,
  flagship = false,
}: {
  pillar: Pillar;
  href: string;
  status: 'live' | 'beta';
  flagship?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`tile group flex flex-col justify-between gap-8 p-8 transition-transform duration-300 hover:scale-[1.01] md:p-10 ${
        flagship ? 'md:col-span-2 md:min-h-[320px] bg-[var(--color-ivory)]! text-white' : 'min-h-[260px]'
      }`}
    >
      <div>
        <div
          className={`flex items-center gap-2 text-[12px] ${flagship ? 'text-white/60' : 'text-[var(--color-ivory-mute)]'}`}
        >
          <span>{pillar.kicker}</span>
          {status === 'beta' && (
            <span className="rounded-full border border-current px-2 py-px text-[11px]">Beta</span>
          )}
        </div>
        <h3
          className={`mt-3 text-[clamp(1.6rem,2.6vw,2.4rem)] leading-[1.1] tracking-[-0.03em] ${
            flagship ? 'text-white' : 'text-[var(--color-ivory)]'
          }`}
        >
          {pillar.title}
        </h3>
        <p
          className={`mt-4 max-w-[52ch] text-[16px] leading-[1.5] ${
            flagship ? 'text-white/75' : 'text-[var(--color-ivory-dim)]'
          }`}
        >
          {pillar.description}
        </p>
      </div>
      <span
        className={`text-[15px] group-hover:underline ${flagship ? 'text-[#2997ff]' : 'text-[var(--color-link)]'}`}
      >
        {pillar.cta} ›
      </span>
    </Link>
  );
}

export function PillarsBento({
  copy = EN_COPY.pillarsSection,
}: {
  copy?: HomepageCopy['pillarsSection'];
}) {
  return (
    <section id="pillars" className="bg-[var(--color-ink)] py-20 md:py-24">
      <div className="mx-auto max-w-[1080px] px-6">
        <FadeUp className="mb-12 text-center">
          <h2 className="mx-auto max-w-[22ch] text-[clamp(2rem,4vw,3rem)] leading-[1.1]">{copy.title}</h2>
        </FadeUp>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <Tile pillar={copy.intelligence} href="/intelligence/" status="live" flagship />
          <Tile pillar={copy.search} href="/search/" status="live" />
          <Tile pillar={copy.sourcing} href="/sourcing/" status="live" />
          <Tile pillar={copy.logistics} href="/logistics/" status="live" />
          <Tile pillar={copy.finance} href="/finance/" status="beta" />
        </div>
      </div>
    </section>
  );
}
