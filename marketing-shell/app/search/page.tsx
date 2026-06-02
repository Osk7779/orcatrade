import type { Metadata } from 'next';
import { PillarPage } from '@/components/marketing/pillar-page';

export const metadata: Metadata = {
  title: 'OrcaTrade Search — Find verified manufacturers',
  description:
    'Type any HS code, product, supplier or lane. Get every regime that touches it — duty, anti-dumping, CBAM, REACH, CE — with citations and confidence tiers.',
};

export default function SearchPage() {
  return (
    <PillarPage
      stageKicker="Stage 01 · Find it"
      title={
        <>
          OrcaTrade Search.
          <br className="hidden md:block" /> Type the lane. See every regime.
        </>
      }
      lead="The platform's entry point. Type an HS code, product name, supplier, or origin–destination lane. The search surfaces every duty, every preferential framework, every compliance regime that touches it — with chunk-level citations and confidence tiers on every claim."
      meta="Calculator-grounded · citations on every claim · always free to read"
      whatItDoesIntro="Search is how the platform meets you for the first time — and the surface every other stage routes back into."
      features={[
        {
          title: 'Search by anything that matters.',
          body: 'HS code (6, 8 or 10 digits), product description, supplier name, or origin → destination lane. The retrieval layer is hybrid pgvector + BM25, so it finds the regime even if you spelled the chapter differently.',
        },
        {
          title: 'Every regime, surfaced.',
          body: 'EU/UK duty, anti-dumping and CVD, CBAM, EUDR, REACH, CE family, GPSR, WEEE, PPWR — fourteen regulatory regimes today, all surfaced when the lane touches them.',
        },
        {
          title: 'Cited, never hallucinated.',
          body: 'Every regulatory claim carries a chunk identifier and a confidence tier. You can verify the source on every line. The LLM writes prose; the calculators move money.',
        },
        {
          title: 'Free to read, no email gate.',
          body: 'Search is open. No paywall, no email harvesting, no behavioural tracking. We earn the account when you decide to compose a plan, not before.',
        },
      ]}
      closingTitle={<>Find the regimes. Then price the lane.</>}
      closingLead="Search hands off to the Import Plan Builder the moment you want numbers. Same regulatory corpus, same calculators — the search becomes the brief."
    />
  );
}
