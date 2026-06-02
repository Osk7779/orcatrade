import type { Metadata } from 'next';
import { DomainLanding } from '@/components/marketing/domain-landing';

export const metadata: Metadata = {
  title: 'Routing — OrcaTrade Group',
  description:
    'Mode + lane + warehouse + insurance recommendation with a deterministic landed-cost quote. Bonded warehouse trade-offs surfaced explicitly.',
};

export default function RoutingPage() {
  return (
    <DomainLanding
      hero={{
        kicker: 'Routing',
        title: <>Cheapest reliable route within your window.</>,
        lead: "Sea, air, rail, road — picked against the deadline + cargo profile, not the cheapest line on a freight tariff. Lane prices come from our partner forwarder network refreshed quarterly; deadlines come from your input. The recommendation is a single answer with the math, not a multi-option table you have to choose between.",
        meta: 'Mode + lane priced against deadline · partner forwarder network',
        ctas: [
          { label: 'Get a routing quote', href: '/start' },
          { label: 'See pricing', href: '/pricing', variant: 'ghost' },
        ],
      }}
      steps={{
        label: 'How the recommendation is built',
        items: [
          { title: 'Cargo profile in', body: 'Weight / volume / unit value / FOB origin / target window / preferred Incoterm. The wizard captures these in one pass.' },
          { title: 'Mode + lane pricing', body: 'Sea (FCL / LCL), air (consolidated / direct), rail (China–Europe corridor), and road for short EU legs — each priced from the snapshot lane tariff plus the routing calculator overlay.' },
          { title: 'Single recommendation', body: 'One mode + lane chosen against the deadline. The reasoning + alternatives are visible but the platform takes a position, with the deterministic price.' },
        ],
      }}
      scenarios={{
        label: 'Three lane archetypes',
        items: [
          { badge: 'Sea FCL · standard', title: 'Containerised, 4–6 weeks, lowest €/cbm', body: 'For 20+ cbm consignments with > 5-week windows. Lane priced from origin port to destination port + inland delivery if required. Bonded warehouse trade-off surfaced if the goods sit > 30 days.' },
          { badge: 'Air consolidated', title: 'Urgent + light, 3–7 days', body: 'For sub-200 kg consumer electronics, samples, or any cargo where time-to-shelf compresses cost-of-capital math. Premium vs sea is itemised line-by-line.' },
          { badge: 'Rail · China-EU', title: 'Faster than sea, cheaper than air', body: 'Sub-20-day Xi\'an → Duisburg / Łódź corridor. Useful when the air premium is too steep but the sea window is too long. Capacity tightens in peak season — flagged in the quote.', variant: 'positive' },
        ],
      }}
      closer={{
        label: 'Run a quote',
        title: 'Real prices, not estimates.',
        body: 'The routing calculator outputs are pinned to the data snapshot the quote saved against. Open the plan six months later and the original lane price is still there, alongside the live one — drift surfaced explicitly.',
        ctas: [{ label: 'Start the wizard', href: '/start' }],
      }}
    />
  );
}
