// Shared page-opening masthead for cockpit pages. Italic-serif kicker +
// Fraunces 550 display title + optional italic-serif sub. Same rhythm as
// the marketing-shell EditorialHeader, scaled for in-app density.

import type { ReactNode } from 'react';

export function PageHeader({
  kicker,
  title,
  sub,
  meta,
  actions,
}: {
  kicker?: string;
  title: ReactNode;
  sub?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-10 flex flex-col gap-4 border-b border-[var(--color-navy-line)] pb-8 md:mb-12 md:pb-10">
      {kicker && (
        <div className="flex items-center gap-3">
          <span aria-hidden className="font-serif text-[12.5px] text-[var(--color-ivory-dim)]/55">
            ❦
          </span>
          <span className="font-serif text-[12.5px] italic text-[var(--color-ivory-mute)]">
            {kicker}
          </span>
        </div>
      )}
      <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between md:gap-10">
        <div className="flex flex-col gap-3">
          <h1
            className="font-serif text-[clamp(2rem,3.4vw+0.4rem,2.8rem)] leading-[1.06] tracking-[-0.022em] text-[var(--color-ivory)]"
            style={{ fontVariationSettings: "'SOFT' 35, 'opsz' 144", fontWeight: 550 }}
          >
            {title}
          </h1>
          {sub && (
            <p className="max-w-[64ch] font-serif text-[1rem] italic leading-[1.55] text-[var(--color-ivory-dim)]">
              {sub}
            </p>
          )}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-3">{actions}</div>}
      </div>
      {meta && (
        <div className="mt-2 flex items-center gap-3">
          <span aria-hidden className="h-px w-8 bg-[var(--color-ivory-mute)]/40" />
          <span className="font-serif text-[12.5px] italic text-[var(--color-ivory-mute)]">
            {meta}
          </span>
        </div>
      )}
    </header>
  );
}
