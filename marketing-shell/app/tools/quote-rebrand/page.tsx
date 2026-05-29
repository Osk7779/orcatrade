import type { Metadata } from 'next';
import { EditorialHeader } from '@/components/marketing/editorial-header';
import { QuoteStudio } from '@/components/marketing/quote-studio';

export const metadata: Metadata = {
  title: 'Quote Studio — OrcaTrade Group',
  description:
    'Internal team tool. Supplier PDF in, OrcaTrade-branded quote PDF out. Margin folded silently. Team-only access.',
  robots: { index: false, follow: false },
};

export default function QuoteStudioPage() {
  return (
    <>
      <EditorialHeader
        kicker="Tools · internal · team-only"
        title="Quote Studio."
        lead="Drop a supplier PDF, rebrand it onto OrcaTrade letterhead, fold the margin silently into the per-line rate. The studio is gated to the operations team."
        meta="No customer email collected · supplier currency preserved · margin folded silently"
      />

      <QuoteStudio />
    </>
  );
}
