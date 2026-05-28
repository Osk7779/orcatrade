import type { Metadata } from 'next';
import { EditorialHeader } from '@/components/marketing/editorial-header';
import { HubCard } from '@/components/marketing/hub-card';
import { FadeUp } from '@/components/marketing/fade-up';

export const metadata: Metadata = {
  title: 'Compliance guides — OrcaTrade Group',
  description:
    'Every EU regulatory regime that touches consumer and industrial imports. CBAM, EUDR, REACH, CE, GPSR, WEEE, PPWR and more.',
};

const REGIMES = [
  {
    href: '/guides/compliance/cbam/',
    kicker: 'Carbon Border Adjustment Mechanism',
    title: 'CBAM.',
    description:
      'Steel, cement, aluminium, fertilisers, electricity, hydrogen. Definitive period from January 2026.',
  },
  {
    href: '/guides/compliance/eudr/',
    kicker: 'EU Deforestation Regulation',
    title: 'EUDR.',
    description:
      'Soy, palm oil, cattle, coffee, cocoa, rubber, wood and derived products. Due-diligence statements and plot-level geolocation.',
  },
  {
    href: '/guides/compliance/reach/',
    kicker: 'Registration, Evaluation, Authorisation',
    title: 'REACH.',
    description:
      'SVHC, registration thresholds, authorisation. What the importer becomes responsible for under EU REACH.',
  },
  {
    href: '/guides/compliance/ce-lvd-emc-red/',
    kicker: 'CE — electrical',
    title: 'CE marking — LVD / EMC / RED.',
    description:
      'Low Voltage, Electromagnetic Compatibility, Radio Equipment. The three directives that govern most electrical imports.',
  },
  {
    href: '/guides/compliance/ce-machinery/',
    kicker: 'CE — machinery',
    title: 'CE — Machinery Directive.',
    description:
      'Industrial machinery, mobility, lifting equipment. The new Machinery Regulation replaces 2006/42/EC from 2027.',
  },
  {
    href: '/guides/compliance/gpsr/',
    kicker: 'General Product Safety Regulation',
    title: 'GPSR.',
    description:
      'Effective December 2024 for consumer products. Article 4 requires every non-EU seller to appoint an EU responsible person.',
  },
  {
    href: '/guides/compliance/rohs/',
    kicker: 'Restriction of Hazardous Substances',
    title: 'RoHS.',
    description:
      'Lead, mercury, cadmium, hexavalent chromium and the bromine pair. Conformity assessment for electrical and electronic equipment.',
  },
  {
    href: '/guides/compliance/weee/',
    kicker: 'Waste Electrical & Electronic Equipment',
    title: 'WEEE.',
    description:
      'Producer registration in every destination state. Take-back obligation, financial guarantee, marking requirements.',
  },
  {
    href: '/guides/compliance/ppwr/',
    kicker: 'Packaging & Packaging Waste',
    title: 'PPWR.',
    description:
      'Material thresholds, recyclability targets, reuse obligations. Replaces the directive with a directly-applicable regulation.',
  },
  {
    href: '/guides/compliance/cosmetics/',
    kicker: 'Cosmetics Regulation 1223/2009',
    title: 'Cosmetics.',
    description:
      'Responsible Person, Product Information File, CPNP notification before any product reaches the market.',
  },
  {
    href: '/guides/compliance/battery/',
    kicker: 'Battery Regulation',
    title: 'Battery Regulation.',
    description:
      'Carbon footprint, recycled content, due diligence on cobalt, lithium, natural graphite. Replaces the Battery Directive.',
  },
  {
    href: '/guides/compliance/toy-safety/',
    kicker: 'Toy Safety Directive',
    title: 'Toy safety.',
    description:
      'EN 71 mechanical and physical, EN 71 flammability, EN 62115 electrical safety. Type approval and the warning requirements.',
  },
  {
    href: '/guides/compliance/footwear-labelling/',
    kicker: 'Footwear labelling',
    title: 'Footwear labelling.',
    description:
      '94/11/EC pictograms for upper, lining and outsole materials. Per-pair labelling required at the point of sale.',
  },
];

export default function ComplianceHubPage() {
  return (
    <>
      <EditorialHeader
        kicker="Compliance regimes"
        title="Every regulatory regime that touches imports."
        lead="Thirteen regimes today, citation-checked against the live regulatory corpus. New regimes added as they enter the EU legislative pipeline."
        meta="13 regimes · EN reference · PL and DE editions linked from each guide"
      />

      <section className="bg-[var(--color-ink)] py-20 md:py-28">
        <div className="mx-auto max-w-[1280px] px-6">
          <FadeUp>
            <div className="grid grid-cols-1 gap-px border border-[var(--color-navy-line)] bg-[var(--color-navy-line)] md:grid-cols-2 lg:grid-cols-3 [&>*]:transition-opacity [&>*]:duration-700 [&:has(>*:hover)>*:not(:hover)]:opacity-45">
              {REGIMES.map((r) => (
                <HubCard key={r.href} {...r} />
              ))}
            </div>
          </FadeUp>
        </div>
      </section>
    </>
  );
}
