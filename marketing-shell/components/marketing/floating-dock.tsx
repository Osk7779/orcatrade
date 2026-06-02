'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

// Floating dock pinned to the bottom-right edge of the viewport.
//
//   1. Index ☰ — only shown when the current page declares chapters via
//      <section id="..."> with matching entries in the registry, OR
//      auto-discovers any [data-chapter] elements. Opens a discrete
//      table of contents with scroll-spy.
//   2. Back to top ↑ — always available once the reader is past the hero.
//
// Page-aware: on routes without chapters, only the back-to-top affords.

// Homepage chapter registry. If we later add a per-route way to pass
// chapters from a page component, we can swap this out — but the
// auto-discovery in the effect below already handles new pages that use
// the same [data-chapter] convention.
const HOMEPAGE_CHAPTERS = [
  { id: 'manifesto', numeral: '0', label: 'On principle' },
  { id: 'platform', numeral: 'I', label: 'The composition' },
  { id: 'examples', numeral: 'II', label: 'Worked examples' },
  { id: 'pillars', numeral: 'III', label: 'Five stages' },
  { id: 'leadership', numeral: 'IV', label: 'Leadership' },
  { id: 'on-record', numeral: 'V', label: 'On record' },
  { id: 'news', numeral: 'VI', label: 'From the desk' },
];

interface Chapter {
  id: string;
  numeral: string;
  label: string;
}

export function FloatingDock() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);

  // Resolve which chapters to show on the current page. Prefer
  // data-chapter elements; fall back to the homepage registry only when
  // its ids resolve on the page.
  useEffect(() => {
    const dataChapters = Array.from(
      document.querySelectorAll<HTMLElement>('[data-chapter]'),
    ).map((el, i) => ({
      id: el.id,
      numeral:
        el.getAttribute('data-chapter-numeral') ?? toRoman(i + 1),
      label: el.getAttribute('data-chapter') ?? el.id,
    }));

    if (dataChapters.length) {
      setChapters(dataChapters);
      return;
    }

    const homepage = HOMEPAGE_CHAPTERS.filter((c) => document.getElementById(c.id));
    setChapters(homepage);
  }, []);

  // Show back-to-top once past the hero.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 600);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Scroll-spy across the resolved chapters.
  useEffect(() => {
    if (!chapters.length) return;
    const nodes = chapters
      .map((c) => ({ id: c.id, el: document.getElementById(c.id) }))
      .filter((c): c is { id: string; el: HTMLElement } => Boolean(c.el));
    if (!nodes.length) return;

    const onScroll = () => {
      const probe = window.scrollY + 180;
      let current = nodes[0].id;
      for (const { id, el } of nodes) {
        if (el.offsetTop <= probe) current = id;
      }
      setActive(current);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [chapters]);

  // Esc closes the panel.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const scrollToTop = () => window.scrollTo({ top: 0, behavior: 'smooth' });
  const scrollToId = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    const y = el.getBoundingClientRect().top + window.scrollY - 88;
    window.scrollTo({ top: y, behavior: 'smooth' });
    setOpen(false);
  };

  const hasChapters = chapters.length > 0;

  return (
    <>
      {hasChapters && (
        <div
          aria-hidden={!open}
          className={cn(
            'fixed bottom-[5.5rem] right-4 z-[70] origin-bottom-right transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] md:right-6',
            open
              ? 'pointer-events-auto translate-y-0 opacity-100'
              : 'pointer-events-none translate-y-3 opacity-0',
          )}
        >
          <div className="w-[18rem] border border-[var(--color-navy-line)] bg-[var(--color-ink)]/96 p-4 shadow-[0_24px_60px_rgba(0,0,0,0.55)] backdrop-blur-2xl">
            <div className="mb-3 flex items-baseline gap-2 px-2">
              <span aria-hidden className="font-serif text-[12px] text-[var(--color-ivory-dim)]/60">
                ❦
              </span>
              <span
                className="font-serif text-[12px] italic text-[var(--color-ivory-dim)]"
                style={{ fontVariationSettings: "'SOFT' 35, 'opsz' 144" }}
              >
                In this issue
              </span>
            </div>
            <ul className="flex flex-col">
              {chapters.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => scrollToId(c.id)}
                    className={cn(
                      'group flex w-full items-baseline gap-3 px-2 py-2 text-left transition-colors duration-300',
                      active === c.id
                        ? 'text-[var(--color-ivory)]'
                        : 'text-[var(--color-ivory-dim)] hover:text-[var(--color-ivory)]',
                    )}
                  >
                    <span
                      className={cn(
                        'w-6 shrink-0 font-serif text-[11px] italic',
                        active === c.id
                          ? 'text-[var(--color-ivory)]'
                          : 'text-[var(--color-ivory-mute)]',
                      )}
                    >
                      § {c.numeral}
                    </span>
                    <span
                      className="flex-1 font-serif text-[14px] italic leading-tight"
                      style={{ fontVariationSettings: "'SOFT' 35, 'opsz' 144" }}
                    >
                      {c.label}
                    </span>
                    <span
                      aria-hidden
                      className={cn(
                        'text-[11px] transition-opacity duration-300',
                        active === c.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-60',
                      )}
                    >
                      ↗
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <div className="fixed bottom-4 right-4 z-[70] flex flex-col gap-2 md:bottom-6 md:right-6">
        <DockButton ariaLabel="Back to top" onClick={scrollToTop} visible={scrolled}>
          <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
            <path
              d="M12 4 L12 20 M5 11 L12 4 L19 11"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </DockButton>

        {hasChapters && (
          <DockButton
            ariaLabel={open ? 'Close index' : 'Open index'}
            onClick={() => setOpen((p) => !p)}
            visible
            active={open}
          >
            {open ? (
              <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden>
                <line x1="2" y1="2" x2="14" y2="14" stroke="currentColor" strokeWidth="1.4" />
                <line x1="14" y1="2" x2="2" y2="14" stroke="currentColor" strokeWidth="1.4" />
              </svg>
            ) : (
              <svg viewBox="0 0 16 16" className="size-4" aria-hidden>
                <line x1="2" y1="4" x2="14" y2="4" stroke="currentColor" strokeWidth="1.2" />
                <line x1="2" y1="8" x2="14" y2="8" stroke="currentColor" strokeWidth="1.2" />
                <line x1="2" y1="12" x2="14" y2="12" stroke="currentColor" strokeWidth="1.2" />
              </svg>
            )}
          </DockButton>
        )}
      </div>
    </>
  );
}

function DockButton({
  children,
  onClick,
  ariaLabel,
  visible,
  active,
}: {
  children: React.ReactNode;
  onClick: () => void;
  ariaLabel: string;
  visible: boolean;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className={cn(
        'grid size-11 place-items-center border bg-[var(--color-ink)]/90 backdrop-blur-xl transition-all duration-500',
        active
          ? 'border-[var(--color-ivory-dim)] text-[var(--color-ivory)]'
          : 'border-[var(--color-navy-line)] text-[var(--color-ivory-dim)] hover:border-[var(--color-ivory-dim)]/70 hover:text-[var(--color-ivory)]',
        visible
          ? 'pointer-events-auto opacity-100'
          : 'pointer-events-none translate-y-2 opacity-0',
      )}
    >
      {children}
    </button>
  );
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
