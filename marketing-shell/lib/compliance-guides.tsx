// Content store for the 13 EU compliance regimes. Each entry feeds the
// dynamic route at /guides/compliance/[slug]. Hand-written, citation-aware
// summaries of regimes we route every customer through.
//
// Long-form content lives here so the dynamic route can stay thin and
// the editorial team can edit one file to update a regime.

import type { ReactNode } from 'react';

export interface ComplianceGuide {
  slug: string;
  short: string; // e.g. "CBAM"
  title: string; // editorial headline
  lead: string;
  meta?: string;
  body: {
    title: string;
    body: ReactNode;
    bullets?: ReactNode[];
  }[];
  related: { href: string; title: string; kicker?: string }[];
}

const COMMON_RELATED: ComplianceGuide['related'] = [
  { href: '/guides/compliance', title: 'All compliance regimes', kicker: 'Hub' },
  { href: '/start', title: 'Open the import plan builder', kicker: 'Apply' },
  { href: '/examples', title: 'See worked examples', kicker: 'Reference' },
];

export const COMPLIANCE_GUIDES: ComplianceGuide[] = [
  {
    slug: 'cbam',
    short: 'CBAM',
    title:
      'CBAM — Carbon Border Adjustment Mechanism, definitive period from January 2026.',
    lead: 'Importers of steel, cement, aluminium, fertilisers, electricity and hydrogen now pay the embedded-emissions premium at the EU border. Reporting closed 31 December 2025; the financial obligation begins.',
    meta: 'Scope: six product groups · Status: definitive period live',
    body: [
      {
        title: 'What CBAM is.',
        body: (
          <>
            <p>
              CBAM puts a carbon price on goods entering the EU customs
              territory, equal to the price an EU producer would have paid
              under the ETS. The aim is to prevent &ldquo;carbon
              leakage&rdquo; — the cost-driven migration of emissions-heavy
              production from regulated jurisdictions to unregulated ones.
            </p>
            <p>
              The regulation passed in 2023. The transitional period ran from
              1 October 2023 to 31 December 2025 and required quarterly
              reporting only. The definitive period began 1 January 2026 and
              adds the financial obligation: CBAM certificate purchases for
              every tonne of embedded CO<sub>2</sub> imported.
            </p>
          </>
        ),
      },
      {
        title: 'Who it applies to.',
        body: (
          <p>
            Any economic operator declaring goods for release into free
            circulation in the EU within the six product groups. The
            obligation rests on the <em>importer of record</em>, regardless
            of whether you are a producer, distributor, or trader. Indirect
            customs representatives can act on behalf of EU declarants;
            non-EU sellers cannot.
          </p>
        ),
        bullets: [
          'Steel — chapters 72 and 73, with specific HS-code carve-outs.',
          'Aluminium — chapter 76 unwrought, semis, and certain articles.',
          'Cement — clinker, Portland cement, aluminous cement.',
          'Fertilisers — nitrogenous, including ammonia and urea.',
          'Electricity — direct imports from third-country grids.',
          <span key="h2">
            Hydrogen — chapter 28 in pure form, including isotopes.
          </span>,
        ],
      },
      {
        title: 'The compliance steps, in order.',
        body: (
          <p>
            Each step has its own deadline and its own evidence package. The
            calculator captures all of them on the plan output.
          </p>
        ),
        bullets: [
          'Apply for authorised CBAM declarant status with your national competent authority.',
          'Collect embedded-emissions data from each producer for each consignment.',
          'Verify the emissions data through an accredited verifier (required from May 2026).',
          'Submit the annual CBAM declaration for the prior calendar year by 31 May.',
          'Hold CBAM certificates equal to declared embedded emissions, at the weekly auction price.',
          'Surrender certificates against the declaration; up to one-third can be carried over.',
        ],
      },
      {
        title: 'Common mistakes.',
        body: (
          <>
            <p>
              The biggest is treating CBAM as a tax. It is a market
              instrument: certificate price moves weekly with the ETS
              benchmark, so the cost of the same shipment changes between
              quote and clearance. Lock the certificate purchase to the
              shipment booking, not the quotation date.
            </p>
            <p>
              The second is relying on the producer&rsquo;s emissions number
              without verifying the methodology. From May 2026 the emissions
              must be verified by an EU-accredited body — many third-country
              producers underestimate or omit indirect emissions (scope 2),
              which can double the embedded total.
            </p>
          </>
        ),
      },
      {
        title: 'Where to learn more.',
        body: (
          <ul className="flex flex-col gap-2">
            <li className="flex gap-3">
              <span
                aria-hidden
                className="mt-2.5 size-[3px] shrink-0 rounded-full bg-[var(--color-ivory-mute)]/60"
              />
              <span>
                Regulation (EU) 2023/956 — establishing CBAM (the founding
                instrument).
              </span>
            </li>
            <li className="flex gap-3">
              <span
                aria-hidden
                className="mt-2.5 size-[3px] shrink-0 rounded-full bg-[var(--color-ivory-mute)]/60"
              />
              <span>
                Implementing Regulation (EU) 2023/1773 — transitional period
                reporting obligations.
              </span>
            </li>
            <li className="flex gap-3">
              <span
                aria-hidden
                className="mt-2.5 size-[3px] shrink-0 rounded-full bg-[var(--color-ivory-mute)]/60"
              />
              <span>
                Worked example: <em>CBAM declarant status + 32%
                anti-dumping duty</em> on Chinese aluminium extrusions.
              </span>
            </li>
          </ul>
        ),
      },
    ],
    related: [
      { href: '/examples/cn-aluminium-cbam-plus-32pct-ad/', title: 'CBAM + 32% AD on CN aluminium', kicker: 'Worked example' },
      { href: '/guides/compliance/reach', title: 'REACH', kicker: 'Related regime' },
      ...COMMON_RELATED.slice(0, 1),
    ],
  },
  {
    slug: 'eudr',
    short: 'EUDR',
    title:
      'EUDR — EU Deforestation Regulation, due diligence and the geolocation file.',
    lead: 'Soy, palm oil, cattle, coffee, cocoa, rubber, wood and many derived products require a due-diligence statement with plot-level geolocation before they can enter the EU market.',
    meta: 'Scope: 7 raw + derived · Status: rollout in progress',
    body: [
      {
        title: 'What EUDR is.',
        body: (
          <>
            <p>
              EUDR prohibits placing products on the EU market if they are
              linked to land deforested or degraded after 31 December 2020.
              The instrument is Regulation (EU) 2023/1115, replacing the
              prior EUTR which covered timber only.
            </p>
            <p>
              The scope is much wider: seven primary commodities and the
              long list of derived products in Annex I. Coverage rolled out
              in phases — large operators first, SMEs later. The Commission
              has also pushed back the textile inclusion to give the sector
              a longer runway.
            </p>
          </>
        ),
      },
      {
        title: 'What you have to produce.',
        body: (
          <p>
            Every consignment requires a <em>due-diligence statement</em>{' '}
            filed in the EUDR Information System before the goods are
            released into free circulation. The statement carries the
            geolocation of <em>every plot of land</em> where the
            commodity was produced, the harvest dates, and the supply-chain
            chain of custody back to the plot.
          </p>
        ),
        bullets: [
          'Plot-level geolocation in WGS-84 (polygon, or single point for plots under 4 hectares).',
          'Date or date range of harvest or production.',
          'Quantity and unit of the commodity / product.',
          'Identity of every supplier and intermediate operator.',
          'Risk assessment and mitigation steps you took.',
        ],
      },
      {
        title: 'How the calculator surfaces it.',
        body: (
          <p>
            When a plan touches an EUDR-covered HS code, the regime is
            flagged on the plan output with the required artefact set, the
            implementing dates for your operator class, and links to the
            current Information System endpoint. The geolocation file is
            never invented — we list what evidence you need, you produce it.
          </p>
        ),
      },
      {
        title: 'Common mistakes.',
        body: (
          <p>
            Treating EUDR as a paperwork burden rather than a supply-chain
            decision. The regulation rewards <em>fewer, deeper</em> supplier
            relationships — you can only credibly file a due-diligence
            statement on a supplier whose plots you can trace and verify.
            Importers with diffuse, intermediary-heavy sourcing find
            compliance disproportionately expensive.
          </p>
        ),
      },
    ],
    related: [
      { href: '/guides/compliance/cbam', title: 'CBAM', kicker: 'Related regime' },
      { href: '/guides/compliance/reach', title: 'REACH', kicker: 'Related regime' },
      ...COMMON_RELATED.slice(0, 1),
    ],
  },
  {
    slug: 'reach',
    short: 'REACH',
    title:
      'REACH — Registration, Evaluation, Authorisation and restriction of chemicals.',
    lead: 'Every importer placing a substance on the EU market in quantities of one tonne per year or more is a REACH registrant — by default, whether they call themselves one or not.',
    meta: 'Scope: substances, mixtures, articles · Status: in force',
    body: [
      {
        title: 'What REACH is.',
        body: (
          <p>
            REACH (Regulation (EC) 1907/2006) regulates the manufacture and
            import of chemical substances in the EU. Importers are treated
            equivalently to manufacturers: the same registration, evaluation
            and authorisation obligations apply if you bring a substance,
            mixture or article into the EU customs territory.
          </p>
        ),
      },
      {
        title: 'When it triggers.',
        body: <p>The trigger thresholds depend on what you import:</p>,
        bullets: [
          'Substances or mixtures at ≥1 t/year per legal entity — registration with ECHA required.',
          'Articles releasing a registered substance intentionally — registration if the substance is in the article above ≥1 t/year.',
          'Articles containing an SVHC at >0.1% by weight — notification (and Article 33 communication to recipients).',
          'Authorisation-list substances — explicit authorisation required for any use.',
          'Restricted substances under Annex XVII — prohibition or conditions on placing on the market.',
        ],
      },
      {
        title: 'The Only Representative path.',
        body: (
          <p>
            Non-EU manufacturers can appoint an Only Representative (OR)
            established in the EU to fulfil their registration obligations.
            This shifts the legal responsibility for compliance to the OR
            and removes the registration burden from each EU importer of
            the same substance. For frequent imports from the same
            producer, the OR route is almost always cheaper than each
            importer registering independently.
          </p>
        ),
      },
      {
        title: 'Common mistakes.',
        body: (
          <p>
            Assuming REACH only applies to chemicals. The Article 33
            communication obligation hits articles &mdash; finished
            consumer goods &mdash; whenever they contain an SVHC above the
            threshold. Cookware, electronics, textile dyes, leather
            tanning, plastic plasticisers and flame retardants are the
            common surprise hits.
          </p>
        ),
      },
    ],
    related: [
      { href: '/guides/compliance/rohs', title: 'RoHS', kicker: 'Related regime' },
      { href: '/guides/compliance/cosmetics', title: 'Cosmetics Regulation', kicker: 'Related regime' },
      ...COMMON_RELATED.slice(0, 1),
    ],
  },
  // Remaining 10 regimes — short stubs that link back to the live page
  // until the deep-write is done. Each carries enough detail for the
  // editorial template to feel substantive.
  ...stubFor(
    'ce-lvd-emc-red',
    'CE LVD / EMC / RED',
    'CE marking for electrical equipment — Low Voltage, Electromagnetic Compatibility, Radio Equipment.',
    'Three directives that govern most electrical imports into the EU. Each carries its own conformity-assessment pathway, harmonised standards and technical-file requirements.',
  ),
  ...stubFor(
    'ce-machinery',
    'CE Machinery',
    'CE marking under the Machinery Regulation (replacing 2006/42/EC from 2027).',
    'Industrial machinery, mobility and lifting equipment. The new Machinery Regulation (EU) 2023/1230 phases out the directive over a transition window.',
  ),
  ...stubFor(
    'gpsr',
    'GPSR',
    'General Product Safety Regulation — every non-EU seller needs an EU responsible person.',
    'Effective 13 December 2024 for consumer products. Article 4 forces non-EU sellers to appoint an EU-established economic operator before placing goods on the market.',
  ),
  ...stubFor(
    'rohs',
    'RoHS',
    'Restriction of Hazardous Substances in electrical and electronic equipment.',
    'Lead, mercury, cadmium, hexavalent chromium and the bromine pair. Self-declaration in the technical file; CE marking required.',
  ),
  ...stubFor(
    'weee',
    'WEEE',
    'Waste Electrical & Electronic Equipment — producer registration and take-back obligation.',
    'Each EU member state runs its own register. Producer responsibility, financial guarantees, recyclate quotas and the WEEE marking on every product.',
  ),
  ...stubFor(
    'ppwr',
    'PPWR',
    'Packaging and Packaging Waste Regulation — material thresholds and reuse targets.',
    'Replaces the directive with a directly-applicable regulation. Reduction targets, recycled content quotas, ban on certain single-use plastic packaging.',
  ),
  ...stubFor(
    'cosmetics',
    'Cosmetics Regulation 1223/2009',
    'Responsible Person, Product Information File, CPNP notification.',
    'Every cosmetic product placed on the EU market needs a designated Responsible Person, a Product Information File at their EU address, and CPNP notification before market placement.',
  ),
  ...stubFor(
    'battery',
    'Battery Regulation',
    'Carbon footprint, recycled content and due diligence on cobalt, lithium and graphite.',
    'Regulation (EU) 2023/1542 replaces the Battery Directive. Phased implementation through 2031; portable, industrial, automotive and EV batteries all in scope.',
  ),
  ...stubFor(
    'toy-safety',
    'Toy safety',
    'Toy Safety Directive 2009/48/EC — EN 71 family of standards.',
    'EN 71 mechanical/physical, EN 71 flammability, EN 62115 electrical safety. Type approval, technical-file requirements, warning labels.',
  ),
  ...stubFor(
    'footwear-labelling',
    'Footwear labelling',
    '94/11/EC pictograms for upper, lining and outsole materials.',
    'Per-pair labelling required at the point of sale. Five material categories per component, pictogram + text in the language of the destination state.',
  ),
];

function stubFor(
  slug: string,
  short: string,
  title: string,
  lead: string,
): ComplianceGuide[] {
  return [
    {
      slug,
      short,
      title,
      lead,
      meta: 'Outline · full guide in preparation',
      body: [
        {
          title: 'Scope and applicability.',
          body: (
            <p>
              {lead} The full deep-write of this guide is being prepared.
              In the meantime, the regime is covered by the calculator
              overlay on every relevant plan, and the live reference page
              on orcatrade.pl carries the current detailed working.
            </p>
          ),
        },
        {
          title: 'How OrcaTrade applies it.',
          body: (
            <p>
              When a plan touches an HS code in this regime, the obligation
              is surfaced on the plan output with the required artefact
              set, the implementing dates for your operator class, and a
              link to the current legal instrument. You decide whether the
              compliance cost shifts the lane economics; we surface the
              cost.
            </p>
          ),
        },
      ],
      related: COMMON_RELATED,
    },
  ];
}
