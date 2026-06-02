import type { Metadata } from 'next';
import { DomainLanding } from '@/components/marketing/domain-landing';

export const metadata: Metadata = {
  title: 'Warehouse — OrcaTrade Group',
  description:
    'Bonded and standard 3PL warehousing across the EU. Storage, picking, B2B onward delivery, and the cash-flow math that decides which one fits.',
};

export default function WarehousePage() {
  return (
    <DomainLanding
      hero={{
        kicker: 'Warehouse',
        title: <>Standard 3PL, bonded, or both — with the cash-flow math.</>,
        lead: "Warehousing is rarely just storage. The right answer depends on how long your goods sit, how often they ship out, and whether re-export is on the table. We coordinate partner 3PL and bonded sites in Hamburg, Rotterdam, Gdańsk, Warsaw, Frankfurt, Barcelona, Prague — picked per shipment, priced per cbm + per pick.",
        meta: 'Partner network · 7 European hubs · bonded + standard',
        ctas: [{ label: 'Get a warehouse quote', href: '/start' }],
      }}
      steps={{
        label: 'How the warehouse choice gets made',
        items: [
          { title: 'Time horizon', body: 'How long before the goods leave the facility — fast-mover (< 30 days), seasonal (30–180 days), long-tail (180+ days). Drives the storage vs cash-flow trade-off.' },
          { title: 'Re-export probability', body: 'If any portion will leave the EU again, bonded keeps duty + VAT unpaid until the final destination is known. Cash-flow lever for samples, returns, transit hubs.' },
          { title: 'Pick + pack profile', body: 'B2B pallet-pick beats e-commerce single-piece on per-order cost. Choice of partner depends on your volume + downstream channel.' },
        ],
      }}
      scenarios={{
        label: 'Three scenarios',
        items: [
          { badge: 'Standard 3PL', title: 'Fast-mover, EU-final', body: 'Goods cleared on arrival, delivered to a standard 3PL near the destination market. Per-pallet storage + per-order pick fee. Simplest setup.' },
          { badge: 'Bonded · re-export', title: 'Transit hub, samples, returns', body: 'Goods held under customs supervision; duty + VAT skipped on re-export. Bonded storage premium recovered many times over by the avoided duty.', variant: 'positive' },
          { badge: 'Bonded · cash-flow', title: 'Seasonal goods, 90+ day hold', body: 'Defer duty + VAT for the period the goods sit. The cost-of-capital benefit on €100k consignments + 6-month hold typically exceeds the bonded storage premium.', variant: 'positive' },
        ],
      }}
      closer={{
        label: 'Price your shipment',
        title: 'Storage cost + the cash-flow math, end to end.',
        ctas: [{ label: 'Start the plan', href: '/start' }],
      }}
    />
  );
}
