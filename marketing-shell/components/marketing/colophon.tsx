// Editorial colophon. Sits at the very bottom under the footer — the
// 'printed in' signature line a publication wraps its issue with. One
// final fleuron, one stamp of place and date.
export function Colophon() {
  return (
    <div className="border-t border-[var(--color-navy-line)] bg-[var(--color-ink)]">
      <div className="mx-auto flex max-w-[1320px] items-center justify-center gap-5 px-7 py-8 font-serif text-[12px] italic text-[var(--color-ivory-mute)] md:px-9">
        <span>Composed in London · Warsaw · Hong Kong</span>
        <span aria-hidden className="text-[var(--color-ivory-dim)]/50">❦</span>
        <span>OrcaTrade Group Ltd · MMXXVI</span>
      </div>
    </div>
  );
}
