import type { Metadata } from 'next';
import { PillarPage } from '@/components/marketing/pillar-page';

export const metadata: Metadata = {
  title: 'OrcaTrade Finance — Working capital, FX, total cost of ownership',
  description:
    'Working capital, FX hedging windows, total cost of ownership. Investor-grade actuals for orders of €50k–€500k.',
};

export default function FinancePage() {
  return (
    <PillarPage
      stageKicker="Stage 05 · Finance it"
      title={
        <>
          OrcaTrade Finance.
          <br className="hidden md:block" /> Working capital, end to end.
        </>
      }
      lead="The pillar that makes the lane bankable. Working capital, FX hedging windows, total cost of ownership — computed against the calculator-grounded plan, not estimated from a spreadsheet."
      meta="Order range €50k–€500k · in pilot · investor-grade actuals"
      whatItDoesIntro="Finance is where the platform graduates from operations advice to money math. We model the capital cycle, the FX exposure, and the total cost of the lane over its full life."
      features={[
        {
          title: 'Working capital cycle.',
          body: 'Deposit → balance → freight → customs → first sale. The plan models the full cycle in euros and in days, so you see when the cash is locked up and when it comes back.',
        },
        {
          title: 'FX hedging windows.',
          body: 'Supplier quotes in CNY or USD, balance due in 30 or 60 days, landed in EUR. The platform surfaces the hedge window and the basis-point sensitivity, so the FX desk sees the same plan you do.',
        },
        {
          title: 'Total cost of ownership.',
          body: 'Per-unit landed cost, blended duty rate, freight per kilogram, warehousing per pallet-month, last-mile per parcel. The output is the cost-to-serve, not the cost-to-import.',
        },
        {
          title: 'Investor-grade actuals.',
          body: 'Quoted landed cost vs receipt at port, on every saved plan. Drift surfaced quarterly. Calculator-grounded actuals — the same number for you, the auditor, the bank.',
        },
      ]}
      closingTitle={<>Make the lane bankable.</>}
      closingLead="Finance is in pilot. Working with the Founding 10 to ship the underwriting layer that turns the plan into a credit decision."
    />
  );
}
