import type { Metadata } from 'next';
import Link from 'next/link';
import { EditorialHeader } from '@/components/marketing/editorial-header';
import { FadeUp } from '@/components/marketing/fade-up';

export const metadata: Metadata = {
  title: 'Customs guides — OrcaTrade Group',
  description:
    'EU customs procedures by commodity and destination. Duty, VAT, anti-dumping and CBAM at the port.',
};

const COMMODITIES = [
  {
    slug: 'electronics',
    title: 'Electronics',
    detail: 'Chapter 85. CE LVD/EMC/RED, RoHS, WEEE overlay; CBAM where applicable.',
  },
  {
    slug: 'footwear',
    title: 'Footwear',
    detail: 'Chapter 64. 94/11/EC labelling; product-safety GPSR; classification by upper material.',
  },
  {
    slug: 'furniture',
    title: 'Furniture',
    detail: 'Chapter 94. EUDR for wood-based; flammability for upholstery; CE for adjustable.',
  },
  {
    slug: 'home-textiles',
    title: 'Home textiles',
    detail: 'Chapter 63. REACH SVHC; care-label requirements; preferential origin under EBA / EVFTA.',
  },
  {
    slug: 'knitted-apparel',
    title: 'Knitted apparel',
    detail: 'Chapter 61. Anti-dumping carve-outs; care-label REACH; preferential origin under EBA / EVFTA.',
  },
  {
    slug: 'woven-apparel',
    title: 'Woven apparel',
    detail: 'Chapter 62. Anti-dumping carve-outs; care-label REACH; preferential origin under EBA / EVFTA.',
  },
];

const DESTINATIONS = [
  { code: 'DE', name: 'Germany' },
  { code: 'NL', name: 'Netherlands' },
  { code: 'PL', name: 'Poland' },
  { code: 'FR', name: 'France' },
  { code: 'IT', name: 'Italy' },
  { code: 'ES', name: 'Spain' },
];

export default function CustomsHubPage() {
  return (
    <>
      <EditorialHeader
        kicker="Customs"
        title="EU customs procedures, by commodity and destination."
        lead="Each row is a commodity class. Each column is a destination member state. Click any cell for the duty rates, the compliance overlay, and the documentation a clean clearance needs."
        meta="6 commodity classes × 6 destinations · live TARIC rates"
      />

      <section className="bg-[var(--color-ink)] py-20 md:py-28">
        <div className="mx-auto max-w-[1280px] px-6">
          <FadeUp>
            <div className="flex flex-col gap-px bg-[var(--color-navy-line)] border border-[var(--color-navy-line)]">
              {COMMODITIES.map((commodity) => (
                <article
                  key={commodity.slug}
                  className="group flex flex-col gap-6 bg-[var(--color-ink)] p-7 transition-colors duration-700 hover:bg-[var(--color-navy-soft)] md:p-9"
                >
                  <div className="flex flex-col gap-1">
                    <h2
                      className="font-serif text-[1.55rem] leading-[1.1] tracking-[-0.016em] text-[var(--color-ivory)]"
                      style={{ fontVariationSettings: "'SOFT' 35, 'opsz' 144", fontWeight: 550 }}
                    >
                      {commodity.title}
                    </h2>
                    <span className="font-serif text-[13px] italic text-[var(--color-ivory-dim)]">
                      {commodity.detail}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-px bg-[var(--color-navy-line)] sm:grid-cols-3 lg:grid-cols-6">
                    {DESTINATIONS.map((dest) => (
                      <Link
                        key={dest.code}
                        href={`/guides/customs/${commodity.slug}-into-${dest.code.toLowerCase()}/`}
                        className="group/cell flex flex-col gap-1 bg-[var(--color-ink)] px-4 py-3.5 transition-colors duration-300 hover:bg-[var(--color-navy-soft)]"
                      >
                        <span className="font-mono text-[11px] font-medium tabular-nums tracking-tight text-[var(--color-ivory)]">
                          {commodity.title} → {dest.code}
                        </span>
                        <span className="font-serif text-[12.5px] italic text-[var(--color-ivory-mute)] transition-colors duration-300 group-hover/cell:text-[var(--color-ivory-dim)]">
                          {dest.name}
                        </span>
                      </Link>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </FadeUp>
        </div>
      </section>
    </>
  );
}
