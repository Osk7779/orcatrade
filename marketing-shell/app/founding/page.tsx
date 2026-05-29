import type { Metadata } from 'next';
import Link from 'next/link';
import { EditorialHeader } from '@/components/marketing/editorial-header';
import { ChapterRule } from '@/components/marketing/chapter-rule';
import { FadeUp } from '@/components/marketing/fade-up';

export const metadata: Metadata = {
  title: 'Founding 10 — OrcaTrade Group',
  description:
    'The first ten paying importers help us shape the platform and get founder pricing for the life of their account.',
};

const WHAT_YOU_GET = [
  {
    title: 'Founder pricing for life.',
    body:
      'Lifetime 50% off the Growth plan — €199/mo, not €399. The discount follows your account, not the calendar, even after we raise prices.',
  },
  {
    title: 'Your name on the homepage.',
    body:
      'Listed as a founding importer once you have shipped your first order through the platform. Optional — withdrawable at any time.',
  },
  {
    title: 'A founder Slack channel.',
    body:
      'Direct line to Jay and Oskar. We answer questions in hours, not days, and route the right operator to the right brief.',
  },
  {
    title: 'Three imports, hand-walked.',
    body:
      'We help you ship your first three imports without surprises — HS code, regimes, routing, compliance overlay, supplier brief.',
  },
];

const WHAT_WE_ASK = [
  {
    title: 'Real orders, not interviews.',
    body:
      'You are actually placing orders, somewhere between €50k and €500k each. The platform is built to take pressure, not generate demos.',
  },
  {
    title: 'Direct feedback.',
    body:
      'When something is wrong, you tell us within a day. When something is right, you tell us why. We change the platform on signal, not survey.',
  },
  {
    title: 'A case study, eventually.',
    body:
      'After three completed shipments, a 30-minute conversation we can publish — calibrated for what you are comfortable saying publicly.',
  },
];

const FAQ = [
  {
    q: 'How is this different from a normal customer?',
    a: 'Founder pricing for life, a direct line to founders, and the kind of attention only the first ten get. After that we move to a normal pricing tier.',
  },
  {
    q: 'How fast do I need to apply?',
    a: 'There are ten spots. When they are taken, they are taken. There is no payment to apply — we have a short conversation, then a short paid pilot.',
  },
  {
    q: 'What does the platform actually do?',
    a: 'Five stages of an import: Find it, Source it, Verify it (Intelligence), Ship it, Finance it. Every recommendation is calculator-grounded with citations.',
  },
  {
    q: 'What does it cost during the pilot?',
    a: 'The first pilot order is priced at cost on our side — we want to see the platform pay itself off on order one. From order two: lifetime 50% off Growth.',
  },
];

export default function FoundingPage() {
  return (
    <>
      <EditorialHeader
        kicker="Founding 10 · pilot programme"
        title={
          <>
            Build OrcaTrade with us.
            <br className="hidden md:block" /> Ten importers, lifetime founder pricing.
          </>
        }
        lead="The platform is real — eighteen calculators, live customs rates, anti-dumping and CVD database, five AI agents, working examples grounded in EU regulation citations. What it does not have yet is your name on the homepage. The first ten paying importers help us shape the product and get founder pricing for the life of their account."
        meta="No payment to apply · founder Slack channel · lifetime 50% off Growth"
      />

      <ChapterRule numeral="I" label="What you get" />

      <section
        id="what-you-get"
        data-chapter="What you get"
        data-chapter-numeral="I"
        className="border-b border-[var(--color-navy-line)] bg-[var(--color-ink)] py-20 md:py-32"
      >
        <div className="mx-auto max-w-[1100px] px-6">
          <div className="grid grid-cols-1 gap-px border border-[var(--color-navy-line)] bg-[var(--color-navy-line)] md:grid-cols-2 [&>*]:transition-opacity [&>*]:duration-700 [&:has(>*:hover)>*:not(:hover)]:opacity-45">
            {WHAT_YOU_GET.map((p, i) => (
              <Bullet key={p.title} {...p} numeral={`${i + 1}`} />
            ))}
          </div>
        </div>
      </section>

      <ChapterRule numeral="II" label="What we ask in return" />

      <section
        id="what-we-ask"
        data-chapter="What we ask"
        data-chapter-numeral="II"
        className="border-b border-[var(--color-navy-line)] bg-[var(--color-ink)] py-20 md:py-32"
      >
        <div className="mx-auto max-w-[1100px] px-6">
          <div className="grid grid-cols-1 gap-px border border-[var(--color-navy-line)] bg-[var(--color-navy-line)] md:grid-cols-3 [&>*]:transition-opacity [&>*]:duration-700 [&:has(>*:hover)>*:not(:hover)]:opacity-45">
            {WHAT_WE_ASK.map((p, i) => (
              <Bullet key={p.title} {...p} numeral={`${i + 1}`} />
            ))}
          </div>
        </div>
      </section>

      <ChapterRule numeral="III" label="Apply" />

      <section
        id="apply"
        data-chapter="Apply"
        data-chapter-numeral="III"
        className="border-b border-[var(--color-navy-line)] bg-[var(--color-ink)] py-24 md:py-36"
      >
        <div className="mx-auto max-w-[760px] px-6 text-center">
          <FadeUp>
            <h2
              className="font-serif text-[clamp(2rem,3.4vw+0.4rem,3rem)] leading-[1.06] tracking-[-0.02em] text-[var(--color-ivory)]"
              style={{ fontVariationSettings: "'SOFT' 35, 'opsz' 144", fontWeight: 550 }}
            >
              Apply for a Founding 10 spot.
            </h2>
            <p className="mx-auto mt-6 max-w-[58ch] font-serif text-[1.1rem] italic leading-[1.55] text-[var(--color-ivory-dim)]">
              Short conversation, no payment to apply. We come back within one
              business day.
            </p>
          </FadeUp>

          <FadeUp delay={0.1} className="mt-10 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/contact"
              className="group inline-flex items-center gap-3 bg-[var(--color-ivory)] px-7 py-3.5 text-[12.5px] font-semibold text-[var(--color-ink)] transition-colors duration-500 hover:bg-white"
            >
              Tell us about your next import
              <span
                aria-hidden
                className="transition-transform duration-500 group-hover:translate-x-0.5"
              >
                →
              </span>
            </Link>
            <a
              href="mailto:oskar@orcatradegroup.com"
              className="inline-flex items-center gap-3 border border-[var(--color-navy-line)] px-7 py-3.5 text-[12.5px] font-medium text-[var(--color-ivory)] transition-all duration-500 hover:border-[var(--color-ivory-dim)] hover:bg-[var(--color-navy-soft)]"
            >
              Email a founder
            </a>
          </FadeUp>
        </div>
      </section>

      <ChapterRule numeral="IV" label="Common questions" />

      <section
        id="faq"
        data-chapter="FAQ"
        data-chapter-numeral="IV"
        className="bg-[var(--color-ink)] py-20 md:py-32"
      >
        <div className="mx-auto max-w-[820px] px-6">
          <div className="flex flex-col gap-px bg-[var(--color-navy-line)]">
            {FAQ.map((item) => (
              <FadeUp key={item.q} className="bg-[var(--color-ink)] py-8">
                <h3
                  className="font-serif text-[1.3rem] leading-[1.2] tracking-[-0.016em] text-[var(--color-ivory)]"
                  style={{ fontVariationSettings: "'SOFT' 35, 'opsz' 144", fontWeight: 550 }}
                >
                  {item.q}
                </h3>
                <p className="mt-3 max-w-[58ch] text-[14.5px] leading-[1.65] text-[var(--color-ivory-dim)]">
                  {item.a}
                </p>
              </FadeUp>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}

function Bullet({
  title,
  body,
  numeral,
}: {
  title: string;
  body: string;
  numeral: string;
}) {
  return (
    <article className="group flex flex-col gap-4 bg-[var(--color-ink)] p-9 transition-colors duration-700 hover:bg-[var(--color-navy-soft)] md:p-10">
      <span className="font-serif text-[12px] italic text-[var(--color-ivory-mute)]">
        № {numeral}
      </span>
      <h3
        className="font-serif text-[1.4rem] leading-[1.15] tracking-[-0.016em] text-[var(--color-ivory)]"
        style={{ fontVariationSettings: "'SOFT' 35, 'opsz' 144", fontWeight: 550 }}
      >
        {title}
      </h3>
      <p className="text-[14.5px] leading-[1.65] text-[var(--color-ivory-dim)]">{body}</p>
    </article>
  );
}
