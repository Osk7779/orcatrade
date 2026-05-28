import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { EditorialHeader } from '@/components/marketing/editorial-header';
import { GuideArticle, type GuideSection } from '@/components/marketing/guide-article';
import { SOURCING_COMMODITIES, ORIGINS } from '@/lib/matrix-data';

interface Params {
  params: Promise<{ slug: string }>;
}

const SOURCING_ORIGINS = ORIGINS.filter((o) => ['cn', 'vn', 'in', 'bd', 'tr'].includes(o.code));

function parseSlug(slug: string) {
  const match = slug.match(/^(.+)-from-([a-z]{2})$/);
  if (!match) return null;
  const commodity = SOURCING_COMMODITIES.find((c) => c.slug === match[1]);
  const origin = SOURCING_ORIGINS.find((o) => o.code === match[2]);
  if (!commodity || !origin) return null;
  return { commodity, origin };
}

export function generateStaticParams() {
  return SOURCING_COMMODITIES.flatMap((c) =>
    SOURCING_ORIGINS.map((o) => ({ slug: `${c.slug}-from-${o.code}` })),
  );
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const parsed = parseSlug(slug);
  if (!parsed) return { title: 'Not found — OrcaTrade Group' };
  return {
    title: `${parsed.commodity.short} from ${parsed.origin.name} — Sourcing — OrcaTrade Group`,
    description: `Sourcing ${parsed.commodity.short.toLowerCase()} from ${parsed.origin.name}. Supplier brief, regime overlay, common HS codes.`,
  };
}

export default async function SourcingGuidePage({ params }: Params) {
  const { slug } = await params;
  const parsed = parseSlug(slug);
  if (!parsed) notFound();

  const { commodity, origin } = parsed;

  const body: GuideSection[] = [
    {
      title: `The lane — ${commodity.short.toLowerCase()} from ${origin.name}.`,
      body: (
        <>
          <p>
            {commodity.short} sits in <em>{commodity.chapter}</em>. The MFN headline is{' '}
            <em>{commodity.mfn}</em>. {commodity.notes}
          </p>
          {origin.frameworks.length > 0 ? (
            <p>
              {origin.name} has preferential access:{' '}
              {origin.frameworks.map((f, i) => (
                <span key={f.href}>
                  <a
                    href={f.href}
                    className="text-[var(--color-ivory)] underline-offset-4 hover:underline"
                  >
                    {f.name}
                  </a>
                  {' '}<em>({f.note})</em>
                  {i < origin.frameworks.length - 1 && '; '}
                </span>
              ))}
              . The duty headline drops accordingly.
            </p>
          ) : (
            <p>{origin.notes}</p>
          )}
        </>
      ),
    },
    {
      title: 'Compliance regimes on this lane.',
      body: (
        <p>
          Preferential origin does not waive compliance. Each regime below applies on
          its own merits and must be satisfied at the EU border, regardless of duty
          outcome.
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
      title: 'Supplier brief — what to verify before the deposit.',
      body: (
        <p>The non-negotiables before money moves on a {origin.name} supplier:</p>
      ),
      bullets: [
        'Business licence and tax registration verified against the public registry.',
        'Factory address visited in person or by a third-party inspector.',
        'Quality system documented (ISO 9001 at minimum; sector-specific certifications where relevant).',
        'Sample-to-bulk approval against agreed tolerances, in writing.',
        'Sanctions screening of the legal entity and the beneficial owners (see /trust for our screening posture).',
        origin.code === 'cn'
          ? 'Anti-dumping and CVD exposure on the specific HS line — sampled vs residual rates.'
          : 'Origin-proof readiness — REX registration where preference applies; movement-document procedure where Customs Union applies.',
      ],
    },
  ];

  return (
    <>
      <EditorialHeader
        kicker={`Sourcing · ${commodity.short.toLowerCase()} ← ${origin.short}`}
        title={`${commodity.short} from ${origin.name}.`}
        lead={`What to ask suppliers, what to verify before the deposit, what to plan for at the EU border on the ${commodity.short.toLowerCase()} lane out of ${origin.name}.`}
        meta={`${commodity.chapter}`}
      />

      <GuideArticle
        body={body}
        related={[
          { href: '/guides/sourcing', title: 'All sourcing guides', kicker: 'Hub' },
          { href: '/guides/compliance', title: 'Compliance regimes', kicker: 'Related' },
          { href: '/start', title: 'Build my import plan', kicker: 'Apply' },
        ]}
      />
    </>
  );
}
