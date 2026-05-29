import Link from 'next/link';
import { ChapterRule } from './chapter-rule';
import { FadeUp } from './fade-up';

// Shared editorial template for deep guide pages. Numbered sections in
// a long-form column, "Related" links at the bottom, primary CTA back
// to the import plan builder. Same vocabulary as the homepage and
// hub indexes — no break in aesthetic across the site.

export interface GuideSection {
  title: string;
  body: React.ReactNode;
  bullets?: React.ReactNode[];
}

export interface RelatedGuide {
  href: string;
  title: string;
  kicker?: string;
}

export interface GuideArticleProps {
  body: GuideSection[];
  related?: RelatedGuide[];
  ctaHref?: string;
  ctaLabel?: string;
}

export function GuideArticle({
  body,
  related,
  ctaHref = '/start',
  ctaLabel = 'Build my import plan',
}: GuideArticleProps) {
  return (
    <>
      <section className="bg-[var(--color-ink)] py-20 md:py-28">
        <div className="mx-auto flex max-w-[820px] flex-col gap-16 px-6 md:gap-20">
          {body.map((s, i) => (
            <section
              key={i}
              id={slug(s.title)}
              data-chapter={s.title}
              data-chapter-numeral={toRoman(i + 1)}
              className="scroll-mt-28"
            >
              <FadeUp>
                <div className="flex items-baseline gap-4 border-b border-[var(--color-navy-line)] pb-4">
                  <span
                    className="font-serif text-[12.5px] italic text-[var(--color-ivory)]"
                    style={{ fontVariationSettings: "'SOFT' 35, 'opsz' 144" }}
                  >
                    § {toRoman(i + 1)}
                  </span>
                  <h2
                    className="font-serif text-[clamp(1.5rem,2vw+0.4rem,2rem)] leading-[1.1] tracking-[-0.02em] text-[var(--color-ivory)]"
                    style={{ fontVariationSettings: "'SOFT' 35, 'opsz' 144", fontWeight: 550 }}
                  >
                    {s.title}
                  </h2>
                </div>
                <div className="mt-7 flex max-w-[62ch] flex-col gap-5 text-[15px] leading-[1.75] text-[var(--color-ivory-dim)]">
                  {s.body}
                  {s.bullets && s.bullets.length > 0 && (
                    <ul className="mt-1 flex flex-col gap-2.5">
                      {s.bullets.map((b, j) => (
                        <li key={j} className="flex gap-3">
                          <span
                            aria-hidden
                            className="mt-2.5 size-[3px] shrink-0 rounded-full bg-[var(--color-ivory-mute)]/60"
                          />
                          <span>{b}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </FadeUp>
            </section>
          ))}
        </div>
      </section>

      <ChapterRule numeral="§" label="Take it further" />

      <section className="border-b border-[var(--color-navy-line)] bg-[var(--color-ink)] py-16 md:py-24">
        <div className="mx-auto max-w-[820px] px-6">
          <FadeUp>
            <div className="grid grid-cols-1 gap-px border border-[var(--color-navy-line)] bg-[var(--color-navy-line)] md:grid-cols-[1.4fr_1fr]">
              <Link
                href={ctaHref}
                className="group flex flex-col gap-3 bg-[var(--color-ink)] p-9 transition-colors duration-700 hover:bg-[var(--color-navy-soft)] md:p-10"
              >
                <span className="font-serif text-[12.5px] italic text-[var(--color-ivory-mute)]">
                  Apply it
                </span>
                <h3
                  className="font-serif text-[1.5rem] leading-[1.1] tracking-[-0.016em] text-[var(--color-ivory)]"
                  style={{
                    fontVariationSettings: "'SOFT' 35, 'opsz' 144",
                    fontWeight: 550,
                  }}
                >
                  {ctaLabel}
                </h3>
                <span className="font-serif text-[14px] italic text-[var(--color-ivory-dim)]">
                  Price your lane end-to-end. Same regime overlay, calculated
                  on your numbers.
                </span>
                <span className="mt-2 inline-flex items-center gap-2 text-[12.5px] font-medium text-[var(--color-ivory)]">
                  Open the builder
                  <span
                    aria-hidden
                    className="transition-transform duration-500 group-hover:translate-x-0.5"
                  >
                    →
                  </span>
                </span>
              </Link>

              <a
                href="/start"
                className="group flex flex-col gap-3 bg-[var(--color-ink)] p-9 transition-colors duration-700 hover:bg-[var(--color-navy-soft)] md:p-10"
              >
                <span className="font-serif text-[12.5px] italic text-[var(--color-ivory-mute)]">
                  Talk to us
                </span>
                <h3
                  className="font-serif text-[1.5rem] leading-[1.1] tracking-[-0.016em] text-[var(--color-ivory)]"
                  style={{
                    fontVariationSettings: "'SOFT' 35, 'opsz' 144",
                    fontWeight: 550,
                  }}
                >
                  Have a question on this regime?
                </h3>
                <span className="font-serif text-[14px] italic text-[var(--color-ivory-dim)]">
                  Send the brief to a founder. We come back within one business
                  day.
                </span>
                <span className="mt-2 inline-flex items-center gap-2 text-[12.5px] font-medium text-[var(--color-ivory)]">
                  Open the form
                  <span
                    aria-hidden
                    className="transition-transform duration-500 group-hover:translate-x-0.5"
                  >
                    →
                  </span>
                </span>
              </a>
            </div>
          </FadeUp>
        </div>
      </section>

      {related && related.length > 0 && (
        <section className="bg-[var(--color-ink)] py-16 md:py-24">
          <div className="mx-auto max-w-[1280px] px-6">
            <FadeUp className="mb-8 flex items-center gap-4">
              <span
                aria-hidden
                className="font-serif text-[13px] text-[var(--color-ivory-dim)]/60"
              >
                ❦
              </span>
              <span className="font-serif text-[13px] italic text-[var(--color-ivory-mute)]">
                Related guides
              </span>
            </FadeUp>
            <FadeUp delay={0.05}>
              <div className="grid grid-cols-1 gap-px border border-[var(--color-navy-line)] bg-[var(--color-navy-line)] md:grid-cols-3 [&>*]:transition-opacity [&>*]:duration-700 [&:has(>*:hover)>*:not(:hover)]:opacity-45">
                {related.map((r) => (
                  <Link
                    key={r.href}
                    href={r.href}
                    className="group flex flex-col gap-2 bg-[var(--color-ink)] p-7 transition-colors duration-700 hover:bg-[var(--color-navy-soft)] md:p-8"
                  >
                    {r.kicker && (
                      <span className="font-serif text-[12px] italic text-[var(--color-ivory-mute)]">
                        {r.kicker}
                      </span>
                    )}
                    <span
                      className="font-serif text-[1.15rem] leading-[1.15] tracking-[-0.014em] text-[var(--color-ivory)]"
                      style={{
                        fontVariationSettings: "'SOFT' 35, 'opsz' 144",
                        fontWeight: 550,
                      }}
                    >
                      {r.title}
                    </span>
                    <span className="mt-2 inline-flex items-center gap-1.5 text-[11.5px] font-medium text-[var(--color-ivory-dim)] opacity-60 transition-opacity duration-500 group-hover:opacity-100">
                      Read →
                    </span>
                  </Link>
                ))}
              </div>
            </FadeUp>
          </div>
        </section>
      )}
    </>
  );
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function toRoman(n: number): string {
  const map: [number, string][] = [
    [10, 'X'],
    [9, 'IX'],
    [5, 'V'],
    [4, 'IV'],
    [1, 'I'],
  ];
  let result = '';
  let remaining = n;
  for (const [v, s] of map) {
    while (remaining >= v) {
      result += s;
      remaining -= v;
    }
  }
  return result || 'I';
}
