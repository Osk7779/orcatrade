import type { Metadata } from 'next';
import { DomainLanding } from '@/components/marketing/domain-landing';

export const metadata: Metadata = {
  title: 'Cargo insurance — OrcaTrade Group',
  description:
    'ICC(A/B/C) cargo cover priced against your consignment. War and strikes endorsements where the route warrants it. Underwriter-network premiums, not retail rates.',
};

export default function InsurancePage() {
  return (
    <DomainLanding
      hero={{
        kicker: 'Cargo insurance',
        title: <>ICC clauses you can read, premiums priced against the route.</>,
        lead: "Marine cargo insurance is sold by every freight forwarder as a tickbox at booking — and most importers pay 20–40% over the underwriter rate without seeing the policy wording. We quote Institute Cargo Clauses (A / B / C) per consignment with the war-and-strikes endorsement called out separately, the exclusions surfaced in plain English, and the premium routed through our underwriter partners.",
        meta: 'ICC clauses · war + strikes endorsement separately · underwriter-network rates',
        ctas: [{ label: 'Get an insurance quote', href: '/start' }],
      }}
      steps={{
        label: 'How the cover gets sized',
        items: [
          { title: 'CIF value + 10%', body: 'Standard market practice: insured value = invoice + freight + 10% expected gross margin. The 10% is negotiable up to 20% on high-margin consumer goods.' },
          { title: 'Clauses A / B / C', body: 'A = all-risks (broadest). B = named perils (fire, collision, jettison, etc.). C = limited (major casualties only). The platform recommends per cargo profile.' },
          { title: 'War & strikes endorsement', body: 'A separate endorsement for war, strikes, riots, civil commotion. Required on pirate-risk waters and certain trade lanes; called out explicitly when relevant.' },
        ],
      }}
      scenarios={{
        label: 'When to upgrade or skip',
        items: [
          { badge: 'High-value electronics', title: 'Always ICC(A) + W&S', body: 'Phones, tablets, lithium batteries — high theft risk + high replacement cost. ICC(A) all-risks is the default. War & strikes added on any route crossing pirate-risk corridors.', variant: 'positive' },
          { badge: 'Bulk commodities', title: 'ICC(C) often sufficient', body: 'Steel, aluminium, raw chemicals — low per-unit theft incentive, large casualties are the real risk. C-clauses cover the catastrophic events without the premium of all-risks.' },
          { badge: 'Skip altogether', title: 'Low-value samples', body: 'Sub-€2k consignments where the premium + admin exceeds the salvage value. Document the decision and self-insure.' },
        ],
      }}
      closer={{
        label: 'Quote it with the shipment',
        title: 'Cargo insurance is line 5 of the landed-cost quote.',
        body: 'Run the wizard once; the insurance quote ships alongside duty, VAT, freight and brokerage. Underwriter premiums, not retail markup.',
        ctas: [{ label: 'Start the plan', href: '/start' }],
      }}
    />
  );
}
