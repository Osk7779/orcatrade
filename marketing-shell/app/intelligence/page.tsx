import type { Metadata } from 'next';
import { PillarPage } from '@/components/marketing/pillar-page';

export const metadata: Metadata = {
  title: 'OrcaTrade Intelligence — The flagship · calculator-grounded compliance',
  description:
    'EU/UK customs, CBAM, EUDR, REACH, CE-marking, anti-dumping. Calculator-grounded compliance, not LLM guesses. Citations on every claim.',
};

export default function IntelligencePage() {
  return (
    <PillarPage
      flagship
      stageKicker="Stage 03 · Verify it · Flagship"
      title={
        <>
          OrcaTrade Intelligence.
          <br className="hidden md:block" /> The compliance brain.
        </>
      }
      lead="The platform's flagship surface. Fourteen regulatory regimes covered. Every duty rate, every anti-dumping measure, every CBAM declarant trigger surfaced from one calculator-grounded engine — with citations and confidence tiers on every claim."
      meta="14 regimes · 45,809 sanctions designations · live TARIC integration · audit-chained"
      whatItDoesIntro="Intelligence is what the brokers do, automated and made transparent. The math is in code; the prose is the explanation on top."
      features={[
        {
          title: 'Calculator-grounded, not estimated.',
          body: 'Every number on this surface comes from a versioned, deterministic function — never an LLM. The AI layer writes prose; the calculators move money. The two are walled off in the codebase and enforced by CI.',
        },
        {
          title: 'Citations on every claim.',
          body: 'Regulatory references carry chunk IDs and confidence tiers. Every plan is stamped with the calculator version, the data snapshot date, and the customs mode. You can reproduce any quote we wrote, on any date we wrote it.',
        },
        {
          title: 'Live customs integration.',
          body: 'Duty rates are fetched directly from the EU customs database when a plan is composed. Warm-cached briefly for the same classification, never trusted past that. The same data the inspectors will use at the port.',
        },
        {
          title: 'Sanctions screened, four lists.',
          body: 'Counterparties screened against OFAC SDN, UK OFSI, the UN Security Council and the European Union — consolidated lists, refreshed weekly. Safe by design — the engine returns "no match", never "clear".',
        },
        {
          title: 'Audit-chained mutations.',
          body: 'Every state change is hash-stamped over a GDPR-compatible projection — no raw personal data in the chain, so an erasure request never breaks the audit trail. Exportable in one call, independently verifiable.',
        },
        {
          title: 'Hybrid retrieval across the corpus.',
          body: 'Regulatory chunks indexed in Postgres with pgvector and BM25, fused with reciprocal rank. Voyage embeddings for the vector half. Degrades to keyword retrieval if vectors are unavailable.',
        },
      ]}
      toolsTitle="Open the tools"
      tools={[
        {
          eyebrow: 'Sanctions + EUDR + forced labour',
          title: 'Factory risk',
          desc: 'Score any Asian factory before the deposit. Sanctions, beneficial owners, EUDR readiness, forced-labour signals, trade-defence exposure.',
          href: '/factory-risk',
        },
        {
          eyebrow: 'Live shipment tracking',
          title: 'Supply chain',
          desc: 'Track every active shipment, port-by-port. Disruption forecasts, supplier risk, lane-level alerts. Composed from live carrier and port data.',
          href: '/supply-chain',
        },
        {
          eyebrow: 'CBAM · EUDR · REACH · CE',
          title: 'Compliance brief',
          desc: 'Lane-specific compliance report covering all 14 regimes. Free for the first run — calculator-grounded, citation-backed, queue-routed to a founder for review.',
          href: '/compliance',
        },
        {
          eyebrow: 'OFAC · OFSI · UN · EU',
          title: 'Buyer verification',
          desc: 'Verify a European buyer before you ship. Sanctions, beneficial owners, VAT validation against VIES, credit signals where the buyer publishes.',
          href: '/buyer-verification',
        },
        {
          eyebrow: 'One-line brief',
          title: 'Lane analysis',
          desc: 'Describe a lane in a sentence. We compose the calculator-grounded analysis — duty, regimes, freight, working capital — and reply within one business day.',
          href: '/analysis',
        },
        {
          eyebrow: 'TARIC · 45k designations · live',
          title: 'Build a plan',
          desc: 'Six-step wizard from product to landed cost. Outputs a full plan you can ship from — duty, every regime, freight, working capital, end to end.',
          href: '/start',
        },
      ]}
      closingTitle={<>The flagship, on principle.</>}
      closingLead="Intelligence is where we hold the line on calculator-grounded math. Investors and customers ask: how do we know the numbers? Because we wrote them down, we cited the source, and we will reproduce them on demand."
    />
  );
}
