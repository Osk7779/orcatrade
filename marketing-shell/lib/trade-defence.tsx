// Content store for the active EU trade-defence measures. Each entry
// describes the chapter the measure sits in, the rate where known, and
// the OJEU publication reference. Updated when the OJEU publishes a new
// measure or an expiry review concludes.

import type { ReactNode } from 'react';

export interface TradeDefenceGuide {
  slug: string;
  short: string;
  title: string;
  lead: string;
  meta?: string;
  body: { title: string; body: ReactNode; bullets?: ReactNode[] }[];
  related: { href: string; title: string; kicker?: string }[];
}

const HUB_LINK = {
  href: '/guides/trade-defence',
  title: 'All active measures',
  kicker: 'Hub',
};
const APPLY_LINK = {
  href: '/start',
  title: 'Build my import plan',
  kicker: 'Apply',
};

export const TRADE_DEFENCE_GUIDES: TradeDefenceGuide[] = [
  {
    slug: 'cn-e-bikes-ad',
    short: 'E-bikes — AD',
    title: 'Anti-dumping on Chinese electric bicycles.',
    lead: 'AD rate of 70.1% on top of the 10% MFN duty applies to electric bicycles originating in China. Definitive measure since 2019; expiry review concluded in favour of continuation.',
    meta: 'HS 8711 60 · OJEU L 16/108 · expiry review concluded',
    body: [
      {
        title: 'Where the measure sits.',
        body: (
          <p>
            HS subheading 8711 60: cycles with auxiliary electric motor. The AD measure
            stacks on top of the 10% MFN duty for the chapter, so the combined headline
            on a Chinese e-bike consignment lands at 80.1% before CVD is considered.
          </p>
        ),
      },
      {
        title: 'The combination with CVD.',
        body: (
          <p>
            A parallel countervailing-duty investigation produced a definitive CVD rate
            of 17.2% applied to the same goods. AD + CVD stack on top of MFN, so a clean
            Chinese e-bike import carries 70.1% + 17.2% + 10% = 97.3% of duty per €100 of
            customs value. Importers planning against MFN-only numbers fail at the port.
          </p>
        ),
      },
      {
        title: 'Carve-outs and individual rates.',
        body: (
          <p>
            Sampled exporters received individual rates lower than 70.1%. The
            country-wide residual rate applies to all other producers. The current
            individual-rate list is the one in the most recent expiry review; we surface
            the rate per supplier on the plan when the producer is named.
          </p>
        ),
      },
    ],
    related: [
      { href: '/guides/trade-defence/cn-e-bikes-cvd', title: 'CVD on the same lane', kicker: 'Related measure' },
      { href: '/examples/chinese-ebike-importer-87pct-combined-ad-cvd/', title: '87% combined AD + CVD', kicker: 'Worked example' },
      HUB_LINK,
    ],
  },
  {
    slug: 'cn-e-bikes-cvd',
    short: 'E-bikes — CVD',
    title: 'Countervailing duty on Chinese electric bicycles.',
    lead: '17.2% CVD applies to electric bicycles originating in China, in parallel with the 70.1% AD measure.',
    meta: 'HS 8711 60 · stacked with AD + MFN',
    body: [
      {
        title: 'How CVD stacks.',
        body: (
          <p>
            CVD is layered on top of MFN and on top of AD. For a clean Chinese e-bike
            consignment the combined headline is 70.1% + 17.2% + 10% = 97.3%, or
            &euro;97,300 of duty per &euro;100,000 of customs value.
          </p>
        ),
      },
    ],
    related: [
      { href: '/guides/trade-defence/cn-e-bikes-ad', title: 'AD on the same lane', kicker: 'Related measure' },
      { href: '/examples/chinese-ebike-importer-87pct-combined-ad-cvd/', title: '87% combined AD + CVD', kicker: 'Worked example' },
      HUB_LINK,
    ],
  },
  {
    slug: 'cn-aluminum-extrusions',
    short: 'Aluminium extrusions',
    title: 'Anti-dumping on Chinese aluminium extrusions.',
    lead: '32% AD on top of the 6% MFN duty. The lane also triggers CBAM declarant status from January 2026, stacking emissions cost on top of duty.',
    meta: 'HS 7604 · CBAM-eligible · stacked CBAM + AD + MFN',
    body: [
      {
        title: 'The lane economics.',
        body: (
          <p>
            32% AD plus 6% MFN puts the duty headline at 38% of customs value. From
            January 2026 the CBAM declarant obligation adds the embedded-emissions cost
            on top of duty &mdash; the certificate price moves weekly with the ETS,
            so the cost of the same shipment changes between quote and clearance.
          </p>
        ),
      },
    ],
    related: [
      { href: '/guides/compliance/cbam', title: 'CBAM', kicker: 'Related regime' },
      { href: '/examples/cn-aluminium-cbam-plus-32pct-ad/', title: 'CBAM + 32% AD worked example', kicker: 'Worked example' },
      HUB_LINK,
    ],
  },

  // ───────── Other active CN measures, outlined ─────────
  ...stub('cn-aluminum-flat-rolled', 'Aluminium flat-rolled', 'Active AD measure on Chinese aluminium flat-rolled products.', 'HS 7606 · CBAM-eligible'),
  ...stub('cn-aluminum-converter-foil', 'Aluminium converter foil', 'Active AD measure on Chinese aluminium converter foil.', 'HS 7607 · CBAM-eligible'),
  ...stub('cn-cold-rolled-steel', 'Cold-rolled steel', 'Active AD measure on Chinese cold-rolled flat steel products.', 'HS 7209 · A.TR re-export still pays AD'),
  ...stub('cn-corrosion-resistant-steel', 'Corrosion-resistant steel', 'Active AD measure on Chinese corrosion-resistant flat steel products.', 'HS 7210'),
  ...stub('cn-bev-passenger-cars', 'BEV passenger cars', 'Definitive countervailing duty on Chinese battery-electric passenger cars.', 'HS 8703 80 · individual rates published'),
  ...stub('cn-bicycles', 'Bicycles', 'Active AD measure on Chinese conventional bicycles.', 'HS 8712'),
  ...stub('cn-bicycle-parts', 'Bicycle parts', 'Active AD on certain Chinese bicycle components (anti-circumvention).', 'HS 8714'),
  ...stub('cn-ceramic-tableware', 'Ceramic tableware', 'Active AD on Chinese ceramic dinnerware and kitchenware.', 'HS 6911 · 6912'),
  ...stub('cn-ceramic-tiles', 'Ceramic tiles', 'Active AD on Chinese porcelain and stoneware tiles.', 'HS 6907'),
  ...stub('cn-disposable-lighters', 'Disposable lighters', 'Active AD measure on Chinese gas-fuelled disposable lighters.', 'HS 9613'),
  ...stub('cn-citric-acid', 'Citric acid', 'Active AD measure on Chinese industrial-grade citric acid.', 'HS 2918 14'),
  ...stub('cn-fatty-acid', 'Fatty acid', 'Active AD measure on certain Chinese fatty acids.', 'HS 3823'),
];

function stub(slug: string, short: string, lead: string, meta: string): TradeDefenceGuide[] {
  return [
    {
      slug,
      short,
      title: `${lead}`,
      lead,
      meta: `${meta} · outline — full guide in preparation`,
      body: [
        {
          title: 'Scope.',
          body: (
            <p>
              {lead} The full deep-write of this measure is being prepared. The
              calculator continues to apply the duty on every plan that touches the
              affected HS lines; the live reference page on orcatrade.pl carries the
              detailed working.
            </p>
          ),
        },
        {
          title: 'Where to learn more.',
          body: (
            <p>
              The plan output stamps the OJEU publication reference and the
              individual-producer rate where the producer is named. Use the import-plan
              builder to model the lane with the live rate.
            </p>
          ),
        },
      ],
      related: [HUB_LINK, APPLY_LINK],
    },
  ];
}
