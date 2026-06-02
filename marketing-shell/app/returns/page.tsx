import type { Metadata } from 'next';
import { DomainLanding } from '@/components/marketing/domain-landing';

export const metadata: Metadata = {
  title: 'Returns to Asia — OrcaTrade Group',
  description:
    'Defective or surplus stock back to the supplier — handled with duty-drawback claims, EUR1 documentation, and the cash-flow math.',
};

export default function ReturnsPage() {
  return (
    <DomainLanding
      hero={{
        kicker: 'Returns to Asia',
        title: <>Surplus or defective stock back to the supplier — without losing the duty.</>,
        lead: "Most importers eat the duty + VAT when goods go back to Asia. They do not have to. We handle returns via re-export (no duty / VAT paid if bonded), duty drawback (refund of duty already paid on goods now leaving the EU), or supplier consignment swap — picked per scenario, with the recovery math made explicit.",
        meta: 'Re-export · drawback · consignment swap',
        ctas: [{ label: 'Talk to us', href: '/contact' }],
      }}
      steps={{
        label: 'Three recovery routes',
        items: [
          { title: 'Re-export from bonded', body: 'If goods are still in bonded regime, re-export to the supplier skips duty and VAT entirely. Cleanest path when the defect is found on arrival.' },
          { title: 'Duty drawback', body: 'For goods already in free circulation: file a drawback claim within the customs-set window (typically 3 years EU). Refund of duty paid; VAT recoverable separately via the standard return process.' },
          { title: 'Consignment swap', body: 'Supplier ships replacement goods alongside accepting the return; duty + VAT applied to the net difference. Useful when the relationship justifies the goodwill on both sides.' },
        ],
      }}
      closer={{
        label: 'Recover what you paid',
        title: 'A returns file done right pays for itself many times over.',
        body: 'Send us the consignment + the defect + the supplier; we run the recovery math and file the paperwork.',
        ctas: [{ label: 'Contact us', href: '/contact' }],
      }}
    />
  );
}
