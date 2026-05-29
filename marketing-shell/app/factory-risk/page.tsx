import type { Metadata } from 'next';
import { ToolPage } from '@/components/marketing/tool-page';

export const metadata: Metadata = {
  title: 'Factory risk — OrcaTrade Group',
  description:
    'Screen an Asian factory before the deposit. Sanctions, beneficial owners, EUDR readiness, forced-labour signals and trade-defence exposure.',
};

export default function FactoryRiskPage() {
  return (
    <ToolPage
      kicker="Tools · factory risk"
      title={
        <>
          Screen an Asian factory
          <br className="hidden md:block" /> before the deposit.
        </>
      }
      lead="Sanctions screening on the legal entity and beneficial owners. EUDR readiness check where the chapter applies. Forced-labour signal against the public Withhold Release Orders and the EU FLR. Trade-defence exposure on the HS lines the factory produces."
      meta="Free for the first three checks · indicative only"
      inputLabel="Factory legal name or registration number"
      inputPlaceholder="e.g. Shanghai Xinjie Manufacturing Co., Ltd"
      inputName="query"
      submitLabel="Run the factory check"
      endpoint="/api/factory-risk"
      whyTitle="Why screen"
      why="The deposit is the moment of leverage. A factory on the OFAC SDN, with a beneficial owner on the EU consolidated list, with an HS line that carries 70% anti-dumping — the brief should surface all three before the wire transfer clears."
      steps={[
        {
          title: 'You submit the factory legal name.',
          body: 'No payment to submit. The check is rate-limited so the public surface stays usable.',
        },
        {
          title: 'We screen against four sanctions lists.',
          body: 'OFAC SDN, UK OFSI, UN Security Council, EU consolidated. Beneficial owners where the registry exposes them.',
        },
        {
          title: 'We check EUDR readiness on the relevant chapters.',
          body: 'For commodities in EUDR scope, we surface whether the factory has historically supplied plot-level geolocation, the chain-of-custody evidence, and the supplier declarations the regulation requires.',
        },
        {
          title: 'We flag trade-defence exposure on the HS lines.',
          body: 'Anti-dumping or countervailing duties currently in force against the origin for the HS lines the factory produces. We list the rate and the carve-outs.',
        },
        {
          title: 'A founder follows up within one business day.',
          body: 'With the report and recommended next steps. If the factory passes, we can route the order into the Import Plan Builder; if not, we recommend an alternative origin in the same commodity class.',
        },
      ]}
      closingTitle={<>Screen the factory. Brief the lane.</>}
      closingLead="A clean factory-risk report is the foundation of a calculator-grounded supplier brief. Build the rest in the cockpit."
    />
  );
}
