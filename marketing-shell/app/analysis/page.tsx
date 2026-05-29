import type { Metadata } from 'next';
import { ToolPage } from '@/components/marketing/tool-page';

export const metadata: Metadata = {
  title: 'Lane analysis — OrcaTrade Group',
  description:
    'Describe a lane (origin → destination, commodity, value). We compose a calculator-grounded analysis — duty, regimes, freight, working capital — and come back within one business day.',
};

export default function AnalysisPage() {
  return (
    <ToolPage
      kicker="Tools · lane analysis"
      title={
        <>
          Lane analysis,
          <br className="hidden md:block" /> brief to report.
        </>
      }
      lead="Describe a lane in one sentence. We compose the full calculator-grounded analysis — duty, every regime that touches it, freight, brokerage, warehousing, working capital and total cost of ownership — and send the report back within one business day."
      meta="Free for the first analysis · calculator-grounded · citations included"
      inputLabel="Describe the lane"
      inputPlaceholder="e.g. Apparel from Vietnam to Poland, 50,000 EUR per shipment, monthly"
      inputName="brief"
      submitLabel="Submit the brief"
      endpoint="/api/analysis"
      whyTitle="What you get"
      why="A complete written analysis of the lane — not a quote, not a sales pitch. We model the math, name the regimes, surface the carve-outs, and list the three decisions you need to make before booking."
      steps={[
        {
          title: 'You write the lane in one sentence.',
          body: 'Commodity, origin → destination, ballpark value, frequency. The agent fills in the rest from there.',
        },
        {
          title: 'We compose the plan against the calculators.',
          body: 'Duty by HS line, preferential origin where it applies, anti-dumping where it stacks, every regulatory regime triggered, freight per carrier class, brokerage and last-mile.',
        },
        {
          title: 'We layer the working-capital cycle.',
          body: 'Deposit → balance → freight → customs → first sale. The plan models the full cycle in days and in euros so the cash exposure is visible from the brief.',
        },
        {
          title: 'A founder reviews and reports back.',
          body: 'Within one business day. The report includes the calculator-grounded output, the citations, and the three decisions that drive the lane economics.',
        },
      ]}
      closingTitle={<>Analyse, then ship.</>}
      closingLead="The analysis is the brief that becomes the saved plan. The saved plan is the one the platform monitors for drift while you ship."
    />
  );
}
