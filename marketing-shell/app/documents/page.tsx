import type { Metadata } from 'next';
import { DomainLanding } from '@/components/marketing/domain-landing';

export const metadata: Metadata = {
  title: 'Document drafting — OrcaTrade Group',
  description:
    'CBAM filings, EUDR Due Diligence Statements, customs entries, supplier RFQs, LC applications — drafted from your inputs, approved by you, never auto-filed.',
};

export default function DocumentsPage() {
  return (
    <DomainLanding
      hero={{
        kicker: 'Document drafting',
        title: <>Drafts you approve. The platform never files.</>,
        lead: "Trade-compliance work is half analysis, half paperwork. Our document drafter takes the analysis you already have — the saved plan, the supplier brief, the customs value — and produces the underlying filing as a draft. You read, you approve or reject, the platform records the click. It does not file. Filing stays with you and your broker, by design.",
        meta: 'Draft → human approve → record · platform never files',
        ctas: [
          { label: 'See the drafter', href: '/app/drafts' },
          { label: 'Read the AI use position', href: '/trust#ai', variant: 'ghost' },
        ],
      }}
      steps={{
        label: 'Drafts the platform produces',
        items: [
          { title: 'CBAM quarterly report', body: 'Per CN-code embedded-emissions report with the verifier section pre-populated from your saved plan. Defaults marked + flagged separately from actual-data inputs.' },
          { title: 'EUDR Due Diligence Statement', body: 'DDS draft with the geolocation block stubbed for your supplier upload. Plot polygons + risk assessment pre-loaded from the country-risk overlay.' },
          { title: 'Customs entry (SAD-equivalent)', body: 'Pre-filled customs entry with the HS code, customs value, preferential origin claim, and AD/CVD line where applicable. Broker reviews + files.' },
          { title: 'Supplier RFQ email', body: 'Drafted in the supplier\'s language (CN / VN / TR / IN) with the spec, MOQ ask, lead-time ask, and the compliance certifications you need. Two-line cover, no slop.' },
          { title: 'LC application', body: 'Letter of Credit application drafted against your bank\'s template, with the technical clauses (latest shipment date, presentation period, document set) sized to the shipment.' },
        ],
      }}
      closer={{
        label: 'Approval workflow is the discipline',
        title: 'Every draft tracked from generated → approved or rejected.',
        body: 'The approve / reject click writes to the audit chain so a regulator or auditor can trace who signed off on which filing.',
        ctas: [{ label: 'See the trust posture', href: '/trust' }],
      }}
    />
  );
}
