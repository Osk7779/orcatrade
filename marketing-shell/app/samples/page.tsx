import type { Metadata } from 'next';
import { DomainLanding } from '@/components/marketing/domain-landing';

export const metadata: Metadata = {
  title: 'Samples — OrcaTrade Group',
  description:
    'Sample shipments from Asia handled with the same compliance discipline as production orders. Consolidated, bonded-eligible, tracked.',
};

export default function SamplesPage() {
  return (
    <DomainLanding
      hero={{
        kicker: 'Samples',
        title: <>Samples are not orders — they are decisions.</>,
        lead: "A sample that arrives late, untracked, or with the wrong paperwork costs you the supplier you were vetting. We handle sample shipments from Asia consolidated through our HK desk, with the same compliance discipline as production orders — sub-€2k consignments under simplified declaration, CE / REACH paperwork prepared where applicable, optional bonded routing if the sample will be re-exported for evaluation.",
        meta: 'HK desk consolidation · simplified declaration · CE / REACH-aware',
        ctas: [{ label: 'Send a sample brief', href: '/contact' }],
      }}
      steps={{
        label: 'How a sample shipment lands',
        items: [
          { title: 'Supplier pickup', body: 'HK desk collects from the factory on a single day per week, charges per kg + per declaration. Photos + measured weight back within 24 hours.' },
          { title: 'Consolidation', body: 'Multiple suppliers in one consignment to keep per-unit freight reasonable. Each sample tagged + manifested separately for clean unpacking on arrival.' },
          { title: 'EU clearance', body: 'Simplified declaration for sub-€2k consignments. Full declaration above. CE / REACH paperwork prepared where the sample needs it for evaluation.' },
          { title: 'Delivery + re-export option', body: 'Standard delivery to your office, or bonded routing if the sample will leave the EU again (avoid duty + VAT on the re-export leg).' },
        ],
      }}
      closer={{
        label: 'Get a sample brief',
        title: 'Tell us what you are evaluating; we coordinate the rest.',
        ctas: [{ label: 'Contact us', href: '/contact' }],
      }}
    />
  );
}
