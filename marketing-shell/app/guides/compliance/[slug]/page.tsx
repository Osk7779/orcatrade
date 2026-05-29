import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { EditorialHeader } from '@/components/marketing/editorial-header';
import { GuideArticle } from '@/components/marketing/guide-article';
import { COMPLIANCE_GUIDES } from '@/lib/compliance-guides';

interface Params {
  params: Promise<{ slug: string }>;
}

export function generateStaticParams() {
  return COMPLIANCE_GUIDES.map((g) => ({ slug: g.slug }));
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const guide = COMPLIANCE_GUIDES.find((g) => g.slug === slug);
  if (!guide) return { title: 'Not found — OrcaTrade Group' };
  return {
    title: `${guide.short} — OrcaTrade Group`,
    description: guide.lead,
  };
}

export default async function ComplianceGuidePage({ params }: Params) {
  const { slug } = await params;
  const guide = COMPLIANCE_GUIDES.find((g) => g.slug === slug);
  if (!guide) notFound();

  return (
    <>
      <EditorialHeader
        kicker={`Compliance · ${guide.short}`}
        title={guide.title}
        lead={guide.lead}
        meta={guide.meta}
      />

      <GuideArticle body={guide.body} related={guide.related} />
    </>
  );
}
