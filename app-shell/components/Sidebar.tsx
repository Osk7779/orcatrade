'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

// Sidebar organised in editorial sections. Section labels are small caps
// in IBM Plex Mono — same treatment as the marketing-shell's Tools mega-
// menu. Active link gets an ivory left-rail accent + ivory text, hover
// uses the navy-soft surface.

type NavItem = { label: string; href: string; inApp?: boolean };

const SECTIONS: { heading: string; items: NavItem[] }[] = [
  {
    heading: 'Workspace',
    items: [
      { label: 'Dashboard', href: '/dashboard', inApp: true },
      { label: 'Operations', href: '/operations', inApp: true },
      { label: 'Ask the agent', href: '/chat', inApp: true },
    ],
  },
  {
    heading: 'Trade',
    items: [
      { label: 'Plans', href: '/plans', inApp: true },
      { label: 'Portfolios', href: '/portfolios', inApp: true },
      { label: 'Documents', href: '/documents', inApp: true },
      { label: 'Drafts', href: '/drafts', inApp: true },
    ],
  },
  {
    heading: 'Watch',
    items: [
      { label: 'Monitoring alerts', href: '/alerts', inApp: true },
      { label: 'Compliance calendar', href: '/calendar', inApp: true },
      { label: 'Screening', href: '/screening', inApp: true },
    ],
  },
  {
    heading: 'Account',
    items: [
      { label: 'Team', href: '/team', inApp: true },
      { label: 'Preferences', href: '/preferences', inApp: true },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname() || '';
  const [openAlerts, setOpenAlerts] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/account/alerts', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled && d && typeof d.openCount === 'number') setOpenAlerts(d.openCount); })
      .catch(() => { /* silent */ });
    return () => { cancelled = true; };
  }, []);

  return (
    <aside className="hidden md:flex w-64 shrink-0 flex-col border-r border-[var(--color-navy-line)] min-h-screen sticky top-0 max-h-screen overflow-y-auto">
      {/* Brand wordmark — matches marketing-shell Header */}
      <Link href="/dashboard" className="block px-7 py-7 border-b border-[var(--color-navy-line)] group">
        <div className="flex items-baseline gap-2">
          <span
            className="font-serif text-[1.55rem] tracking-[-0.022em] text-[var(--color-ivory)] leading-none"
            style={{ fontVariationSettings: "'SOFT' 28, 'opsz' 144", fontWeight: 600 }}
          >
            OrcaTrade
          </span>
          <span className="font-serif italic text-[1rem] text-[var(--color-ivory-mute)] leading-none">
            Operations
          </span>
        </div>
        <span className="block mt-2 font-mono text-[10px] tracking-[0.18em] uppercase text-[var(--color-ivory-mute)]">
          The cockpit
        </span>
      </Link>

      <nav className="flex-1 flex flex-col gap-7 px-5 py-6">
        {SECTIONS.map((section) => (
          <div key={section.heading} className="flex flex-col gap-1">
            <div className="flex items-center gap-2 px-3 mb-1.5">
              <span aria-hidden className="font-serif text-[11px] text-[var(--color-ivory-mute)]/55">
                ❦
              </span>
              <span className="font-mono text-[10px] tracking-[0.16em] uppercase text-[var(--color-ivory-mute)]">
                {section.heading}
              </span>
            </div>
            {section.items.map((item) => {
              const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
              const isAlerts = item.href === '/alerts';
              const badge = isAlerts && openAlerts && openAlerts > 0 ? (
                <span
                  className="ml-auto font-mono text-[10px] px-1.5 py-0.5 bg-[var(--color-critical)]/15 text-[var(--color-critical)] border border-[var(--color-critical)]/35"
                  title={`${openAlerts} open monitoring alert${openAlerts === 1 ? '' : 's'}`}
                >
                  {openAlerts > 99 ? '99+' : openAlerts}
                </span>
              ) : null;

              const baseCls =
                'group/item relative flex items-center gap-2 px-3 py-2 text-[13.5px] transition-colors duration-300';
              const stateCls = isActive
                ? 'text-[var(--color-ivory)] bg-[var(--color-navy-soft)]/60'
                : 'text-[var(--color-ivory-dim)] hover:text-[var(--color-ivory)] hover:bg-[var(--color-navy-soft)]/40';

              const inner = (
                <>
                  {isActive && (
                    <span
                      aria-hidden
                      className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[2px] bg-[var(--color-ivory)]"
                    />
                  )}
                  <span className="truncate">{item.label}</span>
                  {badge}
                </>
              );

              return item.inApp ? (
                <Link key={item.href} href={item.href} className={`${baseCls} ${stateCls}`}>
                  {inner}
                </Link>
              ) : (
                <a key={item.href} href={item.href} className={`${baseCls} ${stateCls}`}>
                  {inner}
                </a>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Footer colophon */}
      <div className="px-7 py-5 border-t border-[var(--color-navy-line)]">
        <a
          href="/account/"
          className="font-mono text-[10px] tracking-[0.14em] uppercase text-[var(--color-ivory-mute)] hover:text-[var(--color-ivory)] transition-colors"
        >
          Sign out ↗
        </a>
        <div className="mt-2 font-serif italic text-[12px] text-[var(--color-ivory-mute)]/70">
          OrcaTrade Group · MMXXVI
        </div>
      </div>
    </aside>
  );
}
