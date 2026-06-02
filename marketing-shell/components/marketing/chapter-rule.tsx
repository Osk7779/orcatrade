// Editorial chapter rule. Hairlines either side of a small label with a
// fleuron (❦) as the centerpiece — the dingbat is the class signal. Same
// glyph used in the manifesto closer, so the page has a single ornament
// language.
export function ChapterRule({
  numeral,
  label,
}: {
  numeral: string;
  label: string;
}) {
  return (
    <div className="bg-[var(--color-ink)]">
      <div className="mx-auto flex max-w-[1280px] items-center gap-5 px-6 py-12 md:gap-8 md:py-20">
        <span className="h-px flex-1 bg-[var(--color-navy-line)]" />
        <span className="flex items-baseline gap-3.5 font-serif text-[13px] italic text-[var(--color-ivory-dim)]">
          <span className="text-[var(--color-ivory)]">§ {numeral}</span>
          <span
            aria-hidden
            className="translate-y-[-1px] text-[15px] text-[var(--color-ivory-dim)]/65"
          >
            ❦
          </span>
          <span>{label}</span>
        </span>
        <span className="h-px flex-1 bg-[var(--color-navy-line)]" />
      </div>
    </div>
  );
}
