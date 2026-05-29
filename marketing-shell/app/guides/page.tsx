import type { Metadata } from 'next';
import { EditorialHeader } from '@/components/marketing/editorial-header';
import { HubCard } from '@/components/marketing/hub-card';
import { FadeUp } from '@/components/marketing/fade-up';

export const metadata: Metadata = {
  title: 'Guides — OrcaTrade Group',
  description:
    'Calculator-grounded reference for Asia–Europe trade. Sourcing, routing, customs, warehousing, compliance, preferential origin, trade defence.',
};

const HUBS = [
  {
    href: '/guides/sourcing',
    kicker: 'Stage 02 — Source it',
    title: 'Sourcing.',
    description:
      'Eight Asia origins, six commodity categories. What to ask suppliers, what to verify before the deposit, what to avoid.',
    detail: 'Apparel · cosmetics · electronics · footwear · furniture · homeware · machinery · toys',
  },
  {
    href: '/guides/customs',
    kicker: 'Stage 03 — Clear it',
    title: 'Customs.',
    description:
      'EU and UK customs procedures by commodity and destination. Duty, VAT, anti-dumping, CVD, CBAM — what hits at the port.',
    detail: 'Six commodity classes · six destinations · live TARIC',
  },
  {
    href: '/guides/compliance',
    kicker: 'Stage 03 — Verify it',
    title: 'Compliance regimes.',
    description:
      'Every EU regulatory regime that touches consumer and industrial imports. CBAM, EUDR, REACH, CE, GPSR and twelve more.',
    detail: '13 regimes · cited, summarised, kept current',
  },
  {
    href: '/guides/preferential-origin',
    kicker: 'Across the lanes',
    title: 'Preferential origin.',
    description:
      'EBA, EU–Korea FTA, EVFTA, GSP, GSP+, A.TR Customs Union, EU–Japan EPA. Where the duty drops and where it does not.',
    detail: '7 frameworks · 7 origins',
  },
  {
    href: '/guides/trade-defence',
    kicker: 'When duty stacks',
    title: 'Trade defence.',
    description:
      'Anti-dumping and countervailing duties currently in force on Chinese commodities. The rates, the chapters, the carve-outs.',
    detail: 'Active CN measures · updated when OJEU publishes',
  },
  {
    href: '/guides/routing',
    kicker: 'Stage 04 — Ship it',
    title: 'Routing.',
    description:
      'Sea and air lanes from Asia origins to European destinations. Transit times, frequencies, and which port favours which cargo.',
    detail: '5 origins × 6 destinations',
  },
  {
    href: '/guides/warehouse',
    kicker: 'Stage 04 — Hold it',
    title: 'Warehouse and 3PL.',
    description:
      'Bonded and non-bonded options in the most-used European hubs. What each city does best and what to ask the operator.',
    detail: 'Barcelona · Frankfurt · Hamburg · Poznań · Prague · Rotterdam',
  },
];

export default function GuidesHubPage() {
  return (
    <>
      <EditorialHeader
        kicker="The reference library"
        title="Calculator-grounded guides for Asia–Europe trade."
        lead="Seven category hubs. Hundreds of pages, written against the same regulatory corpus the calculators consult — citation-checked, kept current, free to read without an account."
        meta="No paywall · no email gate · no behavioural tracking"
      />

      <section className="bg-[var(--color-ink)] py-20 md:py-28">
        <div className="mx-auto max-w-[1280px] px-6">
          <FadeUp>
            <div className="grid grid-cols-1 gap-px border border-[var(--color-navy-line)] bg-[var(--color-navy-line)] md:grid-cols-2 lg:grid-cols-3 [&>*]:transition-opacity [&>*]:duration-700 [&:has(>*:hover)>*:not(:hover)]:opacity-45">
              {HUBS.map((h) => (
                <HubCard key={h.href} {...h} />
              ))}
            </div>
          </FadeUp>
        </div>
      </section>
    </>
  );
}
