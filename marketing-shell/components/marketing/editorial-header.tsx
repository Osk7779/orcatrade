import { Aurora } from './aurora';
import { FadeUp } from './fade-up';

// Shared page-opening masthead. Every non-homepage editorial page starts
// with the same rhythm: a thin upper masthead row (issue / kicker), then
// a single confident Fraunces display title, then an italic-serif lead
// paragraph. Aurora optional. Matches the cadence of the homepage hero
// without competing with it.
export function EditorialHeader({
  kicker,
  title,
  lead,
  meta,
  aurora = true,
}: {
  kicker?: string;
  title: React.ReactNode;
  lead?: React.ReactNode;
  meta?: React.ReactNode;
  aurora?: boolean;
}) {
  return (
    <section className="relative isolate overflow-hidden border-b border-[var(--color-navy-line)] bg-[var(--color-ink)]">
      {aurora && <Aurora />}

      <div className="relative mx-auto max-w-[1100px] px-6 pt-24 pb-20 md:pt-32 md:pb-24">
        {kicker && (
          <FadeUp className="mb-10 flex items-center gap-4">
            <span className="h-px w-10 bg-[var(--color-ivory-dim)]/50" />
            <span
              aria-hidden
              className="font-serif text-[13px] text-[var(--color-ivory-dim)]/60"
            >
              ❦
            </span>
            <span className="font-serif text-[13px] italic text-[var(--color-ivory-mute)]">
              {kicker}
            </span>
          </FadeUp>
        )}

        <FadeUp delay={0.05}>
          <h1
            className="font-serif text-[clamp(2.6rem,5.4vw+0.4rem,4.6rem)] leading-[1.04] tracking-[-0.022em] text-[var(--color-ivory)]"
            style={{
              fontVariationSettings: "'SOFT' 35, 'opsz' 144",
              fontWeight: 550,
            }}
          >
            {title}
          </h1>
        </FadeUp>

        {lead && (
          <FadeUp delay={0.12} className="mt-8 max-w-[58ch]">
            <p
              className="font-serif text-[clamp(1.15rem,1.4vw+0.4rem,1.45rem)] italic leading-[1.55] text-[var(--color-ivory-dim)]"
              style={{ fontVariationSettings: "'SOFT' 35, 'opsz' 144" }}
            >
              {lead}
            </p>
          </FadeUp>
        )}

        {meta && (
          <FadeUp delay={0.2} className="mt-10 flex items-center gap-4">
            <span className="h-px w-8 bg-[var(--color-ivory-mute)]/40" />
            <span className="font-serif text-[13px] italic text-[var(--color-ivory-mute)]">
              {meta}
            </span>
          </FadeUp>
        )}
      </div>
    </section>
  );
}
