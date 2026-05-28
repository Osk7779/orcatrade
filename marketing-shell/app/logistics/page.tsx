import type { Metadata } from 'next';
import { PillarPage } from '@/components/marketing/pillar-page';

export const metadata: Metadata = {
  title: 'OrcaTrade Logistics — Lane routing, end-to-end pricing',
  description:
    'Sea and air lanes from Asia to Europe. 3PL coverage across DE, NL, PL, ES, IT, FR. Door-to-door priced end-to-end.',
};

export default function LogisticsPage() {
  return (
    <PillarPage
      stageKicker="Stage 04 · Ship it"
      title={
        <>
          OrcaTrade Logistics.
          <br className="hidden md:block" /> Quay to door, priced once.
        </>
      }
      lead="Sea and air lanes from six Asia origins to twenty-seven European markets. Customs windows, port fit, last-mile coverage — and the freight, brokerage and warehousing costs that turn a quoted landed cost into a real one."
      meta="5 origins × 6 destinations · sea and air · bonded options at six EU hubs"
      whatItDoesIntro="Logistics is what turns the plan from a price into a shipment. The platform routes the lane, books the freight, clears the customs window, and lands the goods in the right hub."
      features={[
        {
          title: 'Lane shape per origin × destination.',
          body: 'Sea-transit windows, container congestion, customs rhythm, port fit by cargo type. Thirty lane combinations modelled — a Chinese consumer-electronics order routes differently than a Turkish steel order, and we surface why.',
        },
        {
          title: 'Bonded options at six EU hubs.',
          body: 'Rotterdam, Hamburg, Frankfurt, Barcelona, Poznań, Prague. Each city sorted by what it does best — Frankfurt for air-cargo electronics, Poznań for inland distribution of Bangladesh apparel, Hamburg for rail into the Visegrád four.',
        },
        {
          title: 'End-to-end pricing, not piecewise.',
          body: 'Freight per kilogram, brokerage per declaration, warehousing per pallet-month, last-mile per parcel. The plan composes all four into one landed-cost number and re-prices it weekly against the live market.',
        },
        {
          title: 'Customs windows surfaced as constraints.',
          body: 'The destination customs house has a rhythm — clearance windows, language requirements, declarant authorisation. The plan flags the constraint before the booking goes out, not at the port.',
        },
      ]}
      closingTitle={<>Ship the lane you priced.</>}
      closingLead="Logistics is where the calculator-grounded plan becomes the booked container. The numbers you saw in Search are the numbers that arrive at the port."
    />
  );
}
