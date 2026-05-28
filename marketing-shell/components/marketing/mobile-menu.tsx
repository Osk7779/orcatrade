'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { TimezoneClocks } from './timezone-clocks';

const NAV = [
  { href: '/#platform', label: 'Platform' },
  { href: '/tools/quote-rebrand/', label: 'Tools' },
  { href: '/#examples', label: 'Examples' },
  { href: '/#leadership', label: 'Team' },
  { href: '/#news', label: 'News' },
];

export function MobileMenu() {
  const [open, setOpen] = useState(false);

  // Lock body scroll while panel is open, restore on close/unmount.
  useEffect(() => {
    if (open) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = prev;
      };
    }
  }, [open]);

  // Escape closes the panel.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      {/* Trigger — two hairline rules, no rounding. Reads as 'this is a menu,
          not a button.' */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        aria-expanded={open}
        className="flex size-9 flex-col items-center justify-center gap-[5px] md:hidden"
      >
        <span className="block h-px w-6 bg-[var(--color-ivory)]" />
        <span className="block h-px w-6 bg-[var(--color-ivory)]" />
      </button>

      {/* Panel — full screen, dark ink, generous editorial typography. */}
      {open && (
        <div
          className="fixed inset-0 z-[100] flex flex-col bg-[var(--color-ink)]/97 backdrop-blur-2xl md:hidden"
          role="dialog"
          aria-modal="true"
        >
          {/* Top row mirrors the masthead so the close stays inside the same frame */}
          <div className="flex h-[72px] items-center justify-between border-b border-[var(--color-navy-line)] px-7">
            <Link
              href="/"
              onClick={() => setOpen(false)}
              className="flex items-baseline gap-2 font-serif leading-none text-[var(--color-ivory)]"
            >
              <span
                className="text-[1.55rem] tracking-[-0.022em]"
                style={{
                  fontVariationSettings: "'SOFT' 28, 'opsz' 144",
                  fontWeight: 600,
                }}
              >
                OrcaTrade
              </span>
              <span className="text-[1rem] italic text-[var(--color-ivory-mute)]">
                Group
              </span>
            </Link>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close menu"
              className="grid size-9 place-items-center border border-[var(--color-navy-line)] text-[var(--color-ivory)] transition-colors duration-300 hover:bg-[var(--color-navy-soft)]"
            >
              <svg viewBox="0 0 16 16" className="size-4" aria-hidden>
                <line x1="2" y1="2" x2="14" y2="14" stroke="currentColor" strokeWidth="1.25" />
                <line x1="14" y1="2" x2="2" y2="14" stroke="currentColor" strokeWidth="1.25" />
              </svg>
            </button>
          </div>

          {/* Nav stack — display-size serif so it feels like a chapter index */}
          <nav className="flex flex-1 flex-col gap-6 overflow-y-auto px-7 py-10">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className="font-serif text-[2.2rem] leading-tight tracking-[-0.018em] text-[var(--color-ivory)] transition-opacity duration-300 hover:opacity-70"
                style={{
                  fontVariationSettings: "'SOFT' 35, 'opsz' 144",
                  fontWeight: 550,
                }}
              >
                {item.label}
              </Link>
            ))}

            <span className="my-4 h-px bg-[var(--color-navy-line)]" />

            <Link
              href="/start"
              onClick={() => setOpen(false)}
              className="inline-flex w-fit items-center gap-3 bg-[var(--color-ivory)] px-7 py-4 text-[13px] font-semibold text-[var(--color-ink)] transition-colors duration-500 hover:bg-white"
            >
              Build my import plan
              <span aria-hidden>→</span>
            </Link>
            <Link
              href="/app/dashboard"
              onClick={() => setOpen(false)}
              className="inline-flex items-center gap-2 text-[15px] font-medium text-[var(--color-ivory-dim)] transition-colors duration-300 hover:text-[var(--color-ivory)]"
            >
              Sign in
              <span aria-hidden className="text-[var(--color-ivory-mute)]">
                ↗
              </span>
            </Link>
          </nav>

          {/* Footer of the panel — the live clocks confirm 'open globally' */}
          <div className="border-t border-[var(--color-navy-line)] px-7 py-5">
            <TimezoneClocks />
          </div>
        </div>
      )}
    </>
  );
}
