import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { EditorialHeader } from '@/components/marketing/editorial-header';
import { GuideArticle, type GuideSection } from '@/components/marketing/guide-article';
import { ORIGINS, DESTINATIONS } from '@/lib/matrix-data';

interface Params {
  params: Promise<{ slug: string }>;
}

const ROUTING_ORIGINS = ORIGINS.filter((o) => ['cn', 'hk', 'vn', 'in', 'tr'].includes(o.code));

function parseSlug(slug: string) {
  const match = slug.match(/^([a-z]{2})-to-([a-z]{2})$/);
  if (!match) return null;
  const origin = ROUTING_ORIGINS.find((o) => o.code === match[1]);
  const destination = DESTINATIONS.find((d) => d.code === match[2]);
  if (!origin || !destination) return null;
  return { origin, destination };
}

export function generateStaticParams() {
  return ROUTING_ORIGINS.flatMap((o) =>
    DESTINATIONS.map((d) => ({ slug: `${o.code}-to-${d.code}` })),
  );
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const parsed = parseSlug(slug);
  if (!parsed) return { title: 'Not found — OrcaTrade Group' };
  return {
    title: `${parsed.origin.short} → ${parsed.destination.short} — Routing — OrcaTrade Group`,
    description: `Lane shape from ${parsed.origin.name} to ${parsed.destination.name}. Transit, frequencies, port fit.`,
  };
}

export default async function RoutingGuidePage({ params }: Params) {
  const { slug } = await params;
  const parsed = parseSlug(slug);
  if (!parsed) notFound();

  const { origin, destination } = parsed;

  // Crude but useful: sea-transit estimates from common Asia hubs to common
  // European ports. The wizard surfaces live rates; this page describes the
  // shape of the lane, not the live cost.
  const seaTransit: Record<string, Record<string, string>> = {
    cn: { de: '32–36 days', nl: '30–34 days', pl: '34–38 days', fr: '30–34 days', it: '28–32 days', es: '28–32 days' },
    hk: { de: '32–36 days', nl: '30–34 days', pl: '34–38 days', fr: '30–34 days', it: '28–32 days', es: '28–32 days' },
    vn: { de: '28–32 days', nl: '26–30 days', pl: '30–34 days', fr: '26–30 days', it: '24–28 days', es: '24–28 days' },
    in: { de: '22–26 days', nl: '20–24 days', pl: '24–28 days', fr: '20–24 days', it: '18–22 days', es: '18–22 days' },
    tr: { de: '7–10 days (sea); 4–6 days (road)', nl: '7–10 days (sea)', pl: '5–8 days (road)', fr: '7–10 days (sea)', it: '4–6 days (sea)', es: '6–8 days (sea)' },
  };

  const transit = seaTransit[origin.code]?.[destination.code] ?? 'Lane-dependent';

  const body: GuideSection[] = [
    {
      title: `The lane shape — ${origin.name} to ${destination.name}.`,
      body: (
        <>
          <p>
            Headline transit: <em>{transit}</em>, port-to-port plus customs clearance.
            Primary destination port: <em>{destination.port}</em>.{' '}
            {destination.notes}
          </p>
          {origin.frameworks.length > 0 && (
            <p>
              {origin.name} has preferential access under{' '}
              {origin.frameworks.map((f, i) => (
                <span key={f.href}>
                  <a
                    href={f.href}
                    className="text-[var(--color-ivory)] underline-offset-4 hover:underline"
                  >
                    {f.name}
                  </a>
                  {i < origin.frameworks.length - 1 && ', '}
                </span>
              ))}
              . Build the origin-proof step into the lane plan.
            </p>
          )}
        </>
      ),
    },
    {
      title: 'Mode trade-offs.',
      body: <p>The decision on this lane is rarely sea-or-air; it is what to send by which.</p>,
      bullets: [
        origin.code === 'tr'
          ? 'TR–EU is the rare lane where road is competitive: shorter transit, no maritime customs windows.'
          : 'Sea — cheapest per kilo, slowest. Default for low-margin, high-volume.',
        'Air — fastest, most expensive. Reserve for high-margin items where lead time pays for the freight.',
        'Sea-air via Dubai or Singapore — middle ground for time-sensitive electronics out of HK/VN.',
        'LCL versus FCL — break-even is typically around 14–15 CBM depending on the carrier and the lane.',
      ],
    },
    {
      title: 'Customs and compliance at the destination.',
      body: (
        <p>
          Procedure language: <em>{destination.language}</em>. Customs authority:{' '}
          <em>{destination.customsHouse}</em>. The compliance overlay for the
          specific commodity is on the {' '}
          <a href="/guides/compliance" className="text-[var(--color-ivory)] underline-offset-4 hover:underline">
            compliance hub
          </a>
          ; the customs guides at{' '}
          <a href="/guides/customs" className="text-[var(--color-ivory)] underline-offset-4 hover:underline">
            /guides/customs
          </a>{' '}
          walk the clearance pack by commodity.
        </p>
      ),
    },
  ];

  return (
    <>
      <EditorialHeader
        kicker={`Routing · ${origin.short} → ${destination.short}`}
        title={`${origin.name} to ${destination.name}.`}
        lead={`Lane shape, transit windows, port fit, and the decision points for the ${origin.name}→${destination.name} routing.`}
        meta={`${destination.port}`}
      />

      <GuideArticle
        body={body}
        related={[
          { href: '/guides/routing', title: 'All routing guides', kicker: 'Hub' },
          { href: '/guides/warehouse', title: 'Warehouse and 3PL', kicker: 'Related' },
          { href: '/start', title: 'Build my import plan', kicker: 'Apply' },
        ]}
      />
    </>
  );
}
