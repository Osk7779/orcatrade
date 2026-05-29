import type { Metadata } from 'next';
import { EditorialHeader } from '@/components/marketing/editorial-header';
import { Wizard } from '@/components/marketing/wizard';

export const metadata: Metadata = {
  title: 'Build your import plan — OrcaTrade Group',
  description:
    "Tell us what you're importing. We'll compose a calculator-grounded plan across sourcing, routing, customs, and warehousing — in about sixty seconds.",
};

export default function StartPage() {
  return (
    <>
      <EditorialHeader
        kicker="Import Plan Builder · about sixty seconds · free"
        title={
          <>
            Tell us what you&rsquo;re importing.
            <br className="hidden md:block" /> We&rsquo;ll compose the plan.
          </>
        }
        lead="A six-step brief — what, from where, to where, the numbers. We come back with the calculator-grounded plan: duty, every regime, freight, working capital, end to end."
        meta="No payment to apply · calculator-grounded, with citations"
      />

      <Wizard />
    </>
  );
}
