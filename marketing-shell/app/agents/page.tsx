import type { Metadata } from 'next';
import Link from 'next/link';
import { EditorialHeader } from '@/components/marketing/editorial-header';
import { ChapterRule } from '@/components/marketing/chapter-rule';
import { FadeUp } from '@/components/marketing/fade-up';
import { Aurora } from '@/components/marketing/aurora';

export const metadata: Metadata = {
  title: 'The agents — Six tool-using AI agents over one calculator-grounded engine',
  description:
    'Five customer-facing agents (compliance, sourcing, logistics, finance, orchestrator) plus a personal agent that reasons over the signed-in user’s own data. Each one calls the calculators as tools and writes prose on top.',
};

const AGENTS = [
  {
    numeral: 'I',
    name: 'Compliance',
    role: 'EU and UK regulatory reasoning',
    body: 'Routes regulatory questions through the hybrid RAG corpus and the compliance calculators. Surfaces the regime, the article, the implementing dates and the carve-outs — with chunk citations on every claim. Uses the live customs and sanctions datasets as tools, never as paraphrase.',
    tools: [
      'searchRegulations',
      'getComplianceCalendar',
      'extractDocumentFields',
      'auditDocument',
      'determineRulesOfOrigin',
      'screenCounterparty',
    ],
  },
  {
    numeral: 'II',
    name: 'Sourcing',
    role: 'Supplier brief and origin assessment',
    body: 'Reasons over the eight commodity briefs and the six Asia origins. Calls the preferential-origin engine to surface framework qualification, the trade-defence database to flag stacked duties, and the sanctions screen against beneficial owners before recommending a shortlist.',
    tools: ['preferentialOrigin', 'searchRegulations', 'screenCounterparty'],
  },
  {
    numeral: 'III',
    name: 'Logistics',
    role: 'Routing, freight, port fit',
    body: 'Knows the lane shape across thirty origin × destination combinations, the bonded options at six EU hubs, and the transit windows by carrier class. Calls the freight calculator and the customs-procedure engine, then surfaces the lane that fits the cargo.',
    tools: ['searchRegulations', 'getApplicableRegimes'],
  },
  {
    numeral: 'IV',
    name: 'Finance',
    role: 'Working capital, FX, total cost of ownership',
    body: 'Reasons over the calculator-grounded landed-cost math, the FX hedge windows from the live market, and the working-capital cycle for the lane. Surfaces the cash-locked window in days and the basis-point sensitivity in euros.',
    tools: ['searchRegulations'],
  },
  {
    numeral: 'V',
    name: 'Orchestrator',
    role: 'Routes the question to the right specialist',
    body: 'A meta-agent that decomposes the question into specialist sub-questions, delegates to compliance, sourcing, logistics or finance as needed, and merges the findings into a single calculator-grounded answer. Twenty-seven tools across the four specialists plus its own routing tools.',
    tools: ['planDelegation', 'mergeSpecialistFindings', '...all twenty-seven specialist tools'],
  },
  {
    numeral: 'VI',
    name: 'Personal agent',
    role: 'Reasons over the signed-in user’s own data',
    body: 'A separate agent confined to the signed-in user’s saved plans, portfolios, monitoring alerts, compliance deadlines and agent memory. Eight personal tools — recallMemory, rememberForUser, forgetForUser, getMyComplianceDeadlines, plus the orchestrator’s read-only set.',
    tools: [
      'recallMemory',
      'rememberForUser',
      'forgetForUser',
      'getMyComplianceDeadlines',
      'getMyPlans',
      'getMyPortfolios',
      'getMyAlerts',
      'getMyCalendar',
    ],
  },
];

export default function AgentsPage() {
  return (
    <>
      <EditorialHeader
        kicker="The agents"
        title={
          <>
            Six tool-using agents.
            <br className="hidden md:block" /> One calculator-grounded engine.
          </>
        }
        lead="Five customer-facing agents plus a personal one. Each agent calls the calculators as tools and writes the prose on top, with citations. The LLM never produces a number that drives a decision — that wall is enforced by CI."
        meta="Powered by Claude Opus 4.7 · prompt-caching across the conversation · graceful degradation"
      />

      <section className="border-b border-[var(--color-navy-line)] bg-[var(--color-ink)] py-20 md:py-28">
        <div className="mx-auto max-w-[1100px] px-6">
          <FadeUp className="mx-auto mb-14 max-w-[760px] text-center">
            <p
              className="font-serif text-[clamp(1.4rem,2vw+0.4rem,1.8rem)] italic leading-[1.4] text-[var(--color-ivory)]"
              style={{ fontVariationSettings: "'SOFT' 35, 'opsz' 144" }}
            >
              Each agent is a tool-use loop, not a sampling machine. The tools do the
              math; the agent writes the explanation.
            </p>
          </FadeUp>

          <div className="grid grid-cols-1 gap-px border border-[var(--color-navy-line)] bg-[var(--color-navy-line)] md:grid-cols-2 [&>*]:transition-opacity [&>*]:duration-700 [&:has(>*:hover)>*:not(:hover)]:opacity-45">
            {AGENTS.map((a) => (
              <article
                key={a.numeral}
                className="group flex flex-col gap-5 bg-[var(--color-ink)] p-8 transition-colors duration-700 hover:bg-[var(--color-navy-soft)] md:p-10"
              >
                <div className="flex items-baseline gap-3">
                  <span
                    className="font-serif text-[1.6rem] italic leading-none text-[var(--color-ivory)]"
                    style={{ fontVariationSettings: "'SOFT' 35, 'opsz' 144" }}
                  >
                    § {a.numeral}
                  </span>
                  <h2
                    className="font-serif text-[1.6rem] leading-[1.1] tracking-[-0.018em] text-[var(--color-ivory)]"
                    style={{
                      fontVariationSettings: "'SOFT' 35, 'opsz' 144",
                      fontWeight: 550,
                    }}
                  >
                    {a.name}
                  </h2>
                </div>
                <span className="font-serif text-[13px] italic text-[var(--color-ivory-mute)]">
                  {a.role}
                </span>
                <p className="text-[14.5px] leading-[1.65] text-[var(--color-ivory-dim)]">
                  {a.body}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {a.tools.map((t) => (
                    <span
                      key={t}
                      className="inline-flex items-center bg-[var(--color-navy-soft)] px-2 py-0.5 font-mono text-[10.5px] font-medium tracking-tight text-[var(--color-ivory-dim)]"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <ChapterRule numeral="§" label="Discipline" />

      <section
        id="discipline"
        data-chapter="Discipline"
        className="border-b border-[var(--color-navy-line)] bg-[var(--color-ink)] py-20 md:py-28"
      >
        <div className="mx-auto max-w-[820px] px-6">
          <FadeUp>
            <h2
              className="font-serif text-[clamp(1.8rem,2.6vw+0.4rem,2.4rem)] leading-[1.1] tracking-[-0.02em] text-[var(--color-ivory)]"
              style={{ fontVariationSettings: "'SOFT' 35, 'opsz' 144", fontWeight: 550 }}
            >
              The discipline that makes the agents safe.
            </h2>
            <div className="mt-7 flex flex-col gap-5 text-[15px] leading-[1.75] text-[var(--color-ivory-dim)]">
              <p>
                Every agent calls calculators as tools. The Anthropic SDK is
                import-banned in any module that touches money math — the ban is
                checked by CI on every commit.
              </p>
              <p>
                Every regulatory claim cites the chunk identifier it came from, with
                a confidence tier. Every plan is stamped with the calculator version,
                the data-snapshot date and the customs mode used — reproducible on
                any past date.
              </p>
              <p>
                Every irreversible action (delete, surrender, file) calls{' '}
                <code className="font-mono text-[14px]">requestHumanReview</code>{' '}
                before executing. The agent recommends; the human commits.
              </p>
            </div>
          </FadeUp>
        </div>
      </section>

      {/* Closing */}
      <section className="relative isolate overflow-hidden bg-[var(--color-ink)] py-24 md:py-36">
        <Aurora />
        <div className="relative mx-auto max-w-[860px] px-6 text-center">
          <FadeUp>
            <span className="font-serif text-[14px] italic text-[var(--color-ivory-dim)]">
              Ask the orchestrator
            </span>
            <h2
              className="mx-auto mt-6 max-w-[22ch] font-serif text-[clamp(2.4rem,5vw+0.4rem,3.8rem)] leading-[1.05] tracking-[-0.024em] text-[var(--color-ivory)]"
              style={{ fontVariationSettings: "'SOFT' 35, 'opsz' 144", fontWeight: 550 }}
            >
              The agent is in the cockpit.
            </h2>
            <p className="mx-auto mt-6 max-w-[58ch] text-[15.5px] leading-[1.78] text-[var(--color-ivory-dim)]">
              Available behind sign-in at the Ask-the-agent surface in the cockpit. Same
              calculators, same RAG corpus, same audit chain — for your saved plans and
              portfolios.
            </p>
            <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/app/chat"
                className="group inline-flex items-center gap-3 bg-[var(--color-ivory)] px-7 py-3.5 text-[12.5px] font-semibold text-[var(--color-ink)] transition-colors duration-500 hover:bg-white"
              >
                Open Ask the agent
                <span
                  aria-hidden
                  className="transition-transform duration-500 group-hover:translate-x-0.5"
                >
                  →
                </span>
              </Link>
              <Link
                href="/intelligence"
                className="inline-flex items-center gap-3 border border-[var(--color-navy-line)] px-7 py-3.5 text-[12.5px] font-medium text-[var(--color-ivory)] transition-all duration-500 hover:border-[var(--color-ivory-dim)] hover:bg-[var(--color-navy-soft)]"
              >
                Read about the flagship
              </Link>
            </div>
          </FadeUp>
        </div>
      </section>
    </>
  );
}
