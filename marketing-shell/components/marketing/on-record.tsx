import { FadeUp } from './fade-up';

// Principles, not counts. Every card describes a discipline — calculator-
// grounded math, citations, sanctions sources, audit trail, live customs
// data, hybrid retrieval. The trust signal is the posture itself, not
// any number we could put on it.
const RECORDS = [
  {
    kicker: 'Determinism',
    title: 'Calculator-grounded, not estimated.',
    body:
      'Every number on this platform comes from a versioned, deterministic function — never an LLM. The AI layer writes prose; the calculators move money. The two are walled off in the codebase, and the wall is enforced by CI.',
  },
  {
    kicker: 'Provenance',
    title: 'Citations on every claim.',
    body:
      'Regulatory references carry chunk identifiers and confidence tiers. Every plan is stamped with the calculator version, the data-snapshot date, and the customs mode. You can reproduce any quote we wrote, on any date we wrote it.',
  },
  {
    kicker: 'Counterparty risk',
    title: 'Sanctions screened against four authoritative lists.',
    body:
      'Consolidated lists from OFAC SDN, UK OFSI, the United Nations Security Council, and the European Union. Safe by design: the engine returns "no match" — never "clear" — because absence of evidence is not evidence of absence.',
  },
  {
    kicker: 'Auditability',
    title: 'Hash-chained mutations.',
    body:
      'Every state change is hash-stamped over a GDPR-compatible projection — no raw personal data in the chain, so an erasure request never breaks the audit trail. The chain is exportable in one call and independently verifiable.',
  },
  {
    kicker: 'Live integrations',
    title: 'EU customs, in real time.',
    body:
      'Duty rates are fetched directly from the European customs database when a plan is composed. Warm-cached briefly for the same classification, never trusted past it. The same data the inspectors will use at the port.',
  },
  {
    kicker: 'Retrieval',
    title: 'Hybrid search across the regulatory corpus.',
    body:
      'Regulatory chunks indexed in Postgres with both vector embeddings and keyword search, fused with reciprocal-rank. Falls back to keyword retrieval if vectors are unavailable — and never fails open.',
  },
];

export function OnRecord() {
  return (
    <section
      id="on-record"
      className="border-b border-[var(--color-navy-line)] bg-[var(--color-ink)] py-20 md:py-32"
    >
      <div className="mx-auto max-w-[1280px] px-6">
        <FadeUp className="mx-auto mb-16 max-w-[760px] text-center">
          <h2
            className="font-serif text-[clamp(2.2rem,3.8vw+0.4rem,3.4rem)] leading-[1.08] tracking-[-0.022em] text-[var(--color-ivory)]"
            style={{ fontVariationSettings: "'SOFT' 35, 'opsz' 144" }}
          >
            On record.
          </h2>
          <p className="mx-auto mt-6 max-w-[60ch] font-serif text-[1.1rem] italic leading-[1.55] text-[var(--color-ivory-dim)]">
            How the platform is actually built. The posture we hold ourselves to —
            calculator-grounded, citation-checked, audit-chained.
          </p>
        </FadeUp>

        <div className="grid grid-cols-1 gap-px border border-[var(--color-navy-line)] bg-[var(--color-navy-line)] md:grid-cols-3 [&>*]:transition-opacity [&>*]:duration-700 [&:has(>*:hover)>*:not(:hover)]:opacity-45">
          {RECORDS.map((r) => (
            <article
              key={r.title}
              className="group flex flex-col gap-5 bg-[var(--color-ink)] p-9 transition-colors duration-700 hover:bg-[var(--color-navy-soft)] md:p-10"
            >
              <span className="font-serif text-[12px] italic text-[var(--color-ivory-mute)]">
                {r.kicker}
              </span>
              <h3
                className="font-serif text-[1.45rem] leading-[1.15] tracking-[-0.016em] text-[var(--color-ivory)]"
                style={{ fontVariationSettings: "'SOFT' 35, 'opsz' 144", fontWeight: 550 }}
              >
                {r.title}
              </h3>
              <p className="text-[14.5px] leading-[1.65] text-[var(--color-ivory-dim)]">
                {r.body}
              </p>
            </article>
          ))}
        </div>

        <div className="mt-10 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 font-serif text-[13px] italic text-[var(--color-ivory-mute)]">
          <span>Full disclosures at</span>
          <a
            href="/trust/"
            className="text-[var(--color-ivory)] transition-opacity duration-300 hover:opacity-70"
          >
            orcatrade.pl/trust
          </a>
          <span aria-hidden>·</span>
          <span>Honest about what we do not yet have</span>
        </div>
      </div>
    </section>
  );
}
