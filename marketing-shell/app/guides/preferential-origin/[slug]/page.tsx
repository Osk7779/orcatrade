import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { EditorialHeader } from '@/components/marketing/editorial-header';
import { GuideArticle } from '@/components/marketing/guide-article';
import { PREF_ORIGIN_GUIDES } from '@/lib/preferential-origin';

interface Params {
  params: Promise<{ slug: string }>;
}

export function generateStaticParams() {
  return PREF_ORIGIN_GUIDES.map((g) => ({ slug: g.slug }));
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const guide = PREF_ORIGIN_GUIDES.find((g) => g.slug === slug);
  if (!guide) return { title: 'Not found — OrcaTrade Group' };
  return {
    title: `${guide.short} — Preferential origin — OrcaTrade Group`,
    description: guide.lead,
  };
}

export default async function PreferentialOriginGuidePage({ params }: Params) {
  const { slug } = await params;
  const guide = PREF_ORIGIN_GUIDES.find((g) => g.slug === slug);
  if (!guide) notFound();

  return (
    <>
      <EditorialHeader
        kicker={
          guide.kind === 'framework'
            ? `Preferential origin · ${guide.short}`
            : 'Preferential origin · origin lookup'
        }
        title={guide.title}
        lead={guide.lead}
        meta={guide.meta}
      />

      <GuideArticle body={guide.body} related={guide.related} />
    </>
  );
}
