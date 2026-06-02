// Long-form editorial column. Section headings carry a numeral + label
// (FT longform pattern), body paragraphs sit at 60ch / 15px / 1.75
// line-height for sustained reading. Used by /privacy and similar
// long-form documents.
import type { ReactNode } from 'react';
import { FadeUp } from './fade-up';

export interface LongFormSection {
  numeral: string;
  title: string;
  body: ReactNode;
  id?: string;
}

export function LongForm({
  sections,
}: {
  sections: LongFormSection[];
}) {
  return (
    <div className="mx-auto max-w-[820px] px-6">
      <div className="flex flex-col gap-16 md:gap-24">
        {sections.map((s) => (
          <section
            key={s.numeral}
            id={s.id ?? slug(s.title)}
            data-chapter={s.title}
            data-chapter-numeral={s.numeral}
            className="scroll-mt-28"
          >
            <FadeUp>
              <div className="flex items-baseline gap-4 border-b border-[var(--color-navy-line)] pb-4">
                <span
                  className="font-serif text-[12.5px] italic text-[var(--color-ivory)]"
                  style={{ fontVariationSettings: "'SOFT' 35, 'opsz' 144" }}
                >
                  § {s.numeral}
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
              </div>
            </FadeUp>
          </section>
        ))}
      </div>
    </div>
  );
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
