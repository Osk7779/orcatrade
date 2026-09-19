'use client';

import Link from '@/components/marketing/smart-link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { MobileMenu } from './mobile-menu';
import { AccountWidget } from './account-widget';
import { detectLocale, switchLocale } from '@/lib/i18n-routes';
import { PRIMARY_NAV, SECONDARY_NAV, TOOLS_GROUPS } from '@/lib/nav';

type LocaleCode = 'EN' | 'PL' | 'DE';
const LOCALE_CODES: LocaleCode[] = ['EN', 'PL', 'DE'];

const linkClass =
  'text-[12.5px] text-[var(--color-ivory)]/80 transition-colors duration-200 hover:text-[var(--color-ivory)]';

// Apple-style global nav: one slim translucent bar. Wordmark left, links
// centred, locale + account + primary action right. Tools open a quiet
// full-width panel.
export function Header() {
  const pathname = usePathname() || '/';
  const currentLocale = detectLocale(pathname);
  const [toolsOpen, setToolsOpen] = useState(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function openTools() {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    setToolsOpen(true);
  }
  function scheduleClose() {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = setTimeout(() => setToolsOpen(false), 140);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setToolsOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => setToolsOpen(false), [pathname]);

  const homeHref = currentLocale === 'EN' ? '/' : `/${currentLocale.toLowerCase()}/`;

  return (
    <header className="sticky top-0 z-50 border-b border-[var(--color-navy-line)] bg-white/80 backdrop-blur-xl backdrop-saturate-150">
      <div className="mx-auto flex h-12 max-w-[1080px] items-center justify-between gap-6 px-4 md:h-[52px] md:px-6">
        <Link
          href={homeHref}
          className="flex items-baseline gap-1.5 text-[17px] font-semibold tracking-[-0.02em] text-[var(--color-ivory)]"
        >
          OrcaTrade
          <span className="font-normal text-[var(--color-ivory-mute)]">Group</span>
        </Link>

        <nav aria-label="Main" className="hidden flex-1 items-center justify-center gap-7 md:flex">
          {PRIMARY_NAV.map((item) => (
            <Link key={item.href} href={item.href} className={linkClass}>
              {item.label}
            </Link>
          ))}

          <div className="relative" onMouseEnter={openTools} onMouseLeave={scheduleClose}>
            <button
              type="button"
              onClick={() => setToolsOpen((v) => !v)}
              aria-expanded={toolsOpen}
              aria-controls="tools-panel"
              className={`${linkClass} flex items-center gap-1`}
            >
              Tools
              <svg
                viewBox="0 0 10 6"
                aria-hidden
                className={`size-2 transition-transform duration-200 ${toolsOpen ? 'rotate-180' : ''}`}
              >
                <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.3" />
              </svg>
            </button>
          </div>

          {SECONDARY_NAV.map((item) => (
            <a key={item.href} href={item.href} className={linkClass}>
              {item.label}
            </a>
          ))}
        </nav>

        <div className="hidden items-center gap-5 md:flex">
          <div className="flex items-center gap-2 text-[12px]" aria-label="Language">
            {LOCALE_CODES.map((code) =>
              code === currentLocale ? (
                <span key={code} className="font-semibold text-[var(--color-ivory)]">
                  {code}
                </span>
              ) : (
                <a
                  key={code}
                  href={switchLocale(pathname, code)}
                  className="text-[var(--color-ivory-mute)] transition-colors hover:text-[var(--color-ivory)]"
                >
                  {code}
                </a>
              ),
            )}
          </div>
          <AccountWidget />
          <a href="/start/" className="btn-primary !px-4 !py-1.5 !text-[12.5px]">
            Get started
          </a>
        </div>

        <MobileMenu />
      </div>

      {toolsOpen && (
        <div
          id="tools-panel"
          className="absolute inset-x-0 top-full hidden border-b border-[var(--color-navy-line)] bg-white/95 backdrop-blur-xl md:block"
          onMouseEnter={openTools}
          onMouseLeave={scheduleClose}
        >
          <div className="mx-auto grid max-w-[1080px] grid-cols-3 gap-10 px-6 pb-12 pt-8">
            {TOOLS_GROUPS.map((group) => (
              <div key={group.heading}>
                <div className="mb-3 text-[12px] text-[var(--color-ivory-mute)]">{group.heading}</div>
                <ul className="flex flex-col gap-2.5">
                  {group.items.map((item) => (
                    <li key={item.href}>
                      <a href={item.href} onClick={() => setToolsOpen(false)} className="group block">
                        <span className="block text-[15px] font-semibold text-[var(--color-ivory)] group-hover:text-[var(--color-link)]">
                          {item.label}
                        </span>
                        {item.desc && (
                          <span className="block text-[12.5px] text-[var(--color-ivory-mute)]">
                            {item.desc}
                          </span>
                        )}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}
    </header>
  );
}
