import type { Metadata } from 'next';
import Link from 'next/link';
import { EditorialHeader } from '@/components/marketing/editorial-header';
import { FadeUp } from '@/components/marketing/fade-up';

export const metadata: Metadata = {
  title: 'Routing guides — OrcaTrade Group',
  description:
    'Sea and air lanes from Asia origins to European destinations. Transit, frequencies, port fit.',
};

const ORIGINS = [
  { code: 'cn', name: 'China' },
  { code: 'hk', name: 'Hong Kong' },
  { code: 'vn', name: 'Vietnam' },
  { code: 'in', name: 'India' },
  { code: 'tr', name: 'Türkiye' },
];

const DESTINATIONS = [
  { code: 'de', name: 'Germany' },
  { code: 'nl', name: 'Netherlands' },
  { code: 'pl', name: 'Poland' },
  { code: 'fr', name: 'France' },
  { code: 'it', name: 'Italy' },
  { code: 'es', name: 'Spain' },
];

export default function RoutingHubPage() {
  return (
    <>
      <EditorialHeader
        kicker="Routing"
        title="From origin to port, port to door."
        lead="Each row is an Asia origin. Each column is a European destination. Click any cell for transit windows, lane frequencies, and which gateway favours which cargo."
        meta="5 origins × 6 destinations · sea and air"
      />

      <section className="bg-[var(--color-ink)] py-20 md:py-28">
        <div className="mx-auto max-w-[1280px] px-6">
          <FadeUp>
            <div className="flex flex-col gap-px border border-[var(--color-navy-line)] bg-[var(--color-navy-line)]">
              {ORIGINS.map((o) => (
                <article
                  key={o.code}
                  className="bg-[var(--color-ink)] p-7 transition-colors duration-700 hover:bg-[var(--color-navy-soft)] md:p-9"
                >
                  <h2
                    className="mb-5 font-serif text-[1.55rem] leading-[1.1] tracking-[-0.016em] text-[var(--color-ivory)]"
                    style={{ fontVariationSettings: "'SOFT' 35, 'opsz' 144", fontWeight: 550 }}
                  >
                    From {o.name}
                  </h2>
                  <div className="grid grid-cols-2 gap-px bg-[var(--color-navy-line)] sm:grid-cols-3 md:grid-cols-6">
                    {DESTINATIONS.map((d) => (
                      <Link
                        key={d.code}
                        href={`/guides/routing/${o.code}-to-${d.code}/`}
                        className="flex flex-col gap-1 bg-[var(--color-ink)] px-4 py-3.5 transition-colors duration-300 hover:bg-[var(--color-navy-soft)]"
                      >
                        <span className="font-mono text-[11px] font-medium uppercase tabular-nums tracking-tight text-[var(--color-ivory)]">
                          {o.code} → {d.code}
                        </span>
                        <span className="font-serif text-[12.5px] italic text-[var(--color-ivory-mute)]">
                          To {d.name}
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
