import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { EditorialHeader } from '@/components/marketing/editorial-header';
import { GuideArticle, type GuideSection } from '@/components/marketing/guide-article';
import { COMMODITIES, DESTINATIONS } from '@/lib/matrix-data';

interface Params {
  params: Promise<{ slug: string }>;
}

// Slug shape: '<commodity>-into-<destination>' e.g. 'electronics-into-de'.
function parseSlug(slug: string) {
  const match = slug.match(/^(.+)-into-([a-z]{2})$/);
  if (!match) return null;
  const commodity = COMMODITIES.find((c) => c.slug === match[1]);
  const destination = DESTINATIONS.find((d) => d.code === match[2]);
  if (!commodity || !destination) return null;
  return { commodity, destination };
}

export function generateStaticParams() {
  return COMMODITIES.flatMap((c) =>
    DESTINATIONS.map((d) => ({ slug: `${c.slug}-into-${d.code}` })),
  );
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const parsed = parseSlug(slug);
  if (!parsed) return { title: 'Not found — OrcaTrade Group' };
  const { commodity, destination } = parsed;
  return {
    title: `${commodity.short} into ${destination.name} — Customs — OrcaTrade Group`,
    description: `EU customs procedures for ${commodity.short.toLowerCase()} entering ${destination.name}. Duty, VAT, compliance overlay and the port-of-entry tips.`,
  };
}

export default async function CustomsGuidePage({ params }: Params) {
  const { slug } = await params;
  const parsed = parseSlug(slug);
  if (!parsed) notFound();

  const { commodity, destination } = parsed;

  const body: GuideSection[] = [
    {
      title: `Duty headline — ${commodity.short}.`,
      body: (
        <>
          <p>
            {commodity.short} sits in <em>{commodity.chapter}</em>. The MFN headline is{' '}
            <em>{commodity.mfn}</em>. The calculator looks up the live TARIC rate for the
            specific HS line at the time the plan is composed; this page describes the
            chapter-level shape, not the line-level rate.
          </p>
          <p>{commodity.notes}</p>
        </>
      ),
    },
    {
      title: 'Compliance overlay — what still applies.',
      body: (
        <p>
          Preferential duty drops the headline but does not waive the regulatory
          regimes that touch this commodity. Each of the regimes below applies on
          its own merits and must be satisfied before the goods can be placed on the
          {' '}{destination.name} market.
        </p>
      ),
      bullets: commodity.regimes.map((r) => (
        <span key={r.href}>
          <a
            href={r.href}
            className="text-[var(--color-ivory)] underline-offset-4 hover:underline"
          >
            {r.name}
          </a>
        </span>
      )),
    },
    {
      title: `Entering ${destination.name}.`,
      body: (
        <>
          <p>
            Primary port of entry for sea cargo: <em>{destination.port}</em>. Customs
            authority: <em>{destination.customsHouse}</em>. Procedure language:{' '}
            <em>{destination.language}</em>.
          </p>
          <p>{destination.notes}</p>
        </>
      ),
    },
    {
      title: 'What to bring to clearance.',
      body: <p>The standard pack for a clean entry on this lane:</p>,
      bullets: [
        'Commercial invoice with the EORI of the EU importer of record.',
        'Packing list aligned to the invoice line-by-line.',
        'Bill of lading or AWB; matching consignee.',
        'Origin proof (statement on origin or movement certificate) if claiming preference.',
        'Compliance file references — CE conformity, WEEE registration number, REACH SVHC declaration where relevant.',
        commodity.slug === 'electronics'
          ? 'For chapter 85: the technical file reference, RoHS self-declaration, and the WEEE producer registration number for the destination state.'
          : 'Any commodity-specific labelling requirement applicable to the destination state.',
      ],
    },
  ];

  return (
    <>
      <EditorialHeader
        kicker={`Customs · ${commodity.short.toLowerCase()} → ${destination.short}`}
        title={`${commodity.short} into ${destination.name}.`}
        lead={`EU customs procedure for ${commodity.short.toLowerCase()} entering ${destination.name} — duty, compliance overlay, port-of-entry rhythm and the clearance pack.`}
        meta={`${commodity.chapter} · ${destination.port}`}
      />

      <GuideArticle
        body={body}
        related={[
          { href: '/guides/customs', title: 'All customs guides', kicker: 'Hub' },
          { href: `/guides/compliance`, title: 'Compliance regimes', kicker: 'Related' },
          { href: '/start', title: 'Build my import plan', kicker: 'Apply' },
        ]}
      />
    </>
  );
}
