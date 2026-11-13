'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { detectLocale, switchLocale } from '@/lib/i18n-routes';
import { PRIMARY_NAV, SECONDARY_NAV, TOOLS_GROUPS } from '@/lib/nav';

const LOCALE_CODES = ['EN', 'PL', 'DE'] as const;

// Full-screen mobile menu, Apple-style: large plain links, then every
// tool grouped underneath, then language. Reads the same nav data as the
// desktop header so nothing is reachable on one and missing on the other.
export function MobileMenu() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname() || '/';
  const currentLocale = detectLocale(pathname);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => setOpen(false), [pathname]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? 'Close menu' : 'Open menu'}
        aria-expanded={open}
        className="relative z-[110] flex size-9 flex-col items-center justify-center gap-[6px] md:hidden"
      >
        <span
          className={`block h-[1.5px] w-[18px] bg-[var(--color-ivory)] transition-transform duration-300 ${open ? 'translate-y-[3.75px] rotate-45' : ''}`}
        />
        <span
          className={`block h-[1.5px] w-[18px] bg-[var(--color-ivory)] transition-transform duration-300 ${open ? '-translate-y-[3.75px] -rotate-45' : ''}`}
        />
      </button>

      {open && (
        <div
          className="fixed inset-x-0 bottom-0 top-12 z-[100] overflow-y-auto bg-white md:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Menu"
        >
          <nav className="flex flex-col px-8 pb-16 pt-6">
            {[...PRIMARY_NAV, ...SECONDARY_NAV].map((item) => (
              <a
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className="py-2 text-[28px] font-semibold tracking-[-0.02em] text-[var(--color-ivory)]"
              >
                {item.label}
              </a>
            ))}
            <a
              href="/signin"
              onClick={() => setOpen(false)}
              className="py-2 text-[28px] font-semibold tracking-[-0.02em] text-[var(--color-ivory)]"
            >
              Sign in
            </a>

            {TOOLS_GROUPS.map((group) => (
              <div key={group.heading} className="mt-8">
                <div className="mb-2 text-[12px] text-[var(--color-ivory-mute)]">{group.heading}</div>
                <ul className="flex flex-col">
                  {group.items.map((item) => (
                    <li key={item.href}>
                      <a
                        href={item.href}
                        onClick={() => setOpen(false)}
                        className="block py-1.5 text-[17px] font-medium text-[var(--color-ivory)]"
                      >
                        {item.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}

            <div className="mt-10 flex gap-5 text-[15px]" aria-label="Language">
              {LOCALE_CODES.map((code) =>
                code === currentLocale ? (
                  <span key={code} className="font-semibold text-[var(--color-ivory)]">
                    {code}
                  </span>
                ) : (
                  <a key={code} href={switchLocale(pathname, code)} className="text-[var(--color-ivory-mute)]">
                    {code}
                  </a>
                ),
              )}
            </div>
          </nav>
        </div>
      )}
    </>
  );
}
