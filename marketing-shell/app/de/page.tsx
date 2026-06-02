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
import { DE_COPY } from '@/lib/i18n/homepage-copy';

export const metadata: Metadata = {
  title: 'OrcaTrade Group — Importoperationen auf Autopilot',
  description:
    'KI-native Compliance- und Importoperationsplattform für europäische Unternehmen, die aus Asien beziehen. Suche, Beschaffung, Compliance, Logistik und Finanzierung — eine kalkulator-fundierte Plattform.',
  alternates: {
    canonical: 'https://orcatrade.pl/de/',
    languages: {
      en: 'https://orcatrade.pl/',
      pl: 'https://orcatrade.pl/pl/',
      de: 'https://orcatrade.pl/de/',
      'x-default': 'https://orcatrade.pl/',
    },
  },
};

export default function HomePageDE() {
  return (
    <>
      <Hero copy={DE_COPY.hero} />
      <Manifesto copy={DE_COPY.manifesto} />

      <ChapterRule numeral="I" label={DE_COPY.chapters.composition} />
      <StoryBeam copy={DE_COPY.storyBeam} />

      <ChapterRule numeral="II" label={DE_COPY.chapters.examples} />
      <WorkedExamples copy={DE_COPY.examplesSection} />

      <ChapterRule numeral="III" label={DE_COPY.chapters.stages} />
      <PillarsBento copy={DE_COPY.pillarsSection} />

      <ChapterRule numeral="IV" label={DE_COPY.chapters.leadership} />
      <Leadership copy={DE_COPY.leadershipSection} />

      <ChapterRule numeral="V" label={DE_COPY.chapters.news} />
      <TradeNews copy={DE_COPY.newsSection} locale="de" />

      <FinalCta copy={DE_COPY.finalCta} />
    </>
  );
}
