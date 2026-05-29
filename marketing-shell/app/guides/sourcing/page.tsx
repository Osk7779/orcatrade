import type { Metadata } from 'next';
import Link from 'next/link';
import { EditorialHeader } from '@/components/marketing/editorial-header';
import { FadeUp } from '@/components/marketing/fade-up';

export const metadata: Metadata = {
  title: 'Sourcing guides — OrcaTrade Group',
  description:
    'Eight Asia origins, eight commodity categories. What to ask suppliers, what to verify, what to avoid.',
};

const COMMODITIES = [
  { slug: 'apparel', title: 'Apparel' },
  { slug: 'cosmetics', title: 'Cosmetics' },
  { slug: 'electronics', title: 'Electronics' },
  { slug: 'footwear', title: 'Footwear' },
  { slug: 'furniture', title: 'Furniture' },
  { slug: 'homeware', title: 'Homeware' },
  { slug: 'machinery', title: 'Machinery' },
  { slug: 'toys', title: 'Toys' },
];

const ORIGINS = [
  { code: 'cn', name: 'China' },
  { code: 'vn', name: 'Vietnam' },
  { code: 'in', name: 'India' },
  { code: 'bd', name: 'Bangladesh' },
  { code: 'tr', name: 'Türkiye' },
];

export default function SourcingHubPage() {
  return (
    <>
      <EditorialHeader
        kicker="Sourcing"
        title="By commodity, by origin."
        lead="Each row is a commodity category we have priced lanes for. Each column is the Asia origin we know best. Click any cell for the supplier brief, the regulatory regime overlay, and the cost benchmarks."
        meta="8 commodity classes × 5 origins"
      />

      <section className="bg-[var(--color-ink)] py-20 md:py-28">
        <div className="mx-auto max-w-[1280px] px-6">
          <FadeUp>
            <div className="flex flex-col gap-px bg-[var(--color-navy-line)] border border-[var(--color-navy-line)]">
              {COMMODITIES.map((c) => (
                <article
                  key={c.slug}
                  className="bg-[var(--color-ink)] p-7 transition-colors duration-700 hover:bg-[var(--color-navy-soft)] md:p-9"
                >
                  <h2
                    className="mb-5 font-serif text-[1.55rem] leading-[1.1] tracking-[-0.016em] text-[var(--color-ivory)]"
                    style={{ fontVariationSettings: "'SOFT' 35, 'opsz' 144", fontWeight: 550 }}
                  >
                    {c.title}
                  </h2>
                  <div className="grid grid-cols-2 gap-px bg-[var(--color-navy-line)] sm:grid-cols-3 md:grid-cols-5">
                    {ORIGINS.map((o) => (
                      <Link
                        key={o.code}
                        href={`/guides/sourcing/${c.slug}-from-${o.code}/`}
                        className="flex flex-col gap-1 bg-[var(--color-ink)] px-4 py-3.5 transition-colors duration-300 hover:bg-[var(--color-navy-soft)]"
                      >
                        <span className="font-mono text-[11px] font-medium tabular-nums uppercase tracking-tight text-[var(--color-ivory)]">
                          {c.title} ← {o.code.toUpperCase()}
                        </span>
                        <span className="font-serif text-[12.5px] italic text-[var(--color-ivory-mute)]">
                          From {o.name}
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
