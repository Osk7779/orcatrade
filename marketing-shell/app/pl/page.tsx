import type { Metadata } from 'next';
import { Hero } from '@/components/marketing/hero';
import { Manifesto } from '@/components/marketing/manifesto';
import { StoryBeam } from '@/components/marketing/story-beam';
import { WorkedExamples } from '@/components/marketing/worked-examples';
import { PillarsBento } from '@/components/marketing/pillars-bento';
import { Leadership } from '@/components/marketing/leadership';
import { TradeNews } from '@/components/marketing/trade-news';
import { FinalCta } from '@/components/marketing/final-cta';
import { ChapterRule } from '@/components/marketing/chapter-rule';
import { PL_COPY } from '@/lib/i18n/homepage-copy';

export const metadata: Metadata = {
  title: 'OrcaTrade Group — Operacje importowe na autopilocie',
  description:
    'AI-natywna platforma compliance i operacji importowych dla europejskich firm sprowadzających z Azji. Wyszukiwanie, sourcing, compliance, logistyka i finansowanie — jedna platforma oparta na kalkulatorach.',
  alternates: {
    canonical: 'https://orcatrade.pl/pl/',
    languages: {
      en: 'https://orcatrade.pl/',
      pl: 'https://orcatrade.pl/pl/',
      de: 'https://orcatrade.pl/de/',
      'x-default': 'https://orcatrade.pl/',
    },
  },
};

export default function HomePagePL() {
  return (
    <>
      <Hero copy={PL_COPY.hero} />
      <Manifesto copy={PL_COPY.manifesto} />

      <ChapterRule numeral="I" label={PL_COPY.chapters.composition} />
      <StoryBeam copy={PL_COPY.storyBeam} />

      <ChapterRule numeral="II" label={PL_COPY.chapters.examples} />
      <WorkedExamples copy={PL_COPY.examplesSection} />

      <ChapterRule numeral="III" label={PL_COPY.chapters.stages} />
      <PillarsBento copy={PL_COPY.pillarsSection} />

      <ChapterRule numeral="IV" label={PL_COPY.chapters.leadership} />
      <Leadership copy={PL_COPY.leadershipSection} />

      <ChapterRule numeral="V" label={PL_COPY.chapters.news} />
      <TradeNews copy={PL_COPY.newsSection} locale="pl" />

      <FinalCta copy={PL_COPY.finalCta} />
    </>
  );
}
