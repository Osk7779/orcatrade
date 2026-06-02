import type { Metadata } from 'next';
import { DomainLanding } from '@/components/marketing/domain-landing';

export const metadata: Metadata = {
  title: 'Compliance — OrcaTrade Group',
  description:
    'CBAM, EUDR, REACH, CE marking, anti-dumping & countervailing duties — per-shipment applicability, exposure math, ranked actions, every claim cited.',
};

export default function CompliancePage() {
  return (
    <DomainLanding
      hero={{
        kicker: 'Compliance',
        title: <>EU regulation, made navigable.</>,
        lead: "The five regimes that move money on import: CBAM (carbon border adjustment), EUDR (deforestation due diligence), REACH (chemical registration), CE marking (product-safety conformity), and AD/CVD (anti-dumping + countervailing duties). For each, the compliance agent tells you whether it applies to your shipment, what evidence you must collect from whom by when, what the financial exposure is, what the next concrete action is, and what is unknown that would change the answer.",
        meta: 'Five regimes · per-shipment · every claim cited to verbatim regulation',
        ctas: [
          { label: 'Run a free CBAM + EUDR analysis', href: '/analysis' },
          { label: 'See the compliance agent', href: '/agents', variant: 'ghost' },
        ],
      }}
      scenarios={{
        label: 'The five regimes',
        intro: 'Each is its own filing, its own evidence pack, its own deadline. The platform treats them as one workflow.',
        items: [
          { badge: 'CBAM', title: 'Carbon Border Adjustment Mechanism', body: 'In force since 2023, full enforcement 2026. Covered goods (cement, steel, aluminium, fertilisers, hydrogen, electricity) need quarterly embedded-emissions reports + certificate surrender. Default values + verifier mark-up vs actual data — the cost math differs sharply.', variant: 'positive' },
          { badge: 'EUDR', title: 'EU Deforestation Regulation', body: 'In force from 30 December 2025 (large operators), 30 June 2026 (SMEs). Covered commodities (coffee, cocoa, palm oil, soy, rubber, cattle, wood) need a Due Diligence Statement per consignment with plot-level geolocation. Penalties up to 4% of EU turnover.' },
          { badge: 'REACH', title: 'Chemicals registration', body: 'Importing > 1 tonne/year of a substance triggers registration. SVHC list updated semi-annually; ECHA notifications required above 0.1% w/w in articles. Only Representative option for non-EU suppliers.' },
          { badge: 'CE marking', title: 'Product-safety conformity', body: 'Importer takes on the conformity-assessment liability when the manufacturer is non-EU. Technical file, Declaration of Conformity, authorised representative — for LVD, EMC, RED, machinery, toys, PPE, cosmetics, medical devices.' },
          { badge: 'AD / CVD', title: 'Anti-dumping & countervailing', body: 'Active EU measures cover 45+ product/origin combinations. Rates can exceed 100% on top of MFN duty. The trade-defence database flags applicability at the HS6 + origin level before you commit to the supplier.' },
        ],
      }}
      closer={{
        label: 'Start with a free analysis',
        title: 'CBAM + EUDR brief on your actual cargo — citation-grounded.',
        body: 'Tell us what you import; the compliance engine runs both filters, surfaces applicability, exposure, evidence gaps, and ranked actions. No paywall on the first analysis.',
        ctas: [
          { label: 'Run the analysis', href: '/analysis' },
          { label: 'See pricing', href: '/pricing', variant: 'ghost' },
        ],
      }}
    />
  );
}
