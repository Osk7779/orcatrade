import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { EditorialHeader } from '@/components/marketing/editorial-header';
import { GuideArticle, type GuideSection } from '@/components/marketing/guide-article';
import { WAREHOUSE_CITIES } from '@/lib/matrix-data';

interface Params {
  params: Promise<{ slug: string }>;
}

export function generateStaticParams() {
  return WAREHOUSE_CITIES.map((c) => ({ slug: c.slug }));
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const city = WAREHOUSE_CITIES.find((c) => c.slug === slug);
  if (!city) return { title: 'Not found — OrcaTrade Group' };
  return {
    title: `${city.short} 3PL — Warehouse — OrcaTrade Group`,
    description: `${city.short} 3PL: ${city.laneFit}. Operator types, lane fit, what to ask before signing.`,
  };
}

export default async function WarehouseGuidePage({ params }: Params) {
  const { slug } = await params;
  const city = WAREHOUSE_CITIES.find((c) => c.slug === slug);
  if (!city) notFound();

  const body: GuideSection[] = [
    {
      title: `What ${city.short} does best.`,
      body: <p>{city.notes}</p>,
    },
    {
      title: 'Lane fit.',
      body: (
        <p>
          The lanes that route most naturally through {city.short}:{' '}
          <em>{city.laneFit}</em>. Other lanes can land here, but the rhythm is
          tuned to these.
        </p>
      ),
    },
    {
      title: 'Operator types available.',
      body: (
        <p>
          {city.short} has a spread of operator types. Match the type to the
          lane shape, not the brochure.
        </p>
      ),
      bullets: city.operatorTypes,
    },
    {
      title: 'What to ask before signing.',
      body: <p>The non-negotiables before money moves:</p>,
      bullets: [
        city.bonded
          ? 'Bonded status confirmed (the customs authorisation number, not just the brochure).'
          : 'Non-bonded — confirm the duty payment workflow with your declarant.',
        'IT integration shape — EDI/API, file drop, or manual portal entry.',
        'Pick-pack tolerances, error rates and the corrective-action SLA.',
        'Audit access — how often you can inspect, and what the operator commits to in writing.',
        'Insurance coverage, including in-transit between facility and last-mile carrier.',
      ],
    },
  ];

  return (
    <>
      <EditorialHeader
        kicker={`Warehouse · ${city.country}`}
        title={`${city.short} 3PL.`}
        lead={`Lane fit, operator types and the brief for ${city.short}. Bonded options ${city.bonded ? 'available' : 'not the local strength'}; the city is most-used for ${city.laneFit.toLowerCase()}.`}
        meta={`${city.name}, ${city.country}`}
      />

      <GuideArticle
        body={body}
        related={[
          { href: '/guides/warehouse', title: 'All warehouse cities', kicker: 'Hub' },
          { href: '/guides/routing', title: 'Routing guides', kicker: 'Related' },
          { href: '/start', title: 'Build my import plan', kicker: 'Apply' },
        ]}
      />
    </>
  );
}
