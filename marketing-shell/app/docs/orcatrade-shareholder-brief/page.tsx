import type { Metadata } from 'next';
import { EditorialHeader } from '@/components/marketing/editorial-header';
import { ChapterRule } from '@/components/marketing/chapter-rule';
import { LongForm, type LongFormSection } from '@/components/marketing/long-form';
import { FadeUp } from '@/components/marketing/fade-up';
import { NumberTicker } from '@/components/marketing/number-ticker';

export const metadata: Metadata = {
  title: 'Shareholder brief — OrcaTrade Group',
  description:
    'Investor-facing brief on OrcaTrade Group Ltd. What we have built, how it is built, where the data lives, and the ask.',
};

// Real platform-capability facts from the live shareholder brief.
// Engineering metrics (test counts, calculators, sanctions designations,
// languages) — not transaction counts. Numeric figures animate via the
// NumberTicker on scroll-into-view; static labels render as-is.
type Figure =
  | { kind: 'static'; text: string; label: string }
  | { kind: 'count'; value: number; label: string };

const FIGURES: Figure[] = [
  { kind: 'static', text: '5+1', label: 'AI agents · plus orchestrator' },
  { kind: 'count', value: 3018, label: 'Automated tests · all green' },
  { kind: 'count', value: 10, label: 'Deterministic calculators' },
  { kind: 'count', value: 45809, label: 'Live sanctions designations' },
  { kind: 'count', value: 4, label: 'Authoritative lists · OFAC · OFSI · UN · EU' },
  { kind: 'count', value: 3, label: 'Languages · EN · PL · DE' },
];

const BRIEF: LongFormSection[] = [
  {
    numeral: 'I',
    title: 'The business at a glance.',
    body: (
      <>
        <p>
          OrcaTrade is an AI-native trade-compliance and import-operations
          platform for European businesses sourcing from Asia. Five domains
          &mdash; search, sourcing, intelligence (compliance), logistics,
          finance &mdash; delivered as one platform that produces
          recommendations the user can trust, because every number is computed
          by audited code, never invented by a language model.
        </p>
        <p>
          The legal entity is OrcaTrade Group Ltd. Offices in London, Warsaw
          and Hong Kong. The platform is live in production; the company is in
          its pilot phase, building with the first ten paying importers.
        </p>
      </>
    ),
  },
  {
    numeral: 'II',
    title: 'What we have built.',
    body: (
      <>
        <p>
          <em>A trustworthy decision engine.</em> Ten deterministic calculators
          covering EU and UK customs and duty, anti-dumping and countervailing
          duties, preferential origin, CBAM, EUDR, REACH, CE marking, FX risk,
          freight routing, warehousing, working capital and total cost of
          ownership.
        </p>
        <p>
          <em>Six AI agents</em> &mdash; compliance, logistics, sourcing,
          finance, a meta-orchestrator, and a personal agent that reasons over
          the signed-in user&rsquo;s own data &mdash; that call the
          calculators as tools and write the prose on top, with citations.
        </p>
        <p>
          <em>A proactive monitoring agent</em> that watches every saved plan
          and flags cost drift, FX exposure, compliance deadlines and sanctions
          changes &mdash; automatically.
        </p>
        <p>
          <em>A durable data spine</em> on Postgres + Redis, with GDPR-grade
          privacy, a tamper-evident audit trail, and live denied-party
          screening against the OFAC, UK OFSI, UN Security Council and EU
          consolidated lists.
        </p>
      </>
    ),
  },
  {
    numeral: 'III',
    title: 'Calculator-grounded AI — why our numbers can be trusted.',
    body: (
      <>
        <p>
          The LLM never produces a number that drives a decision. Demand
          estimates, anomaly thresholds, duty rates, restock priorities,
          revenue share calculations &mdash; all deterministic, computed from
          data in code. The AI layer only produces natural-language summaries
          and explanations on top of pre-computed numerics.
        </p>
        <p>
          The discipline is enforced in the codebase, not promised in
          marketing. The Anthropic SDK is import-banned in any module that
          touches money math. The ban is checked by CI on every commit.
        </p>
        <p>
          Every plan we generate is stamped with the calculator version, the
          data-snapshot date, and the customs mode used. You can reproduce any
          quote we wrote, on any date we wrote it.
        </p>
      </>
    ),
  },
  {
    numeral: 'IV',
    title: 'How the platform is built.',
    body: (
      <>
        <p>
          Vercel for hosting and edge compute. Neon (managed Postgres) as the
          durable corpus. Upstash (managed Redis) for sessions and short-lived
          state. Resend for transactional email. Anthropic for inference.
          Voyage for vector embeddings. Sentry for error monitoring. A short
          list, chosen for what each vendor refuses to do as much as for what
          they do.
        </p>
        <p>
          The application is a Next.js shell sitting beside a single Vercel
          function that dispatches roughly fifty logical API endpoints to
          well-isolated handlers. Money math, AI calls, durable writes, and
          read paths are walled off from each other in the file structure and
          enforced by CI.
        </p>
      </>
    ),
  },
  {
    numeral: 'V',
    title: 'How and where we hold data.',
    body: (
      <>
        <p>
          <em>Tier 1 &mdash; Redis.</em> Sessions, magic-link tokens, cache
          preferences, rate-limit counters. Fast, ephemeral, short retention.
        </p>
        <p>
          <em>Tier 2 &mdash; Postgres.</em> The durable corpus: plans,
          portfolios, audit events, the regulatory index (BM25 plus pgvector),
          sanctions snapshots. Dual-written from the application boundary so
          recovery and replay are first-class.
        </p>
        <p>
          PII is hashed at the application boundary; audit chains are stamped
          over GDPR-compatible projections; erasure requests remove identity
          without breaking the chain.
        </p>
      </>
    ),
  },
  {
    numeral: 'VI',
    title: 'What we do not yet have.',
    body: (
      <>
        <p>
          SOC 2 Type II &mdash; not yet certified. ISO 27001 &mdash; not yet
          earned. A real-time freight feed &mdash; deferred until first paid
          year. A formal penetration-test cadence &mdash; annual once the
          pilot programme closes. Real customer revenue &mdash; we are in
          pilot, building with the Founding 10.
        </p>
        <p>
          This document will be updated when each of these moves. We will not
          claim certifications we have not earned.
        </p>
      </>
    ),
  },
  {
    numeral: 'VII',
    title: 'The ask.',
    body: (
      <>
        <p>
          Capital to finish the Founding 10 build-out and ship the next two
          pillars (Logistics live freight feed, Finance working-capital
          underwriting). Distribution to put the platform in front of the
          European businesses already sourcing fifty thousand to five hundred
          thousand euros at a time from Asia. Operating partners who have
          imported and know where the platform should hurt before it helps.
        </p>
        <p>
          Founder direct line:{' '}
          <a
            href="mailto:oskar@orcatradegroup.com"
            className="text-[var(--color-ivory)] underline-offset-4 hover:underline"
          >
            oskar@orcatradegroup.com
          </a>
          .
        </p>
      </>
    ),
  },
];

export default function ShareholderBriefPage() {
  return (
    <>
      <EditorialHeader
        kicker="Shareholder brief · MMXXVI"
        title="The business, the build, the ask."
        lead="A short brief for capital and distribution partners. Posture statements only. Platform-engineering metrics where we have them; honest about what we have not earned."
        meta="OrcaTrade Group Ltd · London · Warsaw · Hong Kong"
      />

      {/* Figures plate — real platform-capability metrics */}
      <section className="border-b border-[var(--color-navy-line)] bg-[var(--color-ink)] py-16 md:py-24">
        <div className="mx-auto max-w-[1280px] px-6">
          <FadeUp className="mb-10 flex items-baseline gap-4">
            <span aria-hidden className="font-serif text-[13px] text-[var(--color-ivory-dim)]/60">
              ❦
            </span>
            <span className="font-serif text-[13px] italic text-[var(--color-ivory-mute)]">
              Plate I &mdash; platform on record
            </span>
          </FadeUp>
          <div className="grid grid-cols-2 gap-px border border-[var(--color-navy-line)] bg-[var(--color-navy-line)] md:grid-cols-3">
            {FIGURES.map((f) => (
              <article
                key={f.label}
                className="flex flex-col gap-3 bg-[var(--color-ink)] p-8 md:p-10"
              >
                <div
                  className="font-serif text-[clamp(2.4rem,4vw,3.4rem)] leading-[0.95] tracking-[-0.026em] text-[var(--color-ivory)]"
                  style={{ fontVariationSettings: "'SOFT' 30, 'opsz' 144", fontWeight: 550 }}
                >
                  {f.kind === 'static' ? f.text : <NumberTicker value={f.value} />}
                </div>
                <div className="font-serif text-[13.5px] italic leading-[1.4] text-[var(--color-ivory-dim)]">
                  {f.label}
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <ChapterRule numeral="I" label="The brief" />

      <section className="bg-[var(--color-ink)] py-20 md:py-28">
        <LongForm sections={BRIEF} />
      </section>
    </>
  );
}
