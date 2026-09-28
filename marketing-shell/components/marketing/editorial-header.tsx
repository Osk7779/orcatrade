import { FadeUp } from './fade-up';

// Shared page opener for every non-homepage page: small eyebrow, one large
// centred title, a lead paragraph in secondary grey. Apple-style —
// whitespace and scale carry the hierarchy.
export function EditorialHeader({
  kicker,
  title,
  lead,
  meta,
}: {
  kicker?: string;
  title: React.ReactNode;
  lead?: React.ReactNode;
  meta?: React.ReactNode;
  aurora?: boolean;
}) {
  return (
    <section className="bg-[var(--color-ink)]">
      <FadeUp className="mx-auto max-w-[900px] px-6 pb-14 pt-20 text-center md:pb-20 md:pt-28">
        {kicker && <p className="eyebrow mb-4">{kicker}</p>}
        <h1 className="text-[clamp(2.2rem,4.6vw,3.75rem)] leading-[1.08] tracking-[-0.035em] text-[var(--color-ivory)]">
          {title}
        </h1>
        {lead && (
          <p className="mx-auto mt-6 max-w-[60ch] text-[clamp(1.05rem,1.4vw,1.3rem)] leading-[1.5] text-[var(--color-ivory-mute)]">
            {lead}
          </p>
        )}
        {meta && <p className="mt-6 text-[13px] text-[var(--color-ivory-mute)]">{meta}</p>}
      </FadeUp>
    </section>
  );
}
