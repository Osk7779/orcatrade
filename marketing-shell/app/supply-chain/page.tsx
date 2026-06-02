import type { Metadata } from 'next';
import { DomainLanding } from '@/components/marketing/domain-landing';

export const metadata: Metadata = {
  title: 'Supply chain — OrcaTrade Group',
  description:
    'End-to-end visibility from supplier ready-date through EU customs release. Exception queue for stuck shipments, not green dashboards.',
};

export default function SupplyChainPage() {
  return (
    <DomainLanding
      hero={{
        kicker: 'Supply chain',
        title: <>Visibility you can act on, not green dashboards.</>,
        lead: "Most supply-chain platforms paint everything green until the moment a shipment is genuinely stuck. We invert the priority: the dashboard shows exceptions first, normal flows second. Supplier ready-date variance, port congestion, customs hold, missing document — the things that actually move outcomes — surface at the top, not buried under shipment-tracking maps.",
        meta: 'Exception-first dashboard · port + customs + supplier signals',
        ctas: [{ label: 'See the dashboard', href: '/app/operations' }],
      }}
      steps={{
        label: 'Signals we surface',
        items: [
          { title: 'Supplier ready-date drift', body: 'Compare promised ready date against actual; alert on > 5-day slip. Predict downstream impact on the booked freight window.' },
          { title: 'Port congestion', body: 'Live-data overlay on origin + destination ports. A 4-day berth delay at Rotterdam shifts your inland-leg booking; flagged before the forwarder calls.' },
          { title: 'Customs hold', body: 'Broker reports an inspection or document request; surfaces on the dashboard within the hour with the document missing + the supplier contact for follow-up.' },
          { title: 'Compliance window closing', body: 'CBAM quarterly deadline approaching, EUDR DDS unfiled, REACH SVHC update due — calendar engine alerts at 30, 14, 7, 1 days out.' },
        ],
      }}
      closer={{
        label: 'Wire it up',
        title: 'Visibility starts with one plan saved.',
        body: 'Each saved plan generates the supplier + forwarder + broker contacts the dashboard polls. Add a plan; the exception queue begins.',
        ctas: [{ label: 'Build a plan', href: '/start' }],
      }}
    />
  );
}
