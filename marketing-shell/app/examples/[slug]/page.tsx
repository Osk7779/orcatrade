import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { EditorialHeader } from '@/components/marketing/editorial-header';
import { GuideArticle } from '@/components/marketing/guide-article';
import { FadeUp } from '@/components/marketing/fade-up';
import { WORKED_EXAMPLES } from '@/lib/examples';

interface Params {
  params: Promise<{ slug: string }>;
}

export function generateStaticParams() {
  return WORKED_EXAMPLES.map((e) => ({ slug: e.slug }));
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const example = WORKED_EXAMPLES.find((e) => e.slug === slug);
  if (!example) return { title: 'Not found — OrcaTrade Group' };
  return {
    title: `${example.short} — Worked example — OrcaTrade Group`,
    description: example.lead,
  };
}

export default async function WorkedExamplePage({ params }: Params) {
  const { slug } = await params;
  const example = WORKED_EXAMPLES.find((e) => e.slug === slug);
  if (!example) notFound();

  return (
    <>
      <EditorialHeader
        kicker={`Worked example · ${example.short}`}
        title={example.title}
        lead={example.lead}
        meta={example.meta}
      />

      {/* Headline-metric plate — the example's signature number set off
          before the body, like a magazine pull-statistic. */}
      {example.headline && (
        <section className="border-b border-[var(--color-navy-line)] bg-[var(--color-ink)] py-12 md:py-16">
          <div className="mx-auto max-w-[820px] px-6">
            <FadeUp className="flex flex-col items-start gap-2 border-y border-[var(--color-navy-line)] py-10 md:flex-row md:items-baseline md:gap-10 md:py-12">
              <div
                className="font-serif text-[clamp(3.6rem,7vw,5.6rem)] leading-[0.95] tracking-[-0.028em] text-[var(--color-ivory)]"
                style={{
                  fontVariationSettings: "'SOFT' 30, 'opsz' 144",
                  fontWeight: 550,
                }}
              >
                {example.headline.value}
              </div>
              <div
                className="max-w-[44ch] font-serif text-[1.25rem] italic leading-[1.4] text-[var(--color-ivory-dim)]"
                style={{ fontVariationSettings: "'SOFT' 35, 'opsz' 144" }}
              >
                {example.headline.caption}
              </div>
            </FadeUp>
          </div>
        </section>
      )}

      <GuideArticle body={example.body} related={example.related} />
    </>
  );
}
