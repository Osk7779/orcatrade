import type { Metadata } from 'next';
import { PillarPage } from '@/components/marketing/pillar-page';

export const metadata: Metadata = {
  title: 'OrcaTrade Sourcing — Asia procurement and quality control',
  description:
    'Six Asia origins. Supplier screening, factory-risk feeds, sample-quote rebranding. Built for brands that take supply chains seriously.',
};

export default function SourcingPage() {
  return (
    <PillarPage
      stageKicker="Stage 02 · Source it"
      title={
        <>
          OrcaTrade Sourcing.
          <br className="hidden md:block" /> Asia procurement, end-to-end.
        </>
      }
      lead="Six Asia origins, eight commodity categories. Supplier briefs that ask the right questions, factory-risk feeds that surface what the brochure hides, and the rebranded sample-quote workflow we use internally."
      meta="Six origins · eight commodity classes · €50k–€500k order range"
      whatItDoesIntro="Sourcing is the moment trust is built or burned. The platform makes the brief sharper, the screening tighter, and the supplier conversation faster."
      features={[
        {
          title: 'Origin coverage that matches the platform.',
          body: 'China, Vietnam, India, Bangladesh, Türkiye, Hong Kong — and we treat each origin as different, because trade defence, preferential access and compliance overlay diverge sharply between them.',
        },
        {
          title: 'Eight commodity briefs, codified.',
          body: 'Apparel, cosmetics, electronics, footwear, furniture, homeware, machinery, toys. Each carries its own non-negotiables — REACH SVHC, CPNP for cosmetics, RoHS/WEEE for chapter 85 — and the brief makes them explicit.',
        },
        {
          title: 'Sanctions screening, baked in.',
          body: 'Every supplier and beneficial owner screened against OFAC SDN, UK OFSI, the UN Security Council and the EU consolidated lists. Safe-by-design: "no match" never means "clear".',
        },
        {
          title: 'Quote Studio for the team.',
          body: 'Internal team tool that rebrands supplier PDFs onto OrcaTrade letterhead, folding margin silently. The supplier currency is preserved; the margin is enforced at the line level.',
        },
      ]}
      workflowIntro="A simple six-step flow from first conversation to deposit-ready supplier."
      steps={[
        {
          numeral: 'I',
          title: 'Brief shaped against the lane.',
          body: 'Origin, commodity, target spec, target cost. The brief carries the regulatory overlay so the supplier sees the compliance constraints from day one.',
        },
        {
          numeral: 'II',
          title: 'Shortlist of supplier candidates.',
          body: 'From the network and from cold outreach. Screened against sanctions and against factory-risk signals before they make the shortlist.',
        },
        {
          numeral: 'III',
          title: 'Quote rebranded onto our letterhead.',
          body: 'Supplier currency preserved. Margin folded silently into the per-line rate. You see the OrcaTrade quote; the supplier never sees the markup.',
        },
        {
          numeral: 'IV',
          title: 'Sample-to-bulk approval in writing.',
          body: 'Tolerances agreed, in writing, before the deposit. The platform tracks the deviation between sample and bulk through to receipt.',
        },
        {
          numeral: 'V',
          title: 'Pre-shipment inspection.',
          body: 'Third-party where the lane warrants it. Findings recorded against the supplier file so the next order benefits from the history.',
        },
        {
          numeral: 'VI',
          title: 'Hand-off to logistics and customs.',
          body: 'The plan composed in Search hands the cleared brief to Logistics. The lane is priced end-to-end before the booking goes out.',
        },
      ]}
      closingTitle={<>Source like the people who&rsquo;ve imported.</>}
      closingLead="The platform is built by founders who have walked the factory floor in Shanghai and the customs window in Gdańsk. The brief is what we wish we had."
    />
  );
}
