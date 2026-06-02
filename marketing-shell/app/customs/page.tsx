import type { Metadata } from 'next';
import { DomainLanding } from '@/components/marketing/domain-landing';

export const metadata: Metadata = {
  title: 'Customs & bonded warehouse — OrcaTrade Group',
  description:
    'Standard clearance is the default. Bonded is the cash-flow lever nobody is showing you. TARIC-grounded duty + VAT + brokerage math, side-by-side with the bonded alternative.',
};

export default function CustomsPage() {
  return (
    <DomainLanding
      hero={{
        kicker: 'Customs & bonded · Tier 2',
        title: (
          <>
            Standard clearance is the default.
            <br className="hidden md:block" /> Bonded is the cash-flow lever nobody is showing you.
          </>
        ),
        lead: "Every importer pays duty + VAT + brokerage on day one of EU entry. Few realise bonded warehousing can defer that cash outflow for months — or, if goods are re-exported, avoid duty and VAT entirely. We compute both side-by-side, with TARIC chapter-level duty rates, all 27 EU national VAT rates, brokerage fees, and the bonded math (storage + bond fee + cost-of-capital benefit).",
        meta: 'TARIC-grounded · all 27 EU VAT rates · per-quote pinned for replay',
        ctas: [
          { label: 'Build an import plan', href: '/start' },
          { label: 'How bonded works', href: '#how', variant: 'ghost' },
        ],
      }}
      steps={{
        label: 'How bonded actually works',
        intro: 'Goods stored under customs supervision. Liability suspended. Two exit paths.',
        items: [
          { title: 'Goods enter EU under T1 transit', body: 'No duty or VAT on arrival. Goods move under customs supervision into an AEO-authorised bonded warehouse — a standard public bonded site or a partner facility we coordinate.' },
          { title: 'A bond is posted with customs', body: 'A financial guarantee covers the suspended duty + VAT liability. Typical fee is ~1.2% of customs value. The guarantee can be a partner bank facility (we arrange) or your own.' },
          { title: 'Goods can be stored indefinitely', body: 'EU customs warehousing has no statutory storage limit. Goods can be repackaged, relabelled (limited operations), and consolidated — but not modified, sold, or used while in bonded regime.' },
          { title: 'Two exit paths', body: 'Release into free circulation: duty + VAT paid at exit, at the rate in force on that day. Re-export: goods leave EU customs territory; duty and VAT are never paid. Bonded is the only legal way to skip both.' },
        ],
      }}
      scenarios={{
        label: 'When bonded beats standard clearance',
        items: [
          {
            badge: 'Re-export probable',
            title: 'Samples, returns, transit consolidation',
            body: 'If goods will leave the EU again — supplier returns, sample distribution to non-EU buyers, Asia-Africa transit — bonded re-export skips duty and VAT entirely. Savings usually exceed bonded fees by an order of magnitude.',
            bullets: ['Duty avoided in full', 'VAT avoided in full', 'Bonded storage €5–15 / cbm / month', '1.2% bond on customs value'],
            variant: 'positive',
          },
          {
            badge: 'Slow-moving stock',
            title: 'Seasonal goods, dead-stock SKUs',
            body: 'If goods sell over 90+ days, the cash-flow benefit of deferring duty + VAT compounds. At 6% cost of capital + €100k customs value, deferring six months frees €1,800 in working capital. That can exceed bonded fees on larger consignments.',
            variant: 'positive',
          },
          {
            badge: 'Standard wins',
            title: 'Fast-movers (sold < 30 days)',
            body: 'Goods clearing your books inside a month rarely benefit from bonded — storage and bond fees exceed any cash-flow benefit. Most retail and DTC importers default to standard for the bulk of stock and use bonded only on long-tail SKUs.',
          },
        ],
      }}
      closer={{
        label: 'See the math on your own shipment',
        title: 'Both routes priced side-by-side, in about sixty seconds.',
        body: 'The wizard captures the inputs once. The platform returns standard-clearance landed cost + the bonded alternative with the cash-flow break-even spelled out.',
        ctas: [
          { label: 'Build the plan', href: '/start' },
          { label: 'Read the reproducibility guarantee', href: '/trust#reproducibility', variant: 'ghost' },
        ],
      }}
    />
  );
}
