import Link from 'next/link';
import { EditorialHeader } from './editorial-header';
import { ChapterRule } from './chapter-rule';
import { FadeUp } from './fade-up';
import { Aurora } from './aurora';
import type { ReactNode } from 'react';

export interface PillarFeature {
  title: string;
  body: string;
}

export interface PillarStep {
  numeral: string;
  title: string;
  body: string;
}

export interface PillarPageProps {
  stageKicker: string;
  title: ReactNode;
  lead: string;
  meta?: string;
  flagship?: boolean;
  whatItDoesIntro: string;
  features: PillarFeature[];
  workflowIntro?: string;
  steps?: PillarStep[];
  closingTitle: ReactNode;
  closingLead: string;
}

export function PillarPage({
  stageKicker,
  title,
  lead,
  meta,
  flagship,
  whatItDoesIntro,
  features,
  workflowIntro,
  steps,
  closingTitle,
  closingLead,
}: PillarPageProps) {
  return (
    <>
      <EditorialHeader
        kicker={stageKicker}
        title={title}
        lead={lead}
        meta={meta}
      />

      <ChapterRule numeral="I" label="What it does" />

      <section
        id="capabilities"
        data-chapter="What it does"
        data-chapter-numeral="I"
        className="border-b border-[var(--color-navy-line)] bg-[var(--color-ink)] py-20 md:py-32"
      >
        <div className="mx-auto max-w-[1100px] px-6">
          <FadeUp className="mx-auto mb-14 max-w-[760px] text-center">
            <p
              className="font-serif text-[clamp(1.4rem,2vw+0.4rem,1.8rem)] italic leading-[1.4] text-[var(--color-ivory)]"
              style={{ fontVariationSettings: "'SOFT' 35, 'opsz' 144" }}
            >
              {whatItDoesIntro}
            </p>
          </FadeUp>

          <div className="grid grid-cols-1 gap-px border border-[var(--color-navy-line)] bg-[var(--color-navy-line)] md:grid-cols-2 [&>*]:transition-opacity [&>*]:duration-700 [&:has(>*:hover)>*:not(:hover)]:opacity-45">
            {features.map((f, i) => (
              <article
                key={f.title}
                className="group flex flex-col gap-4 bg-[var(--color-ink)] p-9 transition-colors duration-700 hover:bg-[var(--color-navy-soft)] md:p-10"
              >
                <span className="font-serif text-[12px] italic text-[var(--color-ivory-mute)]">
                  № {String(i + 1).padStart(2, '0')}
                </span>
                <h3
                  className="font-serif text-[1.4rem] leading-[1.15] tracking-[-0.016em] text-[var(--color-ivory)]"
                  style={{ fontVariationSettings: "'SOFT' 35, 'opsz' 144", fontWeight: 550 }}
                >
                  {f.title}
                </h3>
                <p className="text-[14.5px] leading-[1.65] text-[var(--color-ivory-dim)]">
                  {f.body}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {steps && steps.length > 0 && (
        <>
          <ChapterRule numeral="II" label="The workflow" />
          <section
            id="workflow"
            data-chapter="The workflow"
            data-chapter-numeral="II"
            className="border-b border-[var(--color-navy-line)] bg-[var(--color-ink)] py-20 md:py-32"
          >
            <div className="mx-auto max-w-[1100px] px-6">
              {workflowIntro && (
                <FadeUp className="mx-auto mb-14 max-w-[760px] text-center">
                  <p
                    className="font-serif text-[clamp(1.4rem,2vw+0.4rem,1.8rem)] italic leading-[1.4] text-[var(--color-ivory)]"
                    style={{ fontVariationSettings: "'SOFT' 35, 'opsz' 144" }}
                  >
                    {workflowIntro}
                  </p>
                </FadeUp>
              )}

              <ol className="flex flex-col gap-px border border-[var(--color-navy-line)] bg-[var(--color-navy-line)]">
                {steps.map((s) => (
                  <li
                    key={s.numeral}
                    className="group flex flex-col gap-4 bg-[var(--color-ink)] p-8 transition-colors duration-700 hover:bg-[var(--color-navy-soft)] md:flex-row md:items-baseline md:gap-10 md:p-10"
                  >
                    <span
                      className="shrink-0 font-serif text-[1.6rem] italic leading-none text-[var(--color-ivory)] md:w-[60px]"
                      style={{ fontVariationSettings: "'SOFT' 35, 'opsz' 144" }}
                    >
                      § {s.numeral}
                    </span>
                    <div className="flex-1">
                      <h3
                        className="font-serif text-[1.3rem] leading-[1.15] tracking-[-0.016em] text-[var(--color-ivory)]"
                        style={{
                          fontVariationSettings: "'SOFT' 35, 'opsz' 144",
                          fontWeight: 550,
                        }}
                      >
                        {s.title}
                      </h3>
                      <p className="mt-2 max-w-[58ch] text-[14.5px] leading-[1.65] text-[var(--color-ivory-dim)]">
                        {s.body}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </section>
        </>
      )}

      {/* Closing */}
      <section className="relative isolate overflow-hidden bg-[var(--color-ink)] py-24 md:py-36">
        <Aurora />
        <div className="relative mx-auto max-w-[860px] px-6 text-center">
          <FadeUp>
            <span className="font-serif text-[14px] italic text-[var(--color-ivory-dim)]">
              {flagship ? 'The flagship surface' : 'Ready when you are'}
            </span>
            <h2
              className="mx-auto mt-6 max-w-[22ch] font-serif text-[clamp(2.4rem,5vw+0.4rem,3.8rem)] leading-[1.05] tracking-[-0.024em] text-[var(--color-ivory)]"
              style={{
                fontVariationSettings: "'SOFT' 35, 'opsz' 144",
                fontWeight: 550,
              }}
            >
              {closingTitle}
            </h2>
            <p className="mx-auto mt-6 max-w-[58ch] text-[15.5px] leading-[1.78] text-[var(--color-ivory-dim)]">
              {closingLead}
            </p>
            <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/start"
                className="group inline-flex items-center gap-3 bg-[var(--color-ivory)] px-7 py-3.5 text-[12.5px] font-semibold text-[var(--color-ink)] transition-colors duration-500 hover:bg-white"
              >
                Build my import plan
                <span
                  aria-hidden
                  className="transition-transform duration-500 group-hover:translate-x-0.5"
                >
                  →
                </span>
              </Link>
              <Link
                href="/contact"
                className="inline-flex items-center gap-3 border border-[var(--color-navy-line)] px-7 py-3.5 text-[12.5px] font-medium text-[var(--color-ivory)] transition-all duration-500 hover:border-[var(--color-ivory-dim)] hover:bg-[var(--color-navy-soft)]"
              >
                Talk to a person
              </Link>
            </div>
          </FadeUp>
        </div>
      </section>
    </>
  );
}
