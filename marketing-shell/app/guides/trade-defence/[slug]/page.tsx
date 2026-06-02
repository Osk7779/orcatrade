import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { EditorialHeader } from '@/components/marketing/editorial-header';
import { GuideArticle } from '@/components/marketing/guide-article';
import { TRADE_DEFENCE_GUIDES } from '@/lib/trade-defence';

interface Params {
  params: Promise<{ slug: string }>;
}

export function generateStaticParams() {
  return TRADE_DEFENCE_GUIDES.map((g) => ({ slug: g.slug }));
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const guide = TRADE_DEFENCE_GUIDES.find((g) => g.slug === slug);
  if (!guide) return { title: 'Not found — OrcaTrade Group' };
  return {
    title: `${guide.short} — Trade defence — OrcaTrade Group`,
    description: guide.lead,
  };
}

export default async function TradeDefenceGuidePage({ params }: Params) {
  const { slug } = await params;
  const guide = TRADE_DEFENCE_GUIDES.find((g) => g.slug === slug);
  if (!guide) notFound();

  return (
    <>
      <EditorialHeader
        kicker={`Trade defence · ${guide.short}`}
        title={guide.title}
        lead={guide.lead}
        meta={guide.meta}
      />

      <GuideArticle body={guide.body} related={guide.related} />
    </>
  );
}
