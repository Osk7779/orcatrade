'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ScrollProgress } from './scroll-progress';
import { TimezoneClocks } from './timezone-clocks';
import { MobileMenu } from './mobile-menu';
import { AccountWidget } from './account-widget';
import { detectLocale, switchLocale } from '@/lib/i18n-routes';

// Full TOOLS dropdown mirrors js/site-nav.js — every existing tool page on
// the static site is reachable from the marketing-shell header. URLs point
// at the live static pages (they keep working as they always have).
const TOOLS_GROUPS = [
  {
    heading: 'AI Agents',
    items: [
      { label: 'Agent Hub', desc: 'All 5 agents · cross-domain stories · demo prompts', href: '/agents/' },
      { label: 'Operations Orchestrator', desc: 'One agent · every domain · cross-domain plans', href: '/agent/orchestrator/' },
      { label: 'Sourcing Agent', desc: 'Where to source · supplier shortlists · risk', href: '/agent/sourcing/' },
      { label: 'Compliance Agent', desc: 'CBAM · EUDR · REACH · CE marking', href: '/agent/' },
      { label: 'Logistics Agent', desc: 'Transport · customs · 3PL · full plans', href: '/agent/logistics/' },
      { label: 'Finance Agent', desc: 'Payment terms · LC · FX · working capital', href: '/agent/finance/' },
    ],
  },
  {
    heading: 'Trade Services',
    items: [
      { label: 'Trade Documents', desc: 'CI · Packing List · COO · Bill of Lading', href: '/documents/' },
      { label: 'Insurance', desc: 'Cargo + trade-credit quotes', href: '/insurance/' },
      { label: 'Buyer Verification', desc: 'Tier-1 buyer dossiers', href: '/buyer-verification/' },
      { label: 'Samples', desc: 'HK consolidation', href: '/samples/' },
      { label: 'Returns', desc: 'Reverse logistics', href: '/returns/' },
    ],
  },
  {
    heading: 'Logistics',
    items: [
      { label: 'Routing', desc: 'Sea / rail / air comparison', href: '/routing/' },
      { label: 'Customs', desc: 'Duty + bonded warehouse', href: '/customs/' },
      { label: 'Warehouse', desc: '6-hub 3PL benchmark', href: '/warehouse/' },
    ],
  },
];

const PRIMARY = [
  { label: 'Home', href: '/' },
  { label: 'Platform', href: '/platform/' },
  { label: 'Build a plan', href: '/start/' },
];

const SECONDARY = [
  { label: 'Guides', href: '/guides/' },
  { label: 'Dashboard', href: '/dashboard/' },
  { label: 'Pricing', href: '/pricing/' },
];

type LocaleCode = 'EN' | 'PL' | 'DE';
const LOCALE_CODES: LocaleCode[] = ['EN', 'PL', 'DE'];

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
    closeTimerRef.current = setTimeout(() => setToolsOpen(false), 160);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setToolsOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <header className="sticky top-0 z-50 bg-[var(--color-ink)]/88 backdrop-blur-xl">
      <ScrollProgress />

      {/* TIER 1 — live clocks left, locale right. */}
      <div className="border-b border-[var(--color-navy-line)]/70">
        <div className="mx-auto flex h-10 max-w-[1320px] items-center justify-between gap-4 px-6 md:gap-6 md:px-9">
          <TimezoneClocks />
          <div className="hidden items-center gap-2 text-[12px] md:flex">
            {LOCALE_CODES.map((code, i) => {
              const isActive = code === currentLocale;
              const href = switchLocale(pathname, code);
              return (
                <span key={code} className="flex items-center gap-2">
                  {isActive ? (
                    <span className="font-semibold text-[var(--color-ivory)]">{code}</span>
                  ) : (
                    <a
                      href={href}
                      className="font-medium text-[var(--color-ivory-dim)] transition-colors duration-300 hover:text-[var(--color-ivory)]"
                    >
                      {code}
                    </a>
                  )}
                  {i < LOCALE_CODES.length - 1 && (
                    <span aria-hidden className="text-[var(--color-navy-line)]">
                      /
                    </span>
                  )}
                </span>
              );
            })}
          </div>
        </div>
      </div>

      {/* TIER 2 — wordmark · nav · CTA cluster */}
      <div className="border-b border-[var(--color-navy-line)]">
        <div className="mx-auto flex h-[68px] max-w-[1320px] items-center justify-between gap-6 px-6 md:h-[72px] md:gap-8 md:px-9">
          <Link
            href="/"
            className="flex items-baseline gap-2 font-serif leading-none text-[var(--color-ivory)]"
          >
            <span
              className="text-[1.55rem] tracking-[-0.022em] md:text-[1.7rem]"
              style={{ fontVariationSettings: "'SOFT' 28, 'opsz' 144", fontWeight: 600 }}
            >
              OrcaTrade
            </span>
            <span className="text-[1rem] italic text-[var(--color-ivory-mute)] md:text-[1.1rem]">
              Group
            </span>
          </Link>

          <MobileMenu />

          <nav className="hidden flex-1 items-center justify-center gap-7 md:flex lg:gap-9">
            {PRIMARY.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="group relative py-1 text-[13px] font-medium text-[var(--color-ivory-dim)] transition-colors duration-300 hover:text-[var(--color-ivory)]"
              >
                {item.label}
                <span className="absolute -bottom-0.5 left-0 h-px w-0 bg-[var(--color-ivory)]/75 transition-[width] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:w-full" />
              </Link>
            ))}

            {/* TOOLS — dropdown */}
            <div
              className="relative"
              onMouseEnter={openTools}
              onMouseLeave={scheduleClose}
            >
              <button
                type="button"
                onClick={() => setToolsOpen((v) => !v)}
                aria-expanded={toolsOpen}
                className="group relative flex items-center gap-1 py-1 text-[13px] font-medium text-[var(--color-ivory-dim)] transition-colors duration-300 hover:text-[var(--color-ivory)]"
              >
                Tools
                <span
                  aria-hidden
                  className={`text-[10px] transition-transform duration-300 ${toolsOpen ? 'rotate-180' : ''}`}
                >
                  ▾
                </span>
                <span className="absolute -bottom-0.5 left-0 h-px w-0 bg-[var(--color-ivory)]/75 transition-[width] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:w-full" />
              </button>

              {toolsOpen && (
                <div
                  className="fixed left-0 right-0 top-[112px] z-40 border-y border-[var(--color-navy-line)] bg-[var(--color-ink)]/96 backdrop-blur-2xl shadow-[0_24px_60px_-30px_rgba(0,0,0,0.7)]"
                  onMouseEnter={openTools}
                  onMouseLeave={scheduleClose}
                >
                  <div className="mx-auto grid max-w-[1320px] grid-cols-3 gap-8 px-9 py-9">
                    {TOOLS_GROUPS.map((group) => (
                      <div key={group.heading} className="flex flex-col gap-3">
                        <div className="flex items-center gap-2">
                          <span aria-hidden className="font-serif text-[12px] text-[var(--color-ivory-dim)]/55">
                            ❦
                          </span>
                          <span className="font-serif text-[11.5px] italic tracking-[0.05em] text-[var(--color-ivory-mute)] uppercase">
                            {group.heading}
                          </span>
                        </div>
                        <div className="flex flex-col gap-3">
                          {group.items.map((item) => (
                            <a
                              key={item.href}
                              href={item.href}
                              onClick={() => setToolsOpen(false)}
                              className="group/item -mx-2 flex flex-col gap-0.5 rounded-none px-2 py-1.5 transition-colors duration-300 hover:bg-[var(--color-navy-soft)]/60"
                            >
                              <span className="text-[13.5px] font-medium text-[var(--color-ivory)] transition-colors duration-300">
                                {item.label}
                              </span>
                              <span className="font-serif text-[12px] italic leading-tight text-[var(--color-ivory-mute)]">
                                {item.desc}
                              </span>
                            </a>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {SECONDARY.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="group relative py-1 text-[13px] font-medium text-[var(--color-ivory-dim)] transition-colors duration-300 hover:text-[var(--color-ivory)]"
              >
                {item.label}
                <span className="absolute -bottom-0.5 left-0 h-px w-0 bg-[var(--color-ivory)]/75 transition-[width] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:w-full" />
              </a>
            ))}
          </nav>

          <div className="hidden items-center gap-5 md:flex">
            <span aria-hidden className="h-5 w-px bg-[var(--color-navy-line)]" />
            <a
              href="/start/"
              className="group inline-flex items-center gap-2 border border-[var(--color-ivory-dim)]/35 px-5 py-2.5 text-[12.5px] font-medium text-[var(--color-ivory)] transition-all duration-500 hover:border-[var(--color-ivory-dim)] hover:bg-[var(--color-navy-soft)]"
            >
              Import plan
              <span aria-hidden className="transition-transform duration-500 group-hover:translate-x-0.5">
                →
              </span>
            </a>
            <AccountWidget />
          </div>
        </div>
      </div>
    </header>
  );
}
