// Content store for the preferential-origin deep pages.
// Two kinds of slugs share one route:
//   - frameworks: 'eba', 'evfta', 'eukfta', 'eujepa', 'atr', 'gsp-standard', 'gsp-plus'
//   - origin lookups: 'from-bd', 'from-in', 'from-jp', 'from-kr', 'from-pk', 'from-tr', 'from-vn'
//
// Both render through GuideArticle. The slug shape tells us which kind
// to fetch from the map; the template treats them identically.

import type { ReactNode } from 'react';

export interface PrefOriginGuide {
  slug: string;
  kind: 'framework' | 'origin';
  short: string;
  title: string;
  lead: string;
  meta?: string;
  body: { title: string; body: ReactNode; bullets?: ReactNode[] }[];
  related: { href: string; title: string; kicker?: string }[];
}

const HUB_LINK = {
  href: '/guides/preferential-origin',
  title: 'All frameworks & origins',
  kicker: 'Hub',
};
const APPLY_LINK = {
  href: '/start',
  title: 'Build my import plan',
  kicker: 'Apply',
};

export const PREF_ORIGIN_GUIDES: PrefOriginGuide[] = [
  // ───────── Frameworks (deep) ─────────
  {
    slug: 'eba',
    kind: 'framework',
    short: 'EBA',
    title: 'EBA — Everything But Arms, zero duty for least-developed origins.',
    lead: 'Unilateral EU preference granting duty-free, quota-free access for all products except arms and ammunition. Bangladesh continues on the transitional schedule until 2029.',
    meta: 'Unilateral · LDC origins · GSP Regulation 978/2012',
    body: [
      {
        title: 'What EBA is.',
        body: (
          <>
            <p>
              Everything But Arms is the most generous arrangement under the EU&rsquo;s
              Generalised Scheme of Preferences. It grants <em>duty-free, quota-free</em>{' '}
              access to the EU market for all products originating in countries classified
              by the UN as Least Developed Countries &mdash; with the sole exception of arms
              and ammunition.
            </p>
            <p>
              The arrangement is unilateral: there is no reciprocal obligation on the
              originating country. It applies until the country graduates from LDC status,
              and then for a transitional period of three years to soften the cliff.
            </p>
          </>
        ),
      },
      {
        title: 'Who qualifies today.',
        body: (
          <p>
            All UN-listed LDCs that are also GSP-eligible. The headline cases for European
            buyers are Bangladesh (apparel, footwear, leather goods), Cambodia, Myanmar
            (suspended in part since 2020), and a number of African origins.
          </p>
        ),
        bullets: [
          'Bangladesh — LDC graduation 24 November 2026; EBA continues until 24 November 2029 under the transitional period.',
          'Cambodia — partial suspension in force since August 2020; selected HS codes excluded.',
          'Most sub-Saharan African LDCs continue without restriction.',
        ],
      },
      {
        title: 'The documentation.',
        body: (
          <p>
            Origin proof under EBA is the <em>REX statement</em> &mdash; a self-declaration
            issued by an exporter registered in the EU&rsquo;s Registered Exporter system.
            For consignments below &euro;6,000, an invoice declaration is sufficient. Above
            that, the REX number must appear on the statement.
          </p>
        ),
        bullets: [
          'Statement on origin printed on the invoice, packing list, or any commercial document.',
          'Exporter registered in the EU REX database (one-off registration).',
          'Statement valid for 24 months from issue.',
          'Importer may claim preference retroactively up to three years if the statement is later available.',
        ],
      },
      {
        title: 'When it does not apply.',
        body: (
          <>
            <p>
              Trade-defence measures override preference. An anti-dumping or
              countervailing duty in force against an LDC origin still applies even though
              MFN drops to zero under EBA. We have not seen many such cases in practice,
              but the carve-out exists.
            </p>
            <p>
              Rules of origin matter. A garment cut and sewn in Bangladesh from fabric
              imported from a third country only qualifies if the cumulation rules are
              satisfied. Bangladesh has access to ASEAN, SAARC and SAARC+ cumulation
              under specific conditions; the import plan surfaces the live rule for the
              HS chapter you are sourcing.
            </p>
          </>
        ),
      },
    ],
    related: [
      { href: '/examples/bangladesh-apparel-eba-zero-duty/', title: 'Bangladesh apparel under EBA', kicker: 'Worked example' },
      { href: '/guides/preferential-origin/from-bd', title: 'From Bangladesh', kicker: 'Origin' },
      HUB_LINK,
    ],
  },
  {
    slug: 'evfta',
    kind: 'framework',
    short: 'EVFTA',
    title: 'EVFTA — the EU–Vietnam Free Trade Agreement.',
    lead: 'Reciprocal preference between the EU and Vietnam. Most HS chapters reach zero duty over a phased calendar; the REX statement is the proof. The compliance overlay still applies in full.',
    meta: 'In force since 1 August 2020 · phased duty schedule',
    body: [
      {
        title: 'What EVFTA is.',
        body: (
          <p>
            The EU&ndash;Vietnam Free Trade Agreement entered into force on 1 August 2020.
            It eliminates duties on most product groups over a phased calendar &mdash; some
            chapters reached zero on day one, others phase in over seven to ten years.
            The agreement is reciprocal: Vietnamese exporters get EU preference, EU
            exporters get Vietnamese preference.
          </p>
        ),
      },
      {
        title: 'How the duty drops.',
        body: (
          <p>
            Each HS chapter has its own staging category in Annex 2-A. Most consumer
            electronics, footwear and textiles are at zero today; some machinery and
            chemicals remain on the phased schedule until 2027 or 2030. The calculator
            looks up the current rate by chapter and stamps it onto the plan.
          </p>
        ),
      },
      {
        title: 'Origin proof — REX statement.',
        body: (
          <p>
            Vietnamese exporters self-declare origin via a statement on the invoice
            referencing their REX number. Consignments below &euro;6,000 do not need
            the REX number, only an invoice declaration. The statement is valid for
            twelve months.
          </p>
        ),
        bullets: [
          'REX number from the Vietnamese-issued registry, printed on the invoice or commercial document.',
          'Statement template laid out in Annex VI of the implementing protocol.',
          'Sufficient working or processing required per the chapter-specific rule of origin.',
          'Cumulation with ASEAN partners possible under the bilateral cumulation rules.',
        ],
      },
      {
        title: 'Compliance overlay remains.',
        body: (
          <p>
            Preferential duty does not waive compliance regimes. A Vietnamese electronics
            import enters the EU duty-free but still needs CE LVD/EMC/RED conformity
            assessment, RoHS self-declaration, WEEE producer registration in every
            destination state. The worked example on this lane walks the four overlapping
            regimes alongside the duty saving.
          </p>
        ),
      },
    ],
    related: [
      { href: '/examples/vietnam-electronics-evfta-zero-duty/', title: 'EVFTA + compliance stack', kicker: 'Worked example' },
      { href: '/guides/preferential-origin/from-vn', title: 'From Vietnam', kicker: 'Origin' },
      HUB_LINK,
    ],
  },
  {
    slug: 'eukfta',
    kind: 'framework',
    short: 'EUKFTA',
    title: 'EUKFTA — the EU–Korea Free Trade Agreement.',
    lead: 'In force since July 2011, fully implemented since 2016. Zero duty on virtually all industrial goods; origin declaration on the invoice is the proof.',
    meta: 'Fully implemented · self-certification · most HS chapters at 0%',
    body: [
      {
        title: 'What EUKFTA is.',
        body: (
          <p>
            The first EU free-trade agreement with a major Asian economy. Provisional
            application from 1 July 2011, full implementation from 13 December 2016.
            Industrial duties were eliminated on most HS chapters during the phase-in;
            today the headline rate on the vast majority of lines is zero.
          </p>
        ),
      },
      {
        title: 'How origin is proved.',
        body: (
          <p>
            Self-certification. An approved Korean exporter prints an origin declaration
            on the invoice or any commercial document, signed by the exporter, identifying
            the goods as preferential. For consignments above &euro;6,000 the exporter
            must hold an &ldquo;approved exporter&rdquo; authorisation from Korean customs;
            below that, the declaration is sufficient on its own.
          </p>
        ),
      },
      {
        title: 'The carve-outs.',
        body: (
          <p>
            A handful of agricultural and processed-food lines remain on tariff quotas.
            Industrial goods are essentially clean. Anti-dumping and countervailing duties
            in force against Korean producers still apply &mdash; the FTA does not waive
            trade defence. The calculator stamps both onto the plan if relevant.
          </p>
        ),
      },
    ],
    related: [
      { href: '/examples/south-korea-machinery-eukfta-zero-duty/', title: 'KR machinery under EUKFTA', kicker: 'Worked example' },
      { href: '/guides/preferential-origin/from-kr', title: 'From South Korea', kicker: 'Origin' },
      HUB_LINK,
    ],
  },
  {
    slug: 'atr',
    kind: 'framework',
    short: 'A.TR',
    title: 'A.TR — the EU–Türkiye Customs Union.',
    lead: 'A customs union, not a free-trade agreement. Industrial goods circulate freely between the EU and Türkiye, but trade-defence measures override the preference and still apply.',
    meta: 'Customs Union since 1996 · industrial scope · trade defence overrides',
    body: [
      {
        title: 'What the Customs Union is.',
        body: (
          <p>
            The EU&ndash;Türkiye Customs Union entered into force on 1 January 1996. It
            covers industrial goods and processed agricultural products. The Union
            applies the EU&rsquo;s common external tariff, so goods that are in free
            circulation in one party can move to the other duty-free with the A.TR
            movement certificate.
          </p>
        ),
      },
      {
        title: 'A.TR — the movement document.',
        body: (
          <p>
            A.TR is not an origin certificate. It certifies that the goods are{' '}
            <em>in free circulation</em>, meaning either originating in the Customs
            Union or duty-paid into it. The implication: third-country goods imported
            into Türkiye, duty-paid, can re-export to the EU under A.TR without paying
            EU MFN duty again.
          </p>
        ),
        bullets: [
          'Issued by Turkish customs or by an approved exporter.',
          'Validity 120 days from issue.',
          'Required at EU entry to claim free-circulation status.',
        ],
      },
      {
        title: 'The trade-defence override.',
        body: (
          <>
            <p>
              The most-misunderstood point of A.TR. Free circulation does <em>not</em>{' '}
              waive trade-defence measures. Anti-dumping or countervailing duties on a
              third-country origin still apply to goods re-exported from Türkiye to the
              EU. The classic example: Chinese cold-rolled steel imported into Türkiye,
              re-exported to Germany under A.TR &mdash; 23.3% AD still hits at German
              entry.
            </p>
            <p>
              The procurement misconception is &ldquo;TR goods are duty-free under
              A.TR&rdquo;. True for MFN. Not true for trade defence. The worked example
              on this lane walks the full math.
            </p>
          </>
        ),
      },
    ],
    related: [
      { href: '/examples/turkey-cold-rolled-steel-atr-with-ad/', title: 'TR steel + 23.3% AD', kicker: 'Worked example' },
      { href: '/guides/preferential-origin/from-tr', title: 'From Türkiye', kicker: 'Origin' },
      HUB_LINK,
    ],
  },

  // ───────── Framework stubs ─────────
  ...stubFramework(
    'eujepa',
    'EU–Japan EPA',
    'EU–Japan Economic Partnership Agreement.',
    'In force since 1 February 2019. Phased duty elimination on most chapters. Self-certification by the exporter; the importer claims preference at entry.',
  ),
  ...stubFramework(
    'gsp-standard',
    'GSP',
    'Generalised Scheme of Preferences — standard arrangement.',
    'Unilateral EU preference for developing countries that are not yet LDC. Sensitive product lists, sector graduation rules, and documentation requirements vary by HS chapter.',
  ),
  ...stubFramework(
    'gsp-plus',
    'GSP+',
    'GSP+ — preference for countries ratifying the twenty-seven conventions.',
    'Zero duty on most products for countries that ratify and implement the twenty-seven conventions on human rights, labour, environment and good governance.',
  ),

  // ───────── Origin lookups ─────────
  {
    slug: 'from-vn',
    kind: 'origin',
    short: 'From Vietnam',
    title: 'Sourcing from Vietnam — the preferential-origin lookup.',
    lead: 'EVFTA grants zero duty on most chapters; REX statement is the proof. Compliance overlay applies in full alongside the duty saving.',
    meta: 'Primary framework: EVFTA',
    body: [
      {
        title: 'What applies.',
        body: (
          <p>
            Vietnam is covered by the EU&ndash;Vietnam Free Trade Agreement (EVFTA),
            in force since 1 August 2020. The agreement covers virtually all chapters
            on a phased schedule; most consumer goods are at zero today.
          </p>
        ),
      },
      {
        title: 'Documentation.',
        body: (
          <p>
            REX statement on the invoice, referencing the exporter&rsquo;s REX number.
            Statement valid twelve months. Cumulation with ASEAN partners under the
            bilateral rules.
          </p>
        ),
      },
    ],
    related: [
      { href: '/guides/preferential-origin/evfta', title: 'EVFTA', kicker: 'Framework' },
      { href: '/examples/vietnam-electronics-evfta-zero-duty/', title: 'VN electronics worked example', kicker: 'Worked example' },
      HUB_LINK,
    ],
  },
  {
    slug: 'from-bd',
    kind: 'origin',
    short: 'From Bangladesh',
    title: 'Sourcing from Bangladesh — the preferential-origin lookup.',
    lead: 'EBA grants zero duty on all chapters except arms. Bangladesh graduates from LDC status 24 November 2026; EBA continues until 24 November 2029 under the transitional schedule.',
    meta: 'Primary framework: EBA · graduation 2026, transitional to 2029',
    body: [
      {
        title: 'What applies.',
        body: (
          <p>
            Bangladesh is covered by Everything But Arms, the most generous EU
            preference. Duty-free, quota-free access for every product group except
            arms and ammunition.
          </p>
        ),
      },
      {
        title: 'Documentation.',
        body: (
          <p>
            REX statement on the invoice. Below &euro;6,000 the REX number is not
            required; above that it must appear.
          </p>
        ),
      },
      {
        title: 'The graduation timeline.',
        body: (
          <p>
            Bangladesh has been confirmed for LDC graduation on 24 November 2026. EBA
            continues for a further three years &mdash; until 24 November 2029 &mdash;
            under the transitional period. After that, Bangladesh moves to the standard
            GSP arrangement.
          </p>
        ),
      },
    ],
    related: [
      { href: '/guides/preferential-origin/eba', title: 'EBA framework', kicker: 'Framework' },
      { href: '/examples/bangladesh-apparel-eba-zero-duty/', title: 'BD apparel worked example', kicker: 'Worked example' },
      HUB_LINK,
    ],
  },
  {
    slug: 'from-tr',
    kind: 'origin',
    short: 'From Türkiye',
    title: 'Sourcing from Türkiye — the preferential-origin lookup.',
    lead: 'A.TR free circulation under the Customs Union. Trade-defence measures override the preference and still apply on third-country goods re-exported via Türkiye.',
    meta: 'Primary framework: A.TR · trade defence overrides',
    body: [
      {
        title: 'What applies.',
        body: (
          <p>
            Türkiye is in customs union with the EU for industrial goods. Goods in
            free circulation circulate duty-free under the A.TR movement document.
          </p>
        ),
      },
      {
        title: 'Where the misconception hits.',
        body: (
          <p>
            &ldquo;TR goods are duty-free under A.TR&rdquo; is true for MFN, not for
            trade defence. Anti-dumping or countervailing duties in force against
            a third-country origin still apply when those goods re-export via Türkiye.
          </p>
        ),
      },
    ],
    related: [
      { href: '/guides/preferential-origin/atr', title: 'A.TR framework', kicker: 'Framework' },
      { href: '/examples/turkey-cold-rolled-steel-atr-with-ad/', title: 'TR steel + 23.3% AD', kicker: 'Worked example' },
      HUB_LINK,
    ],
  },
  {
    slug: 'from-kr',
    kind: 'origin',
    short: 'From South Korea',
    title: 'Sourcing from South Korea — the preferential-origin lookup.',
    lead: 'EUKFTA grants zero duty on virtually all industrial goods. Origin declaration on the invoice is the proof.',
    meta: 'Primary framework: EUKFTA · fully implemented',
    body: [
      {
        title: 'What applies.',
        body: (
          <p>
            South Korea is covered by the EU&ndash;Korea Free Trade Agreement (EUKFTA),
            fully implemented since 13 December 2016. Industrial duties are zero on
            virtually all HS chapters.
          </p>
        ),
      },
      {
        title: 'Documentation.',
        body: (
          <p>
            Origin declaration on the invoice. Above &euro;6,000, the exporter must
            hold an &ldquo;approved exporter&rdquo; authorisation from Korean customs.
          </p>
        ),
      },
    ],
    related: [
      { href: '/guides/preferential-origin/eukfta', title: 'EUKFTA framework', kicker: 'Framework' },
      { href: '/examples/south-korea-machinery-eukfta-zero-duty/', title: 'KR machinery worked example', kicker: 'Worked example' },
      HUB_LINK,
    ],
  },

  // ───────── Origin stubs ─────────
  ...stubOrigin(
    'from-in',
    'From India',
    'GSP standard arrangement; sector graduation excludes textiles, chemicals and metals from preference.',
  ),
  ...stubOrigin(
    'from-jp',
    'From Japan',
    'EU–Japan Economic Partnership Agreement; self-certification by exporter.',
  ),
  ...stubOrigin(
    'from-pk',
    'From Pakistan',
    'GSP+ — zero duty on most products for countries implementing the twenty-seven conventions.',
  ),
];

function stubFramework(
  slug: string,
  short: string,
  title: string,
  lead: string,
): PrefOriginGuide[] {
  return [
    {
      slug,
      kind: 'framework',
      short,
      title,
      lead,
      meta: 'Outline · full guide in preparation',
      body: [
        {
          title: 'Scope.',
          body: (
            <p>
              {lead} The full deep-write of this framework is being prepared. In the
              meantime, the preference is honoured by the calculator on every relevant
              plan, and the live reference page on orcatrade.pl carries the current
              detailed working.
            </p>
          ),
        },
        {
          title: 'How OrcaTrade applies it.',
          body: (
            <p>
              When a plan touches an HS code under this framework, the duty drop is
              surfaced on the plan output with the required artefact set and the
              implementing dates.
            </p>
          ),
        },
      ],
      related: [HUB_LINK, APPLY_LINK],
    },
  ];
}

function stubOrigin(slug: string, short: string, lead: string): PrefOriginGuide[] {
  return [
    {
      slug,
      kind: 'origin',
      short,
      title: `Sourcing ${short.toLowerCase()} — the preferential-origin lookup.`,
      lead,
      meta: 'Outline · full guide in preparation',
      body: [
        {
          title: 'What applies.',
          body: (
            <p>
              {lead} Full deep-write in preparation; the calculator surfaces the
              applicable framework on every plan that touches this origin.
            </p>
          ),
        },
      ],
      related: [HUB_LINK, APPLY_LINK],
    },
  ];
}
