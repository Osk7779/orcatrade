import type { Metadata } from 'next';
import { ToolPage } from '@/components/marketing/tool-page';

export const metadata: Metadata = {
  title: 'Buyer verification — OrcaTrade Group',
  description:
    'Verify a European buyer before you ship. Sanctions screening, beneficial-owner check, VAT-number validation, and a credit-risk signal.',
};

export default function BuyerVerificationPage() {
  return (
    <ToolPage
      kicker="Tools · buyer verification"
      title={
        <>
          Verify a European buyer
          <br className="hidden md:block" /> before you ship.
        </>
      }
      lead="Sanctions screening against OFAC SDN, UK OFSI, the UN Security Council and the EU consolidated lists. VAT-number validation against the European VIES register. Beneficial-owner screening. Credit-risk signal where the buyer publishes accounts."
      meta="Free for the first three checks · sanctions-safe-by-design"
      inputLabel="Buyer company name or VAT number"
      inputPlaceholder="e.g. Volcano Trading GmbH or DE123456789"
      inputName="companyName"
      submitLabel="Run the verification"
      endpoint="/api/buyer-verification"
      whyTitle="Why verify"
      why="A European buyer with a sanctioned beneficial owner or an invalid VAT number can sit on a shipment in the bonded warehouse for weeks while the customs broker waits for clearance. The verification is cheap; the delay is not."
      steps={[
        {
          title: 'You submit the buyer name or VAT number.',
          body: 'No payment to submit. We rate-limit to keep the platform open without scraping.',
        },
        {
          title: 'We screen against four authoritative lists.',
          body: 'OFAC SDN, UK OFSI, the UN Security Council and the EU consolidated lists. Safe-by-design — the engine returns "no match" or "match", never "clear".',
        },
        {
          title: 'We validate the VAT number against VIES.',
          body: 'Live check against the EU VAT Information Exchange System. Mismatches flagged, with the canonical address on file when the registry returns one.',
        },
        {
          title: 'We surface beneficial-owner and credit signals.',
          body: 'Where the buyer publishes accounts. Credit signal is indicative — useful for prioritising follow-up, not a replacement for a credit insurer.',
        },
        {
          title: 'A founder follows up within one business day.',
          body: 'With the calculator-grounded report and the recommended next steps. If you want continuous monitoring, you can convert the report into a saved buyer profile in the cockpit.',
        },
      ]}
      closingTitle={<>Verify, then price the lane.</>}
      closingLead="A clean buyer-verification report is the first piece of the import plan. Build the rest in the Import Plan Builder."
    />
  );
}
