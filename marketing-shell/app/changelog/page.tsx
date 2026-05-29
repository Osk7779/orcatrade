import type { Metadata } from 'next';
import { EditorialHeader } from '@/components/marketing/editorial-header';
import { Timeline, type TimelineEntry } from '@/components/marketing/timeline';

export const metadata: Metadata = {
  title: 'Changelog — OrcaTrade Group',
  description:
    "What we've shipped on the platform. Engineering log, dated, in order.",
};

// Real release notes from the live OrcaTrade.pl changelog and the
// project memory. Newest first. Bullets describe what landed, in
// posture-statement language — no fabricated numbers.
const ENTRIES: TimelineEntry[] = [
  {
    date: '2026-05-27 · 28',
    kicker: 'Enterprise',
    title: 'Enterprise access, end-to-end reproducibility, in-app agent.',
    bullets: [
      'Enterprise plan with SSO scaffolding, audit-chain export, dedicated retention windows.',
      'Provenance stamping across every plan — calculator version, data-snapshot date, customs mode — for replay on any past date.',
      'The personal agent moved into the authenticated app shell at /app/dashboard, with eight tools reasoning over the signed-in user’s own portfolio.',
    ],
  },
  {
    date: '2026-05-25',
    kicker: 'Compliance',
    title: 'Sanctions screening — four authoritative lists, live.',
    bullets: [
      'Consolidated lists from OFAC SDN, UK OFSI, the United Nations Security Council, and the European Union — refreshed by cron, never trusted past the refresh window.',
      'Safe-by-design engine: returns "no match" or "match" — never "clear". Absence of evidence is not evidence of absence.',
      'POST /api/screen exposes the same engine for ad-hoc counterparty checks.',
    ],
  },
  {
    date: '2026-05-25',
    kicker: 'Retrieval',
    title: 'Hybrid RAG over the regulatory corpus.',
    bullets: [
      'Regulatory chunks indexed in Postgres with pgvector plus BM25, fused with reciprocal-rank.',
      'Voyage embeddings for the vector half. Degrades to keyword retrieval if vectors are unavailable.',
      'Five customer-facing agents and the orchestrator now ride the hybrid retriever, with awaited tool loops.',
    ],
  },
  {
    date: '2026-05-25',
    kicker: 'Auditability',
    title: 'Hash-chained mutations.',
    bullets: [
      'Every state change is hash-stamped over a GDPR-compatible projection — no raw personal data in the chain.',
      'Erasure requests remove the identity but not the events. The audit trail and the right to be forgotten coexist.',
      'GET /api/audit?format=chain returns a one-call exportable, independently verifiable chain.',
    ],
  },
  {
    date: '2026-05-25',
    kicker: 'Compliance',
    title: 'Compliance obligations tracker.',
    bullets: [
      'Calendar engine for CBAM, EUDR, REACH and CE-marking deadlines per portfolio — never an LLM-made deadline.',
      'Weekly digest mail with a per-user unsubscribe stream parameter.',
      'getMyComplianceDeadlines exposed as a personal-agent tool.',
    ],
  },
  {
    date: '2026-05-22',
    kicker: 'Foundations',
    title: 'Calculator-grounded money core.',
    bullets: [
      'Integer-cents arithmetic across every calculator — no JavaScript float on money.',
      'Reality-check actuals: quoted landed cost compared with the receipt at port, drift surfaced on the plan.',
      'API v1 contract frozen. Trade-defence database covering forty-five active regimes.',
    ],
  },
];

export default function ChangelogPage() {
  return (
    <>
      <EditorialHeader
        kicker="Changelog"
        title={
          <>
            What we&rsquo;ve shipped on the platform.
            <br className="hidden md:block" /> Engineering log, in order.
          </>
        }
        lead="Posture statements, not press releases. Each entry describes what the platform does today after the change landed — calculator-grounded, citation-checked, in production."
        meta="Newest first · all entries refer to deployed work"
      />

      <section className="bg-[var(--color-ink)] py-20 md:py-32">
        <div className="mx-auto max-w-[1200px] px-6">
          <Timeline entries={ENTRIES} />
        </div>
      </section>
    </>
  );
}
