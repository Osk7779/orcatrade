import { Hero } from '@/components/marketing/hero';
import { Manifesto } from '@/components/marketing/manifesto';
import { StoryBeam } from '@/components/marketing/story-beam';
import { WorkedExamples } from '@/components/marketing/worked-examples';
import { PillarsBento } from '@/components/marketing/pillars-bento';
import { Leadership } from '@/components/marketing/leadership';
import { OnRecord } from '@/components/marketing/on-record';
import { TradeNews } from '@/components/marketing/trade-news';
import { FinalCta } from '@/components/marketing/final-cta';
import { ChapterRule } from '@/components/marketing/chapter-rule';

export default function HomePage() {
  return (
    <>
      <Hero />
      <Manifesto />
      <ChapterRule numeral="I" label="The composition" />
      <StoryBeam />
      <ChapterRule numeral="II" label="Worked examples" />
      <WorkedExamples />
      <ChapterRule numeral="III" label="Five stages" />
      <PillarsBento />
      <ChapterRule numeral="IV" label="Leadership" />
      <Leadership />
      <ChapterRule numeral="V" label="On record" />
      <OnRecord />
      <ChapterRule numeral="VI" label="From the desk" />
      <TradeNews />
      <FinalCta />
    </>
  );
}
