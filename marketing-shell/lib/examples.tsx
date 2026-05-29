// Content store for the eight worked examples. Each entry is a real
// lane scenario priced by the same composePlan() function that powers
// the wizard. The numbers in the lead and body are derived from real
// regulatory rates, not invented.

import type { ReactNode } from 'react';

export interface WorkedExample {
  slug: string;
  short: string;
  title: string;
  lead: string;
  meta?: string;
  headline?: { value: string; caption: string };
  body: { title: string; body: ReactNode; bullets?: ReactNode[] }[];
  related: { href: string; title: string; kicker?: string }[];
}

const HUB_LINK = { href: '/examples', title: 'All worked examples', kicker: 'Hub' };
const APPLY_LINK = { href: '/start', title: 'Build my import plan', kicker: 'Apply' };

export const WORKED_EXAMPLES: WorkedExample[] = [
  {
    slug: 'chinese-ebike-importer-87pct-combined-ad-cvd',
    short: 'CN e-bikes — 87% AD+CVD',
    title: '87% combined anti-dumping plus countervailing duty on Chinese e-bikes.',
    lead: '€97,300 of duty per €100,000 shipment. AD 70.1% plus CVD 17.2% layered on top of 10% MFN. Importers planning against MFN-only numbers go bankrupt at the port.',
    meta: 'Lane: e-bikes · CN → PL · HS 8711 60',
    headline: { value: '87%', caption: 'combined AD + CVD on Chinese e-bikes' },
    body: [
      {
        title: 'The lane.',
        body: (
          <p>
            A Polish bicycle importer sources electric bicycles from a Chinese
            manufacturer. The CIF Rotterdam value of the consignment is
            &euro;100,000. The MFN rate on HS 8711 60 is 10%. The procurement team
            has built the cost case on 10% &mdash; &euro;10,000 of duty.
          </p>
        ),
      },
      {
        title: 'What the calculator surfaces.',
        body: (
          <p>
            HS 8711 60 from China is subject to a definitive 70.1% anti-dumping
            measure and a 17.2% countervailing duty. Both stack on top of MFN. The
            duty headline lands at 97.3%, not 10%.
          </p>
        ),
        bullets: [
          'MFN: 10% × €100,000 = €10,000',
          'AD:  70.1% × €100,000 = €70,100',
          'CVD: 17.2% × €100,000 = €17,200',
          'Total duty before VAT: €97,300',
        ],
      },
      {
        title: 'How the importer recovers.',
        body: (
          <p>
            Two paths: change origin (Vietnamese frames + Chinese motors under EVFTA
            cumulation, if the chapter rule of origin is satisfied), or restructure
            the supply chain (sampled-producer individual rates may be lower than
            the residual). The calculator models both alternatives on the plan
            output before the booking goes out.
          </p>
        ),
      },
    ],
    related: [
      { href: '/guides/trade-defence/cn-e-bikes-ad', title: 'CN e-bikes AD', kicker: 'Trade defence' },
      { href: '/guides/trade-defence/cn-e-bikes-cvd', title: 'CN e-bikes CVD', kicker: 'Trade defence' },
      HUB_LINK,
    ],
  },
  {
    slug: 'bangladesh-apparel-eba-zero-duty',
    short: 'BD apparel — EBA zero',
    title: 'Zero EU duty on Bangladesh apparel under Everything But Arms.',
    lead: '€6,000 saving per €50,000 apparel shipment with a valid REX statement. Bangladesh graduates from LDC in 2026; EBA continues until 2029 under the transitional period.',
    meta: 'Lane: apparel · BD → PL · HS chapters 61 + 62',
    headline: { value: '0%', caption: 'duty under EBA' },
    body: [
      {
        title: 'The lane.',
        body: (
          <p>
            A Polish apparel brand sources knitted t-shirts from a Dhaka factory.
            The CIF value of the consignment is &euro;50,000. The MFN rate on the
            relevant HS chapter is 12%. EBA brings it to zero.
          </p>
        ),
      },
      {
        title: 'What the documentation looks like.',
        body: (
          <p>
            The Bangladeshi exporter registers in the EU REX system once. After
            registration, every consignment carries a statement on origin printed
            on the invoice referencing the REX number. The statement is valid for
            twenty-four months from issue.
          </p>
        ),
      },
      {
        title: 'The graduation timeline.',
        body: (
          <p>
            Bangladesh graduates from LDC status on 24 November 2026. EBA continues
            until 24 November 2029 under the transitional period. After that the
            lane moves to standard GSP and a residual duty may apply.
          </p>
        ),
      },
    ],
    related: [
      { href: '/guides/preferential-origin/eba', title: 'EBA framework', kicker: 'Preferential origin' },
      { href: '/guides/preferential-origin/from-bd', title: 'From Bangladesh', kicker: 'Origin lookup' },
      HUB_LINK,
    ],
  },
  {
    slug: 'turkey-cold-rolled-steel-atr-with-ad',
    short: 'TR cold-rolled steel',
    title: 'A.TR Customs Union does not waive 23.3% anti-dumping duty.',
    lead: 'The procurement misconception: "TR goods are duty-free under A.TR." True for MFN — but trade defence overrides preferential origin. €23,300 AD per €100,000 shipment despite the Customs Union.',
    meta: 'Lane: cold-rolled steel · TR → DE · HS 7209',
    headline: { value: '23.3%', caption: 'AD on the lane despite A.TR' },
    body: [
      {
        title: 'The lane.',
        body: (
          <p>
            A German steel distributor sources cold-rolled flat steel from a Turkish
            re-roller. The base material was imported into Türkiye from China, duty
            paid, and is now in free circulation. The A.TR movement document is
            attached. The procurement team expects zero duty on EU entry.
          </p>
        ),
      },
      {
        title: 'Why the AD still hits.',
        body: (
          <p>
            A.TR certifies free circulation, not Turkish origin. The Chinese
            anti-dumping measure on cold-rolled steel applies to the underlying
            origin, not the circulation status. The 23.3% AD is collected at German
            entry &mdash; &euro;23,300 per &euro;100,000 of customs value &mdash;
            even though MFN is waived.
          </p>
        ),
      },
      {
        title: 'How OrcaTrade catches it.',
        body: (
          <p>
            The plan output flags the underlying origin separately from the
            circulation status. When the underlying origin sits on the active
            trade-defence list, the calculator stacks the AD on top of the A.TR
            preference. The procurement team sees the real duty before the booking
            goes out, not at the port.
          </p>
        ),
      },
    ],
    related: [
      { href: '/guides/preferential-origin/atr', title: 'A.TR framework', kicker: 'Preferential origin' },
      { href: '/guides/trade-defence/cn-cold-rolled-steel', title: 'CN cold-rolled steel AD', kicker: 'Trade defence' },
      HUB_LINK,
    ],
  },
  {
    slug: 'vietnam-electronics-evfta-zero-duty',
    short: 'VN electronics — EVFTA + stack',
    title: 'EVFTA delivers zero duty but four compliance regimes still apply.',
    lead: 'EU–Vietnam FTA gives 0% duty with a REX origin declaration. Chapter 85 triggers CE LVD/EMC/RED + RoHS + WEEE producer registration — four parallel compliance regimes alongside the duty saving.',
    meta: 'Lane: electronics · VN → DE · HS chapter 85',
    headline: { value: '0%', caption: 'duty with four compliance regimes' },
    body: [
      {
        title: 'The lane.',
        body: (
          <p>
            A German consumer-electronics brand sources from a Vietnamese contract
            manufacturer. Under EVFTA the duty drops from 4.7% MFN to zero with a
            REX statement on the invoice. The procurement team books the lane on
            zero duty.
          </p>
        ),
      },
      {
        title: 'What the duty saving costs in compliance.',
        body: (
          <p>
            Chapter 85 triggers four parallel EU regimes. None of them is waived by
            the preferential trade agreement; the brand has to meet each one before
            placing product on the German market.
          </p>
        ),
        bullets: [
          'CE LVD — Low Voltage Directive conformity assessment.',
          'CE EMC — Electromagnetic Compatibility Directive.',
          'CE RED — Radio Equipment Directive (if applicable).',
          'RoHS — Restriction of Hazardous Substances, self-declaration in the technical file.',
          'WEEE — producer registration in every destination state.',
        ],
      },
      {
        title: 'The plan output.',
        body: (
          <p>
            The duty saving is real. The compliance burden is real. The calculator
            surfaces both so the brand makes the lane decision on the full picture,
            not just the headline rate.
          </p>
        ),
      },
    ],
    related: [
      { href: '/guides/preferential-origin/evfta', title: 'EVFTA framework', kicker: 'Preferential origin' },
      { href: '/guides/compliance/ce-lvd-emc-red', title: 'CE LVD/EMC/RED', kicker: 'Compliance' },
      { href: '/guides/compliance/rohs', title: 'RoHS', kicker: 'Compliance' },
    ],
  },
  {
    slug: 'cn-aluminium-cbam-plus-32pct-ad',
    short: 'CN aluminium — CBAM + AD',
    title: 'CBAM declarant status plus 32% anti-dumping on Chinese aluminium.',
    lead: 'Aluminium extrusions from China carry 32% AD on top of 6% MFN AND CBAM declarant status from January 2026. The brand must register, file emissions reports, and buy CBAM certificates.',
    meta: 'Lane: aluminium extrusions · CN → DE · HS 7604',
    headline: { value: '38%', caption: 'duty plus CBAM declarant status' },
    body: [
      {
        title: 'The lane.',
        body: (
          <p>
            A German extrusions importer sources aluminium profile from a Chinese
            mill. The CIF Hamburg value is &euro;100,000. The procurement team
            knew about the 6% MFN and the 32% anti-dumping rate. They did not
            account for CBAM.
          </p>
        ),
      },
      {
        title: 'What the calculator stacks.',
        body: (
          <p>
            From January 2026 the CBAM definitive period applies to HS chapter 76.
            The importer becomes a CBAM declarant. The duty headline is 38%; the
            CBAM cost is the certificate price for the embedded emissions on top.
            Certificate prices move weekly with the ETS benchmark, so the cost of
            the same shipment changes between quote and clearance.
          </p>
        ),
        bullets: [
          'MFN: 6% on customs value',
          'AD:  32% on customs value',
          'CBAM: certificate price (weekly ETS auction) × tonnes embedded CO₂',
          'Verified emissions data required from May 2026',
        ],
      },
    ],
    related: [
      { href: '/guides/compliance/cbam', title: 'CBAM', kicker: 'Compliance' },
      { href: '/guides/trade-defence/cn-aluminum-extrusions', title: 'CN aluminium extrusions AD', kicker: 'Trade defence' },
      HUB_LINK,
    ],
  },
  {
    slug: 'cosmetics-india-reach-cosmetics-regulation',
    short: 'IN cosmetics — CPNP',
    title: 'Responsible Person, Product Information File, CPNP notification before market.',
    lead: 'Cosmetics chapter 33 triggers Cosmetics Regulation 1223/2009: every product needs an EU Responsible Person, a Product Information File, and CPNP notification before market placement. Compliance overlay alone delays first shipment 3–6 months.',
    meta: 'Lane: cosmetics · IN → DE · HS chapter 33',
    headline: { value: '3–6', caption: 'months of compliance overlay before first sale' },
    body: [
      {
        title: 'The lane.',
        body: (
          <p>
            A German cosmetics brand sources finished face-care products from an
            Indian contract manufacturer. The procurement team expected to book the
            first shipment within four weeks.
          </p>
        ),
      },
      {
        title: 'What 1223/2009 requires.',
        body: (
          <p>
            Three parallel obligations, each on the brand. None of them is satisfied
            by the Indian manufacturer; each falls on the EU placer of the product.
          </p>
        ),
        bullets: [
          'Responsible Person — a natural or legal person established in the EU, designated for each product.',
          'Product Information File — held at the Responsible Person address, available to authorities on request.',
          'CPNP notification — Cosmetic Product Notification Portal, before placing the product on the market.',
          'Safety assessment by a qualified assessor, kept in the PIF.',
          'INCI labelling on every unit.',
        ],
      },
      {
        title: 'The realistic timeline.',
        body: (
          <p>
            Three to six months from finished-formula to first legal sale, depending
            on how the safety assessment lands. The calculator surfaces this on the
            plan output so the brand schedules the launch realistically, not
            optimistically.
          </p>
        ),
      },
    ],
    related: [
      { href: '/guides/compliance/cosmetics', title: 'Cosmetics Regulation', kicker: 'Compliance' },
      HUB_LINK,
      APPLY_LINK,
    ],
  },
  {
    slug: 'polish-apparel-importer-from-china',
    short: 'PL apparel from CN',
    title: 'A Polish apparel importer routing from China.',
    lead: 'Woven versus knitted classification, REX-eligibility, and the trade-defence overlay on cotton fabrics from China — what changes from EBA to MFN when the origin moves.',
    meta: 'Lane: apparel · CN → PL · HS chapters 61 + 62',
    body: [
      {
        title: 'The lane.',
        body: (
          <p>
            A Polish apparel brand currently sources from Bangladesh under EBA and is
            considering a partial migration to Chinese production. The duty
            implications are not trivial.
          </p>
        ),
      },
      {
        title: 'Where the lane breaks.',
        body: (
          <p>
            China is not a GSP origin. The lane moves from 0% under EBA to 12% MFN
            under chapter 61, and 11.5% under chapter 62. On a &euro;500,000 annual
            book, the duty delta is roughly &euro;60,000 a year &mdash; before
            considering any trade-defence overlay on the specific chapter or HS
            line.
          </p>
        ),
      },
    ],
    related: [
      { href: '/guides/preferential-origin/eba', title: 'EBA — what the brand loses', kicker: 'Preferential origin' },
      { href: '/guides/customs', title: 'Customs by commodity and destination', kicker: 'Customs' },
      HUB_LINK,
    ],
  },
  {
    slug: 'south-korea-machinery-eukfta-zero-duty',
    short: 'KR machinery — EUKFTA',
    title: 'Zero duty under the EU–Korea Free Trade Agreement.',
    lead: 'Industrial machinery from South Korea under the EUKFTA. Origin declaration on the invoice and a clean lane through the EU.',
    meta: 'Lane: machinery · KR → DE · HS chapter 84',
    headline: { value: '0%', caption: 'duty under EUKFTA' },
    body: [
      {
        title: 'The lane.',
        body: (
          <p>
            A German manufacturer sources industrial machinery from a Korean
            supplier. Under EUKFTA the duty on chapter 84 is zero. The supplier
            holds an &ldquo;approved exporter&rdquo; authorisation from Korean
            customs and prints the origin declaration on the invoice.
          </p>
        ),
      },
      {
        title: 'What remains.',
        body: (
          <p>
            CE marking under the Machinery Regulation, the EMC Directive where
            applicable, and the relevant harmonised standards. The duty saving is
            real; the conformity assessment is unchanged.
          </p>
        ),
      },
    ],
    related: [
      { href: '/guides/preferential-origin/eukfta', title: 'EUKFTA framework', kicker: 'Preferential origin' },
      { href: '/guides/compliance/ce-machinery', title: 'CE Machinery', kicker: 'Compliance' },
      HUB_LINK,
    ],
  },
];
