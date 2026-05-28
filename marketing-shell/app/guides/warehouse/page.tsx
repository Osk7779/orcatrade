import type { Metadata } from 'next';
import { EditorialHeader } from '@/components/marketing/editorial-header';
import { HubCard } from '@/components/marketing/hub-card';
import { FadeUp } from '@/components/marketing/fade-up';

export const metadata: Metadata = {
  title: 'Warehouse & 3PL guides — OrcaTrade Group',
  description:
    'Bonded and non-bonded options in the most-used European hubs. What each city does best.',
};

const CITIES = [
  {
    href: '/guides/warehouse/rotterdam-3pl/',
    kicker: 'Netherlands',
    title: 'Rotterdam 3PL.',
    description:
      'Europe’s largest port. Container congestion, customs windows, bonded options for high-value lanes.',
    detail: 'Lane fit: CN, VN, IN to all EU destinations',
  },
  {
    href: '/guides/warehouse/hamburg-3pl/',
    kicker: 'Germany',
    title: 'Hamburg 3PL.',
    description:
      'Second-busiest European port; rail connectivity into Czechia, Poland and Austria from the quay.',
    detail: 'Lane fit: CN, VN to DE, PL, CZ',
  },
  {
    href: '/guides/warehouse/frankfurt-3pl/',
    kicker: 'Germany',
    title: 'Frankfurt 3PL.',
    description:
      'Air cargo hub. Best for high-value, low-volume electronics where lead time beats freight cost.',
    detail: 'Lane fit: HK, KR by air',
  },
  {
    href: '/guides/warehouse/barcelona-3pl/',
    kicker: 'Spain',
    title: 'Barcelona 3PL.',
    description:
      'Mediterranean gateway. Sea-air combinations from Asia via the Suez transit; growing distribution into IT and FR.',
    detail: 'Lane fit: CN, IN to ES, PT, IT',
  },
  {
    href: '/guides/warehouse/poznan-3pl/',
    kicker: 'Poland',
    title: 'Poznań 3PL.',
    description:
      'Central-European distribution hub. Strongest for apparel, footwear and consumer goods bound for DE and the Visegrád four.',
    detail: 'Lane fit: CN, BD, VN to PL, DE, CZ, SK',
  },
  {
    href: '/guides/warehouse/prague-3pl/',
    kicker: 'Czech Republic',
    title: 'Prague 3PL.',
    description:
      'Land-locked, rail- and road-served. Best for cross-docking and last-mile distribution into CZ, SK, AT and HU.',
    detail: 'Lane fit: cross-dock from DE, PL gateways',
  },
];

export default function WarehouseHubPage() {
  return (
    <>
      <EditorialHeader
        kicker="Warehouse & 3PL"
        title="The European hubs, sorted by what each does best."
        lead="Bonded and non-bonded options in the most-used European warehouse cities. We list the lane fit so you can shortlist before the operator brief."
        meta="6 cities · updated when an operator changes hands"
      />

      <section className="bg-[var(--color-ink)] py-20 md:py-28">
        <div className="mx-auto max-w-[1280px] px-6">
          <FadeUp>
            <div className="grid grid-cols-1 gap-px border border-[var(--color-navy-line)] bg-[var(--color-navy-line)] md:grid-cols-2 lg:grid-cols-3 [&>*]:transition-opacity [&>*]:duration-700 [&:has(>*:hover)>*:not(:hover)]:opacity-45">
              {CITIES.map((c) => (
                <HubCard key={c.href} {...c} />
              ))}
            </div>
          </FadeUp>
        </div>
      </section>
    </>
  );
}
