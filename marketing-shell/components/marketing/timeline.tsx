// Editorial dated-entry timeline. Each entry: date in Plex Mono tabular
// on the left, serif headline + body bullets on the right. Hairline grid
// between entries, focus-card dim on hover. Used by /changelog.
import { FadeUp } from './fade-up';

export interface TimelineEntry {
  date: string;
  kicker?: string;
  title: string;
  bullets?: string[];
  body?: string;
}

export function Timeline({ entries }: { entries: TimelineEntry[] }) {
  return (
    <ol className="grid grid-cols-1 gap-px border border-[var(--color-navy-line)] bg-[var(--color-navy-line)] [&>*]:transition-opacity [&>*]:duration-700 [&:has(>*:hover)>*:not(:hover)]:opacity-45">
      {entries.map((e, i) => (
        <li
          key={i}
          className="group bg-[var(--color-ink)] p-9 transition-colors duration-700 hover:bg-[var(--color-navy-soft)] md:p-12"
        >
          <FadeUp delay={Math.min(i * 0.04, 0.2)}>
            <div className="grid grid-cols-1 gap-6 md:grid-cols-[180px_1fr] md:gap-12">
              <div className="flex flex-col gap-2">
                <time className="font-mono text-[12.5px] font-medium tabular-nums text-[var(--color-ivory)]">
                  {e.date}
                </time>
                {e.kicker && (
                  <span className="font-serif text-[12.5px] italic text-[var(--color-ivory-mute)]">
                    {e.kicker}
                  </span>
                )}
              </div>
              <div className="flex flex-col gap-4">
                <h2
                  className="font-serif text-[clamp(1.5rem,2vw+0.4rem,2rem)] leading-[1.1] tracking-[-0.018em] text-[var(--color-ivory)]"
                  style={{ fontVariationSettings: "'SOFT' 35, 'opsz' 144", fontWeight: 550 }}
                >
                  {e.title}
                </h2>
                {e.body && (
                  <p className="max-w-[58ch] text-[14.5px] leading-[1.7] text-[var(--color-ivory-dim)]">
                    {e.body}
                  </p>
                )}
                {e.bullets && e.bullets.length > 0 && (
                  <ul className="mt-1 flex flex-col gap-2.5">
                    {e.bullets.map((b, j) => (
                      <li
                        key={j}
                        className="flex max-w-[60ch] gap-3 text-[14.5px] leading-[1.7] text-[var(--color-ivory-dim)]"
                      >
                        <span
                          aria-hidden
                          className="mt-2 size-[3px] shrink-0 rounded-full bg-[var(--color-ivory-mute)]/60"
                        />
                        <span>{b}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </FadeUp>
        </li>
      ))}
    </ol>
  );
}
